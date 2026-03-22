/* eslint-disable import/prefer-default-export */
/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import Homey from 'homey';
import { SettingsManagerService } from './settings-manager-service';
import { CapabilityHealthService } from './capability-health-service';
import { EnergyTrackingService } from './energy-tracking-service';
import { ModbusConnectionService, ModbusConnectionConfig } from './modbus-connection-service';
import { FlowCardManagerService } from './flow-card-manager-service';
import { AdaptiveControlService } from './adaptive-control-service';
import { DataSnapshot } from '../modbus/adlar2-modbus-service';

export interface ServiceCoordinatorOptions {
  device: Homey.Device;
  logger?: (message: string, ...args: unknown[]) => void;
}

export interface ServiceInitializationResult {
  success: boolean;
  failedServices: string[];
  errors: Error[];
}

export class ServiceCoordinator {
  private device: Homey.Device;
  private logger: (message: string, ...args: unknown[]) => void;
  private isInitialized = false;

  // Service instances
  private settingsManager!: SettingsManagerService;
  private capabilityHealth!: CapabilityHealthService;
  private energyTracking!: EnergyTrackingService;
  private modbusConnection!: ModbusConnectionService;
  private flowCardManager!: FlowCardManagerService;
  private adaptiveControl!: AdaptiveControlService;

  // Service state
  private serviceHealth = new Map<string, boolean>();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Event handler references (prevent memory leaks)
  private onHealthDegradedHandler?: (data: { capability: string; healthData: unknown }) => void;
  private onHealthRecoveredHandler?: (data: { capability: string; healthData: unknown }) => void;
  private onHealthReportHandler?: (report: unknown) => void;
  private onEnergyTotalResetHandler?: () => void;
  private onEnergyDailyResetHandler?: () => void;

  constructor(options: ServiceCoordinatorOptions) {
    this.device = options.device;
    this.logger = options.logger || (() => {});

    this._initializeServices();
    this._setupEventHandlers();
  }

  private _initializeServices(): void {
    this.logger('ServiceCoordinator: Initializing services');

    const opts = { device: this.device, logger: this.logger };

    this.settingsManager = new SettingsManagerService(opts);
    this.capabilityHealth = new CapabilityHealthService(opts);
    this.energyTracking = new EnergyTrackingService(opts);

    this.adaptiveControl = new AdaptiveControlService({
      ...opts,
    });

    this.flowCardManager = new FlowCardManagerService({
      ...opts,
      onExternalPowerData: this.energyTracking.receiveExternalPowerData.bind(this.energyTracking),
      onExternalPricesData: async (prices: Record<string, number>) => {
        this.adaptiveControl.getEnergyOptimizer().setExternalPrices(prices);
        await this.device.setStoreValue('external_energy_prices', prices);
        this.logger('ServiceCoordinator: External prices forwarded to AdaptiveControlService', {
          count: Object.keys(prices).length,
        });
      },
    });

    this.modbusConnection = new ModbusConnectionService({
      ...opts,
      onData: this._handleModbusData.bind(this),
      onConnected: this._handleConnected.bind(this),
      onDisconnected: this._handleDisconnected.bind(this),
      onError: this._handleError.bind(this),
    });

    this.serviceHealth.set('settings', true);
    this.serviceHealth.set('capability', true);
    this.serviceHealth.set('energy', true);
    this.serviceHealth.set('modbus', false);
    this.serviceHealth.set('flowcard', true);
    this.serviceHealth.set('adaptive', false);

    this.logger('ServiceCoordinator: Services created');
  }

  private _setupEventHandlers(): void {
    // Remove any previously registered handlers first
    if (this.onHealthDegradedHandler) {
      this.device.removeListener('capability:health-degraded', this.onHealthDegradedHandler);
    }
    if (this.onHealthRecoveredHandler) {
      this.device.removeListener('capability:health-recovered', this.onHealthRecoveredHandler);
    }
    if (this.onHealthReportHandler) {
      this.device.removeListener('capability:health-report', this.onHealthReportHandler);
    }
    if (this.onEnergyTotalResetHandler) {
      this.device.removeListener('energy:total-reset', this.onEnergyTotalResetHandler);
    }
    if (this.onEnergyDailyResetHandler) {
      this.device.removeListener('energy:daily-reset', this.onEnergyDailyResetHandler);
    }

    this.onHealthDegradedHandler = () => {
      this.flowCardManager.updateFlowCards().catch((e) => {
        this.logger('ServiceCoordinator: updateFlowCards after health-degraded failed', e);
      });
    };
    this.device.on('capability:health-degraded', this.onHealthDegradedHandler);

    this.onHealthRecoveredHandler = () => {
      this.flowCardManager.updateFlowCards().catch((e) => {
        this.logger('ServiceCoordinator: updateFlowCards after health-recovered failed', e);
      });
    };
    this.device.on('capability:health-recovered', this.onHealthRecoveredHandler);

    this.onHealthReportHandler = (report) => {
      this.logger('ServiceCoordinator: Health report', (report as { overall?: unknown }).overall);
    };
    this.device.on('capability:health-report', this.onHealthReportHandler);

    this.onEnergyTotalResetHandler = () => {
      this.logger('ServiceCoordinator: Energy total reset');
    };
    this.device.on('energy:total-reset', this.onEnergyTotalResetHandler);

    this.onEnergyDailyResetHandler = () => {
      this.logger('ServiceCoordinator: Energy daily reset');
    };
    this.device.on('energy:daily-reset', this.onEnergyDailyResetHandler);
  }

  /**
   * Initialize runtime services and connect to the Modbus device.
   */
  async initialize(config: ModbusConnectionConfig): Promise<ServiceInitializationResult> {
    this.logger('ServiceCoordinator: Starting initialization');

    const result: ServiceInitializationResult = {
      success: true,
      failedServices: [],
      errors: [],
    };

    try {
      this.capabilityHealth.start();
      this.logger('ServiceCoordinator: CapabilityHealth started');

      await this.energyTracking.initialize();
      this.logger('ServiceCoordinator: EnergyTracking initialized');

      await this.flowCardManager.initialize();
      this.logger('ServiceCoordinator: FlowCardManager initialized');

      // Initialize AdaptiveControlService (non-critical — failure does not block device)
      try {
        await this.adaptiveControl.initialize();
        this.serviceHealth.set('adaptive', true);
        this.logger('ServiceCoordinator: AdaptiveControl initialized');
      } catch (err) {
        this.logger('ServiceCoordinator: AdaptiveControl init failed (non-critical)', err);
        result.failedServices.push('adaptive');
        result.errors.push(err as Error);
      }

      // Connect Modbus last (most likely to fail transiently)
      try {
        await this.modbusConnection.connect(config);
        this.serviceHealth.set('modbus', true);
        this.logger('ServiceCoordinator: ModbusConnection initialized');
      } catch (err) {
        this.logger('ServiceCoordinator: Modbus connect failed (will retry)', err);
        result.failedServices.push('modbus');
        result.errors.push(err as Error);
        this.serviceHealth.set('modbus', false);
      }

      this._startHealthMonitoring();
      this.isInitialized = true;

      this.logger('ServiceCoordinator: Initialization complete', {
        failedServices: result.failedServices,
      });
    } catch (err) {
      this.logger('ServiceCoordinator: Critical initialization error', err);
      result.success = false;
      result.errors.push(err as Error);
    }

    return result;
  }

  private _startHealthMonitoring(): void {
    this.healthCheckInterval = this.device.homey.setInterval(() => {
      const modbusHealthy = this.modbusConnection.isDeviceConnected();
      const prev = this.serviceHealth.get('modbus');
      if (prev !== modbusHealthy) {
        this.serviceHealth.set('modbus', modbusHealthy);
        this.logger(`ServiceCoordinator: modbus health → ${modbusHealthy}`);
        this.device.emit('service:health-changed', {
          health: Object.fromEntries(this.serviceHealth),
          timestamp: Date.now(),
        });
      }
    }, 60_000);
  }

  // ── Data handlers ──────────────────────────────────────────────────────────

  private _handleModbusData(snapshot: DataSnapshot): void {
    // Forward snapshot to device for capability updates
    const device = this.device as unknown as {
      applyModbusSnapshot?: (s: DataSnapshot) => void;
    };
    if (typeof device.applyModbusSnapshot === 'function') {
      device.applyModbusSnapshot(snapshot);
    }

    // Update capability health for key sensors
    this.capabilityHealth.updateCapabilityHealth('measure_temperature', snapshot.sensors.outletT7?.value);
    this.capabilityHealth.updateCapabilityHealth('measure_power', snapshot.power.inputPowerKw * 1000);
    this.capabilityHealth.updateCapabilityHealth('onoff', snapshot.control.on);

    // Update energy tracking
    this.energyTracking.updateIntelligentPowerMeasurement().catch((e) => {
      this.logger('ServiceCoordinator: EnergyTracking update failed', e);
    });
  }

  private _handleConnected(): void {
    this.logger('ServiceCoordinator: Modbus connected');
    this.serviceHealth.set('modbus', true);
    this.device.setAvailable().catch(() => {});
    this.energyTracking.setConnectionState(true).catch((e) => {
      this.logger('ServiceCoordinator: setConnectionState(true) failed', e);
    });
    this._setConnectionCapabilities(true, null);
  }

  private _handleDisconnected(reason: string): void {
    this.logger('ServiceCoordinator: Modbus disconnected:', reason);
    this.serviceHealth.set('modbus', false);
    this.energyTracking.setConnectionState(false).catch((e) => {
      this.logger('ServiceCoordinator: setConnectionState(false) failed', e);
    });
    this._setConnectionCapabilities(false, reason);
    this._incrementDailyDisconnectCount();
  }

  private _setConnectionCapabilities(connected: boolean, reason: string | null): void {
    const now = new Date();
    const day = now.getDate();
    const month = now.toLocaleString('en-US', { month: 'short' });
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const timestamp = `${day}-${month} ${time}`;
    const status = connected ? `Connected: ${timestamp}` : `Disconnected: ${timestamp}${reason ? ` (${reason})` : ''}`;

    if (this.device.hasCapability('adlar_connection_active')) {
      this.device.setCapabilityValue('adlar_connection_active', connected).catch(() => {});
    }
    if (this.device.hasCapability('adlar_connection_status')) {
      this.device.setCapabilityValue('adlar_connection_status', status).catch(() => {});
    }
  }

  private _incrementDailyDisconnectCount(): void {
    if (!this.device.hasCapability('adlar_daily_disconnect_count')) return;

    const current = (this.device.getCapabilityValue('adlar_daily_disconnect_count') as number | null) ?? 0;
    this.device.setCapabilityValue('adlar_daily_disconnect_count', current + 1).catch(() => {});
  }

  private _handleError(err: Error, context: string): void {
    this.logger(`ServiceCoordinator: Modbus error [${context}]:`, err.message);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async onSettings(
    oldSettings: Record<string, unknown>,
    newSettings: Record<string, unknown>,
    changedKeys: string[],
  ): Promise<void> {
    await this.settingsManager.onSettings(oldSettings, newSettings, changedKeys);
    if (this.energyTracking) {
      await this.energyTracking.onSettings(oldSettings, newSettings, changedKeys);
    }
  }

  getAdaptiveControl(): AdaptiveControlService {
    return this.adaptiveControl;
  }

  async updateFlowCards(): Promise<void> {
    const capabilitiesWithData = await this.capabilityHealth.detectCapabilitiesWithData();
    return this.flowCardManager.updateFlowCards(capabilitiesWithData);
  }

  async setTemperature(type: 'heating' | 'cooling' | 'dhw' | 'floor' | 'indoor', value: number): Promise<void> {
    return this.modbusConnection.setTemperature(type, value);
  }

  async setMainSwitch(value: boolean): Promise<void> {
    return this.modbusConnection.setMainSwitch(value);
  }

  async setMode(mode: number): Promise<void> {
    return this.modbusConnection.setMode(mode);
  }

  isConnected(): boolean {
    return this.modbusConnection.isDeviceConnected();
  }

  getServiceHealth(): Record<string, boolean> {
    return Object.fromEntries(this.serviceHealth);
  }

  getServiceDiagnostics(): Record<string, unknown> {
    return {
      coordinator: {
        initialized: this.isInitialized,
        serviceHealth: Object.fromEntries(this.serviceHealth),
      },
      modbus: this.modbusConnection.getDiagnostics(),
      capabilityHealth: this.capabilityHealth.generateDiagnosticsReport(),
    };
  }

  // ── Destroy ────────────────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    this.logger('ServiceCoordinator: Destroying');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    try {
      this.settingsManager.destroy();
      this.capabilityHealth.destroy();
      this.energyTracking.destroy();
      this.flowCardManager.destroy();
      this.adaptiveControl.destroy();
      await this.modbusConnection.destroy();
    } catch (err) {
      this.logger('ServiceCoordinator: Error during cleanup', err);
    }

    if (this.onHealthDegradedHandler) {
      this.device.removeListener('capability:health-degraded', this.onHealthDegradedHandler);
      this.onHealthDegradedHandler = undefined;
    }
    if (this.onHealthRecoveredHandler) {
      this.device.removeListener('capability:health-recovered', this.onHealthRecoveredHandler);
      this.onHealthRecoveredHandler = undefined;
    }
    if (this.onHealthReportHandler) {
      this.device.removeListener('capability:health-report', this.onHealthReportHandler);
      this.onHealthReportHandler = undefined;
    }
    if (this.onEnergyTotalResetHandler) {
      this.device.removeListener('energy:total-reset', this.onEnergyTotalResetHandler);
      this.onEnergyTotalResetHandler = undefined;
    }
    if (this.onEnergyDailyResetHandler) {
      this.device.removeListener('energy:daily-reset', this.onEnergyDailyResetHandler);
      this.onEnergyDailyResetHandler = undefined;
    }

    this.serviceHealth.clear();
    this.isInitialized = false;
    this.logger('ServiceCoordinator: Destroyed');
  }
}
