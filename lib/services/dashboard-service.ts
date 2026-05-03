/* eslint-disable import/prefer-default-export */
/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { DataSnapshot } from '../modbus/adlar2-modbus-service';
import {
  STATUS_REGISTER_MAP,
  SENSOR_REGISTERS,
  CONTROL_REGISTERS,
  P_PARAMETERS,
  L_PARAMETERS,
  COIL_ADDRESSES,
  USER_COMMANDS_REGISTERS,
  VERSION_REGISTERS,
  POLL_GROUP_SUPERFAST,
  POLL_GROUP_FAST,
  POLL_GROUP_MEDIUM,
  POLL_GROUP_SLOW,
  POLL_GROUP_ONCE,
  STATUS_1_BITS,
  STATUS_2_BITS,
  FAULT_1_BITS,
  FAULT_2_BITS,
  FAULT_3_BITS,
  SYS1_FAULT_1_BITS,
  SYS1_FAULT_2_BITS,
  SYS1_DRIVE_FAULT_1_BITS,
  SYS1_DRIVE_FAULT_2_BITS,
  SYS1_DRIVE_FAULT_3_BITS,
  RELAY_1_BITS,
  RELAY_2_BITS,
  RELAY_3_BITS,
  RELAY_4_BITS,
  SWITCH_1_BITS,
  SWITCH_2_BITS,
  SWITCH_3_BITS,
  TemperatureRegisterScale,
  scaleRegisterValue,
} from '../modbus/adlar-modbus-registers';

// ── Whitelist voor ADR-044 interactief dashboard ───────────────────────────────

interface WritableRegisterMeta {
  address: number;
  min: number;
  max: number;
  multiply: number;
  name: string;
}

const WRITABLE_REGISTERS: Record<string, WritableRegisterMeta> = {
  tempSetHeating:  { address: CONTROL_REGISTERS.tempSetHeating.address,  min: 15, max: 60, multiply: 0.1, name: 'Verwarming setpoint' },
  tempSetHotWater: { address: CONTROL_REGISTERS.tempSetHotWater.address, min: 20, max: 75, multiply: 0.1, name: 'Tapwater setpoint' },
  tempSetCooling:  { address: CONTROL_REGISTERS.tempSetCooling.address,  min: 7,  max: 25, multiply: 0.1, name: 'Koeling setpoint' },
  mainSwitch:      { address: CONTROL_REGISTERS.mainSwitch.address,      min: 0,  max: 1,  multiply: 1,   name: 'Hoofdschakelaar (0=uit, 1=aan)' },
  runningMode:     { address: CONTROL_REGISTERS.runningMode.address,     min: 0,  max: 2,  multiply: 1,   name: 'Gebruikersmodus (0=Standaard, 1=Krachtig, 2=Stil)' },
};

// ── Registermetadata types voor ADR-046 expertdashboard ───────────────────────

interface RegisterMeta {
  key: string;
  registerId?: string;
  address: number;
  name: string;
  unit?: string;
  multiply?: number;
  min?: number;
  max?: number;
  default?: number;
  desc?: string;
  isCoil?: boolean;
  serviceOnly?: boolean;
  readOnly?: boolean;
  bits?: Record<string, number>;
  pollGroups?: string[];
}

interface RegisterBlock {
  id: string;
  label: string;
  readOnly: boolean;
  registers: RegisterMeta[];
}

// ── DashboardService opties ────────────────────────────────────────────────────

export interface DashboardServiceOptions {
  /** __dirname van app.ts — basis voor het pad naar public/ */
  appDir: string;
  logger: (msg: string, ...args: unknown[]) => void;
  /** default 8090 */
  port?: number;
}

/**
 * ADR-041a / ADR-044 / ADR-046: Lokale HTTP-server die drie dashboards serveert.
 *
 * Routes:
 *   GET /                      → public/dashboard.html          (read-only)
 *   GET /dashboard.html        → public/dashboard.html
 *   GET /api/snapshot          → laatste DataSnapshot als JSON
 *   GET /interactive           → public/dashboard-interactive.html (ADR-044)
 *   GET /interactive.html      → zelfde
 *   POST /api/write            → schrijf één whitelisted register (ADR-044)
 *   GET /expert                → public/dashboard-expert.html   (ADR-046)
 *   GET /expert.html           → zelfde
 *   GET /api/registers         → alle registerblokken als JSON  (ADR-046)
 *   POST /api/expert/read      → lees één register live        (ADR-046)
 *   POST /api/expert/write     → schrijf één register/coil     (ADR-046)
 *   GET /heating-curve         → public/heating_curve_line.html (ADR-049)
 *   GET /heating-curve.html    → zelfde
 *   POST /api/set-diy-curve    → schrijf L27/L28/L29           (ADR-049)
 *   *                          → 404
 */
export class DashboardService {
  private snapshot: DataSnapshot | null = null;
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly publicDir: string;
  private readonly logger: (msg: string, ...args: unknown[]) => void;
  private readonly registerBlocksJson: string;

  // Callbacks — worden laat gebonden vanuit device.ts
  private onWriteRegister: ((address: number, rawValue: number) => Promise<void>) | null = null;
  private onReadRegister: ((address: number, isCoil: boolean) => Promise<number>) | null = null;
  private onWriteExpert: ((address: number, rawValue: number, isCoil: boolean) => Promise<void>) | null = null;
  private onSetDiyHeatingCurve: ((k: number, b: number) => Promise<void>) | null = null;
  private getTemperatureScale: (() => TemperatureRegisterScale) | null = null;

  constructor(options: DashboardServiceOptions) {
    this.port = options.port ?? 8090;
    this.publicDir = path.join(options.appDir, 'public');
    this.logger = options.logger;
    this.registerBlocksJson = JSON.stringify(buildRegisterBlocks());
  }

  // ── Publieke setters voor laat binden van callbacks ──────────────────────────

  setWriteRegisterCallback(fn: (address: number, rawValue: number) => Promise<void>): void {
    this.onWriteRegister = fn;
  }

  setReadRegisterCallback(fn: (address: number, isCoil: boolean) => Promise<number>): void {
    this.onReadRegister = fn;
  }

  setWriteExpertCallback(fn: (address: number, rawValue: number, isCoil: boolean) => Promise<void>): void {
    this.onWriteExpert = fn;
  }

  setDiyHeatingCurveCallback(fn: (k: number, b: number) => Promise<void>): void {
    this.onSetDiyHeatingCurve = fn;
  }

  setGetTemperatureScaleCallback(fn: () => TemperatureRegisterScale): void {
    this.getTemperatureScale = fn;
  }

  /** Sla de meest recente snapshot op (overschrijft de vorige). */
  setSnapshot(snapshot: DataSnapshot): void {
    this.snapshot = snapshot;
  }

  /** Start de HTTP-server. */
  start(): void {
    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res).catch((err: Error) => {
        this.logger('DashboardService: Onverwachte fout:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
      });
    });

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        this.logger(`DashboardService: Poort ${this.port} is al in gebruik — dashboard niet beschikbaar`);
      } else {
        this.logger('DashboardService: Server fout:', err.message);
      }
    });

    this.server.listen(this.port, () => {
      this.logger(`DashboardService: Gestart op http://localhost:${this.port}/`);
    });
  }

  /** Sluit de server en ruimt resources op. */
  destroy(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        this.logger('DashboardService: Gestopt');
        resolve();
      });
    });
  }

  // ── Request dispatcher ────────────────────────────────────────────────────────

  private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0];
    const method = (req.method ?? 'GET').toUpperCase();

    this._setCors(res);

    // OPTIONS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ADR-041: read-only dashboard
    if (method === 'GET' && (url === '/' || url === '/dashboard.html')) {
      await this._serveFile(res, 'dashboard.html');
      return;
    }
    if (method === 'GET' && url === '/api/snapshot') {
      this._serveSnapshot(res);
      return;
    }

    // ADR-044: interactief dashboard
    if (method === 'GET' && (url === '/interactive' || url === '/interactive.html')) {
      await this._serveFile(res, 'dashboard-interactive.html');
      return;
    }
    if (method === 'POST' && url === '/api/write') {
      await this._handleWrite(req, res);
      return;
    }

    // ADR-046: expert dashboard
    if (method === 'GET' && (url === '/expert' || url === '/expert.html')) {
      await this._serveFile(res, 'dashboard-expert.html');
      return;
    }
    if (method === 'GET' && url === '/api/registers') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(this.registerBlocksJson);
      return;
    }
    if (method === 'POST' && url === '/api/expert/read') {
      await this._handleExpertRead(req, res);
      return;
    }
    if (method === 'POST' && url === '/api/expert/write') {
      await this._handleExpertWrite(req, res);
      return;
    }

    // ADR-049: DIY stooklijn
    if (method === 'GET' && (url === '/heating-curve' || url === '/heating-curve.html')) {
      await this._serveFile(res, 'heating_curve_line.html');
      return;
    }
    if (method === 'POST' && url === '/api/set-diy-curve') {
      await this._handleSetDiyCurve(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private _setCors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  private _serveFile(res: http.ServerResponse, filename: string): Promise<void> {
    return new Promise((resolve) => {
      const filePath = path.join(this.publicDir, filename);
      fs.readFile(filePath, (err, content) => {
        if (err) {
          this.logger(`DashboardService: Fout bij laden ${filename}:`, err.message);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Error loading ${filename}`);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
        resolve();
      });
    });
  }

  private _serveSnapshot(res: http.ServerResponse): void {
    if (!this.snapshot) {
      res.writeHead(204);
      res.end();
      return;
    }
    const json = JSON.stringify(this.snapshot);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(json);
  }

  private _readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Ongeldige JSON body')); }
      });
      req.on('error', reject);
    });
  }

  private _jsonOk(res: http.ServerResponse, data?: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data ?? { ok: true }));
  }

  private _jsonError(res: http.ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: message }));
  }

  // ── ADR-044: POST /api/write ──────────────────────────────────────────────────

  private async _handleWrite(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.onWriteRegister) {
      this._jsonError(res, 503, 'Schrijf-callback niet beschikbaar');
      return;
    }

    let body: unknown;
    try { body = await this._readBody(req); } catch {
      this._jsonError(res, 400, 'Ongeldige JSON body');
      return;
    }

    const { key, value } = body as Record<string, unknown>;
    if (typeof key !== 'string' || typeof value !== 'number') {
      this._jsonError(res, 400, 'Verplichte velden: key (string), value (number)');
      return;
    }

    const meta = WRITABLE_REGISTERS[key];
    if (!meta) {
      this._jsonError(res, 400, `Onbekende registersleutel: "${key}"`);
      return;
    }

    const scaledMin = meta.min;
    const scaledMax = meta.max;
    if (value < scaledMin || value > scaledMax) {
      this._jsonError(res, 400, `Waarde buiten toegestaan bereik: min=${scaledMin}, max=${scaledMax}`);
      return;
    }

    const rawValue = Math.round(value / meta.multiply);

    try {
      await this.onWriteRegister(meta.address, rawValue);
      this._jsonOk(res);
    } catch (err) {
      this._jsonError(res, 500, (err as Error).message);
    }
  }

  // ── ADR-046: POST /api/expert/read ───────────────────────────────────────────

  private async _handleExpertRead(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.onReadRegister) {
      this._jsonError(res, 503, 'Lees-callback niet beschikbaar');
      return;
    }

    let body: unknown;
    try { body = await this._readBody(req); } catch {
      this._jsonError(res, 400, 'Ongeldige JSON body');
      return;
    }

    const { address, isCoil, multiply } = body as Record<string, unknown>;
    if (typeof address !== 'number' || address < 0 || address > 0xFFFF) {
      this._jsonError(res, 400, 'Verplicht veld: address (number 0–65535)');
      return;
    }

    const coil = isCoil === true;
    const multiplyFactor = typeof multiply === 'number' ? multiply : 1;
    const tempScale = this.getTemperatureScale?.() ?? 'x1';

    try {
      const rawValue = await this.onReadRegister(address, coil);
      const scaledValue = Math.round(scaleRegisterValue(address, rawValue, tempScale, multiplyFactor) * 10) / 10;
      this._jsonOk(res, { ok: true, rawValue, scaledValue });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === 'Niet verbonden' ? 503 : 500;
      this._jsonError(res, status, msg);
    }
  }

  // ── ADR-046: POST /api/expert/write ──────────────────────────────────────────

  private async _handleExpertWrite(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.onWriteExpert) {
      this._jsonError(res, 503, 'Expert schrijf-callback niet beschikbaar');
      return;
    }

    let body: unknown;
    try { body = await this._readBody(req); } catch {
      this._jsonError(res, 400, 'Ongeldige JSON body');
      return;
    }

    const { address, rawValue, isCoil } = body as Record<string, unknown>;
    if (typeof address !== 'number' || address < 0 || address > 0xFFFF) {
      this._jsonError(res, 400, 'Verplicht veld: address (number 0–65535)');
      return;
    }
    if (typeof rawValue !== 'number') {
      this._jsonError(res, 400, 'Verplicht veld: rawValue (number)');
      return;
    }
    const coil = isCoil === true;
    const clampedRaw = Math.round(rawValue) & 0xFFFF;

    if (coil && clampedRaw > 1) {
      this._jsonError(res, 400, 'Coil waarde moet 0 of 1 zijn');
      return;
    }

    try {
      await this.onWriteExpert(address, clampedRaw, coil);
      this._jsonOk(res);
    } catch (err) {
      this._jsonError(res, 500, (err as Error).message);
    }
  }

  // ── ADR-049: POST /api/set-diy-curve ─────────────────────────────────────────

  private async _handleSetDiyCurve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.onSetDiyHeatingCurve) {
      this._jsonError(res, 503, 'DIY stooklijn callback niet beschikbaar');
      return;
    }

    let body: unknown;
    try { body = await this._readBody(req); } catch {
      this._jsonError(res, 400, 'Ongeldige JSON body');
      return;
    }

    const { slope, intercept } = body as Record<string, unknown>;
    if (typeof slope !== 'number' || !Number.isFinite(slope)) {
      this._jsonError(res, 400, 'Verplicht veld: slope (number, bijv. -0.5)');
      return;
    }
    if (typeof intercept !== 'number' || !Number.isFinite(intercept)) {
      this._jsonError(res, 400, 'Verplicht veld: intercept (number, bijv. 55)');
      return;
    }
    if (slope < -5.0 || slope > 0.0) {
      this._jsonError(res, 400, `slope buiten bereik: min=-5.0, max=0.0`);
      return;
    }
    if (intercept < 30 || intercept > 80) {
      this._jsonError(res, 400, `intercept buiten bereik: min=30, max=80`);
      return;
    }

    try {
      await this.onSetDiyHeatingCurve(slope, intercept);
      this._jsonOk(res);
    } catch (err) {
      this._jsonError(res, 500, (err as Error).message);
    }
  }
}

// ── Registermetadata builder voor /api/registers ─────────────────────────────

function buildRegisterBlocks(): RegisterBlock[] {
  return [
    {
      id: 'blok1_status',
      label: 'Blok 1 — Status & Fault (0x0000–0x0028)',
      readOnly: true,
      registers: Object.entries(STATUS_REGISTER_MAP).map(([key, def]) => ({
        key,
        address: (def as { address: number }).address,
        name: key,
        readOnly: true,
        bits: _serializeBits(def),
        pollGroups: _pollGroupsForAddress((def as { address: number }).address),
      })),
    },
    {
      id: 'blok2_sensors',
      label: 'Blok 2 — Sensoren (0x0040–0x00FF)',
      readOnly: true,
      registers: Object.entries(SENSOR_REGISTERS).map(([key, def]) => ({
        key,
        address: (def as { address: number }).address,
        name: (def as { name: string }).name,
        unit: (def as { unit?: string }).unit,
        multiply: (def as { multiply?: number }).multiply,
        readOnly: true,
        pollGroups: _pollGroupsForAddress((def as { address: number }).address),
      })),
    },
    {
      id: 'blok3_control',
      label: 'Blok 3 — User Control (0x0300–0x0319)',
      readOnly: false,
      registers: Object.entries(CONTROL_REGISTERS).map(([key, def]) => ({
        key,
        address: (def as { address: number }).address,
        name: (def as { name: string }).name,
        unit: (def as { unit?: string }).unit,
        multiply: (def as { multiply?: number }).multiply,
        min: (def as { min?: number }).min,
        max: (def as { max?: number }).max,
        default: (def as { default?: number }).default,
        desc: (def as { desc?: string }).desc,
        pollGroups: _pollGroupsForAddress((def as { address: number }).address),
      })),
    },
    {
      id: 'blok4_pparams',
      label: 'Blok 4 — P-Parameters (0x0100–0x020B)',
      readOnly: false,
      registers: Object.entries(P_PARAMETERS).map(([key, def]) => ({
        key,
        registerId: _parameterIdFromKey(key),
        address: (def as { address: number }).address,
        name: (def as { name: string }).name,
        unit: (def as { unit?: string }).unit,
        multiply: (def as { multiply?: number }).multiply,
        min: (def as { min?: number }).min,
        max: (def as { max?: number }).max,
        default: (def as { default?: number }).default,
        desc: (def as { desc?: string }).desc,
        serviceOnly: (def as { serviceOnly?: boolean }).serviceOnly,
        pollGroups: _pollGroupsForAddress((def as { address: number }).address),
      })),
    },
    {
      id: 'blok5_lparams',
      label: 'Blok 5 — L-Parameters (0x0800–0x0819)',
      readOnly: false,
      registers: Object.entries(L_PARAMETERS).map(([key, def]) => ({
        key,
        registerId: _parameterIdFromKey(key),
        address: (def as { address: number }).address,
        name: (def as { name: string }).name,
        unit: (def as { unit?: string }).unit,
        multiply: (def as { multiply?: number }).multiply,
        min: (def as { min?: number }).min,
        max: (def as { max?: number }).max,
        default: (def as { default?: number }).default,
        desc: (def as { desc?: string }).desc,
        serviceOnly: (def as { serviceOnly?: boolean }).serviceOnly,
        pollGroups: _pollGroupsForAddress((def as { address: number }).address),
      })),
    },
    {
      id: 'blok6_coils',
      label: 'Blok 6 — Coils (0x1000–0x1023)',
      readOnly: false,
      registers: Object.entries(COIL_ADDRESSES).map(([key, def]) => ({
        key,
        address: (def as { address: number }).address,
        name: (def as { name: string }).name,
        isCoil: true,
        serviceOnly: (def as { serviceOnly?: boolean }).serviceOnly,
        pollGroups: [],
      })),
    },
    {
      id: 'blok7_commands',
      label: 'Blok 7 — User Commands (0x0330–0x0345)',
      readOnly: false,
      registers: Object.entries(USER_COMMANDS_REGISTERS).map(([key, def]) => ({
        key,
        address: (def as { address: number }).address,
        name: (def as { name: string }).name,
        unit: (def as { unit?: string }).unit,
        min: (def as { min?: number }).min,
        max: (def as { max?: number }).max,
        desc: (def as { desc?: string }).desc,
        serviceOnly: (def as { serviceOnly?: boolean }).serviceOnly,
        bits: _serializeBits(def),
        pollGroups: _pollGroupsForAddress((def as { address: number }).address),
      })),
    },
    {
      id: 'blok8_version',
      label: 'Blok 8 — Versie Info (0x0360–0x0363)',
      readOnly: true,
      registers: Object.entries(VERSION_REGISTERS).map(([key, def]) => ({
        key,
        address: (def as { address: number }).address,
        name: (def as { name: string }).name,
        desc: (def as { desc?: string }).desc,
        readOnly: true,
        pollGroups: _pollGroupsForAddress((def as { address: number }).address),
      })),
    },
  ];
}

function _pollGroupsForAddress(address: number): string[] {
  const groups = [
    POLL_GROUP_SUPERFAST,
    POLL_GROUP_FAST,
    POLL_GROUP_MEDIUM,
    POLL_GROUP_SLOW,
    POLL_GROUP_ONCE,
  ];

  return groups
    .filter((group) => group.reads.some((read) => address >= read.start && address < read.start + read.count))
    .map((group) => group.name);
}

function _parameterIdFromKey(key: string): string | undefined {
  const match = key.match(/^([PL]\d+)_/);
  return match?.[1];
}

function _serializeBits(def: unknown): Record<string, number> | undefined {
  const bits = (def as { bits?: Record<string, number> }).bits;
  if (!bits) return undefined;
  return Object.fromEntries(
    Object.entries(bits).map(([k, v]) => [k, Number(v)]),
  );
}

// Bits-constanten worden geïmporteerd zodat de compiler ze als gebruikt beschouwt
// (ze zijn indirect gebruikt via STATUS_REGISTER_MAP en USER_COMMANDS_REGISTERS)
void [
  STATUS_1_BITS, STATUS_2_BITS, FAULT_1_BITS, FAULT_2_BITS, FAULT_3_BITS,
  SYS1_FAULT_1_BITS, SYS1_FAULT_2_BITS, SYS1_DRIVE_FAULT_1_BITS,
  SYS1_DRIVE_FAULT_2_BITS, SYS1_DRIVE_FAULT_3_BITS,
  RELAY_1_BITS, RELAY_2_BITS, RELAY_3_BITS, RELAY_4_BITS,
  SWITCH_1_BITS, SWITCH_2_BITS, SWITCH_3_BITS,
];
