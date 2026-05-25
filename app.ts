/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import { App } from 'homey';
import enableDebugInspector from './app-debug';
import { SelfHealingRegistry } from './lib/self-healing-registry';
import { Logger, LogLevel } from './lib/logger';
import { DashboardService } from './lib/services/dashboard-service';
import { LiveOperationWidgetState } from './lib/services/widget-state-service';

const DEFAULT_DASHBOARD_PORT = 8090;
const ADLAR_DRIVER_ID = 'intelligent-heatpump-modbus';

interface LiveOperationWidgetDevice {
  getData(): unknown;
  getLiveOperationWidgetState?: () => LiveOperationWidgetState;
}

class MyApp extends App {

  // Self-healing registry for automatic error recovery
  private selfHealing!: SelfHealingRegistry;

  // Structured logger with configurable log levels
  private logger!: Logger;

  // Local HTTP dashboard server (ADR-041a)
  private _dashboard: DashboardService | null = null;
  private _dashboardPort = DEFAULT_DASHBOARD_PORT;

  get dashboard(): DashboardService | null {
    return this._dashboard;
  }

  getAdlarLiveOperationWidgetState(deviceId?: string): LiveOperationWidgetState {
    const devices = this._getAdlarDevices();
    if (devices.length === 0) {
      return {
        ok: false,
        message: 'Geen Adlar warmtepomp gekoppeld.',
        device: { name: '' },
        status: {
          running: false,
          compressorOn: false,
          defrosting: false,
          mode: 'Unknown',
          faultActive: '',
          connectionStatus: 'unknown',
          connectionLabel: 'Unknown',
        },
        temperatures: {
          outletC: null,
          inletC: null,
          ambientC: null,
          dhwC: null,
          bufferC: null,
        },
        process: {
          deltaTC: null,
          flowLpm: null,
          electricalPowerKw: null,
          thermalPowerKw: null,
          compressorHz: null,
          liveCopEstimate: null,
          capabilityCop: null,
          flowSource: 'none',
          powerSource: 'none',
        },
        regulation: {
          mode: 'Unknown',
          sensor: 'regelbron onbekend',
          hysteresisC: null,
          hysteresisSource: '-',
          hysteresisText: 'Hysterese onbekend',
          activeSetpointC: null,
          activeSetpointText: 'Setpoint onbekend',
          setpointDeviationC: null,
          summary: 'Regeling onbekend',
        },
        data: {
          timestamp: null,
          ageMs: null,
          freshness: 'no_data',
          sourcePollGroup: null,
        },
      };
    }

    const device = this._findAdlarDevice(devices, deviceId) ?? devices[0];
    if (typeof device.getLiveOperationWidgetState !== 'function') {
      throw new Error('Selected device does not support the live operation widget.');
    }

    return device.getLiveOperationWidgetState();
  }

  private _getAdlarDevices(): LiveOperationWidgetDevice[] {
    try {
      return this.homey.drivers
        .getDriver(ADLAR_DRIVER_ID)
        .getDevices() as LiveOperationWidgetDevice[];
    } catch {
      return [];
    }
  }

  private _findAdlarDevice(
    devices: LiveOperationWidgetDevice[],
    deviceId?: string,
  ): LiveOperationWidgetDevice | null {
    if (!deviceId) return null;

    return devices.find((device) => {
      const record = device as unknown as Record<string, unknown>;
      const data = device.getData() as Record<string, unknown>;
      const candidates = [
        record.id,
        record._id,
        data.id,
      ];
      return candidates.some((candidate) => String(candidate) === deviceId);
    }) ?? null;
  }

  async setDashboardPort(port: number): Promise<void> {
    const nextPort = Number.isInteger(port) && port >= 1 && port <= 65535
      ? port
      : DEFAULT_DASHBOARD_PORT;

    if (this._dashboard && this._dashboardPort === nextPort) {
      return;
    }

    if (this._dashboard) {
      await this._dashboard.destroy();
      this._dashboard = null;
    }

    this._dashboardPort = nextPort;
    this._dashboard = new DashboardService({
      appDir: __dirname,
      logger: (msg, ...args) => this.logger.info(String(msg), ...args),
      port: this._dashboardPort,
    });
    this._dashboard.start();
  }

  /**
   * Override Homey's log() method to route through Logger
   */
  log(message?: unknown, ...args: unknown[]): void {
    if (this.logger) {
      this.logger.info(String(message ?? ''), ...args);
    } else {
      super.log(message, ...args);
    }
  }

  /**
   * Override Homey's error() method to route through Logger
   */
  error(message?: unknown, ...args: unknown[]): void {
    if (this.logger) {
      this.logger.error(String(message ?? ''), ...args);
    } else {
      super.error(message, ...args);
    }
  }

  async onInit() {
    const logLevel = process.env.DEBUG === '1' ? LogLevel.DEBUG : LogLevel.ERROR;
    this.logger = new Logger(
      super.log.bind(this),
      super.error.bind(this),
      logLevel,
      'App',
    );
    this.logger.info('App initializing, log level:', Logger.levelToString(logLevel));

    this.selfHealing = new SelfHealingRegistry(
      (message, ...args) => this.logger.debug(message, ...args),
      this.homey,
    );

    if (process.env.DEBUG === '1') {
      await enableDebugInspector();
    }

    // Global safety net for unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.error('⚠️ UNHANDLED PROMISE REJECTION:', reason);
      this.error('Promise:', promise);
      this.homey.notifications.createNotification({
        excerpt: 'Adlar Modbus: Internal error detected',
      }).catch(() => {});
    });

    // Global safety net for uncaught exceptions
    process.on('uncaughtException', (err) => {
      this.error('⚠️ UNCAUGHT EXCEPTION:', err);
      if (err.stack) this.error('Stack:', err.stack);
      this.homey.notifications.createNotification({
        excerpt: 'Adlar Modbus: Critical error — please restart',
      }).catch(() => {});
    });

    await this.setDashboardPort(DEFAULT_DASHBOARD_PORT);

    this.logger.info('App initialized');
  }

  async onUninit() {
    if (this._dashboard) {
      await this._dashboard.destroy();
      this._dashboard = null;
    }

    if (this.selfHealing) {
      this.selfHealing.destroy();
    }
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    this.logger.info('App uninitialized');
  }
}

module.exports = MyApp;
