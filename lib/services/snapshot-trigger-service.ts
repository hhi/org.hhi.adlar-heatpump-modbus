/* eslint-disable import/prefer-default-export */
/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import { DataSnapshot } from '../modbus/adlar2-modbus-service';
import { MODE_OPTIONS } from '../modbus/adlar-modbus-registers';
import { FAULT_DESCRIPTIONS } from '../modbus/adlar-fault-descriptions';
import { userModeToWorkModeId } from '../modbus/adlar-enum-mappers';

const THRESHOLD = 0.5;

type TriggerFn = (
  cardId: string,
  tokens: Record<string, unknown>,
  state: Record<string, unknown>,
) => void;

/**
 * SnapshotTriggerService vergelijkt opeenvolgende DataSnapshots en roept
 * de meegegeven trigger-callback aan wanneer een significante wijziging
 * wordt gedetecteerd.
 *
 * Heeft geen Homey-dependency — werkt puur op DataSnapshot en een
 * framework-agnostische trigger-functie.
 */
export class SnapshotTriggerService {
  private _lastAmbientTemp: number | null = null;
  private _lastInletTemp: number | null = null;
  private _lastOutletTemp: number | null = null;
  private _lastHeatingMode: number | null = null;
  private _lastActiveFaults: string[] = [];
  private _lastDhwTankTemp: number | null = null;
  private _lastOuterCoilTemp: number | null = null;
  private _lastExhaustTemp: number | null = null;
  private _lastEevStep: number | null = null;
  private _lastEviStep: number | null = null;
  private _lastWaterFlow: number | null = null;
  private _lastCompFreq: number | null = null;
  private _lastFanSpeed: number | null = null;
  private _lastWorkMode: number | null = null;

  detect(snap: DataSnapshot, trigger: TriggerFn): void {
    this._detectChangedTriggers(snap, trigger);
    this._detectAlertTriggers(snap, trigger);
  }

  private _detectChangedTriggers(snap: DataSnapshot, trigger: TriggerFn): void {
    const ambient = snap.sensors.ambientT1?.value;
    if (ambient !== undefined && this._lastAmbientTemp !== null) {
      if (Math.abs(ambient - this._lastAmbientTemp) >= THRESHOLD) {
        const condition = ambient > this._lastAmbientTemp ? 'above' : 'below';
        trigger('ambient_temperature_changed',
          { current_temperature: Math.round(ambient * 10) / 10 },
          { condition, temperature: ambient });
      }
    }
    if (ambient !== undefined) this._lastAmbientTemp = ambient;

    const inlet = snap.sensors.inletT6?.value;
    if (inlet !== undefined && this._lastInletTemp !== null) {
      if (Math.abs(inlet - this._lastInletTemp) >= THRESHOLD) {
        const condition = inlet > this._lastInletTemp ? 'above' : 'below';
        trigger('inlet_temperature_changed',
          { current_temperature: Math.round(inlet * 10) / 10 },
          { condition, temperature: inlet });
      }
    }
    if (inlet !== undefined) this._lastInletTemp = inlet;

    const outlet = snap.sensors.outletT7?.value;
    if (outlet !== undefined && this._lastOutletTemp !== null) {
      if (Math.abs(outlet - this._lastOutletTemp) >= THRESHOLD) {
        const condition = outlet > this._lastOutletTemp ? 'above' : 'below';
        trigger('outlet_temperature_changed',
          { current_temperature: Math.round(outlet * 10) / 10 },
          { condition, temperature: outlet });
      }
    }
    if (outlet !== undefined) this._lastOutletTemp = outlet;

    const mode = snap.control.mode;
    if (this._lastHeatingMode !== null && mode !== this._lastHeatingMode) {
      trigger('heating_mode_changed',
        {
          mode: MODE_OPTIONS[mode as keyof typeof MODE_OPTIONS] ?? String(mode),
          previous_mode: MODE_OPTIONS[this._lastHeatingMode as keyof typeof MODE_OPTIONS] ?? String(this._lastHeatingMode),
        },
        {});
    }
    this._lastHeatingMode = mode;

    const workMode = snap.control.userMode;
    if (this._lastWorkMode !== null && workMode !== this._lastWorkMode) {
      trigger('work_mode_changed',
        {
          mode: userModeToWorkModeId(workMode),
          previous_mode: userModeToWorkModeId(this._lastWorkMode),
        },
        {});
    }
    this._lastWorkMode = workMode;

    const currentFaults = snap.status.activeFaults;
    const newFaults = currentFaults.filter((f) => !this._lastActiveFaults.includes(f));
    for (const fault of newFaults) {
      trigger('fault_detected',
        { fault_code: 0, fault_description: FAULT_DESCRIPTIONS[fault] ?? fault },
        { fault_description: FAULT_DESCRIPTIONS[fault] ?? fault });
    }
    this._lastActiveFaults = [...currentFaults];
  }

  private _detectAlertTriggers(snap: DataSnapshot, trigger: TriggerFn): void {
    const dhwTank = snap.sensors.dhwTankTemp?.value;
    if (dhwTank !== undefined && this._lastDhwTankTemp !== null) {
      if (Math.abs(dhwTank - this._lastDhwTankTemp) >= THRESHOLD) {
        const condition = dhwTank > this._lastDhwTankTemp ? 'above' : 'below';
        trigger('tank_temperature_alert',
          { current_temperature: Math.round(dhwTank * 10) / 10, threshold_temperature: 0 },
          { condition, value: dhwTank });
      }
    }
    if (dhwTank !== undefined) this._lastDhwTankTemp = dhwTank;

    const outerCoil = snap.sensors.outerCoilT2?.value;
    if (outerCoil !== undefined && this._lastOuterCoilTemp !== null) {
      if (Math.abs(outerCoil - this._lastOuterCoilTemp) >= THRESHOLD) {
        const condition = outerCoil > this._lastOuterCoilTemp ? 'above' : 'below';
        trigger('coiler_temperature_alert',
          { current_temperature: Math.round(outerCoil * 10) / 10, threshold_temperature: 0 },
          { condition, value: outerCoil });
      }
    }
    if (outerCoil !== undefined) this._lastOuterCoilTemp = outerCoil;

    const exhaust = snap.sensors.exhaustT5?.value;
    if (exhaust !== undefined && this._lastExhaustTemp !== null) {
      if (Math.abs(exhaust - this._lastExhaustTemp) >= THRESHOLD) {
        const condition = exhaust > this._lastExhaustTemp ? 'above' : 'below';
        trigger('discharge_temperature_alert',
          { current_temperature: Math.round(exhaust * 10) / 10, threshold_temperature: 0 },
          { condition, value: exhaust });
      }
    }
    if (exhaust !== undefined) this._lastExhaustTemp = exhaust;

    const eevStep = snap.sensors.eevStep?.value;
    if (eevStep !== undefined && this._lastEevStep !== null) {
      if (Math.abs(eevStep - this._lastEevStep) >= THRESHOLD) {
        const condition = eevStep > this._lastEevStep ? 'above' : 'below';
        trigger('eev_pulse_steps_alert',
          { pulse_steps: Math.round(eevStep) },
          { condition, value: eevStep });
      }
    }
    if (eevStep !== undefined) this._lastEevStep = eevStep;

    const eviStep = snap.sensors.eviStep?.value;
    if (eviStep !== undefined && this._lastEviStep !== null) {
      if (Math.abs(eviStep - this._lastEviStep) >= THRESHOLD) {
        const condition = eviStep > this._lastEviStep ? 'above' : 'below';
        trigger('evi_pulse_steps_alert',
          { pulse_steps: Math.round(eviStep) },
          { condition, value: eviStep });
      }
    }
    if (eviStep !== undefined) this._lastEviStep = eviStep;

    const waterFlow = snap.sensors.waterFlow?.value;
    if (waterFlow !== undefined && this._lastWaterFlow !== null) {
      if (Math.abs(waterFlow - this._lastWaterFlow) >= THRESHOLD) {
        const condition = waterFlow > this._lastWaterFlow ? 'above' : 'below';
        trigger('water_flow_alert',
          { flow_rate: Math.round(waterFlow * 10) / 10 },
          { condition, value: waterFlow });
      }
    }
    if (waterFlow !== undefined) this._lastWaterFlow = waterFlow;

    const compFreq = snap.sensors.compRunningFreq?.value;
    if (compFreq !== undefined && this._lastCompFreq !== null) {
      if (Math.abs(compFreq - this._lastCompFreq) >= THRESHOLD) {
        const condition = compFreq > this._lastCompFreq ? 'above' : 'below';
        trigger('compressor_efficiency_alert',
          { frequency: Math.round(compFreq * 10) / 10 },
          { condition, value: compFreq });
      }
    }
    if (compFreq !== undefined) this._lastCompFreq = compFreq;

    const fanSpeed = snap.sensors.fanSpeed?.value;
    if (fanSpeed !== undefined && this._lastFanSpeed !== null) {
      if (Math.abs(fanSpeed - this._lastFanSpeed) >= THRESHOLD) {
        const condition = fanSpeed > this._lastFanSpeed ? 'above' : 'below';
        trigger('fan_motor_efficiency_alert',
          { frequency: Math.round(fanSpeed * 10) / 10 },
          { condition, value: fanSpeed });
      }
    }
    if (fanSpeed !== undefined) this._lastFanSpeed = fanSpeed;
  }
}
