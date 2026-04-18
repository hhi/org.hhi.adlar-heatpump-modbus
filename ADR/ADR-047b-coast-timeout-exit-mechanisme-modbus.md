# ADR-047b: Adaptive Control — Coast Exit en Watchdog (Modbus)

**Status:** Voorstel
**Datum:** 2026-04-16
**Scope:** `org.hhi.adlar-heatpump-modbus` — adaptive control / coast-logica en de bijbehorende driver-setting
**Gerelateerd:** [ADR-024](../completed/ADR-024-adaptive-cooldown-mode.md), [ADR-025](../completed/ADR-025-adaptive-min-setpoint.md)

---

## 1. Aanleiding

De modbus-app gebruikt een coast-strategie om bij kamerovertemperatuur tijdelijk minder agressief te verwarmen. Die strategie hoort een gecontroleerde overgangsfase te zijn, geen langdurige latched state.

Voor installaties met hoge thermische traagheid, zoals vloerverwarming, is er een reeel scenario waarin:

1. de kamertemperatuur al aantoonbaar daalt
2. de coast-bijdrage in de gecombineerde beslissing praktisch nul is geworden
3. `_coastActive` toch actief blijft

Daardoor blijft coast-state langer bestaan dan functioneel nodig is. Daarnaast kan de eerste coast-correctie te groot zijn voor een systeem met langzame thermische respons.

Dit ADR legt vast hoe de modbus-app coast moet activeren, begrenzen en verlaten.

---

## 2. Context

### 2.1 Relevante signalen

Binnen adaptive control gelden de volgende signalen als normatief:

| Grootheid | Bron |
|---|---|
| Huidige warmtepomp-setpoint | `target_temperature` |
| Gewenste binnentemperatuur | `target_temperature.indoor` |
| Gemeten binnentemperatuur | externe indoor-bron via `externalTemperature` |
| Uitlaattemperatuur T7 | `measure_temperature.outlet` |

### 2.2 Relevante settings

| Setting | Betekenis |
|---|---|
| `adaptive_cooldown_offset` | offset tussen outlet-temperatuur en huidig setpoint |
| `adaptive_cooldown_hysteresis` | activatie-/exitmarge voor coast |
| `adaptive_cooldown_strength` | gewichtsaandeel van coast in de gecombineerde beslissing |
| `adaptive_min_setpoint` | ondergrens voor de uiteindelijke recommendation |
| `adaptive_cooldown_max_cycles` | maximale coast-duur in control cycles |

### 2.3 Werkmodel

Coast is een aanvullende regelcomponent naast PI, COP, prijs en thermische correcties. Coast mag dus:

1. tijdelijk actief zijn
2. alleen een niet-positieve setpoint-correctie leveren
3. zichzelf weer opruimen zodra de functie is uitgewerkt

---

## 3. Beslissing

### 3.1 Zachte exit op dalende kamertemperatuur en verwaarloosbare coast-bijdrage

De modbus-app krijgt een expliciete zachte exit voor coast:

```typescript
private _isStaleCoast(coastAdj: number): boolean {
  const isFalling = this._indoorTempHistory.length >= AdaptiveControlService.TREND_WINDOW_SIZE
    && this._indoorTempHistory[this._indoorTempHistory.length - 1] < this._indoorTempHistory[0];
  const isNegligible = Math.abs(coastAdj) < 0.5;
  return isFalling && isNegligible;
}
```

**Interpretatie:**

1. de kamer beweegt aantoonbaar richting afkoeling
2. coast draagt zelf nauwelijks nog iets bij
3. de state mag dus veilig worden opgeruimd

### 3.2 Watchdog op maximale coast-duur

Coast krijgt een watchdog als backstop:

```typescript
private _coastCycleCount = 0;
private static readonly COAST_MAX_CYCLES = 24;
```

en in runtime:

```typescript
if (this._coastActive && this._coastCycleCount >= maxCycles) {
  this.heatingController.resetHistory();
  this._coastActive = false;
  this._coastCycleCount = 0;
  this._cooldownCycleCount = 0;
}
```

**Normatief gedrag:**

1. default = `24` cycli
2. range = `6` tot `48`
3. de watchdog is een veiligheidsnet, geen primaire regelstrategie

### 3.3 Coast-berekening als aparte compute-stap

De coast-berekening wordt losgetrokken van het bouwen van het `CoastAction`-object.

Nieuwe helpers:

```typescript
private _recordOutletTemp(outletTemp: number): void { ... }
private _calculateOutletDropRate(): number { ... }
private _computeCoastAdjustment(currentSetpoint: number): { adj: number; outletTemp: number | null } { ... }
private _buildCoastAction(coastAdj: number, outletTemp: number, currentSetpoint: number): CoastAction { ... }
```

**Reden:** de exitbeslissing heeft `coastAdj` nodig voordat besloten wordt of coast in dezelfde cyclus actief mag blijven.

### 3.4 Normatieve coast-formule

De coast-correctie wordt berekend uit outlet-temperatuur, offset, staplimiet en outlet-drop-rate:

```typescript
const rawAdjustment = (outletTemp - offset) - currentSetpoint;
const baseAdjustment = Math.min(0, rawAdjustment);
const clampedAdjustment = Math.max(-1.5, baseAdjustment);
const dropRate = this._calculateOutletDropRate();
const dropRateMultiplier = dropRate < 0
  ? Math.max(0.3, 1.0 + dropRate * 0.5)
  : 1.0;
const adjustment = clampedAdjustment * dropRateMultiplier;
```

**Normatief gedrag:**

1. coast levert nooit een positieve correctie
2. de maximale stapgrootte per cyclus is `-1.5°C`
3. snelle outlet-daling verzwakt de coast-druk
4. trage of vlakke outlet-daling laat de volledige basiscorrectie staan

### 3.5 Null-contract bij ontbrekende outlet-data

Wanneer `measure_temperature.outlet` niet beschikbaar is, retourneert de compute-stap:

```typescript
{ adj: 0, outletTemp: null }
```

**Betekenis:**

1. coast heeft in die cyclus geen inhoudelijke bijdrage
2. zachte exit mag nog steeds plaatsvinden op basis van dalende kamertemperatuur
3. harde exit en watchdog blijven altijd werken

### 3.6 Volgorde in `executeControlCycle()`

De normatieve volgorde in adaptive control wordt:

```text
1.  Record indoor temperature in sliding window
2.  Compute coastAdj op basis van measure_temperature.outlet
3.  Harde exit-check
4.  Zachte exit-check
5.  Watchdog-check
6.  Activatie-check als coast nog niet actief is
7.  Increment _coastCycleCount als coast actief is
8.  Build CoastAction uit eerder berekende coastAdj
9.  PI, COP, prijs en thermische componenten uitvoeren
10. combineActionsWithThermal(..., coastAction)
```

Een exit in een cyclus blokkeert directe heractivatie in diezelfde cyclus.

### 3.7 Reset-patroon

Alle coast-exits gebruiken hetzelfde reset-patroon:

```typescript
this.heatingController.resetHistory();
this._coastActive = false;
this._coastCycleCount = 0;
this._cooldownCycleCount = 0;
```

Bij stop/herstart van adaptive control worden daarnaast ook indoor-history en outlet-history geleegd.

### 3.8 Driver-setting

De watchdog wordt configureerbaar via een nieuwe driver-setting in:

```text
drivers/intelligent-heatpump-modbus/driver.settings.compose.json
```

Normatieve definitie:

```json
{
  "id": "adaptive_cooldown_max_cycles",
  "type": "number",
  "label": {
    "en": "Coast max. duration (cycles)",
    "nl": "Maximale coast-duur (cycli)",
    "de": "Maximale Coast-Dauer (Zyklen)",
    "fr": "Durée maximale coast (cycles)"
  },
  "hint": {
    "en": "Watchdog: maximum number of 5-minute cycles before coast is forcibly reset. 24 = 2 hours. Range: 6–48.",
    "nl": "Watchdog: maximaal aantal 5-minuten cycli voordat coast geforceerd wordt gereset. 24 = 2 uur. Bereik: 6–48.",
    "de": "Watchdog: maximale Anzahl 5-Minuten-Zyklen bevor Coast erzwungen zurückgesetzt wird. 24 = 2 Stunden. Bereich: 6–48.",
    "fr": "Chien de garde: nombre maximum de cycles de 5 minutes avant réinitialisation forcée du coast. 24 = 2 heures. Plage: 6–48."
  },
  "value": 24,
  "attr": { "min": 6, "max": 48, "step": 1 }
}
```

---

## 4. Verwacht Gedrag

### 4.1 Normaal verloop

Bij overshoot activeert coast na bevestiging van magnitude, duur en trend. Zodra de kamer daalt en coast praktisch gewichtloos is geworden, verlaat het systeem coast via de zachte exit en neemt PI de landing verder over.

### 4.2 Backstop-gedrag

Wanneer de zachte exit niet triggert, zorgt de watchdog ervoor dat coast-state nooit onbeperkt actief blijft.

### 4.3 Begrensde dynamiek

Een agressieve eerste coast-stap wordt begrensd tot `-1.5°C` per cyclus. Daarmee blijft de setpoint-daling beter passend bij de thermische traagheid van vloerverwarming.

---

## 5. Scopegrenzen

Dit ADR dekt alleen:

1. adaptive control / coast-beslissingen
2. de outlet-gebaseerde coast-berekening
3. de watchdog-setting voor coast

Dit ADR dekt niet:

1. bredere capability-harmonisatie elders in de app
2. rapportage- of diagnostische services buiten adaptive control
3. algemene refactors buiten de coast-control flow

---

## 6. Relevante Bestanden

| Onderdeel | Bestand |
|---|---|
| Coast-logica | `lib/services/adaptive-control-service.ts` |
| Runtime-publicatie van T7 | `drivers/intelligent-heatpump-modbus/device.ts` |
| Driver-settings | `drivers/intelligent-heatpump-modbus/driver.settings.compose.json` |

---

## 7. Consequenties

### Positief

1. coast-state ruimt zichzelf op zodra die functioneel klaar is
2. een blijvend latched coast-state wordt afgevangen
3. de eerste coast-aanpassing wordt begrensd
4. de adaptive-control-flow wordt beter uitlegbaar en testbaar

### Kosten

1. extra state en helper-methodes in `AdaptiveControlService`
2. een extra driver-setting
3. een kleine herordening van `executeControlCycle()`

### Risico

Het voornaamste risico is te vroege exit bij ruis. Dat wordt gemitigeerd door de combinatie van trend over een venster en de drempel `|coastAdj| < 0.5°C`.

---

## 8. Implementatiestatus

Dit ADR beschrijft het gewenste modbus-gedrag. Implementatie volgt in aparte codewijzigingen.
