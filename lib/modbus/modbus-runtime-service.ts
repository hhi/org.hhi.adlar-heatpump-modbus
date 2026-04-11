/* eslint-disable import/prefer-default-export */
/**
 * ADR-031: ModbusRuntimeService<TSnapshot>
 *
 * Protocol-agnostisch interface voor een Modbus-deviceservice.
 * ModbusConnectionService werkt uitsluitend via dit interface — geen directe
 * afhankelijkheid van Adlar2ModbusService of andere concrete implementaties.
 *
 * De default type-parameter TSnapshot = DataSnapshot zorgt ervoor dat bestaande
 * code zonder type-argument ongewijzigd blijft.
 */

export interface ModbusRuntimeService<TSnapshot> {
  // ── Verbinding ──────────────────────────────────────────────────────────────
  connect(): Promise<void>;
  destroy(): Promise<void>;
  startPolling(ms?: { fast?: number; medium?: number; slow?: number }): void;

  // ── Schrijfoperaties ────────────────────────────────────────────────────────
  setTemperature(type: string, value: number): Promise<void>;
  setMainSwitch(value: boolean): Promise<void>;
  setMode(mode: number): Promise<void>;
  setHeatingCurve(curve: number): Promise<void>;
  setHotWaterCurve(curve: number): Promise<void>;
  setUserMode(mode: 0 | 1 | 2): Promise<void>;
  setExternalFlow(lpm: number | null): void;

  // ── Events ──────────────────────────────────────────────────────────────────
  on(event: 'connected', cb: () => void): this;
  on(event: 'disconnected', cb: (reason: string) => void): this;
  on(event: 'reconnecting', cb: (attempt: number, delayMs: number) => void): this;
  on(event: 'error', cb: (err: Error, ctx: string) => void): this;
  on(event: 'data', cb: (snapshot: TSnapshot) => void): this;
}
