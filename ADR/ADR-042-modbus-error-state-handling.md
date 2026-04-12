# ADR-042: Modbus Error State Handling — Verbindingskwaliteit en Fault-classificatie

**Status:** Voorstel  
**Datum:** 2026-04-12  
**Gerelateerd:** [ADR-031 ModbusConnectionService Ontkoppelen](ADR-031-modbus-connection-service-driver-ontkoppeling.md), [ADR-037 Persistentie Runtime-State](ADR-037-persistentie-runtime-state-capability-herstel.md), [ADR-041a Lokale HTTP Dashboard](ADR-041a-lokale-http-dashboard-server.md)

---

## 1. Probleem

De huidige code maakt geen onderscheid tussen:

- **transportfouten** — socket weg, EW11A niet bereikbaar
- **protocol/request-fouten** — FC03 mislukt op een specifiek blok
- **unsupported registers** — register bestaat niet in dit model
- **device faults** — warmtepomp meldt actieve storingen via Fault State-registers

Gevolg: de verbinding kan technisch `connected` zijn terwijl een pollgroep structureel faalt en de app feitelijk verouderde of onvolledige data toont. Dat is niet zichtbaar voor de gebruiker.

Concreet probleem bij block reads: als één register in een contiguous FC03-blok ongeldig is, faalt de volledige read — ook de registers die wél geldig zijn. Eén mappingverschil sloopt zo de hele fast poll.

Aanvullend is er een bestaande bug: `alarm_generic` wordt alleen op `true` gezet bij actieve faults, maar nooit gesymmetrisch teruggezet naar `false` wanneer de faults verdwijnen.

---

## 2. Beslissing

We modelleren **verbindingskwaliteit** en **device faults** als twee onafhankelijke assen:

### 2.1 Vier runtime-states

| State | Betekenis |
| --- | --- |
| `online` | Socket verbonden, recente succesvolle fast poll, geen structurele fouten |
| `degraded` | Socket verbonden maar herhaalde FC03/FC06 fouten, of stale fast-poll data |
| `offline` | Geen bruikbare Modbus-communicatie — socket weg of geen succesvolle poll binnen timeout |
| `device_fault` | Communicatie goed, maar warmtepomp meldt actieve storingen in Fault State-registers |

`device_fault` is een **extra** domeinstatus — geen vervanging van `online/degraded/offline`. Een unit kan tegelijk `online` én `device_fault` zijn.

### 2.2 Homey-semantiek

| State | Homey-actie |
| --- | --- |
| `online` | `setAvailable()` |
| `degraded` | `setWarning(...)` — na een dempingsperiode (zie §4) |
| `offline` | `setUnavailable(...)` — na bestaande grace period (60s) |
| `device_fault` | `alarm_generic = true` + flow trigger; nooit `setUnavailable()` |

### 2.3 alarm_generic bug fix

```typescript
// In applyModbusSnapshot(), device.ts
await this.setCapabilityValue('alarm_generic', snap.status.activeFaults.length > 0);
```

De huidige code zet `alarm_generic` alleen op `true`. Dit wordt gesymmetrisch gemaakt: als `activeFaults` leeg is, wordt `alarm_generic` op `false` gezet.

---

## 3. Fout-classificatie

Alle fouten via `ServiceCoordinator._handleError(err, context)` worden gecategoriseerd:

| Categorie | Betekenis |
| --- | --- |
| `socket` | Connectie-/socketfouten |
| `socket:timeout` | Timeout op socketniveau |
| `reconnect` | Reconnect-limiet bereikt of mislukt |
| `fc03:*` | Read error op holding registers |
| `fc06:*` | Write error op holding register |
| `fc05:*` | Coil write error |
| `poll:*` | Pollgroep afgebroken |
| `init-validation` | Initfase-fout, niet operationeel kritisch |
| `validate:*` | Model-/protocolvalidatie (bijv. onverwacht koelmiddeltype) |

Binnen `fc03`/`fc06`/`fc05` wordt `err.message` geparsed op:

- `illegal data address` → unsupported register of blok
- `illegal data value` → protocol mismatch
- `timeout` → tijdelijke vertraging
- `connection closed` → socket-level disconnect

---

## 4. Counters, timestamps en state transitions

### 4.1 Bij te houden state in `ServiceCoordinator`

```typescript
lastSuccessfulFastPollAt: number | null
lastSuccessfulAnyPollAt: number | null
lastErrorAt: number | null
lastErrorMessage: string | null
lastErrorContext: string | null
consecutiveFastPollFailures: number
errorCountByContext: Map<string, number>
unsupportedBlockCountByStartAddress: Map<number, number>
```

Afbakening met `CapabilityHealthService`: die service bewaakt data-versheid per capability. De bovenstaande counters bewaken poll-succes op transport/protocol-niveau. Geen overlap.

### 4.2 State transitions

```
online  ──(≥2 opeenvolgende fast-poll failures)──► degraded
online  ──(socket disconnect + grace period)──────► offline

degraded ──(fast poll succesvol)──────────────────► online
degraded ──(aanhoudende failures + timeout)───────► offline

offline  ──(reconnect + 1 succesvolle fast poll)──► online
```

**Dempingslaag voor `degraded`:** pas na **3 opeenvolgende** fast-poll failures wordt `setWarning()` aangeroepen — niet al bij 1 of 2. Dit voorkomt valse waarschuwingen bij korte EW11A-hickups.

---

## 5. Quarantine van unsupported blocks (Fase 3)

Dit is een aparte, optionele fase bedoeld primair voor de tweede driver (modbus2) waar de registermap nog niet volledig gevalideerd is.

**Probleem:** een contiguous FC03-blok faalt volledig als één adres erin ongeldig is.

**Aanpak:**

1. Detecteer herhaalde `illegal data address` op hetzelfde startadres.
2. Markeer dat blok als `suspect` na N identieke fouten (N = 3).
3. Splits het blok dynamisch in kleinere subblokken of losse reads.
4. Markeer het probleemadres of subblok als `unsupported` en sla het over.
5. State gaat naar `degraded`, niet `offline`.

**Niet implementeren voor de huidige driver** — de registermap is bekend en gevalideerd.

---

## 6. Diagnostiek

De diagnostische state (connection quality, failure counters, quarantained blocks) wordt ontsloten via het bestaande **ADR-041a dashboard** op poort 8090. De `DataSnapshot` wordt uitgebreid met een `diagnostics`-sectie:

```typescript
diagnostics?: {
  connectionQuality: 'online' | 'degraded' | 'offline';
  consecutiveFastPollFailures: number;
  lastSuccessfulFastPollAt: number | null;
  lastErrorContext: string | null;
  unsupportedBlocks: number[];
}
```

Geen aparte Homey-capability nodig voor diagnostiek — het dashboard biedt voldoende inzicht.

---

## 7. Implementatiefases

### Fase 1 — Directe bug fix (geen ADR nodig)

- Fix `alarm_generic` symmetrie in `device.ts`

### Fase 2 — Connection quality state

- Voeg `connectionQuality` state toe in `ServiceCoordinator`
- Classificeer fouten in `_handleError()`
- Houd `lastSuccessfulFastPollAt` en `consecutiveFastPollFailures` bij
- Koppel aan `setAvailable()` / `setWarning()` / `setUnavailable()`

### Fase 3 — Homey-zichtbaarheid

- Vertaal `degraded` naar `setWarning()` met dempingslaag
- Vertaal `offline` naar `setUnavailable()` na bestaande grace period
- Herstel naar `setAvailable()` pas na succesvolle fast poll

### Fase 4 — Quarantine (alleen modbus2)

- Implementeer suspect/unsupported block tracking
- Dynamische block splitting bij herhaalde `illegal data address`

### Fase 5 — Dashboard-integratie

- Breid `DataSnapshot` uit met `diagnostics`-sectie
- Toon connection quality en counters in ADR-041a dashboard

---

## 8. Niet gekozen alternatieven

**Alle fouten als disconnect behandelen** — verworpen. Een `illegal data address` is een mappingprobleem, geen connectiviteitsstoring. Deze aanpak maskeert de werkelijke oorzaak.

**Aparte `adlar_connection_quality` capability** — verworpen ten gunste van het dashboard. Een extra capability kost UI-ruimte en is minder informatief dan een diagnostiekpagina.

**Quarantine voor huidige driver** — uitgesteld. De registermap is bekend; de complexiteit weegt niet op tegen de beperkte winst.
