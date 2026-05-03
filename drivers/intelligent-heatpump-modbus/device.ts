/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import os from 'os';
import Homey from 'homey';
import { DataSnapshot } from '../../lib/modbus/adlar2-modbus-service';
import { Logger, LogLevel } from '../../lib/logger';
import { ServiceCoordinator } from '../../lib/services/service-coordinator';
import {
  heatingCurveToEnumId,
  enumIdToHeatingCurve,
  userModeToWorkModeId,
  workModeIdToUserMode,
  hotWaterCurveToEnumId,
  enumIdToHotWaterCurve,
} from '../../lib/modbus/adlar-enum-mappers';
import { FAULT_DESCRIPTIONS } from '../../lib/modbus/adlar-fault-descriptions';
import { RollingCOPCalculator, type COPDataPoint } from '../../lib/services/rolling-cop-calculator';
import { SCOPCalculator, type COPMeasurement } from '../../lib/services/scop-calculator';

// ============================================================================
// CONSTANTS
// ============================================================================

const INTERNAL_POWER_CAPABILITIES = [
  'measure_power',
  'meter_power',
  'measure_voltage',
  'measure_current',
  'measure_current.comp_phase',
  'measure_current.b_phase',
  'measure_current.c_phase',
] as const;

// ============================================================================
// DEVICE SETTINGS
// ============================================================================

/* eslint-disable camelcase */
interface DeviceSettings {
  modbus_host: string;
  modbus_port: number;
  modbus_unit_id: number;
  poll_superfast_s: number;
  poll_superfast_adaptive: boolean;
  poll_fast_s: number;
  poll_medium_s: number;
  poll_slow_s: number;
  dashboard_port: number;
  log_level: string;
  enable_power_measurements: boolean;
}
/* eslint-enable camelcase */

// ============================================================================
// DEVICE CLASS
// ============================================================================

class AdlarModbusDevice extends Homey.Device {

  private coordinator: ServiceCoordinator | null = null;
  // Exposed as serviceCoordinator for shared services (e.g. FlowCardManagerService) that access it via duck-typing
  get serviceCoordinator(): ServiceCoordinator | null { return this.coordinator; }
  private logger!: Logger;
  private rollingCOP: RollingCOPCalculator | null = null;
  private scopCalc: SCOPCalculator | null = null;
  private lastCOPUpdateMs: number = 0;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onInit() {
    const settings = this.getSettings() as DeviceSettings;

    const logLevelMap: Record<string, LogLevel> = {
      error: LogLevel.ERROR,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
    };
    this.logger = new Logger(
      this.log.bind(this),
      this.error.bind(this),
      logLevelMap[settings.log_level] ?? LogLevel.ERROR,
    );

    this.logger.info('Device initializing:', this.getName());

    await this._applyDashboardPort(settings.dashboard_port ?? 8090);
    await this._ensureCapabilities();
    await this._applyPowerCapabilities(settings.enable_power_measurements ?? true);

    await this._logRestoreDiagnostics();

    this._initCOPCalculators();
    await this._restoreCOPData();

    this.coordinator = new ServiceCoordinator({
      device: this,
      logger: (msg, ...args) => this.logger.debug(msg, ...args),
      onSnapshot: (snapshot) => {
        const app = this.homey.app as unknown as { dashboard: { setSnapshot(s: DataSnapshot): void } | null };
        app.dashboard?.setSnapshot(snapshot);
      },
    });

    this._registerCapabilityListeners();

    await this.coordinator.initialize({
      host: settings.modbus_host,
      port: settings.modbus_port ?? 502,
      unitId: settings.modbus_unit_id ?? 1,
      pollSuperfastMs: (settings.poll_superfast_s ?? 5) * 1000,
      pollSuperfastAdaptive: settings.poll_superfast_adaptive ?? true,
      pollSuperfastAdaptiveMs: 2_000,
      pollFastMs: (settings.poll_fast_s ?? 10) * 1000,
      pollMediumMs: (settings.poll_medium_s ?? 30) * 1000,
      pollSlowMs: (settings.poll_slow_s ?? 300) * 1000,
    });

    this._registerDashboardCallbacks();

    // Populate read-only info settings with runtime values
    try {
      const uptimeSec = os.uptime();
      const manifestName = this.homey.manifest.name as { en?: string } | string;
      await this.setSettings({
        info_app_version: String(this.homey.manifest.version ?? ''),
        info_app_id: String(this.homey.manifest.id ?? ''),
        info_app_name: String(
          (manifestName as { en?: string })?.en ?? manifestName ?? '',
        ),
        info_homey_version: String(this.homey.version ?? ''),
        info_homey_platform: String(this.homey.platform ?? 'local'),
        info_homey_platform_version: String(this.homey.platformVersion ?? ''),
        info_node_version: process.version,
        info_platform: os.platform(),
        info_arch: os.arch(),
        info_uptime: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
      });
      this.logger.info('Info settings populated');
    } catch (error) {
      this.logger.warn('Failed to populate info settings:', error);
    }
  }

  async onSettings({ newSettings, changedKeys }: { newSettings: Partial<DeviceSettings>; changedKeys: string[] }) {
    this.logger.info('Settings changed:', changedKeys);

    if (changedKeys.includes('log_level')) {
      const logLevelMap: Record<string, LogLevel> = {
        error: LogLevel.ERROR,
        warn: LogLevel.WARN,
        info: LogLevel.INFO,
        debug: LogLevel.DEBUG,
      };
      this.logger.setLevel(logLevelMap[(newSettings.log_level as string) ?? 'error'] ?? LogLevel.ERROR);
    }

    if (this.coordinator) {
      await this.coordinator.onSettings({}, newSettings as Record<string, unknown>, changedKeys);
    }

    if (changedKeys.includes('enable_power_measurements')) {
      await this._applyPowerCapabilities((newSettings.enable_power_measurements ?? true) as boolean);
    }

    if (changedKeys.includes('dashboard_port')) {
      await this._applyDashboardPort((newSettings.dashboard_port ?? 8090) as number);
      this._registerDashboardCallbacks();
    }

    // Restart connection if connection settings changed
    const connectionKeys = [
      'modbus_host',
      'modbus_port',
      'modbus_unit_id',
      'poll_superfast_s',
      'poll_superfast_adaptive',
      'poll_fast_s',
      'poll_medium_s',
      'poll_slow_s',
    ];
    if (changedKeys.some((k) => connectionKeys.includes(k))) {
      this.logger.info('Connection settings changed — restarting coordinator');
      await this._restartCoordinator(newSettings as DeviceSettings);
    }
  }

  async onUninit() {
    this.logger.info('Device uninitializing');
    await this._saveCOPData();
    await this._destroyCoordinator();
    this._destroyCOPCalculators();
  }

  async onDeleted() {
    this.logger.info('Device deleted');
    await this._destroyCoordinator();
    this._destroyCOPCalculators();
  }

  private async _applyPowerCapabilities(enabled: boolean): Promise<void> {
    for (const cap of INTERNAL_POWER_CAPABILITIES) {
      if (enabled && !this.hasCapability(cap)) {
        await this.addCapability(cap);
        this.logger.info(`Added capability: ${cap}`);
      } else if (!enabled && this.hasCapability(cap)) {
        await this.removeCapability(cap);
        this.logger.info(`Removed capability: ${cap}`);
      }
    }
  }

  private async _applyDashboardPort(port: number): Promise<void> {
    const app = this.homey.app as unknown as {
      setDashboardPort?(dashboardPort: number): Promise<void>;
    };
    if (!app.setDashboardPort) return;
    await app.setDashboardPort(port);
  }

  private async _ensureCapabilities(): Promise<void> {
    const requiredCapabilities = [
      'adlar_firmware_mcu',
      'adlar_protocol_version',
      'measure_temperature.outlet',
    ];

    for (const capability of requiredCapabilities) {
      if (!this.hasCapability(capability)) {
        try {
          await this.addCapability(capability);
          this.logger.info(`Added missing capability: ${capability}`);
        } catch (error) {
          this.logger.warn(`Failed to add missing capability ${capability}:`, error);
        }
      }
    }

    // T7 is now modeled explicitly as measure_temperature.outlet.
    // Migrate older devices that still carry the generic measure_temperature capability.
    if (this.hasCapability('measure_temperature.outlet') && this.hasCapability('measure_temperature')) {
      try {
        await this.removeCapability('measure_temperature');
        this.logger.info('Removed legacy capability: measure_temperature');
      } catch (error) {
        this.logger.warn('Failed to remove legacy capability measure_temperature:', error);
      }
    }
  }

  // ── Coordinator lifecycle ──────────────────────────────────────────────────

  private async _destroyCoordinator(): Promise<void> {
    if (this.coordinator) {
      await this.coordinator.destroy();
      this.coordinator = null;
    }
  }

  private async _restartCoordinator(settings: DeviceSettings): Promise<void> {
    await this._destroyCoordinator();

    this.coordinator = new ServiceCoordinator({
      device: this,
      logger: (msg, ...args) => this.logger.debug(msg, ...args),
      onSnapshot: (snapshot) => {
        const app = this.homey.app as unknown as { dashboard: { setSnapshot(s: DataSnapshot): void } | null };
        app.dashboard?.setSnapshot(snapshot);
      },
    });

    this._registerCapabilityListeners();

    await this.coordinator.initialize({
      host: settings.modbus_host,
      port: settings.modbus_port ?? 502,
      unitId: settings.modbus_unit_id ?? 1,
      pollSuperfastMs: (settings.poll_superfast_s ?? 5) * 1000,
      pollSuperfastAdaptive: settings.poll_superfast_adaptive ?? true,
      pollSuperfastAdaptiveMs: 2_000,
      pollFastMs: (settings.poll_fast_s ?? 10) * 1000,
      pollMediumMs: (settings.poll_medium_s ?? 30) * 1000,
      pollSlowMs: (settings.poll_slow_s ?? 300) * 1000,
    });

    this._registerDashboardCallbacks();
  }

  /** Bindt lees/schrijf-callbacks op het dashboard zodat HTTP-requests naar Modbus worden doorgestuurd. */
  private _registerDashboardCallbacks(): void {
    type DashboardApp = {
      dashboard: {
        setWriteRegisterCallback(fn: (addr: number, rawValue: number) => Promise<void>): void;
        setReadRegisterCallback(fn: (addr: number, isCoil: boolean) => Promise<number>): void;
        setWriteExpertCallback(fn: (addr: number, rawValue: number, isCoil: boolean) => Promise<void>): void;
        setDiyHeatingCurveCallback(fn: (k: number, b: number) => Promise<void>): void;
        setGetTemperatureScaleCallback(fn: () => import('../../lib/modbus/adlar-modbus-registers').TemperatureRegisterScale): void;
      } | null;
    };
    const app = this.homey.app as unknown as DashboardApp;
    if (!app.dashboard || !this.coordinator) return;

    app.dashboard.setWriteRegisterCallback(async (addr, rawValue) => {
      await this.coordinator!.writeRaw(addr, rawValue, false);
    });

    app.dashboard.setReadRegisterCallback(async (addr, isCoil) => {
      if (isCoil) return this.coordinator!.readCoil(addr);
      return this.coordinator!.readRegister(addr);
    });

    app.dashboard.setWriteExpertCallback(async (addr, rawValue, isCoil) => {
      await this.coordinator!.writeRaw(addr, rawValue, isCoil);
    });

    app.dashboard.setDiyHeatingCurveCallback(async (k, b) => {
      await this.coordinator!.setDiyHeatingCurve(k, b);
    });

    app.dashboard.setGetTemperatureScaleCallback(() => this.coordinator!.getTemperatureScale());
  }

  // ── Snapshot → Capabilities (called by ServiceCoordinator) ────────────────


  /**
   * Called by ServiceCoordinator._handleModbusData() when new data arrives.
   */
  applyModbusSnapshot(snap: DataSnapshot): void {
    const set = (cap: string, val: unknown) => {
      if (this.hasCapability(cap)) {
        this.setCapabilityValue(cap, val).catch((e: Error) => this.logger.debug(`setCapabilityValue(${cap}) failed:`, e.message));
      }
    };

    // Control
    set('onoff', snap.control.on);
    set('target_temperature', snap.control.heatingSetpointC);
    set('target_temperature.cooling', snap.control.coolingSetpointC);
    set('target_temperature.dhw', snap.control.dhwSetpointC);
    set('adlar_hotwater', snap.control.dhwSetpointC);
    set('target_temperature.floor', snap.control.floorSetpointC);
    set('adlar_mode', String(snap.control.mode));
    set('adlar_enum_countdown_set', heatingCurveToEnumId(snap.control.heatingCurve));
    set('adlar_enum_work_mode', userModeToWorkModeId(snap.control.userMode));
    set('adlar_enum_capacity_set', hotWaterCurveToEnumId(snap.control.hotWaterCurve));

    // Status
    set('adlar_defrosting', snap.status.defrosting);
    set('adlar_running', snap.status.running);
    set('adlar_compressor_on', snap.status.compressorOn);
    set('adlar_antifreeze', snap.status.antifreeze);
    set('adlar_sterilization', snap.status.sterilization);
    set('adlar_fault_shutdown', snap.status.faultShutdown);
    set('adlar_state_compressor_state', snap.status.compressorOn);
    set('adlar_state_defrost_state', snap.status.defrosting);
    set('alarm_generic', snap.status.activeFaults.length > 0);

    if (snap.version.programVersion) {
      set('adlar_firmware_mcu', snap.version.programVersion);
    }

    if (snap.version.protocolVersionFormatted) {
      set('adlar_protocol_version', snap.version.protocolVersionFormatted);
    }

    // Temperatures
    const s = snap.sensors;
    set('measure_temperature.outlet', s.outletT7?.value);
    set('measure_temperature.inlet', s.inletT6?.value);
    set('measure_temperature.ambient', s.ambientT1?.value);
    set('measure_temperature.outer_coil', s.outerCoilT2?.value);
    set('measure_temperature.inner_coil', s.innerCoilT3?.value);
    set('measure_temperature.suction', s.suctionT4?.value);
    set('measure_temperature.exhaust', s.exhaustT5?.value);
    set('measure_temperature.dhw', s.dhwTankTemp?.value);
    set('measure_temperature.econ_in', s.econInT8?.value);
    set('measure_temperature.econ_out', s.econOutT9?.value);
    set('measure_temperature.hp_sat', s.hpSatTemp?.value);
    set('measure_temperature.lp_sat', s.lpSatTemp?.value);
    set('measure_temperature.ipm', s.ipmTemp?.value);
    set('measure_temperature.plate_hx', s.plateHxTemp?.value);
    set('measure_temperature.dhw_return', s.dhwReturnTemp?.value);
    set('measure_temperature.buffer_tank', s.bufferTankTemp?.value);
    set('measure_temperature.total_outlet', s.totalOutlet?.value);
    set('measure_temperature.zone1_mix', s.zone1MixTemp?.value);
    set('measure_temperature.zone2', s.zone2Temp?.value);

    // Power
    set('measure_power', snap.power.inputPowerKw * 1000);
    // meter_power is written exclusively by EnergyTrackingService (ETS).
    // ETS abstracts internal/external power sources and handles hardware that lacks register 0x005D.
    set('measure_voltage', snap.power.inputVoltageV);
    set('measure_current', snap.power.inputCurrentA);

    // COP
    if (snap.cop.valid) {
      set('adlar_cop', snap.cop.cop);
      set('adlar_cop_method', 'direct_thermal');
      this._addCOPMeasurement(snap);
      this._maybeUpdateRollingCOPCapabilities(set);
    } else {
      set('adlar_cop_method', 'insufficient_data');
    }

    // Mechanical sensors
    set('adlar_compressor_freq', s.compRunningFreq?.value);
    set('adlar_comp_target_freq', s.compTargetFreq?.value);
    set('adlar_fan_speed', s.fanSpeed?.value);
    set('adlar_eev_step', s.eevStep?.value);
    set('adlar_evi_step', s.eviStep?.value);
    set('adlar_pump_pwm', s.pumpPwm?.value);
    set('adlar_water_flow', s.waterFlow?.value);

    // Additional currents
    set('measure_current.comp_phase', s.compPhaseI?.value);
    set('measure_current.b_phase', s.bPhaseCurrent?.value);
    set('measure_current.c_phase', s.cPhaseCurrent?.value);

    // Fault register aggregation
    const faults = snap.status.activeFaults;
    set('adlar_fault', faults.length);
    set('adlar_fault_1', faults.some((f: string) => f.startsWith('F1.')));
    set('adlar_fault_2', faults.some((f: string) => f.startsWith('F2.')));
    set('adlar_fault_3', faults.some((f: string) => f.startsWith('F3.') || f.startsWith('SYS1_')));
    set(
      'adlar_fault_active',
      faults.length > 0
        ? faults.map((f: string) => FAULT_DESCRIPTIONS[f] ?? f).join('; ')
        : '',
    );

    // DIY heating curve parameters
    if (snap.diy) {
      set('heating_curve_slope', snap.diy.slopeK);
      set('heating_curve_intercept', snap.diy.interceptB);
      // Expand k×(T+15)+b → k×T + (k×15+b) to match the Tuya app formula display
      const effectiveIntercept = snap.diy.slopeK * 15 + snap.diy.interceptB;
      set('heating_curve_formula', `${snap.diy.slopeK.toFixed(1)} × T + ${effectiveIntercept.toFixed(1)}`);
      set('heating_curve_ref_outdoor', -7);
      set('heating_curve_ref_temp', snap.diy.calcSetpoint(-7));
    }

  }

  // ── COP Calculators ────────────────────────────────────────────────────────

  private async _logRestoreDiagnostics(): Promise<void> {
    const storeKeys: Record<string, string> = {
      cumulative_energy_kwh: 'meter_power (ETS cumulative)',
      daily_consumption_kwh: 'daily consumption (ETS)',
      external_cumulative_energy_kwh: 'adlar_external_energy_total',
      external_indoor_temp: 'adlar_external_indoor_temperature (no restore yet)',
      external_outdoor_temp: 'outdoor temp fallback (no restore yet)',
      external_wind_speed: 'wind speed (no restore yet)',
      external_solar_power: 'solar power (no restore yet)',
      external_solar_radiation: 'solar radiation (no restore yet)',
      rolling_cop_data: 'RollingCOPCalculator state',
      scop_data: 'SCOPCalculator state',
      adaptive_last_target: 'AdaptiveControlService target',
      adaptive_control_enabled: 'AdaptiveControlService enabled flag',
      building_model_state: 'BuildingModelLearner state',
      building_insights_state: 'BuildingInsightsService state',
      energy_optimizer_state: 'EnergyPriceOptimizer state',
      cop_optimizer_state: 'COPOptimizer state',
      defrost_learning_state: 'DefrostLearner state',
    };

    const lines: string[] = ['[RestoreDiagnostics] Store state at startup:'];
    for (const [key, description] of Object.entries(storeKeys)) {
      const value = await this.getStoreValue(key);
      const present = value !== null && value !== undefined;
      const summary = present
        ? (typeof value === 'object' ? `{present, ${JSON.stringify(value).length} chars}` : String(value))
        : 'absent';
      lines.push(`  ${present ? '✓' : '○'} ${key} → ${summary} (${description})`);
    }
    this.logger.info(lines.join('\n'));
  }

  private _initCOPCalculators(): void {
    this.rollingCOP = new RollingCOPCalculator({
      logger: (msg, ...args) => this.logger.debug(msg, ...args),
      device: {
        triggerFlowCard: (cardId, tokens, state) => this.triggerFlowCard(cardId, tokens, state),
        getCapabilityValue: (capability) => this.getCapabilityValue(capability),
      },
    });
    this.scopCalc = new SCOPCalculator(this);
    this.logger.debug('COP calculators initialized');
  }

  private _destroyCOPCalculators(): void {
    if (this.rollingCOP) {
      this.rollingCOP.destroy();
      this.rollingCOP = null;
    }
    if (this.scopCalc) {
      this.scopCalc.destroy();
      this.scopCalc = null;
    }
  }

  private async _restoreCOPData(): Promise<void> {
    try {
      const rollingData = await this.getStoreValue('rolling_cop_data');
      if (rollingData && this.rollingCOP) {
        this.rollingCOP.importData(rollingData);
        this.logger.debug('Restored rolling COP data');
      }
      const scopData = await this.getStoreValue('scop_data');
      if (scopData && this.scopCalc) {
        this.scopCalc.importData(scopData);
        this.logger.debug('Restored SCOP data');
      }
    } catch (e) {
      this.logger.warn('Failed to restore COP data:', (e as Error).message);
    }
  }

  private async _saveCOPData(): Promise<void> {
    try {
      if (this.rollingCOP) {
        await this.setStoreValue('rolling_cop_data', this.rollingCOP.exportData());
      }
      if (this.scopCalc) {
        await this.setStoreValue('scop_data', this.scopCalc.exportData());
      }
    } catch (e) {
      this.logger.warn('Failed to save COP data:', (e as Error).message);
    }
  }

  private _addCOPMeasurement(snap: DataSnapshot): void {
    const cop = snap.cop.cop;
    const ambientTemp = snap.sensors.ambientT1?.value ?? 0;
    const now = Date.now();

    if (this.rollingCOP) {
      const dp: COPDataPoint = {
        timestamp: now,
        cop,
        method: 'direct_thermal',
        confidence: 'high',
        electricalPower: snap.power.inputPowerKw * 1000,
        thermalOutput: snap.cop.thermalPowerKw * 1000,
        ambientTemperature: ambientTemp,
      };
      this.rollingCOP.addDataPoint(dp);
    }

    if (this.scopCalc) {
      const compFreq = snap.sensors.compRunningFreq?.value ?? 0;
      const loadRatio = Math.min(1, compFreq / 60); // normalise 0–1
      const measurement: COPMeasurement = {
        cop,
        method: 'direct_thermal',
        timestamp: now,
        ambientTemperature: ambientTemp,
        loadRatio,
        confidence: 'high',
      };
      this.scopCalc.addCOPMeasurement(measurement);
    }
  }

  private _maybeUpdateRollingCOPCapabilities(set: (cap: string, val: unknown) => void): void {
    const COP_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    if (now - this.lastCOPUpdateMs < COP_UPDATE_INTERVAL_MS) return;
    this.lastCOPUpdateMs = now;

    if (this.rollingCOP) {
      const daily = this.rollingCOP.getDailyCOP();
      if (daily) {
        set('adlar_cop_daily', +daily.averageCOP.toFixed(2));
        const trend = this.rollingCOP.getTrendAnalysis(24);
        if (trend) {
          set('adlar_cop_trend', trend.trend);
        }
      }
      const weekly = this.rollingCOP.getWeeklyCOP();
      if (weekly) set('adlar_cop_weekly', +weekly.averageCOP.toFixed(2));
      const monthly = this.rollingCOP.getMonthlyCOP();
      if (monthly) set('adlar_cop_monthly', +monthly.averageCOP.toFixed(2));
    }

    if (this.scopCalc) {
      const scopResult = this.scopCalc.calculateSCOP();
      if (scopResult) {
        set('adlar_scop', +scopResult.scop.toFixed(2));
        set('adlar_scop_quality', scopResult.dataQuality);
      }
    }
  }

  // ── Capability listeners ───────────────────────────────────────────────────

  private _registerCapabilityListeners(): void {
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      this.logger.debug('Set onoff:', value);
      if (!this.coordinator) return;
      await this.coordinator.setMainSwitch(value);
    });

    this.registerCapabilityListener('target_temperature', async (value: number) => {
      this.logger.debug('Set heating setpoint:', value);
      if (!this.coordinator) return;
      await this.coordinator.setTemperature('heating', value);
      // Persist target for adaptive control simulated-target sync on restart
      this.coordinator.getAdaptiveControl().storeTargetValue(value).catch(() => {});
    });

    this.registerCapabilityListener('target_temperature.indoor', async (value: number) => {
      this.logger.debug('Set indoor temperature setpoint:', value);
      if (!this.coordinator) return;
      await this.coordinator.setTemperature('indoor', value);
    });

    this.registerCapabilityListener('target_temperature.cooling', async (value: number) => {
      this.logger.debug('Set cooling setpoint:', value);
      if (!this.coordinator) return;
      await this.coordinator.setTemperature('cooling', value);
    });

    this.registerCapabilityListener('target_temperature.dhw', async (value: number) => {
      this.logger.debug('Set DHW setpoint:', value);
      if (!this.coordinator) return;
      await this.coordinator.setTemperature('dhw', value);
    });

    this.registerCapabilityListener('adlar_mode', async (value: string) => {
      this.logger.debug('Set mode:', value);
      if (!this.coordinator) return;
      await this.coordinator.setMode(parseInt(value, 10));
    });

    this.registerCapabilityListener('adlar_hotwater', async (value: number) => {
      this.logger.debug('Set hot water setpoint:', value);
      if (!this.coordinator) return;
      await this.coordinator.setTemperature('dhw', value);
    });

    this.registerCapabilityListener('adlar_enum_countdown_set', async (value: string) => {
      this.logger.debug('Set heating curve:', value);
      if (!this.coordinator) return;
      await this.coordinator.setHeatingCurve(enumIdToHeatingCurve(value));
    });

    this.registerCapabilityListener('adlar_enum_work_mode', async (value: string) => {
      this.logger.debug('Set work mode:', value);
      if (!this.coordinator) return;
      await this.coordinator.setUserMode(workModeIdToUserMode(value));
    });

    this.registerCapabilityListener('adlar_enum_capacity_set', async (value: string) => {
      this.logger.debug('Set hot water curve:', value);
      if (!this.coordinator) return;
      await this.coordinator.setHotWaterCurve(enumIdToHotWaterCurve(value));
    });
  }

  // ── Device helper methods (used by services via duck-typing) ─────────────────

  /**
   * Returns the best available outdoor temperature.
   * Priority 1: External ambient sensor (flow card)
   * Priority 2: Heat pump's own ambient sensor (T1)
   */
  public getOutdoorTemperatureWithFallback(): number | null {
    let temp = this.getCapabilityValue('adlar_external_ambient') as number | null;
    if (temp === null || temp === undefined) {
      temp = this.getCapabilityValue('measure_temperature.ambient') as number | null;
    }
    return (temp !== null && temp !== undefined) ? temp : null;
  }

  // ── Flow card trigger hook ─────────────────────────────────────────────────

  async triggerFlowCard(
    cardId: string,
    tokens: Record<string, unknown>,
    state?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const card = this.homey.flow.getDeviceTriggerCard(cardId);
      await card.trigger(this, tokens, state ?? {});
      this.logger.debug('triggerFlowCard:', cardId, tokens);
    } catch (err) {
      this.logger.warn('triggerFlowCard failed:', cardId, (err as Error).message);
    }
  }

}

module.exports = AdlarModbusDevice;
