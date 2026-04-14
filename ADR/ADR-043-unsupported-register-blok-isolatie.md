# ADR-043: Unsupported Register Blok-isolatie en ADR-042 Aanvullingen

**Status:** Geaccepteerd  
**Datum:** 2026-04-13  
**Gerelateerd:** [ADR-042 Modbus Error State Handling](ADR-042-modbus-error-state-handling.md)

---

## Samenvatting

Er zijn drie losstaande problemen, elk met een eigen symptoom.

### Probleem 1 — Één blokfout stopt de hele pollronde

De warmtepomp wordt uitgelezen in "blokken": aangrenzende registers in één aanvraag. Als de pomp voor zo'n blok een fout teruggeeft (adres bestaat niet op dit model), gooit jsmodbus een exception voor het hele blok. In de huidige code stopt de for-loop dan:

```text
MEDIUM poll:
  blok 1 ✓  faults
  blok 2 ✗  relay registers — niet ondersteund op enkelvoudige units  ← exception
  blok 3    control                                                    ← wordt nu overgeslagen
  blok 4    curves                                                     ← wordt nu overgeslagen
```

Blok 3 en 4 zijn wél beschikbaar op dit apparaat, maar worden niet gelezen omdat blok 2 faalde. De oplossing: blokken die variant-afhankelijk zijn markeren als `optional`, zodat een failure daar de rest niet blokkeert.

### Probleem 2 — Verbindingskwaliteit klopt niet

De kwaliteitslogica in `ServiceCoordinator` telt fouten, maar maakt geen onderscheid tussen:

- **"adres bestaat niet"** — het apparaat werkt prima, dit adres bestaat gewoon niet op deze variant
- **"timeout / verbindingsfout"** — echte communicatieproblemen

Nu tellen variant-fouten mee als verbindingsfout → apparaat gaat onterecht naar `degraded`.

Omgekeerd: als MEDIUM/SLOW-blokken keer op keer falen (echte fouten), tellen die helemaal niet mee. Quality blijft `online` terwijl er wel degelijk iets mis is.

### Probleem 3 — Protocol version wordt gelezen als 0

Er is één register (`0x0363`) dat zegt welke Modbus-functies de pomp ondersteunt. Dit staat in het ONCE-blok dat pas na verbinding wordt gelezen. Zolang dat blok nog niet gelezen is, levert `u16(adres)` standaard 0 terug.

Dat heeft twee effecten:

1. `buildControl()` berekent `coilsAvailable: false` — veilig, flow cards tonen geen coil-opties
2. `writeNamedCoil()` heeft een guard `if (version > 0 && !supports(...))` — bij `version=0` is `0 > 0` false, de guard slaat niet aan, en de app probeert FC05 te schrijven naar een apparaat dat dat misschien niet ondersteunt

### Wat ADR-043 oplost

| Probleem | Oplossing |
| --- | --- |
| Blok 2 fout blokkeert blok 3+4 | `optional: true` op variant-afhankelijke blokken; per-blok try/catch in `_runPollGroup` |
| Variant-fouten tellen als verbindingsfout | `ModbusBlockError.code === 'unsupported'` → quality-tellers niet verhogen |
| MEDIUM/SLOW-fouten zijn onzichtbaar | Nieuwe teller `_consecutiveNonFastRequiredFailures` → `degraded` na ≥ 6 failures |
| FAST required blok bestaat niet → stille werking | `_structurallyUnsupportedFast` vlag → `setWarning()` in UI |
| `protocolVersion=0` passeert write-guard | Expliciete `has()`-check in `writeNamedCoil()`: gooit direct als version nog niet gelezen is |

---

## 1. Probleem

### 1.1 Per-blok fout-isolatie ontbreekt

Een FC03-request leest een aaneengesloten blok registers in één aanvraag. Als de warmtepomp voor één adres in dat blok een Modbus exception teruggeeft (exception code `0x02` = Illegal Data Address), gooit jsmodbus een error voor de **hele aanvraag**. In `modbus-tcp-service.ts` wordt de error na logging re-thrown:

```typescript
} catch (err) {
  this.stats.errors++;
  this.emit('error', err as Error, `fc03:${addrHex}`);
  throw err;  // ← stopt de for-loop in _runPollGroup
}
```

Gevolg: alle volgende blokken in dezelfde poll-groep worden die cyclus overgeslagen.

Risicovolle blokken per poll-groep:

| Blok | Registers | Variant-risico |
| --- | --- | --- |
| MEDIUM `0x0072–007D` | Solar/Zone2/Buffer/3-fase | Niet op enkelvoudige units |
| MEDIUM `0x0019–0020` | Relay 4, Switch 2+3 | Mogelijk firmware-afhankelijk |
| SLOW `0x0813–0819` | L30–L36 energieboekhouding | Nieuw in v2.2, oudere hardware |
| ONCE `0x0360–0363` | Version info | Ontbreekt op oud protocol |

### 1.2 Twee gevolgen tegelijk

**Stille nul-waarden (gedeeltelijk)** — `buildSensors()`, `buildVersion()` en `buildDiy()` controleren via `has()` of een register gelezen is en slaan het over bij afwezigheid. `buildStatus()`, `buildControl()`, `buildPower()` en `buildCop()` doen dat niet: zij lezen via `u16(addr, dflt=0)`. De impactvolle gevallen:

| Veld | Builder | Register | Poll-groep | Gevolg bij ontbreken |
| --- | --- | --- | --- | --- |
| `running`, `faultAlarm`, ... | `buildStatus()` | `0x0000–0x0001` | FAST required | Afgedekt door §2.2 — geen snapshot bij required-failure |
| `heatingCurve`, `hotWaterCurve` | `buildControl()` | `0x0314`, `0x0315` | MEDIUM required | Curve 0 = "uit" |
| `protocolVersion` | `buildControl()` | `0x0363` | ONCE optional | `protocolVersion=0`, `coilsAvailable=false` |
| `coilsAvailable` | `buildControl()` | afgeleid | — | Coil-writes via FC06 i.p.v. FC05 — stille write-fout |

`protocolVersion=0` is het meest impactvol: `protocolSupportsCoils(0)` geeft `false`, waardoor schrijfoperaties via het verkeerde function code gaan. `buildControl()` voegt een `has()`-check toe voor `VERSION_REGISTERS.protocolVersion.address` en valt terug op `null` totdat het ONCE-blok gelezen is (zie §3).

**Valse of ontbrekende kwaliteitssignalen:**

- **FAST-groep**: fouten tellen mee als fast-poll failure → `degraded` na 3 failures. Maar `unsupported` registers zijn geen verbindingsproblemen en horen niet mee te tellen.
- **MEDIUM/SLOW/ONCE-groep**: fouten worden niet meegewogen in quality-evaluatie. Quality blijft `online`, geen `setWarning()`, volledig onzichtbaar.

### 1.3 Resterende ADR-042 gaten

| ADR-042 onderdeel | Status |
| --- | --- |
| Fout-classificatie (`illegal data address` vs `timeout` vs `disconnect`) | Niet geïmplementeerd |
| MEDIUM/SLOW poll failures in quality-evaluatie | Niet geïmplementeerd |
| `degraded → offline` bij aanhoudende poll-failures | Niet geïmplementeerd — socket-disconnect gaat al direct naar `offline`; het gat zit in herhaalde FC03-fouten zónder socket-close |
| Non-fast `degraded` reset door elke succesvolle FAST snapshot | Niet beschermd — `_handleModbusData` zet quality terug naar `online` ongeacht de degradatie-oorzaak |

---

## 2. Beslissing

### 2.1 Architectuurkeuze: emit-verantwoordelijkheid verplaatst naar `_runPollGroup`

De huidige architectuur emits fouten in `readHoldingRegisters` op context `fc03:0xADDR`. `_runPollGroup` re-emits vervolgens op `poll:<groupName>`. Dit levert dubbele foutregistratie op bij één blok-failure.

**Gekozen aanpak:** `readHoldingRegisters` emits niet meer — het **gooit alleen**. `_runPollGroup` vangt de throw per blok op, wraps de error in een `ModbusBlockError` met volledige blok-metadata, en emits **één keer** per blok-failure. Zo heeft `ServiceCoordinator._handleError` alle context om required vs optional en fast vs non-fast te onderscheiden.

```typescript
export type ModbusErrorCode =
  | 'unsupported'   // Illegal Data Address (0x02)
  | 'protocol'      // Illegal Data Value (0x03)
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
  ) { super(message); }
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

### 2.2 Per-blok isolatie in `_runPollGroup`

`PollBlock` krijgt een `optional` flag:

```typescript
interface PollBlock {
  start: number;
  count: number;
  label: string;
  optional?: true;  // Afwezig = required
}
```

`_runPollGroup` vervangt de huidige single-catch door per-blok afhandeling:

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

  if (requiredFailed) return; // Geen poll-complete — de per-blok ModbusBlockError is al geëmit

  this.stats.polls++;
  this.stats.lastPollMs = Date.now();
  this.emit(optionalFailed ? 'poll-partial' : 'poll-complete', group.name);
}
```

`readHoldingRegisters` verwijdert zijn `this.emit('error', ...)` aanroep — de throw is voldoende.

### 2.3 `poll-partial` event

`poll-partial` is een nieuw event: required blokken geslaagd, ≥1 optional blok gefaald.

Voor FAST geldt: er zijn geen optional blokken (zie §2.4), dus `poll-partial` kan voor de FAST-groep nooit worden geëmit. `adlar2-modbus-service.ts` triggert snapshots uitsluitend op `poll-complete` voor FAST. Voor MEDIUM/SLOW triggert `poll-complete`/`poll-partial` geen snapshot; `ServiceCoordinator` logt `poll-partial` als waarschuwing.

### 2.4 FAST-blokken: beide required

```typescript
export const POLL_GROUP_FAST = {
  reads: [
    { start: 0x0000, count: 2,  label: 'Status 1+2' },            // required
    { start: 0x0040, count: 30, label: 'WP1 Sensors (0x40–5D)' }, // required
  ],
};
```

Geen `optional` blokken in FAST. Als één blok faalt, keert `_runPollGroup` terug zonder event. `adlar2-modbus-service.ts` bouwt geen snapshot. `ServiceCoordinator` ontvangt geen `data`-event en reset quality **niet** naar `online`. Dit sluit stale nulwaarden uit van `buildStatus()`/`buildPower()`/`buildCop()` die `u16()` lezen zonder `has()`.

### 2.5 Optional blokken in MEDIUM/SLOW/ONCE

```typescript
export const POLL_GROUP_MEDIUM = {
  reads: [
    { start: 0x0002, count: 8,  label: 'Fault State 1-3 + Sys1 Faults' },
    { start: 0x0019, count: 8,  label: 'Relay 1-4 + Switch 1-4',  optional: true },
    { start: 0x0072, count: 12, label: 'Aux/Buffer/Grid/Zone',     optional: true },
    { start: 0x0300, count: 8,  label: 'Control' },
    { start: 0x0313, count: 4,  label: 'Curves' },
    { start: 0x01FF, count: 2,  label: 'P255/P256 Smart Grid' },
  ],
};

export const POLL_GROUP_SLOW = {
  reads: [
    // ... bestaande blokken ...
    { start: 0x0813, count: 7, label: 'L30-L36 energieboekhouding', optional: true },
  ],
};

export const POLL_GROUP_ONCE = {
  reads: [
    { start: 0x0360, count: 4, label: 'Version Info', optional: true },
    // ...
  ],
};
```

### 2.6 Quality-evaluatie: fast vs non-fast degradatie

`ServiceCoordinator._handleError` onderscheidt vier paden op basis van `ModbusBlockError`:

| Conditie | Actie |
| --- | --- |
| `code === 'unsupported'` en `groupName !== 'fast'` | Geen quality-effect — geen verbindingsprobleem |
| `code === 'unsupported'` en `groupName === 'fast'` en `!optional` | Geen quality-effect, maar **structureel stil**: apparaat produceert geen snapshots terwijl quality `online` blijft. `_structurallyUnsupportedFast` vlag zetten + `setWarning()` met meldingstekst "FAST required block unsupported — no data". |
| `code !== 'unsupported'` en `groupName === 'fast'` en `!optional` | `_consecutiveFastPollFailures++` → `degraded` na ≥ 3 |
| `code !== 'unsupported'` en `groupName !== 'fast'` en `!optional` | `_consecutiveNonFastRequiredFailures++` → `degraded` na ≥ 6 |

**Structureel stille staat:** als een FAST required blok `unsupported` retourneert, is er geen verbindingsprobleem maar ook geen weg naar een snapshot. De warmtepomp communiceert — het adresblok bestaat simpelweg niet op deze variant. Dit onderscheid van `degraded` (tijdelijke kwaliteitsachteruitgang) is relevant: de app mag niet stilzwijgend `online` blijven tonen zonder enige signalering. `_structurallyUnsupportedFast` wordt gereset wanneer hetzelfde blok later wél succesvol gelezen wordt (kan na firmware-update).

**Prioriteit en clear-pad:**

`_structurallyUnsupportedFast` is orthogonaal aan `ConnectionQuality`. Een apparaat kan tegelijkertijd `degraded` zijn én structureel stil. De prioriteit voor wat de gebruiker ziet:

```text
offline  >  degraded  >  structurallyUnsupportedFast  >  online
```

Implementatieregels in `_setConnectionQuality` en `_handleStructuralUnsupported`:

1. **`_setConnectionQuality('online')`** — roept `setAvailable()` alleen aan als `!_structurallyUnsupportedFast`. Als de vlag wél actief is, moet in plaats daarvan de structurele warning (opnieuw) gezet worden, zodat `setAvailable()` deze niet stilzwijgend cleart.

2. **FAST required blok succesvol na eerdere `unsupported`** — `_structurallyUnsupportedFast` wordt `false`. Clear-pad: als op dat moment `_connectionQuality === 'online'`, roep `unsetWarning()` / `setAvailable()` aan. Als quality `degraded` of `offline` is, doe niets — die states hebben hun eigen warning/unavailable al actief.

3. **`_setConnectionQuality('degraded')`** — zet `setWarning(...)` ongeacht de structurele vlag; `degraded`-warning heeft hogere prioriteit dan de structurele melding.

```typescript
// In _setConnectionQuality('online'):
if (this._structurallyUnsupportedFast) {
  this.device.setWarning('FAST required block unsupported — no data').catch(() => {});
} else {
  this.device.setAvailable().catch(() => {});
}

// Bij clear van _structurallyUnsupportedFast:
this._structurallyUnsupportedFast = false;
if (this._connectionQuality === 'online') {
  this.device.setAvailable().catch(() => {});
}
```

**Reset:**

- `_consecutiveFastPollFailures` → 0 bij elk `data`-event (bestaand gedrag)
- `_consecutiveNonFastRequiredFailures` → 0 bij een succesvolle non-fast poll

**Event-pad voor non-fast reset — volledige keten:**

`poll-complete`/`poll-partial` worden geëmit door `ModbusTcpService`. Ze bereiken `ServiceCoordinator` momenteel niet door drie ontbrekende schakels:

1. **`Adlar2ModbusService`** luistert naar `tcp.on('poll-complete', ...)` maar handelt alleen FAST af (bouwt snapshot → emits `data`). Non-fast events worden niet doorgegeven aan eigen listeners.

2. **`ModbusRuntimeService` interface** (`modbus-runtime-service.ts:28`) declareert alleen `connected`, `disconnected`, `reconnecting`, `error` en `data`. Geen poll-events.

3. **`ModbusConnectionService`** werkt uitsluitend via het `ModbusRuntimeService`-contract en kan geen niet-gedeclareerde events forwarden.

Oplossing — vier aanpassingen in volgorde:

```typescript
// 1. Adlar2ModbusService: forward non-fast poll-success als nieuw event
this.tcp.on('poll-complete', (groupName) => {
  if (groupName === ADLAR2_POLL_FAST.name) {
    const snapshot = this.buildSnapshot();
    this.emit('data', snapshot);
    this.checkFaults(snapshot.status.activeFaults);
  } else {
    this.emit('poll-group-succeeded', groupName);
  }
});
this.tcp.on('poll-partial', (groupName) => {
  if (groupName !== ADLAR2_POLL_FAST.name) {
    this.emit('poll-group-succeeded', groupName); // required OK
  }
});

// 2. ModbusRuntimeService interface: event toevoegen
on(event: 'poll-group-succeeded', cb: (groupName: string) => void): this;

// 3. ModbusConnectionService: forwarder toevoegen
this.service.on('poll-group-succeeded', (groupName: string) => {
  this.onPollGroupSucceeded(groupName);
});

// 4. ServiceCoordinator: reset non-fast teller
onPollGroupSucceeded(groupName: string): void {
  if (groupName !== 'fast') {
    this._consecutiveNonFastRequiredFailures = 0;
    if (this._connectionQuality === 'degraded'
        && this._consecutiveFastPollFailures === 0) {
      this._setConnectionQuality('online');
    }
  }
}
```

**Kritiek reset-gat:** `_handleModbusData` zet quality terug naar `online` bij *elke* succesvolle FAST snapshot, ook als de degradatie door MEDIUM/SLOW failures werd veroorzaakt. Fix:

```typescript
private _handleModbusData(snapshot: DataSnapshot): void {
  this._lastSuccessfulFastPollAt = Date.now();
  this._consecutiveFastPollFailures = 0;

  // Reset naar online alleen als ook non-fast teller schoon is.
  if (this._connectionQuality !== 'online'
      && this._consecutiveNonFastRequiredFailures === 0) {
    this._setConnectionQuality('online');
  }
}
```

Non-fast `degraded` wordt pas gecleared wanneer een succesvolle MEDIUM/SLOW poll `_consecutiveNonFastRequiredFailures` op 0 zet.

### 2.7 `degraded → offline` transitie

De bestaande `_disconnectStatusTimer` dekt socket-disconnects. Het ontbrekende pad: herhaalde FC03-failures zonder socket-close. Een `_degradedSinceTimer` wordt gestart zodra quality `degraded` wordt. Als binnen 10 minuten geen succesvolle fast poll plaatsvindt, gaat quality naar `offline`. De timer wordt geannuleerd bij elke succesvolle fast poll of bij herstel naar `online`.

---

## 3. Stale data: `protocolVersion` in snapshot én write-path

Beide fixes raken hetzelfde register (`0x0363`) maar via twee onafhankelijke codepaden. De snapshot-fix (`buildControl()`) geeft een veilige UI-default; de write-fix (`writeNamedCoil()`) weigert expliciet. Ze zijn onafhankelijk uitrolbaar (Fase 4).

### 3.1 `buildControl()` — snapshot default

`buildControl()` leest `protocolVersion` via `u16()` zonder `has()`-check. Bij ontbrekend ONCE-blok levert dit `protocolVersion=0` en `coilsAvailable=false` op in de snapshot — een veilige UI-default: flow cards tonen geen coil-opties.

Fix: terugvallen op `null` totdat het register daadwerkelijk gelezen is:

```typescript
const protocolVersion = this.tcp.has(VERSION_REGISTERS.protocolVersion.address)
  ? this.tcp.u16(VERSION_REGISTERS.protocolVersion.address)
  : null;

return {
  // ...
  protocolVersion: protocolVersion ?? 0,
  coilsAvailable: protocolVersion !== null && protocolSupportsCoils(protocolVersion),
};
```

### 3.2 `writeNamedCoil()` — expliciet weigeren

`writeNamedCoil()` leest `protocolVersion` via `u16()` op dezelfde locatie zonder `has()`-check. De guard is:

```typescript
if (protocolVersion > 0 && !protocolSupportsCoils(protocolVersion)) { throw ... }
```

Bij `protocolVersion=0` (nooit gelezen) is `0 > 0 = false` — de guard slaat niet aan. `writeSingleCoil` (FC05) wordt stilzwijgend geprobeerd. Dit is geen stille terugval op een veilige default — dit is een blinde FC05-poging zonder kennis van het apparaat.

Fix: expliciet gooien bij ontbrekend register. Verschil met §3.1: hier is "onbekend" geen veilige default maar een reden om te weigeren:

```typescript
private async writeNamedCoil(
  def: { address: number; name: string },
  state: boolean,
): Promise<void> {
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
  await this.tcp.writeSingleCoil(def.address, state);
}
```

Lange termijn (buiten scope): een `readAt: number | null` per cache-entry zodat `buildSnapshot()` een `stale`-vlag kan meegeven.

---

## 4. Niet gekozen alternatieven

**Hardware-variant detectie** — verworpen. Vereist dat version-registers altijd beschikbaar zijn, maar die staan zelf in een optional ONCE-blok. Introduceert initialisatievolgorde-afhankelijkheid. De `optional`-aanpak lost hetzelfde op zonder die koppeling.

**`readHoldingRegisters` blijft emitten, `_runPollGroup` emits ook** — verworpen. Dubbele foutregistratie per blok-failure. `_consecutiveFastPollFailures` en `errorCountByContext` lopen kunstmatig op.

**Emit alleen in `readHoldingRegisters`, catch in `_runPollGroup` heeft geen emit** — verworpen. `readHoldingRegisters` heeft geen toegang tot blok-metadata (`groupName`, `optional`). `ServiceCoordinator` kan dan geen onderscheid maken tussen required/optional of fast/non-fast. De teller in §2.6 wordt onmogelijk correct.

**`poll-complete` ook bij gedeeltelijk FAST-succes** — verworpen. Leidt tot snapshots met stale `buildStatus()`/`buildPower()` nulwaarden die ServiceCoordinator als volledig geldig markeert en quality op `online` zet.

---

## 5. Implementatiefases

### Fase 1 — Emit-architectuur + per-blok isolatie + event-keten

- `ModbusBlockError` class en `classifyError()` in `modbus-tcp-service.ts`
- `readHoldingRegisters` verwijdert zijn `emit('error', ...)` aanroep
- Per-blok `try/catch` in `_runPollGroup` met `ModbusBlockError` wrap en één emit
- `poll-partial` event toegevoegd naast `poll-complete` in `ModbusTcpService`
- `optional?: true` in `PollBlock` interface
- Risicovolle blokken gemarkeerd in `adlar-modbus-registers.ts`
- **`Adlar2ModbusService`**: `poll-complete` voor FAST triggert snapshot (FAST heeft geen optional blokken, `poll-partial` kan nooit voor FAST worden geëmit); non-fast `poll-complete`/`poll-partial` forwardt als `poll-group-succeeded`
- **`ModbusRuntimeService` interface**: `on('poll-group-succeeded', cb)` declaratie toegevoegd
- **`ModbusConnectionService`**: `poll-group-succeeded` forwarder naar `onPollGroupSucceeded()`
- **`ServiceCoordinator`**: `onPollGroupSucceeded(groupName)` implementatie met non-fast teller reset

### Fase 2 — Quality-evaluatie aanvullingen

- `_consecutiveNonFastRequiredFailures` teller in `ServiceCoordinator`
- `_handleError` onderscheidt `unsupported` / fast / non-fast op `ModbusBlockError.code` en `groupName`
- Reset non-fast teller bij succesvolle non-fast poll
- Guard in `_handleModbusData` zodat non-fast degradatie niet door FAST-succes wordt gecleared

### Fase 3 — `degraded → offline` timer

- `_degradedSinceTimer` in `ServiceCoordinator`
- Geannuleerd bij FAST-succes of herstel naar `online`

### Fase 4 — Stale `protocolVersion` fixes

- `has()`-check in `buildControl()` voor snapshot-veld `coilsAvailable`
- `has()`-check in `writeNamedCoil()`: gooit expliciet bij ontbrekend version-register i.p.v. stilzwijgend FC05 proberen

### Fase 5 — Dashboard-integratie

- `DataSnapshot.diagnostics.skippedBlocks: number[]`
- Toon optional-failed blokken in ADR-041a dashboard
