/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import { App } from 'homey';
import enableDebugInspector from './app-debug';
import { SelfHealingRegistry } from './lib/self-healing-registry';
import { Logger, LogLevel } from './lib/logger';
import { registerSimpleActions, registerSimpleConditions, FLOW_PATTERNS } from './lib/flow-helpers';

class MyApp extends App {

  // Self-healing registry for automatic error recovery
  private selfHealing!: SelfHealingRegistry;

  // Structured logger with configurable log levels
  private logger!: Logger;

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

    registerSimpleActions(this, FLOW_PATTERNS.simpleActions);
    registerSimpleConditions(this, FLOW_PATTERNS.simpleConditions);

    // ── Trigger run listeners: changed triggers ────────────────────────────
    (['ambient_temperature_changed', 'inlet_temperature_changed', 'outlet_temperature_changed'] as const).forEach((cardId) => {
      this.homey.flow.getDeviceTriggerCard(cardId).registerRunListener(async (args, state) => {
        const value = (state as Record<string, number>).temperature;
        const threshold = (args as Record<string, number>).temperature;
        const condition = (args as Record<string, string>).condition;
        if (condition === 'above') return value >= threshold;
        if (condition === 'below') return value <= threshold;
        return false;
      });
    });

    (['heating_mode_changed', 'fault_detected', 'work_mode_changed'] as const).forEach((cardId) => {
      this.homey.flow.getDeviceTriggerCard(cardId).registerRunListener(async () => true);
    });

    // ── Trigger run listeners: alert triggers ──────────────────────────────
    (['tank_temperature_alert', 'coiler_temperature_alert', 'discharge_temperature_alert'] as const).forEach((cardId) => {
      this.homey.flow.getDeviceTriggerCard(cardId).registerRunListener(async (args, state) => {
        const value = (state as Record<string, number>).value;
        const threshold = (args as Record<string, number>).temperature;
        const condition = (args as Record<string, string>).condition;
        if (condition === 'above') return value >= threshold;
        if (condition === 'below') return value <= threshold;
        return false;
      });
    });

    this.homey.flow.getDeviceTriggerCard('water_flow_alert').registerRunListener(async (args, state) => {
      const value = (state as Record<string, number>).value;
      const threshold = (args as Record<string, number>).flow_rate;
      const condition = (args as Record<string, string>).condition;
      if (condition === 'above') return value >= threshold;
      if (condition === 'below') return value <= threshold;
      return false;
    });

    (['compressor_efficiency_alert', 'fan_motor_efficiency_alert'] as const).forEach((cardId) => {
      this.homey.flow.getDeviceTriggerCard(cardId).registerRunListener(async (args, state) => {
        const value = (state as Record<string, number>).value;
        const threshold = (args as Record<string, number>).frequency;
        const condition = (args as Record<string, string>).condition;
        if (condition === 'above') return value >= threshold;
        if (condition === 'below') return value <= threshold;
        return false;
      });
    });

    (['eev_pulse_steps_alert', 'evi_pulse_steps_alert'] as const).forEach((cardId) => {
      this.homey.flow.getDeviceTriggerCard(cardId).registerRunListener(async (args, state) => {
        const value = (state as Record<string, number>).value;
        const threshold = (args as Record<string, number>).pulse_steps;
        const condition = (args as Record<string, string>).condition;
        if (condition === 'above') return value >= threshold;
        if (condition === 'below') return value <= threshold;
        return false;
      });
    });

    this.logger.info('App initialized');
  }

  async onUninit() {
    if (this.selfHealing) {
      this.selfHealing.destroy();
    }
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    this.logger.info('App uninitialized');
  }
}

module.exports = MyApp;
