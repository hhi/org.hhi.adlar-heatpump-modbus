/**
 * Generic Modbus TCP Service — jsmodbus transport layer
 *
 * Pad: Homey → Elfin EW11A (RS485-to-TCP bridge, poort 502) → WP Modbus RTU
 *
 * Protocol-agnostische Modbus TCP client:
 *   - Socket lifecycle (connect, reconnect met backoff, destroy)
 *   - FC03 (readHoldingRegisters), FC06 (writeSingleRegister), FC05 (writeSingleCoil)
 *   - Register cache (Map<address, uint16>)
 *   - Configurable multi-tier polling engine
 *   - Batch delay tussen requests (voor trage bridges)
 *
 * Bevat GEEN device-specifieke logica (registers, schaalfactoren, snapshots).
 *
 * @requires jsmodbus ^5.x.x
 */

import * as Modbus from 'jsmodbus';
import * as net from 'net';
import { EventEmitter } from 'events';

// ============================================================================
// MODBUS BLOCK ERROR — ADR-043
// ============================================================================

export type ModbusErrorCode =
  | 'unsupported'   // Illegal Data Address (Modbus exception 0x02)
  | 'protocol'      // Illegal Data Value (Modbus exception 0x03)
  | 'timeout'       // Request timeout
  | 'disconnect'    // Socket-level close/reset
  | 'unknown';

export class ModbusBlockError extends Error {
  constructor(
    message: string,
    public readonly code: ModbusErrorCode,
    public readonly blockStart: number,
    public readonly groupName: string,
    public readonly optional: boolean,
  ) {
    super(message);
    this.name = 'ModbusBlockError';
  }
}

function classifyError(err: Error): ModbusErrorCode {
  const msg = err.message.toLowerCase();
  if (msg.includes('illegal data address')) return 'unsupported';
  if (msg.includes('illegal data value'))   return 'protocol';
  if (msg.includes('timeout'))              return 'timeout';
  if (msg.includes('connection closed') || msg.includes('econnreset')) return 'disconnect';
  return 'unknown';
}

// ============================================================================
// TIMER FACADE
// ============================================================================

/**
 * Injecteerbare timer-facade.
 *
 * In Homey-context: geef `this.homey.setTimeout` / `this.homey.setInterval` mee
 * zodat Homey de timers beheert en automatisch opruimt bij app-restarts.
 *
 * In CLI / test-context: laat leeg — de standaard global timers worden gebruikt.
 */
export interface TimerProvider {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearTimeout: (handle: ReturnType<typeof setTimeout> | undefined) => void;
  clearInterval: (handle: ReturnType<typeof setInterval> | undefined) => void;
}

const GLOBAL_TIMER_PROVIDER: TimerProvider = {
  // eslint-disable-next-line homey-app/global-timers
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  // eslint-disable-next-line homey-app/global-timers
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearTimeout: (h) => {
    if (h !== undefined) clearTimeout(h);
  },
  clearInterval: (h) => {
    if (h !== undefined) clearInterval(h);
  },
};

// ============================================================================
// CONFIGURATIE
// ============================================================================

export interface ModbusTcpConfig {
  /** IP-adres van de Modbus TCP gateway (bijv. Elfin EW11A) */
  host: string;
  /** TCP-poort. Elfin EW11A Modbus TCP mode: 502 (of 1502). */
  port: number;
  /** Modbus Unit ID — in de MBAP-header meegestuurd. Default = 1. */
  unitId: number;
  /** Request timeout in ms — jsmodbus geeft een Timeout-error na deze periode */
  timeoutMs: number;
  /**
   * Extra delay tussen FC03/FC06/FC05 operaties (ms).
   * Nodig voor RS485 bridges die rust nodig hebben. 80–100 ms is veilig.
   */
  batchDelayMs: number;
  /** Max reconnect pogingen (0 = onbeperkt) */
  maxReconnects: number;
  /**
   * Optionele timer-facade voor Homey-compatibele timerbeheer.
   * Laat leeg voor CLI/test gebruik (global timers als fallback).
   */
  timerProvider?: TimerProvider;
}

const DEFAULT_CONFIG: Omit<ModbusTcpConfig, 'host'> = {
  port: 502,
  unitId: 1,
  timeoutMs: 5_000,
  batchDelayMs: 90,
  maxReconnects: 0,
};

// ============================================================================
// POLL GROUP DEFINITIE
// ============================================================================

export interface PollBlock {
  start: number;
  count: number;
  label: string;
  optional?: true;   // Afwezig = required
}

export interface PollGroup {
  name: string;
  intervalMs: number;
  blocks: readonly PollBlock[];
}

// ============================================================================
// RECONNECT CONSTANTEN
// ============================================================================

const BACKOFF_BASE = 2_000;
const BACKOFF_MAX = 60_000;

// ============================================================================
// MODBUS TCP SERVICE
// ============================================================================

/**
 * Events:
 *   'connected'                     — TCP verbinding succesvol
 *   'disconnected' (reason: string) — verbinding verbroken
 *   'reconnecting' (attempt: number, delayMs: number)
 *   'error' (err: Error, ctx: string)
 *   'poll-complete' (groupName: string) — alle blokken in poll-groep geslaagd
 *   'poll-partial'  (groupName: string) — required blokken OK, ≥1 optional blok gefaald
 */
export class ModbusTcpService extends EventEmitter {

  private readonly cfg: ModbusTcpConfig;
  private readonly _timers: TimerProvider;
  private _debug = false;

  private socket: net.Socket;
  private client: InstanceType<typeof Modbus.client.TCP>;

  /** Holding register cache: adres → unsigned 16-bit */
  private readonly cache = new Map<number, number>();

  private _connected = false;
  private _destroyed = false;
  private _reconnectN = 0;
  private _reconnectTm?: ReturnType<typeof setTimeout>;
  private _pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private _pollGroups: PollGroup[] = [];

  readonly stats = {
    polls: 0, errors: 0, reconnects: 0, lastPollMs: 0,
  };

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(cfg: Partial<ModbusTcpConfig> & { host: string }) {
    super();
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this._timers = cfg.timerProvider ?? GLOBAL_TIMER_PROVIDER;
    this.socket = new net.Socket();
    this.client = new Modbus.client.TCP(this.socket, this.cfg.unitId, this.cfg.timeoutMs);
    this._wireSocketEvents();
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Schakel debug logging in/uit */
  setDebug(on: boolean): void {
    this._debug = on;
  }

  private _log(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    if (this._debug) console.log('[ModbusTCP]', ...args);
  }

  // ── Socket event wiring ────────────────────────────────────────────────────

  private _wireSocketEvents(): void {
    this.socket.on('connect', () => {
      this._connected = true;
      this._reconnectN = 0;
      this.stats.lastPollMs = Date.now();
      this._log(`Connected to ${this.cfg.host}:${this.cfg.port} (unit ${this.cfg.unitId})`);
      this.emit('connected');
    });

    this.socket.on('close', (hadError: boolean) => {
      if (!this._connected) return;
      this._connected = false;
      this._log(`Disconnected (hadError=${hadError})`);
      this.emit('disconnected', hadError ? 'socket error' : 'remote closed');
      if (!this._destroyed) this._scheduleReconnect();
    });

    this.socket.on('error', (err: Error) => {
      this._log(`Socket error: ${err.message}`);
      this.emit('error', err, 'socket');
    });

    this.socket.on('timeout', () => {
      this._log('Socket timeout');
      this.emit('error', new Error('Socket timeout'), 'socket:timeout');
      // destroy(err) zorgt dat 'error' event geëmit wordt → connect() promise rejectt
      this.socket.destroy(new Error('Connection timeout'));
    });
  }

  // ── Verbindingsbeheer ──────────────────────────────────────────────────────

  connect(): Promise<void> {
    if (this._connected) return Promise.resolve();
    if (this._destroyed) return Promise.reject(new Error('Service destroyed'));

    this._log(`Connecting to ${this.cfg.host}:${this.cfg.port}...`);

    return new Promise((resolve, reject) => {
      let onConnect: () => void;
      let onError: (err: Error) => void;
      let onClose: () => void;

      const cleanup = () => {
        this.socket.removeListener('connect', onConnect);
        this.socket.removeListener('error', onError);
        this.socket.removeListener('close', onClose);
      };

      onConnect = () => {
        cleanup();
        resolve();
      };

      onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      onClose = () => {
        cleanup();
        reject(new Error('Socket closed during connect'));
      };

      this.socket.once('connect', onConnect);
      this.socket.once('error', onError);
      this.socket.once('close', onClose);

      this.socket.connect({ host: this.cfg.host, port: this.cfg.port });
      this.socket.setTimeout(this.cfg.timeoutMs);
    });
  }

  async disconnect(): Promise<void> {
    this._stopPolling();
    this._clearBackoff();
    this._destroyed = false;
    if (this._connected) {
      this._connected = false;
      this.socket.destroy();
      this.emit('disconnected', 'manual');
    }
  }

  async destroy(): Promise<void> {
    this._destroyed = true;
    this._stopPolling();
    this._clearBackoff();
    if (this._connected) {
      this._connected = false;
      this.socket.destroy();
    }
    this.removeAllListeners();
  }

  private _scheduleReconnect(): void {
    if (this._destroyed) return;
    this._reconnectN++;
    this.stats.reconnects++;

    const max = this.cfg.maxReconnects;
    if (max > 0 && this._reconnectN > max) {
      this.emit('error', new Error(`Max reconnects (${max}) bereikt`), 'reconnect');
      return;
    }

    const ms = Math.min(BACKOFF_BASE * 2 ** (this._reconnectN - 1), BACKOFF_MAX);
    this._log(`Reconnect #${this._reconnectN} in ${ms}ms`);
    this.emit('reconnecting', this._reconnectN, ms);

    this._reconnectTm = this._timers.setTimeout(() => {
      this._attemptReconnect().catch(() => {});
    }, ms);
  }

  private _clearBackoff(): void {
    if (this._reconnectTm) {
      this._timers.clearTimeout(this._reconnectTm);
      this._reconnectTm = undefined;
    }
  }

  private async _attemptReconnect(): Promise<void> {
    this.socket = new net.Socket();
    this.client = new Modbus.client.TCP(this.socket, this.cfg.unitId, this.cfg.timeoutMs);
    this._wireSocketEvents();

    try {
      await this.connect();
      if (this._pollGroups.length > 0) {
        this.startPolling(this._pollGroups);
      }
    } catch {
      this._scheduleReconnect();
    }
  }

  /**
   * Zorgt dat er een actieve verbinding is voor een schrijfoperatie.
   * Als er geen verbinding is, wordt de geplande backoff geannuleerd en
   * direct een herverbindingspoging gedaan — zonder backoff-vertraging.
   */
  private async _ensureConnected(): Promise<void> {
    if (this._connected) return;
    if (this._destroyed) throw new Error('Service destroyed');
    this._clearBackoff();
    this.socket = new net.Socket();
    this.client = new Modbus.client.TCP(this.socket, this.cfg.unitId, this.cfg.timeoutMs);
    this._wireSocketEvents();
    await this.connect();
    if (this._pollGroups.length > 0) {
      this.startPolling(this._pollGroups);
    }
  }

  // ── Modbus TCP operaties ──────────────────────────────────────────────────

  /**
   * FC03 — Read Holding Registers.
   * Resultaten worden opgeslagen in de interne cache.
   *
   * jsmodbus response.body.values kan zowel Buffer als number[] zijn,
   * afhankelijk van de jsmodbus versie.
   */
  async readHoldingRegisters(startAddr: number, count: number): Promise<void> {
    if (!this._connected) throw new Error('Niet verbonden');

    const addrHex = `0x${startAddr.toString(16).padStart(4, '0')}`;
    this._log(`FC03 READ  ${addrHex} count=${count}`);

    try {
      const resp = await this.client.readHoldingRegisters(startAddr, count);
      const { values } = resp.response.body;

      for (let i = 0; i < count; i++) {
        let val: number;
        if (Buffer.isBuffer(values)) {
          // jsmodbus v4: Buffer met big-endian uint16 pairs
          val = values.readUInt16BE(i * 2);
        } else if (Array.isArray(values)) {
          // jsmodbus v5: number[] array
          val = values[i] & 0xFFFF;
        } else {
          throw new Error(`Onverwacht response type: ${typeof values}`);
        }
        this.cache.set(startAddr + i, val);
      }

      if (this._debug) {
        const preview = Array.from({ length: Math.min(count, 8) }, (_, i) => {
          const a = startAddr + i;
          const v = this.cache.get(a)!;
          return `0x${a.toString(16).padStart(4, '0')}=${v}`;
        }).join(', ');
        this._log(`  → ${preview}${count > 8 ? ` ... (+${count - 8} meer)` : ''}`);
      }
    } catch (err) {
      this.stats.errors++;
      this._log(`  ✗ FC03 ${addrHex}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * FC06 — Write Single Register.
   * Cache wordt synchroon bijgewerkt na succesvolle write.
   */
  async writeSingleRegister(addr: number, value: number): Promise<void> {
    await this._ensureConnected();
    const raw = value & 0xFFFF;
    const addrHex = `0x${addr.toString(16).padStart(4, '0')}`;
    this._log(`FC06 WRITE ${addrHex} = ${raw}`);

    try {
      await this.client.writeSingleRegister(addr, raw);
      this.cache.set(addr, raw);
      this._log('  → OK');
      await this._batchDelay();
    } catch (err) {
      this.stats.errors++;
      this._log(`  ✗ FC06 ${addrHex}: ${(err as Error).message}`);
      this.emit('error', err as Error, `fc06:${addrHex}`);
      throw err;
    }
  }

  /**
   * FC05 — Write Single Coil.
   */
  async writeSingleCoil(coilAddr: number, state: boolean): Promise<void> {
    await this._ensureConnected();
    const addrHex = `0x${coilAddr.toString(16).padStart(4, '0')}`;
    this._log(`FC05 COIL  ${addrHex} = ${state ? 'ON' : 'OFF'}`);

    try {
      await this.client.writeSingleCoil(coilAddr, state);
      this._log('  → OK');
      await this._batchDelay();
    } catch (err) {
      this.stats.errors++;
      this._log(`  ✗ FC05 ${addrHex}: ${(err as Error).message}`);
      this.emit('error', err as Error, `fc05:${addrHex}`);
      throw err;
    }
  }

  private _batchDelay(): Promise<void> {
    return new Promise((r) => this._timers.setTimeout(r, this.cfg.batchDelayMs));
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  /** Unsigned 16-bit uit cache */
  u16(addr: number, dflt = 0): number {
    return this.cache.get(addr) ?? dflt;
  }

  /** Signed 16-bit (two's complement) */
  s16(addr: number, dflt = 0): number {
    const v = this.cache.get(addr);
    if (v === undefined) return dflt;
    return v > 0x7FFF ? v - 0x10000 : v;
  }

  /** Signed 16-bit met schaalfactor */
  scaled(addr: number, scale: number, dflt = 0): number {
    const v = this.cache.get(addr);
    if (v === undefined) return dflt;
    return (v > 0x7FFF ? v - 0x10000 : v) * scale;
  }

  /** Heeft de cache een waarde voor dit adres? */
  has(addr: number): boolean {
    return this.cache.has(addr);
  }

  // ── Poll-engine ────────────────────────────────────────────────────────────

  /**
   * Start multi-tier polling.
   * Poll-groepen worden opgeslagen zodat ze na reconnect
   * automatisch herstart worden met dezelfde intervallen.
   */
  startPolling(groups: PollGroup[]): void {
    this._stopPolling();
    this._pollGroups = groups;

    for (const group of groups) {
      if (group.intervalMs <= 0) {
        // Eenmalig uitvoeren (bijv. versie-info)
        this._runPollGroup(group).catch(() => {});
        continue;
      }

      // Direct eerste poll
      this._runPollGroup(group).catch(() => {});
      this._pollTimers.set(
        group.name,
        this._timers.setInterval(() => {
          this._runPollGroup(group).catch(() => {});
        }, group.intervalMs),
      );
    }
  }

  stopPolling(): void {
    this._stopPolling();
  }

  private _stopPolling(): void {
    for (const t of this._pollTimers.values()) this._timers.clearInterval(t);
    this._pollTimers.clear();
  }

  private async _runPollGroup(group: PollGroup): Promise<void> {
    if (!this._connected) return;
    let requiredFailed = false;
    let optionalFailed = false;

    for (const blk of group.blocks) {
      try {
        await this.readHoldingRegisters(blk.start, blk.count);
        await this._batchDelay();
      } catch (e) {
        const blockError = new ModbusBlockError(
          (e as Error).message,
          classifyError(e as Error),
          blk.start,
          group.name,
          blk.optional ?? false,
        );
        this.emit('error', blockError, `poll:${group.name}:block:0x${blk.start.toString(16)}`);

        if (blk.optional) { optionalFailed = true; }
        else               { requiredFailed = true; }
      }
    }

    if (requiredFailed) return; // Geen poll-complete — ModbusBlockError is al geëmit

    this.stats.polls++;
    this.stats.lastPollMs = Date.now();
    this.emit(optionalFailed ? 'poll-partial' : 'poll-complete', group.name);
  }
}
