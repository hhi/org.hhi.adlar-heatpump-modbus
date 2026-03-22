# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code change policy

1. **Analyze first** — investigate the issue, document findings and proposed solution, present to user.
2. **Wait for approval** — do not make code changes without explicit user approval.
3. **Commit only on explicit request** — never automatically commit; always show what will be committed first.

## Commands

```bash
npm run build               # Compile TypeScript → .homeybuild/
npm run lint                # ESLint (athom/homey-app ruleset)
homey app validate          # Validate Homey app structure (run after build)
homey app validate -l debug # Detailed validation output
```

There are no automated tests. Always run `npm run build` after making changes to verify TypeScript compiles.

## Architecture

This is a Homey SDK v3 app that gives Homey Pro local Modbus TCP access to Adlar Castra / Aurora II heat pumps via an Elfin EW11A (or similar RS485-to-TCP gateway).

### Layer structure (top-down)

1. **`app.ts`** — App entry point. Initializes `Logger` and `SelfHealingRegistry`. Sets global unhandled-rejection/exception handlers.

2. **`drivers/intelligent-heatpump-modbus/device.ts`** — The single Homey device class (`AdlarModbusDevice`). Owns the `ServiceCoordinator` lifecycle, registers capability listeners, and exposes `applyModbusSnapshot()` which maps a `DataSnapshot` onto Homey capabilities.

3. **`lib/services/service-coordinator.ts`** — Orchestrates all services: `SettingsManagerService`, `CapabilityHealthService`, `EnergyTrackingService`, `FlowCardManagerService`, and `ModbusConnectionService`. Acts as the single dependency-injection point for the device.

4. **`lib/services/modbus-connection-service.ts`** — Wraps `Adlar2ModbusService` and handles connection lifecycle events (connected, disconnected, data, error) that are forwarded back to the coordinator.

5. **`lib/modbus/adlar2-modbus-service.ts`** — Device-specific Modbus runtime: builds poll groups, decodes registers into a typed `DataSnapshot`, calculates COP from water flow and temperature delta, and handles write operations.

6. **`lib/modbus/modbus-tcp-service.ts`** — Protocol-agnostic Modbus TCP transport (jsmodbus). Handles socket lifecycle, reconnect with backoff, FC03/FC05/FC06, register cache, and the multi-tier polling engine. Contains no device-specific logic.

7. **`lib/modbus/adlar-modbus-registers.ts`** — All register metadata: addresses, scale factors, ranges, calibration curves, poll groups (`POLL_GROUP_FAST/MEDIUM/SLOW/ONCE`), and decode helpers (`decodeFaults`, `encodeTemperature`, etc.).

### Supporting libraries

- **`lib/adaptive/`** — Advanced features: `HeatingController` (PI control), `CopOptimizer`, `DefrostLearner`, `BuildingModelLearner`, `WeightedDecisionMaker`, `EnergyPriceOptimizer`.
- **`lib/services/`** — Individual services: `CopCalculator`, `RollingCopCalculator`, `SCopCalculator`, `EnergyTrackingService`, `CapabilityHealthService`, `FlowCardManagerService`, `SettingsManagerService`, `PerformanceReportService`, `BuildingInsightsService`.
- **`lib/logger.ts`** — Structured logger with configurable `LogLevel`. Services receive a `(msg, ...args) => void` callback — they never import Logger directly.
- **`lib/constants.ts`** — All timing, threshold, and calculation constants (`DeviceConstants`).
- **`lib/self-healing-registry.ts`** — App-level registry for automatic error recovery.

### Homey Compose structure

Source files that generate `app.json` — **never edit `app.json` directly**:

- `.homeycompose/capabilities/` — One JSON per capability; each file must have `"id"` and `"icon"` fields.
- `.homeycompose/flow/` — Flow card definitions.
- `drivers/intelligent-heatpump-modbus/driver.settings.compose.json` — Device settings (not `driver.compose.json`).

## Homey-specific conventions

### Timers

Always use `this.homey.setTimeout()` / `this.homey.setInterval()` — never global `setTimeout` / `setInterval`. The `TimerProvider` interface in `modbus-tcp-service.ts` exists precisely for this: pass `this.homey` as the timer provider so Homey manages cleanup on restarts.

### Settings (`onSettings()`)

Always read new values from the `newSettings` parameter — never from `this.getSettings()` inside `onSettings()`. Homey calls the handler *before* persisting the new values, so `getSettings()` may still return the old value.

```typescript
// ✅ CORRECT
if (changedKeys.includes('poll_fast_s')) {
  const newValue = (newSettings.poll_fast_s as number) ?? 10;
}

// ❌ WRONG — may return the old value
// const newValue = this.getSetting('poll_fast_s');
```

### Logging
Never use `console.log()`. Use the structured `Logger` class (`this.logger.error/warn/info/debug`). Services receive a logger callback `(message: string, ...args: unknown[]) => void` in their constructor options — they never instantiate `Logger` themselves.

### Type safety
Never use `as any`. Use `@ts-expect-error` with an explanation comment when a cast is unavoidable.

### Localization
All strings exposed to the user must be localized. Add translations to `locales/en.json` and `locales/nl.json`.

### Capability migration
New capabilities are not automatically added to existing paired devices. Add migration code in `device.ts` `onInit()`:

```typescript
const newCapabilities = ['capability_name'];
for (const cap of newCapabilities) {
  if (!this.hasCapability(cap)) {
    await this.addCapability(cap);
    this.log(`Migration: Added ${cap}`);
  }
}
```

### Log level
Controlled per device via the `log_level` setting (`error`/`warn`/`info`/`debug`). The app-level logger uses `process.env.DEBUG === '1'` for debug mode.

## SVG icon guidelines (iOS/Safari compatibility)

WebKit has a known bug where it does **not** inherit `stroke`, `fill`, and other styling attributes from the root `<svg>` element. All SVG icons must apply attributes on each element individually.

```xml
<!-- ❌ WRONG — iOS will not render correctly -->
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
     fill="none" stroke="currentColor" stroke-width="3">
  <rect x="10" y="10" width="80" height="80"/>
</svg>

<!-- ✅ CORRECT -->
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="80" height="80"
        fill="none" stroke="currentColor" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

Rules:

- Root `<svg>` contains only `viewBox` and `xmlns`.
- Every shape element has explicit `fill` and `stroke` attributes.
- Apply `stroke-linecap`, `stroke-linejoin` on individual elements, not on root.

## Changelog guidelines

When updating `.homeychangelog.json`, write for end users — not developers.

- ✅ State **what** changed, factually and directly.
- ✅ Include concrete examples where relevant (e.g., `"3-Oct 14:25"` instead of `"03-10 14:25"`).
- ❌ Do not explain *why* (no "for better user experience").
- ❌ Do not explain *how* (no implementation details).
- ❌ No marketing language or justifications.

```text
✅ "Connection status now shows month abbreviations (e.g., '3-Oct 14:25')."
❌ "Improved connection status display for better readability."
```
