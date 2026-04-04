/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
/**
 * Adlar Castra Aurora II — Modbus Service v3
 *
 * Runtime service bovenop ModbusTcpService.
 * Registermetadata, schaalfactoren, ranges, poll-groepen en decode-helpers
 * komen uit adlar-modbus-registers.ts.
 */

import { EventEmitter } from 'events';

import {
  ModbusTcpConfig, ModbusTcpService, PollBlock, PollGroup, TimerProvider,
} from './modbus-tcp-service';
import {
  COIL_ADDRESSES,
  CONTROL_REGISTERS,
  L_PARAMETERS,
  MODE_OPTIONS,
  P_PARAMETERS,
  POLL_GROUP_FAST,
  POLL_GROUP_MEDIUM,
  POLL_GROUP_ONCE,
  POLL_GROUP_SLOW,
  SENSOR_REGISTERS,
  STATUS_1_BITS,
  STATUS_2_BITS,
  STATUS_REGISTER_MAP,
  VERSION_REGISTERS,
  calculateDIYCurveTemp,
  decodeFaults,
  encodeTemperature,
  interpolateCalibration,
  protocolSupportsCoils,
  validateRefrigerant,
} from './adlar-modbus-registers';

interface CalibrationPoint {
  raw: number;
  actual: number;
}

interface NumericRegisterDefinition {
  address: number;
  name: string;
  unit?: string;
  multiply?: number;
  min?: number;
  max?: number;
  calibrationCurve?: ReadonlyArray<CalibrationPoint>;
}

interface RegisterPollGroupDefinition {
  name: string;
  interval: number;
  reads: readonly PollBlock[];
}

interface SensorDescriptor {
  key: string;
  def: NumericRegisterDefinition;
  signed?: boolean;
}

const WATER_THERMAL_FACTOR = 4.186 / 60;
const MIN_COP_POWER_KW = 0.10;
const MIN_COP_DELTA_T_C = 0.5;
const MAX_VALID_COP = 15.0;

const EXTRA_FAST_BLOCKS: PollBlock[] = [
  {
    start: STATUS_REGISTER_MAP.compressorTargetFreq1.address,
    count: 1,
    label: 'Compressor target frequency',
  },
];

const COMP_TARGET_FREQ_DEF: NumericRegisterDefinition = {
  address: STATUS_REGISTER_MAP.compressorTargetFreq1.address,
  name: 'Compressor Target Frequency',
  unit: 'Hz',
  multiply: 1,
};

const SENSOR_DESCRIPTORS: readonly SensorDescriptor[] = [
  { key: 'compRunningFreq', def: SENSOR_REGISTERS.compressorRunningFreq },
  { key: 'compTargetFreq', def: COMP_TARGET_FREQ_DEF },
  { key: 'fanSpeed', def: SENSOR_REGISTERS.fanRunningSpeed },
  { key: 'eevStep', def: SENSOR_REGISTERS.eevOpenStep },
  { key: 'eviStep', def: SENSOR_REGISTERS.eviValveOpenStep },
  { key: 'pumpPwm', def: SENSOR_REGISTERS.waterPumpSpeedPWM },
  { key: 'waterFlow', def: SENSOR_REGISTERS.waterFlow },
  { key: 'acVoltage', def: SENSOR_REGISTERS.acInputVoltage },
  { key: 'acCurrent', def: SENSOR_REGISTERS.acInputCurrent },
  { key: 'compPhaseI', def: SENSOR_REGISTERS.compressorPhaseCurrent },
  { key: 'unitVoltage', def: SENSOR_REGISTERS.deviceInputVoltage },
  { key: 'unitCurrent', def: SENSOR_REGISTERS.deviceInputCurrent },
  { key: 'unitPower', def: SENSOR_REGISTERS.deviceInputPower },
  { key: 'totalEnergy', def: SENSOR_REGISTERS.totalEnergyConsumption },
  { key: 'ipmTemp', def: SENSOR_REGISTERS.compressorIpmTemp, signed: true },
  { key: 'hpSatTemp', def: SENSOR_REGISTERS.highPressureSatTemp, signed: true },
  { key: 'lpSatTemp', def: SENSOR_REGISTERS.lowPressureSatTemp, signed: true },
  { key: 'ambientT1', def: SENSOR_REGISTERS.ambientTempT1, signed: true },
  { key: 'outerCoilT2', def: SENSOR_REGISTERS.outerCoilTempT2, signed: true },
  { key: 'innerCoilT3', def: SENSOR_REGISTERS.innerCoilTempT3, signed: true },
  { key: 'suctionT4', def: SENSOR_REGISTERS.suctionTempT4, signed: true },
  { key: 'exhaustT5', def: SENSOR_REGISTERS.exhaustTempT5, signed: true },
  { key: 'inletT6', def: SENSOR_REGISTERS.waterInletTempT6, signed: true },
  { key: 'outletT7', def: SENSOR_REGISTERS.waterOutletTempT7, signed: true },
  { key: 'econInT8', def: SENSOR_REGISTERS.economizerInletT8, signed: true },
  { key: 'econOutT9', def: SENSOR_REGISTERS.economizerOutletT9, signed: true },
  { key: 'dhwTankTemp', def: SENSOR_REGISTERS.waterTankTemp, signed: true },
  { key: 'plateHxTemp', def: SENSOR_REGISTERS.plateHxExhaustTemp, signed: true },
  { key: 'dhwReturnTemp', def: SENSOR_REGISTERS.dhwReturnWaterTemp, signed: true },
  { key: 'bufferTankTemp', def: SENSOR_REGISTERS.bufferTankTemp, signed: true },
  { key: 'totalOutlet', def: SENSOR_REGISTERS.totalWaterOutletTemp, signed: true },
  { key: 'zone1MixTemp', def: SENSOR_REGISTERS.zone1MixingTemp, signed: true },
  { key: 'zone2Temp', def: SENSOR_REGISTERS.zone2Temp, signed: true },
  { key: 'bPhaseCurrent', def: SENSOR_REGISTERS.bPhaseCurrent },
  { key: 'cPhaseCurrent', def: SENSOR_REGISTERS.cPhaseCurrent },
];

export interface SensorValue {
  address: number;
  raw: number;
  value: number;
  unit: string;
  label: string;
}

export interface StatusSnapshot {
  running: boolean;
  waiting: boolean;
  defrosting: boolean;
  antifreeze: boolean;
  sterilization: boolean;
  compressorOn: boolean;
  faultAlarm: boolean;
  faultShutdown: boolean;
  activeFaults: string[];
}

export interface ControlSnapshot {
  on: boolean;
  mode: number;
  modeName: string;
  userMode: number;
  heatingSetpointC: number;
  coolingSetpointC: number;
  dhwSetpointC: number;
  floorSetpointC: number;
  heatingCurve: number;
  hotWaterCurve: number;
  protocolVersion: number;
  coilsAvailable: boolean;
}

export interface PowerSnapshot {
  inputPowerKw: number;
  inputCurrentA: number;
  inputVoltageV: number;
  totalEnergyKwh: number;
  derivedPowerKw: number;
}

export interface CopSnapshot {
  thermalPowerKw: number;
  electricalPowerKw: number;
  cop: number;
  deltaTc: number;
  flowLpm: number;
  ambientTempC: number;
  valid: boolean;
  reason?: string;
}

export interface DiyHeatingCurve {
  active: boolean;
  slopeK: number;
  interceptB: number;
  calcSetpoint(ambientC: number): number;
}

export interface DataSnapshot {
  ts: number;
  status: StatusSnapshot;
  control: ControlSnapshot;
  power: PowerSnapshot;
  cop: CopSnapshot;
  sensors: Record<string, SensorValue>;
  diy?: DiyHeatingCurve;
}

type SetpointType = 'heating' | 'cooling' | 'dhw' | 'floor' | 'indoor';
type FreqZone = 'above0' | 'neg7to0' | 'below7';

const SETPOINT_DEFINITIONS: Record<SetpointType, NumericRegisterDefinition> = {
  heating: CONTROL_REGISTERS.tempSetHeating,
  cooling: CONTROL_REGISTERS.tempSetCooling,
  dhw: CONTROL_REGISTERS.tempSetHotWater,
  floor: CONTROL_REGISTERS.tempSetFloorHeating,
  indoor: CONTROL_REGISTERS.indoorTempSetpoint,
};

const HEATING_MIN_FREQ_DEFINITIONS: Record<FreqZone, NumericRegisterDefinition> = {
  above0: P_PARAMETERS.P57_heatingMinFreq_above0,
  neg7to0: P_PARAMETERS.P58_heatingMinFreq_neg10to0,
  below7: P_PARAMETERS.P59_heatingMinFreq_below10,
};

export interface Adlar2ModbusConfig {
  transport: Partial<ModbusTcpConfig> & { host: string };
  /**
   * Optionele timer-facade — geef `this.homey` timers mee vanuit het Homey device.
   * Laat leeg voor CLI/test gebruik.
   */
  timerProvider?: TimerProvider;
}

function toRuntimePollGroup(
  def: RegisterPollGroupDefinition,
  extraBlocks: readonly PollBlock[] = [],
): PollGroup {
  return {
    name: def.name,
    intervalMs: def.interval,
    blocks: [
      ...extraBlocks.map((block) => ({ ...block })),
      ...def.reads.map((block) => ({ ...block })),
    ],
  };
}

const ADLAR2_POLL_FAST = toRuntimePollGroup(POLL_GROUP_FAST, EXTRA_FAST_BLOCKS);
const ADLAR2_POLL_MEDIUM = toRuntimePollGroup(POLL_GROUP_MEDIUM);
const ADLAR2_POLL_SLOW = toRuntimePollGroup(POLL_GROUP_SLOW);
const ADLAR2_POLL_ONCE = toRuntimePollGroup(POLL_GROUP_ONCE);

function modeName(mode: number): string {
  for (const [rawMode, label] of Object.entries(MODE_OPTIONS)) {
    if (Number(rawMode) === mode) {
      return label;
    }
  }

  return `Mode(${mode})`;
}

function isKnownMode(mode: number): boolean {
  return modeName(mode) !== `Mode(${mode})`;
}

function rangeText(def: NumericRegisterDefinition): string {
  const unit = def.unit ?? '';

  if (def.min !== undefined && def.max !== undefined) {
    return `[${def.min}–${def.max}]${unit}`;
  }

  if (def.min !== undefined) {
    return `>= ${def.min}${unit}`;
  }

  if (def.max !== undefined) {
    return `<= ${def.max}${unit}`;
  }

  return '';
}

function assertRange(def: NumericRegisterDefinition, value: number): void {
  if (def.min !== undefined && value < def.min) {
    throw new Error(`${def.name} ${value}${def.unit ?? ''} buiten bereik ${rangeText(def)}`);
  }

  if (def.max !== undefined && value > def.max) {
    throw new Error(`${def.name} ${value}${def.unit ?? ''} buiten bereik ${rangeText(def)}`);
  }
}

function clonePollGroup(group: PollGroup, intervalMs: number): PollGroup {
  return {
    name: group.name,
    intervalMs,
    blocks: group.blocks.map((block) => ({ ...block })),
  };
}

export class Adlar2ModbusService extends EventEmitter {

  private readonly tcp: ModbusTcpService;
  private externalFlowLpm: number | null = null;
  private lastFaults: string[] = [];

  constructor(config: Adlar2ModbusConfig) {
    super();

    this.tcp = new ModbusTcpService({ ...config.transport, timerProvider: config.timerProvider });

    this.tcp.on('disconnected', (reason) => this.emit('disconnected', reason));
    this.tcp.on('reconnecting', (attempt, delayMs) => this.emit('reconnecting', attempt, delayMs));
    this.tcp.on('error', (err, ctx) => this.emit('error', err, ctx));

    this.tcp.on('connected', () => {
      this.runInitValidation()
        .then(() => {
          this.emit('connected');
        })
        .catch((err) => {
          this.emit('error', err as Error, 'init-validation');
        });
    });

    this.tcp.on('poll-complete', (groupName) => {
      if (groupName !== ADLAR2_POLL_FAST.name) {
        return;
      }

      const snapshot = this.buildSnapshot();
      this.emit('data', snapshot);
      this.checkFaults(snapshot.status.activeFaults);
    });
  }

  get connected(): boolean {
    return this.tcp.connected;
  }

  get stats() {
    return this.tcp.stats;
  }

  async connect(): Promise<void> {
    await this.tcp.connect();
  }

  startPolling(ms?: { fast?: number; medium?: number; slow?: number }): void {
    const groups: PollGroup[] = [
      clonePollGroup(ADLAR2_POLL_ONCE, ADLAR2_POLL_ONCE.intervalMs),
      clonePollGroup(ADLAR2_POLL_FAST, ms?.fast ?? ADLAR2_POLL_FAST.intervalMs),
      clonePollGroup(ADLAR2_POLL_MEDIUM, ms?.medium ?? ADLAR2_POLL_MEDIUM.intervalMs),
      clonePollGroup(ADLAR2_POLL_SLOW, ms?.slow ?? ADLAR2_POLL_SLOW.intervalMs),
    ];

    this.tcp.startPolling(groups);
  }

  stopPolling(): void {
    this.tcp.stopPolling();
  }

  async disconnect(): Promise<void> {
    await this.tcp.disconnect();
  }

  async destroy(): Promise<void> {
    this.removeAllListeners();
    await this.tcp.destroy();
  }

  getSnapshot(): DataSnapshot {
    return this.buildSnapshot();
  }

  async validateRefrigerant(): Promise<{ valid: boolean; type: number; name: string }> {
    await this.tcp.readHoldingRegisters(P_PARAMETERS.P119_refrigerantType.address, 1);
    const result = validateRefrigerant(this.tcp.u16(P_PARAMETERS.P119_refrigerantType.address));

    return {
      valid: result.valid,
      type: result.type,
      name: result.name,
    };
  }

  async getProtocolVersion(): Promise<number> {
    await this.tcp.readHoldingRegisters(VERSION_REGISTERS.protocolVersion.address, 1);
    return this.tcp.u16(VERSION_REGISTERS.protocolVersion.address);
  }

  async readRegister(addr: number): Promise<number> {
    await this.tcp.readHoldingRegisters(addr, 1);
    return this.tcp.s16(addr);
  }

  async writeRegister(addr: number, value: number): Promise<void> {
    await this.tcp.writeSingleRegister(addr, value);
  }

  async writeCoil(addr: number, state: boolean): Promise<void> {
    await this.tcp.writeSingleCoil(addr, state);
  }

  async setMainSwitch(on: boolean): Promise<void> {
    await this.tcp.writeSingleRegister(CONTROL_REGISTERS.mainSwitch.address, on ? 1 : 0);
  }

  async setMode(mode: number): Promise<void> {
    if (!isKnownMode(mode)) {
      throw new Error(`Ongeldige mode ${mode}`);
    }

    await this.tcp.writeSingleRegister(CONTROL_REGISTERS.mode.address, mode);
  }

  async setTemperature(type: SetpointType, tempC: number): Promise<void> {
    const def = SETPOINT_DEFINITIONS[type];
    assertRange(def, tempC);
    await this.tcp.writeSingleRegister(def.address, encodeTemperature(tempC));
  }

  async setHeatingCurve(curve: number): Promise<void> {
    const def = CONTROL_REGISTERS.heatingCurve;
    assertRange(def, curve);
    await this.tcp.writeSingleRegister(def.address, curve);
  }

  async setHotWaterCurve(curve: number): Promise<void> {
    const def = CONTROL_REGISTERS.hotWaterCurve;
    assertRange(def, curve);
    await this.tcp.writeSingleRegister(def.address, curve);
  }

  async setUserMode(mode: 0 | 1 | 2): Promise<void> {
    await this.tcp.writeSingleRegister(CONTROL_REGISTERS.runningMode.address, mode);
  }

  async setPowerfulMode(on: boolean): Promise<void> {
    await this.writeNamedCoil(COIL_ADDRESSES.powerfulMode, on);
  }

  async setSilentMode(on: boolean): Promise<void> {
    await this.writeNamedCoil(COIL_ADDRESSES.silentMode, on);
  }

  async forceDefrost(): Promise<void> {
    await this.writeNamedCoil(COIL_ADDRESSES.forceDefrost, true);
  }

  async forceSterilization(): Promise<void> {
    await this.writeNamedCoil(COIL_ADDRESSES.forceSterilization, true);
  }

  async setHeatingMinFreq(zone: FreqZone, hz: number): Promise<void> {
    const def = HEATING_MIN_FREQ_DEFINITIONS[zone];
    assertRange(def, hz);
    await this.tcp.writeSingleRegister(def.address, hz);
  }

  async setDhwMinFreq(hz: number): Promise<void> {
    const def = P_PARAMETERS.P63_hotWaterMinFreq_above0;
    assertRange(def, hz);
    await this.tcp.writeSingleRegister(def.address, hz);
  }

  async setPumpSpeeds(maxPct: number, constPct: number): Promise<void> {
    assertRange(P_PARAMETERS.P260_pumpMaxSpeed, maxPct);
    assertRange(P_PARAMETERS.P261_pumpConstTempSpeed, constPct);

    await this.tcp.writeSingleRegister(P_PARAMETERS.P260_pumpMaxSpeed.address, maxPct);
    await this.tcp.writeSingleRegister(P_PARAMETERS.P261_pumpConstTempSpeed.address, constPct);
  }

  async setDiyHeatingCurve(k: number, b: number): Promise<void> {
    const rawK = Math.round(k * 10);
    assertRange(L_PARAMETERS.L28_heatingCurveCoeffK, rawK);
    assertRange(L_PARAMETERS.L29_heatingCurveConstantB, b);

    await this.tcp.writeSingleRegister(L_PARAMETERS.L27_heatingLowTempCurveDIY.address, 0);
    await this.tcp.writeSingleRegister(L_PARAMETERS.L28_heatingCurveCoeffK.address, Math.round(k * -10));
    await this.tcp.writeSingleRegister(L_PARAMETERS.L29_heatingCurveConstantB.address, encodeTemperature(b));
    await this.tcp.writeSingleRegister(CONTROL_REGISTERS.heatingCurve.address, 0);
  }

  async disableDiyHeatingCurve(): Promise<void> {
    await this.tcp.writeSingleRegister(L_PARAMETERS.L27_heatingLowTempCurveDIY.address, 1);
  }

  calcDiySetpoint(k: number, b: number, ambientC: number): number {
    return calculateDIYCurveTemp(k, b, ambientC);
  }

  async setFlowRate(lpm: number): Promise<void> {
    assertRange(L_PARAMETERS.L31_externalPumpFlowRate, lpm);
    await this.tcp.writeSingleRegister(L_PARAMETERS.L31_externalPumpFlowRate.address, lpm);
  }

  setExternalFlow(lpm: number | null): void {
    this.externalFlowLpm = lpm;
  }

  private async runInitValidation(): Promise<void> {
    for (const block of ADLAR2_POLL_ONCE.blocks) {
      try {
        await this.tcp.readHoldingRegisters(block.start, block.count);
      } catch {
        // Non-fatal: init leest zo veel mogelijk metadata vooraf in.
      }
    }

    const refrigerant = await this.validateRefrigerant();
    if (!refrigerant.valid) {
      this.emit(
        'error',
        new Error(`P119=${refrigerant.type} — onverwacht koelmiddel (verwacht 2=R32)`),
        'validate:refrigerant',
      );
    }
  }

  private buildSnapshot(): DataSnapshot {
    return {
      ts: Date.now(),
      status: this.buildStatus(),
      control: this.buildControl(),
      power: this.buildPower(),
      cop: this.buildCop(),
      sensors: this.buildSensors(),
      diy: this.buildDiy(),
    };
  }

  private buildStatus(): StatusSnapshot {
    const status1 = this.tcp.u16(STATUS_REGISTER_MAP.runningStatus1.address);
    const status2 = this.tcp.u16(STATUS_REGISTER_MAP.runningStatus2.address);
    const compFreq = this.readScaledValue(SENSOR_REGISTERS.compressorRunningFreq);

    return {
      running: !!(status1 & STATUS_1_BITS.MACHINE_RUN),
      waiting: !!(status1 & STATUS_1_BITS.MACHINE_WAIT),
      defrosting: !!(status1 & STATUS_1_BITS.SYSTEM_DEFROST),
      antifreeze: !!(status1 & STATUS_1_BITS.PRIMARY_ANTIFREEZE) || !!(status1 & STATUS_1_BITS.SECONDARY_ANTIFREEZE),
      sterilization: !!(status2 & STATUS_2_BITS.HIGH_TEMP_STERILIZATION),
      compressorOn: compFreq > 0,
      faultAlarm: !!(status1 & STATUS_1_BITS.FAULT_ALARM),
      faultShutdown: !!(status1 & STATUS_1_BITS.FAULT_SHUTDOWN),
      activeFaults: decodeFaults(
        this.tcp.u16(STATUS_REGISTER_MAP.faultState1.address),
        this.tcp.u16(STATUS_REGISTER_MAP.faultState2.address),
        this.tcp.u16(STATUS_REGISTER_MAP.faultState3.address),
      ),
    };
  }

  private buildControl(): ControlSnapshot {
    const mode = this.tcp.u16(CONTROL_REGISTERS.mode.address);
    const protocolVersion = this.tcp.u16(VERSION_REGISTERS.protocolVersion.address);

    return {
      on: this.tcp.u16(CONTROL_REGISTERS.mainSwitch.address) === 1,
      mode,
      modeName: modeName(mode),
      userMode: this.tcp.u16(CONTROL_REGISTERS.runningMode.address),
      heatingSetpointC: this.readScaledValue(CONTROL_REGISTERS.tempSetHeating),
      coolingSetpointC: this.readScaledValue(CONTROL_REGISTERS.tempSetCooling),
      dhwSetpointC: this.readScaledValue(CONTROL_REGISTERS.tempSetHotWater),
      floorSetpointC: this.readScaledValue(CONTROL_REGISTERS.tempSetFloorHeating),
      heatingCurve: this.tcp.u16(CONTROL_REGISTERS.heatingCurve.address),
      hotWaterCurve: this.tcp.u16(CONTROL_REGISTERS.hotWaterCurve.address),
      protocolVersion,
      coilsAvailable: protocolSupportsCoils(protocolVersion),
    };
  }

  private buildPower(): PowerSnapshot {
    const inputVoltageV = this.readScaledValue(SENSOR_REGISTERS.deviceInputVoltage);
    const inputCurrentA = this.readScaledValue(SENSOR_REGISTERS.deviceInputCurrent);

    return {
      inputPowerKw: this.readScaledValue(SENSOR_REGISTERS.deviceInputPower),
      inputCurrentA,
      inputVoltageV,
      totalEnergyKwh: this.tcp.u16(SENSOR_REGISTERS.totalEnergyConsumption.address),
      derivedPowerKw: (inputVoltageV * inputCurrentA) / 1000,
    };
  }

  private buildCop(): CopSnapshot {
    const inletTemp = this.readScaledValue(SENSOR_REGISTERS.waterInletTempT6, true);
    const outletTemp = this.readScaledValue(SENSOR_REGISTERS.waterOutletTempT7, true);
    const ambientTemp = this.readScaledValue(SENSOR_REGISTERS.ambientTempT1, true);
    const deltaT = outletTemp - inletTemp;

    const rawFlow = this.tcp.u16(SENSOR_REGISTERS.waterFlow.address);
    const flow = (this.externalFlowLpm !== null && this.externalFlowLpm > 0)
      ? this.externalFlowLpm
      : (rawFlow > 0 ? rawFlow : 0);
    const thermalPowerKw = Math.abs(deltaT) * flow * WATER_THERMAL_FACTOR;

    const power = this.buildPower();
    let electricalPowerKw = 0;
    if (power.inputPowerKw > MIN_COP_POWER_KW) {
      electricalPowerKw = power.inputPowerKw;
    } else if (power.derivedPowerKw > MIN_COP_POWER_KW) {
      electricalPowerKw = power.derivedPowerKw;
    }

    const base = {
      thermalPowerKw: +thermalPowerKw.toFixed(3),
      electricalPowerKw: +electricalPowerKw.toFixed(3),
      deltaTc: +deltaT.toFixed(1),
      flowLpm: flow,
      ambientTempC: ambientTemp,
    };

    if (electricalPowerKw < MIN_COP_POWER_KW) {
      return {
        ...base,
        cop: 0,
        valid: false,
        reason: 'Elektrisch vermogen niet beschikbaar (0x005C=0). Externe kWh meter aanbevolen.',
      };
    }

    if (deltaT < MIN_COP_DELTA_T_C) {
      return {
        ...base,
        cop: 0,
        valid: false,
        reason: `ΔT=${deltaT.toFixed(1)}°C < ${MIN_COP_DELTA_T_C}°C — compressor inactief.`,
      };
    }

    return {
      ...base,
      cop: +(Math.min(thermalPowerKw / electricalPowerKw, MAX_VALID_COP)).toFixed(2),
      valid: true,
    };
  }

  private buildSensors(): Record<string, SensorValue> {
    const sensors: Record<string, SensorValue> = {};

    for (const descriptor of SENSOR_DESCRIPTORS) {
      if (!this.tcp.has(descriptor.def.address)) {
        continue;
      }

      const raw = this.readRawValue(descriptor.def, descriptor.signed ?? false);
      sensors[descriptor.key] = {
        address: descriptor.def.address,
        raw,
        value: this.readScaledValue(descriptor.def, descriptor.signed ?? false),
        unit: descriptor.def.unit ?? '',
        label: descriptor.def.name,
      };
    }

    return sensors;
  }

  private buildDiy(): DiyHeatingCurve | undefined {
    if (!this.tcp.has(L_PARAMETERS.L27_heatingLowTempCurveDIY.address)) {
      return undefined;
    }

    const active = this.tcp.u16(L_PARAMETERS.L27_heatingLowTempCurveDIY.address) === 0;
    const slopeK = -(this.tcp.u16(L_PARAMETERS.L28_heatingCurveCoeffK.address) / 10);
    const interceptB = this.tcp.u16(L_PARAMETERS.L29_heatingCurveConstantB.address) / 10;

    return {
      active,
      slopeK,
      interceptB,
      calcSetpoint: (ambientC: number) => calculateDIYCurveTemp(slopeK, interceptB, ambientC),
    };
  }

  private checkFaults(currentFaults: string[]): void {
    const previousFaults = new Set(this.lastFaults);
    const newlyActiveFaults = currentFaults.filter((fault) => !previousFaults.has(fault));

    if (newlyActiveFaults.length > 0) {
      this.emit('fault', currentFaults);
    } else if (this.lastFaults.length > 0 && currentFaults.length === 0) {
      this.emit('fault-cleared');
    }

    this.lastFaults = currentFaults;
  }

  private readRawValue(def: NumericRegisterDefinition, signed = false): number {
    return signed ? this.tcp.s16(def.address) : this.tcp.u16(def.address);
  }

  private readScaledValue(def: NumericRegisterDefinition, signed = false): number {
    const raw = this.readRawValue(def, signed);
    const scale = def.multiply ?? 1;
    let value = raw * scale;

    if (def.calibrationCurve) {
      value = interpolateCalibration(value, Array.from(def.calibrationCurve));
    }

    return value;
  }

  private async writeNamedCoil(
    def: { address: number; name: string },
    state: boolean,
  ): Promise<void> {
    const protocolVersion = this.tcp.u16(VERSION_REGISTERS.protocolVersion.address);

    if (protocolVersion > 0 && !protocolSupportsCoils(protocolVersion)) {
      throw new Error(
        `FC05 coil vereist protocol >= 130, huidig: ${protocolVersion}. Gebruik setUserMode() als fallback.`,
      );
    }

    await this.tcp.writeSingleCoil(def.address, state);
  }
}
