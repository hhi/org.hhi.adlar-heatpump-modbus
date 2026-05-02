/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import { App } from 'homey';
import enableDebugInspector from './app-debug';
import { SelfHealingRegistry } from './lib/self-healing-registry';
import { Logger, LogLevel } from './lib/logger';
import { DashboardService } from './lib/services/dashboard-service';

const DEFAULT_DASHBOARD_PORT = 8090;

class MyApp extends App {

  // Self-healing registry for automatic error recovery
  private selfHealing!: SelfHealingRegistry;

  // Structured logger with configurable log levels
  private logger!: Logger;

  // Local HTTP dashboard server (ADR-041a)
  private _dashboard: DashboardService | null = null;
  private _dashboardPort = DEFAULT_DASHBOARD_PORT;

  get dashboard(): DashboardService | null { return this._dashboard; }

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
