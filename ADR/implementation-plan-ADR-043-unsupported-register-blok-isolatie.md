# Implementatieplan: ADR-043 — Unsupported Register Blok-isolatie en ADR-042 Aanvullingen

**Datum:** 2026-04-13  
**ADR:** [ADR-043](ADR-043-unsupported-register-blok-isolatie.md)  
**Repo:** `org.hhi.adlar-heatpump-modbus`

---

## Overzicht

5 fases met vaste dependency-richting. Elke fase is zelfstandig compileerbaar en releasbaar. De hoofdroute is Fase 1 → 2 → 3 → 5; Fase 4 is inhoudelijk onafhankelijk van Fase 1–3 en kan desgewenst apart eerder worden uitgerold. Fase 1 legt het fundament (emit-architectuur + event-keten) waarop de quality-logica en dashboard-integratie bouwen.

| Fase | Bestanden | Aard |
| --- | --- | --- |
| 1 | `modbus-tcp-service.ts`, `adlar-modbus-registers.ts`, `adlar2-modbus-service.ts`, `modbus-runtime-service.ts`, `modbus-connection-service.ts`, `service-coordinator.ts` | Herschrijven / uitbreiden |
| 2 | `service-coordinator.ts` | Uitbreiden |
| 3 | `service-coordinator.ts` | Uitbreiden |
| 4 | `adlar2-modbus-service.ts` | Bugfix |
| 5 | `adlar2-modbus-service.ts`, `lib/services/dashboard-service.ts` | Uitbreiden |

---

## Fase 1 — Emit-architectuur + per-blok isolatie + event-keten

### Doel

- Eén `emit('error')` per blok-failure i.p.v. dubbel (in `readHoldingRegisters` én `_runPollGroup`)
- Per-blok isolatie: required failure stopt de cyclus; optional failure laat volgende blokken door
- `poll-partial` event voor gedeeltelijk succes
- Non-fast poll-succes bereikt `ServiceCoordinator` via nieuwe `poll-group-succeeded` event-keten
- `ServiceCoordinator` heeft in Fase 1 al een werkend resetpad voor non-fast succes, zodat de event-keten inhoudelijk compleet is

### 1a — `ModbusBlockError` en `classifyError()` — `lib/modbus/modbus-tcp-service.ts`

Voeg toe boven de `ModbusTcpService` class (na de bestaande import-blokken):

```typescript
export type ModbusErrorCode =
  | 'unsupported'   // Illegal Data Address (Modbus exception 0x02)
  | 'protocol'      // Illegal Data Value (Modbus exception 0x03)
  | 'timeout'       // Request timeout
  | 'disconnect'    // Socket-level close/reset
  | 'unknown';

export class ModbusBlockError extends Error {
  constructor(
    message: string,
    public readonly code: ModbusErrorCode,
    public readonly blockStart: number,
    public readonly groupName: string,
    public readonly optional: boolean,
  ) {
    super(message);
    this.name = 'ModbusBlockError';
  }
}

function classifyError(err: Error): ModbusErrorCode {
  const msg = err.message.toLowerCase();
  if (msg.includes('illegal data address')) return 'unsupported';
  if (msg.includes('illegal data value'))   return 'protocol';
  if (msg.includes('timeout'))              return 'timeout';
  if (msg.includes('connection closed') || msg.includes('econnreset')) return 'disconnect';
  return 'unknown';
}
```

### 1b — `PollBlock.optional` veld — `lib/modbus/modbus-tcp-service.ts:93`

Voeg `optional?: true` toe aan de bestaande `PollBlock` interface:

```typescript
export interface PollBlock {
  start: number;
  count: number;
  label: string;
  optional?: true;   // Afwezig = required
}
```

### 1c — `readHoldingRegisters` emit verwijderen — `lib/modbus/modbus-tcp-service.ts:370–374`

Verwijder de `this.emit('error', ...)` aanroep uit de catch-tak van `readHoldingRegisters`. De methode gooit alleen nog; `_runPollGroup` emits.

```typescript
// VOOR (verwijderen):
} catch (err) {
  this.stats.errors++;
  this.emit('error', err as Error, `fc03:${addrHex}`);  // ← verwijderen
  throw err;
}

// NA:
} catch (err) {
  this.stats.errors++;
  throw err;
}
```

### 1d — `_runPollGroup` herschrijven — `lib/modbus/modbus-tcp-service.ts:489–502`

Vervang de huidige single-catch implementatie volledig:

```typescript
private async _runPollGroup(group: PollGroup): Promise<void> {
  if (!this._connected) return;
  let requiredFailed = false;
  let optionalFailed = false;

  for (const blk of group.blocks) {
    try {
      await this.readHoldingRegisters(blk.start, blk.count);
      await this._batchDelay();
    } catch (e) {
      const blockError = new ModbusBlockError(
        (e as Error).message,
        classifyError(e as Error),
        blk.start,
        group.name,
        blk.optional ?? false,
      );
      this.emit('error', blockError, `poll:${group.name}:block:0x${blk.start.toString(16)}`);

      if (blk.optional) { optionalFailed = true; }
      else               { requiredFailed = true; }
    }
  }

  if (requiredFailed) return; // Geen poll-complete — ModbusBlockError is al geëmit

  this.stats.polls++;
  this.stats.lastPollMs = Date.now();
  this.emit(optionalFailed ? 'poll-partial' : 'poll-complete', group.name);
}
```

Voeg ook `'poll-partial'` toe aan de event-commentaar bovenaan de klasse (regel ~122):

```typescript
// 'poll-partial' (groupName: string) — required blokken OK, ≥1 optional blok gefaald
```

### 1e — Optional blokken markeren — `lib/modbus/adlar-modbus-registers.ts`

Voeg `optional: true` toe aan de risicovolle blokken (huidige regels ~1715, ~1716, ~1740, ~1751):

```typescript
// POLL_GROUP_MEDIUM (~regel 1715–1716):
{ start: 0x0019, count: 8,  label: 'Relay 1-4 + Switch 1-4 (0x19–0x20)', optional: true },
{ start: 0x0072, count: 12, label: 'Aux/Buffer/Grid/Zone',                optional: true },

// POLL_GROUP_SLOW (~regel 1740):
{ start: 0x0813, count: 7,  label: 'L30–L36 energieboekhouding', optional: true },

// POLL_GROUP_ONCE (~regel 1751):
{ start: 0x0360, count: 4,  label: 'Version Info (0x360–0x363)', optional: true },
```

### 1f — Poll-listeners updaten — `lib/modbus/adlar2-modbus-service.ts:347`

Vervang de huidige `poll-complete`-listener en voeg `poll-partial`-listener toe:

Naast het forwarden van non-fast succes blijft `poll-partial` expliciet zichtbaar als gedeeltelijk succes: log in deze listener een waarschuwing voordat `poll-group-succeeded` wordt geëmit, zodat ADR §2.3 niet verloren gaat.

```typescript
// Vervang bestaande this.tcp.on('poll-complete', ...) handler:
this.tcp.on('poll-complete', (groupName) => {
  if (groupName === ADLAR2_POLL_FAST.name) {
    const snapshot = this.buildSnapshot();
    this.emit('data', snapshot);
    this.checkFaults(snapshot.status.activeFaults);
  } else {
    this.emit('poll-group-succeeded', groupName);
  }
});

// Nieuw:
this.tcp.on('poll-partial', (groupName) => {
  // FAST heeft geen optional blokken — poll-partial kan hier nooit geëmit worden.
  // Non-fast: required blokken OK, optional gefaald → telt als succes voor quality.
  if (groupName !== ADLAR2_POLL_FAST.name) {
    this.emit('poll-group-succeeded', groupName);
  }
});
```

### 1g — `ModbusRuntimeService` interface uitbreiden — `lib/modbus/modbus-runtime-service.ts:33`

Voeg na de bestaande `on(event: 'data', ...)` declaratie toe:

```typescript
on(event: 'poll-group-succeeded', cb: (groupName: string) => void): this;
```

### 1h — `ModbusConnectionService` forwarder — `lib/services/modbus-connection-service.ts:104`

Voeg na de bestaande `this.service.on('error', ...)` listener toe:

```typescript
this.service.on('poll-group-succeeded', (groupName: string) => {
  this.options.onPollGroupSucceeded?.(groupName);
});
```

Voeg `onPollGroupSucceeded?: (groupName: string) => void` toe aan `ModbusConnectionOptions`:

```typescript
export interface ModbusConnectionOptions<TSnapshot> {
  // ... bestaande velden ...
  onPollGroupSucceeded?: (groupName: string) => void;
}
```

### 1i — `ServiceCoordinator.onPollGroupSucceeded()` — `lib/services/service-coordinator.ts`

Voeg bij de bestaande tellerdeclaraties toe:

```typescript
private _consecutiveNonFastRequiredFailures = 0;
```

Voeg toe als private methode naast `_handleModbusData` en `_handleError`:

```typescript
private _onPollGroupSucceeded(groupName: string): void {
  if (groupName === 'fast') return; // FAST gebruikt data-event, niet deze methode

  this._consecutiveNonFastRequiredFailures = 0;
  this.logger(`ServiceCoordinator: Poll group succeeded: ${groupName} — non-fast teller gereset`);

  if (this._connectionQuality === 'degraded'
      && this._consecutiveFastPollFailures === 0) {
    this._setConnectionQuality('online');
  }
}
```

Registreer in de constructor bij `ModbusConnectionService`-opties:

```typescript
onPollGroupSucceeded: this._onPollGroupSucceeded.bind(this),
```

### Verificatie na Fase 1

- `npm run build` geeft geen fouten
- Poll-groepen bevatten `optional`-velden waar verwacht
- Log toont `poll:medium:block:0x0072` i.p.v. dubbele foutmelding bij gesimuleerde blok-failure
- Succesvolle non-fast `poll-group-succeeded` reset `_consecutiveNonFastRequiredFailures`

---

## Fase 2 — Quality-evaluatie aanvullingen

### Doel

- `unsupported`-fouten tellen niet mee als verbindingsfout
- MEDIUM/SLOW required failures maken quality `degraded`
- FAST-succes cleart non-fast degradatie niet meer
- `_structurallyUnsupportedFast` waarschuwing voor FAST required `unsupported`

### 2a — Nieuwe vlag — `lib/services/service-coordinator.ts`

Voeg toe bij de bestaande tellerdeclaraties:

```typescript
private _structurallyUnsupportedFast = false;
```

### 2b — `_handleError` herschrijven — `lib/services/service-coordinator.ts:494`

Vervang de huidige implementatie:

```typescript
private _handleError(err: Error, context: string): void {
  const count = (this._errorCountByContext.get(context) ?? 0) + 1;
  this._errorCountByContext.set(context, count);

  // Niet-blok-fouten (socket, FC06, FC05) ongewijzigd doorlaten
  if (!(err instanceof ModbusBlockError)) {
    if (context.startsWith('poll:fast') || context.startsWith('fc03')) {
      this._consecutiveFastPollFailures++;
      this._evaluateConnectionQuality();
    }
    return;
  }

  const { code, groupName, optional } = err;
  if (optional) return; // Optional failures raken quality niet

  if (code === 'unsupported' && groupName === 'fast') {
    // Structureel stil: FAST required blok bestaat niet op deze variant
    if (!this._structurallyUnsupportedFast) {
      this._structurallyUnsupportedFast = true;
      this.logger('ServiceCoordinator: FAST required block unsupported — device structurally silent');
      this.device.setWarning('FAST required block unsupported — no data').catch(() => {});
    }
    return; // Geen quality-teller — geen verbindingsprobleem
  }

  if (code === 'unsupported') return; // Non-fast unsupported: geen quality-effect

  if (groupName === 'fast') {
    this._consecutiveFastPollFailures++;
    this.logger(`ServiceCoordinator: Fast poll failures: ${this._consecutiveFastPollFailures}`);
    this._evaluateConnectionQuality();
  } else {
    this._consecutiveNonFastRequiredFailures++;
    this.logger(`ServiceCoordinator: Non-fast required failures: ${this._consecutiveNonFastRequiredFailures}`);
    this._evaluateNonFastConnectionQuality();
  }
}
```

Voeg `_evaluateNonFastConnectionQuality()` toe naast `_evaluateConnectionQuality()`:

```typescript
private _evaluateNonFastConnectionQuality(): void {
  const NON_FAST_DEGRADED_THRESHOLD = 6;
  if (
    this._connectionQuality === 'online'
    && this._consecutiveNonFastRequiredFailures >= NON_FAST_DEGRADED_THRESHOLD
  ) {
    this._setConnectionQuality('degraded');
  }
}
```

### 2c — Guard in `_handleModbusData` — `lib/services/service-coordinator.ts:359`

Vervang de huidige quality-reset:

```typescript
private _handleModbusData(snapshot: DataSnapshot): void {
  this._lastSuccessfulFastPollAt = Date.now();
  this._consecutiveFastPollFailures = 0;

  // Reset structureel stille vlag als FAST nu wél slaagt
  if (this._structurallyUnsupportedFast) {
    this._structurallyUnsupportedFast = false;
    if (this._connectionQuality === 'online') {
      this.device.setAvailable().catch(() => {});
    }
  }

  // Reset naar online alleen als non-fast teller ook schoon is
  if (this._connectionQuality !== 'online'
      && this._consecutiveNonFastRequiredFailures === 0) {
    this._setConnectionQuality('online');
  }
}
```

### 2d — `_setConnectionQuality` bewust maken van structurele vlag — `lib/services/service-coordinator.ts:521`

Vervang de `online`-tak:

```typescript
if (quality === 'online') {
  if (this._structurallyUnsupportedFast) {
    // Prioriteit: structurele warning heeft hogere prioriteit dan schone online-status
    this.device
      .setWarning('FAST required block unsupported — no data')
      .catch(() => {});
  } else {
    this.device.setAvailable().catch(() => {});
  }
}
```

### 2e — Reset tellers bij disconnect/reconnect — `lib/services/service-coordinator.ts`

In de bestaande `_handleDisconnected()` (of equivalent reset-methode) toevoegen:

```typescript
this._consecutiveNonFastRequiredFailures = 0;
// _structurallyUnsupportedFast bewust NIET resetten:
// structureel unsupported blokken verdwijnen niet door een reconnect.
```

### Verificatie na Fase 2

- `npm run build` geeft geen fouten
- `unsupported` fout op FAST required → `setWarning()`, geen `_consecutiveFastPollFailures`-increment
- 6× MEDIUM required failure → quality `degraded`; volgende succesvolle MEDIUM poll → quality `online`
- Succesvolle FAST snapshot cleart non-fast `degraded` niet (teller nog > 0)

---

## Fase 3 — `degraded → offline` timer

### Doel

Herhaalde FC03-failures zonder socket-close brengen het apparaat uiteindelijk naar `offline`.

### 3a — `_degradedSinceTimer` — `lib/services/service-coordinator.ts`

Voeg toe bij de bestaande timer-declaraties:

```typescript
private _degradedSinceTimer: ReturnType<typeof setTimeout> | null = null;
private static readonly DEGRADED_TO_OFFLINE_MS = 10 * 60 * 1000; // 10 minuten
```

### 3b — Timer starten in `_setConnectionQuality` — `lib/services/service-coordinator.ts:521`

```typescript
private _setConnectionQuality(quality: ConnectionQuality): void {
  if (this._connectionQuality === quality) return;
  // ...

  // Start/annuleer degraded-naar-offline timer
  if (quality === 'degraded') {
    if (!this._degradedSinceTimer) {
      this._degradedSinceTimer = this.device.homey.setTimeout(() => {
        this._degradedSinceTimer = null;
        this.logger('ServiceCoordinator: Degraded timeout — setting offline');
        this._setConnectionQuality('offline'); // of: this.device.setUnavailable(...)
      }, ServiceCoordinator.DEGRADED_TO_OFFLINE_MS);
    }
  } else {
    if (this._degradedSinceTimer) {
      this.device.homey.clearTimeout(this._degradedSinceTimer);
      this._degradedSinceTimer = null;
    }
  }
}
```

### 3c — Timer annuleren bij succesvolle FAST poll — `lib/services/service-coordinator.ts`

Voeg expliciet toe aan `_handleModbusData()`: een succesvolle FAST snapshot annuleert de timer ook als quality nog `degraded` blijft door non-fast failures.

```typescript
private _handleModbusData(snapshot: DataSnapshot): void {
  this._lastSuccessfulFastPollAt = Date.now();
  this._consecutiveFastPollFailures = 0;

  if (this._degradedSinceTimer) {
    this.device.homey.clearTimeout(this._degradedSinceTimer);
    this._degradedSinceTimer = null;
  }

  // ... bestaande reset-logica uit Fase 2c ...
}
```

### Verificatie na Fase 3

- `npm run build` geeft geen fouten
- Gesimuleerde aanhoudende MEDIUM-failure: na 10 minuten `degraded` → `offline`
- Succesvolle poll voor timeout: timer geannuleerd, quality blijft `degraded` totdat teller gereset wordt

---

## Fase 4 — Stale `protocolVersion` fixes

### Doel

Twee onafhankelijke codepaden die `protocolVersion` lezen zonder `has()`-check, met verschillende risico's.

### 4a — `buildControl()` — `lib/modbus/adlar2-modbus-service.ts:579`

Vervang de huidige `protocolVersion`-leesregel:

```typescript
// VOOR:
const protocolVersion = this.tcp.u16(VERSION_REGISTERS.protocolVersion.address);
// ...
return {
  protocolVersion,
  coilsAvailable: protocolSupportsCoils(protocolVersion),
};

// NA:
const protocolVersion = this.tcp.has(VERSION_REGISTERS.protocolVersion.address)
  ? this.tcp.u16(VERSION_REGISTERS.protocolVersion.address)
  : null;
return {
  protocolVersion: protocolVersion ?? 0,
  coilsAvailable: protocolVersion !== null && protocolSupportsCoils(protocolVersion),
};
```

### 4b — `writeNamedCoil()` — `lib/modbus/adlar2-modbus-service.ts:755`

Vervang de huidige guard:

```typescript
// VOOR:
const protocolVersion = this.tcp.u16(VERSION_REGISTERS.protocolVersion.address);
if (protocolVersion > 0 && !protocolSupportsCoils(protocolVersion)) {
  throw new Error(`FC05 coil vereist protocol >= 130, huidig: ${protocolVersion}. ...`);
}

// NA:
if (!this.tcp.has(VERSION_REGISTERS.protocolVersion.address)) {
  throw new Error(
    'Coil write geweigerd: protocol version nog niet gelezen (ONCE-blok ontbreekt).',
  );
}
const protocolVersion = this.tcp.u16(VERSION_REGISTERS.protocolVersion.address);
if (!protocolSupportsCoils(protocolVersion)) {
  throw new Error(
    `FC05 coil vereist protocol >= 130, huidig: ${protocolVersion}.`,
  );
}
```

### Verificatie na Fase 4

- `npm run build` geeft geen fouten
- Direct na connect (ONCE-blok nog niet gelezen): `buildControl()` geeft `coilsAvailable: false`, geen FC05-poging mogelijk
- `writeNamedCoil()` gooit direct als ONCE-blok ontbreekt

---

## Fase 5 — Dashboard-integratie

### Doel

Toon in het ADR-041a dashboard welke optional blokken gefaald hebben, zodat variant-problemen zichtbaar zijn.

### 5a — `DataSnapshot.diagnostics.skippedBlocks` — `lib/modbus/adlar2-modbus-service.ts`

Voeg toe aan het `diagnostics`-veld van `DataSnapshot`:

```typescript
diagnostics: {
  // ... bestaande velden ...
  skippedBlocks: number[];  // blockStart-adressen van gefaalde optional blokken
}
```

Vul bij in `buildSnapshot()`: registreer welke optional-blok-adressen een `ModbusBlockError` met `optional: true` hebben gehad in de laatste poll-cyclus. Reset per poll-groep-cyclus.

### 5b — Dashboard tabel — `public/dashboard.html` of `lib/services/dashboard-service.ts`

Toon de `skippedBlocks` als aparte rij/badge in de register-tabel zodat zichtbaar is welke blokken niet worden gelezen.

### Verificatie na Fase 5

- `npm run build` geeft geen fouten
- Dashboard op `http://<homey-ip>:8090/` toont gefaalde optional blokken

---

## Releasebeleid

| Fase | Releasekandidaat | Versie-bump |
| --- | --- | --- |
| 1 | Ja — architectuurwijziging, geen zichtbare functiewijziging | Patch (1.5.x) |
| 1+2 | Ja — quality-evaluatie volledig | Minor (1.6.0) |
| 3 | Bundelen met Fase 2 of apart patch | Patch |
| 4 | Apart — bugfix, ook zonder Fase 1/2 uitrolbaar | Patch |
| 5 | Apart — dashboard-only uitbreiding | Patch |
