/* eslint-disable import/prefer-default-export */
/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import { EventEmitter } from 'events';
import Homey from 'homey';
import { Adlar2ModbusService, DataSnapshot } from '../modbus/adlar2-modbus-service';
import { TimerProvider } from '../modbus/modbus-tcp-service';

export interface ModbusConnectionConfig {
  host: string;
  port?: number;
  unitId?: number;
  hasFlowMeter?: boolean;
  defaultFlowLpm?: number;
  pollFastMs?: number;
  pollMediumMs?: number;
  pollSlowMs?: number;
}

export interface ModbusConnectionOptions {
  device: Homey.Device;
  logger?: (message: string, ...args: unknown[]) => void;
  onData: (snapshot: DataSnapshot) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onError: (err: Error, context: string) => void;
}

/**
 * ModbusConnectionService wraps Adlar2ModbusService and exposes a clean interface
 * to the ServiceCoordinator — mirroring TuyaConnectionService's role in the Tuya app.
 */
export class ModbusConnectionService extends EventEmitter {
  private device: Homey.Device;
  private logger: (message: string, ...args: unknown[]) => void;
  private service: Adlar2ModbusService | null = null;
  private connected = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onData: (snapshot: DataSnapshot) => void;
  private readonly onConnected: () => void;
  private readonly onDisconnected: (reason: string) => void;
  private readonly onError: (err: Error, context: string) => void;

  constructor(options: ModbusConnectionOptions) {
    super();
    this.device = options.device;
    this.logger = options.logger || (() => {});
    this.onData = options.onData;
    this.onConnected = options.onConnected;
    this.onDisconnected = options.onDisconnected;
    this.onError = options.onError;
  }

  /**
   * Connect to the Modbus device using the provided config.
   */
  async connect(config: ModbusConnectionConfig): Promise<void> {
    this.logger('ModbusConnectionService: Connecting to', config.host);

    const timerProvider: TimerProvider = {
      setTimeout: this.device.homey.setTimeout.bind(this.device.homey),
      setInterval: this.device.homey.setInterval.bind(this.device.homey),
      clearTimeout: this.device.homey.clearTimeout.bind(this.device.homey),
      clearInterval: this.device.homey.clearInterval.bind(this.device.homey),
    };

    this.service = new Adlar2ModbusService({
      transport: {
        host: config.host,
        port: config.port ?? 502,
        unitId: config.unitId ?? 1,
        timeoutMs: 5_000,
        batchDelayMs: 90,
        maxReconnects: 0,
      },
      hasFlowMeter: config.hasFlowMeter ?? false,
      defaultFlowLpm: config.defaultFlowLpm ?? 20,
      timerProvider,
    });

    this.service.on('connected', () => {
      this.connected = true;
      this.logger('ModbusConnectionService: Connected');
      const fast = config.pollFastMs ?? 10_000;
      const medium = config.pollMediumMs ?? 30_000;
      const slow = config.pollSlowMs ?? 300_000;
      this.service!.startPolling({ fast, medium, slow });
      this.onConnected();
    });

    this.service.on('disconnected', (reason: string) => {
      this.connected = false;
      this.logger('ModbusConnectionService: Disconnected:', reason);
      this.onDisconnected(reason);
    });

    this.service.on('reconnecting', (attempt: number, delayMs: number) => {
      this.logger(`ModbusConnectionService: Reconnect attempt #${attempt} in ${delayMs}ms`);
    });

    this.service.on('data', (snapshot: DataSnapshot) => {
      this.onData(snapshot);
    });

    this.service.on('error', (err: Error, ctx: string) => {
      this.logger(`ModbusConnectionService: Error [${ctx}]:`, err.message);
      this.onError(err, ctx);
    });

    try {
      await this.service.connect();
    } catch (err) {
      this.logger('ModbusConnectionService: Initial connect failed, will retry in 30s:', (err as Error).message);
      this.retryTimer = this.device.homey.setTimeout(async () => {
        this.retryTimer = null;
        await this.connect(config);
      }, 30_000);
    }
  }

  /**
   * Write a setpoint to the device.
   */
  async setTemperature(type: 'heating' | 'cooling' | 'dhw' | 'floor' | 'indoor', value: number): Promise<void> {
    if (!this.service) throw new Error('Not connected');
    await this.service.setTemperature(type, value);
  }

  /**
   * Write the on/off switch to the device.
   */
  async setMainSwitch(value: boolean): Promise<void> {
    if (!this.service) throw new Error('Not connected');
    await this.service.setMainSwitch(value);
  }

  /**
   * Write the operating mode to the device.
   */
  async setMode(mode: number): Promise<void> {
    if (!this.service) throw new Error('Not connected');
    await this.service.setMode(mode);
  }

  async setHeatingCurve(curve: number): Promise<void> {
    if (!this.service) throw new Error('Not connected');
    await this.service.setHeatingCurve(curve);
  }

  async setHotWaterCurve(curve: number): Promise<void> {
    if (!this.service) throw new Error('Not connected');
    await this.service.setHotWaterCurve(curve);
  }

  async setUserMode(mode: 0 | 1 | 2): Promise<void> {
    if (!this.service) throw new Error('Not connected');
    await this.service.setUserMode(mode);
  }

  /**
   * Returns whether the device is currently connected.
   */
  isDeviceConnected(): boolean {
    return this.connected;
  }

  /**
   * Returns diagnostic information.
   */
  getDiagnostics(): Record<string, unknown> {
    return {
      connected: this.connected,
      hasService: !!this.service,
      hasRetryTimer: !!this.retryTimer,
    };
  }

  /**
   * Destroy the service and clean up all resources.
   */
  async destroy(): Promise<void> {
    this.logger('ModbusConnectionService: Destroying');

    if (this.retryTimer) {
      this.device.homey.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.service) {
      await this.service.destroy();
      this.service = null;
    }

    this.connected = false;
    this.removeAllListeners();
    this.logger('ModbusConnectionService: Destroyed');
  }
}
