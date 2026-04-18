# ADR-049: DIY Stooklijn Schrijftoegang via Flow Card en Dashboard

**Status:** Voorstel
**Datum:** 2026-04-18
**Scope:** `org.hhi.adlar-heatpump-modbus`
**Gerelateerd:** ADR-044 (interactief dashboard), ADR-045 (flow cards Modbus lees/schrijf), ADR-046 (expert dashboard)

---

## 1. Aanleiding

De app leest de DIY heating curve parameters uit Modbus en toont ze als read-only capabilities:

- `L28_heatingCurveCoeffK` (0x0811) → `heating_curve_slope`
- `L29_heatingCurveConstantB` (0x0812) → `heating_curve_intercept`

De write-implementatie `Adlar2ModbusService.setDiyHeatingCurve(k, b)` bestaat al en doet het juiste: schrijft L27, L28, L29 en reset de preset-curve naar 0. Die methode is echter niet bereikbaar via flows of het dashboard.

Daarnaast heeft de app al een interactieve stooklijn-visualisatie (`public/heating_curve_line.html`) waarmee de gebruiker de curve visueel kan instellen, maar die pagina heeft nog geen schrijfknop en is niet geregistreerd als dashboardroute.

---

## 2. Beslissing

Schrijftoegang tot de DIY stooklijn wordt op twee manieren aangeboden:

1. **Flow card** — de bestaande `calculate_linear_heating_curve` action wordt uitgebreid zodat hij na de berekening ook de curve schrijft naar Modbus.
2. **Webpagina** — `heating_curve_line.html` krijgt een "Toepassen op warmtepomp"-knop en wordt geregistreerd als dashboardroute.

De capabilities `heating_curve_slope` en `heating_curve_intercept` blijven read-only. Na een succesvolle write werkt de bestaande polling-keten de capabilities vanzelf bij.

---

## 3. Scope

### Niet in scope

- `heating_curve_slope` en `heating_curve_intercept` op `setable: true` zetten
- Capability listeners toevoegen in `device.ts`
- Een aparte `set_diy_heating_curve` flow action (zie `plans/decisions/set-diy-heating-curve.md`)

---

## 4. Ontwerp

### 4.1 Lagenstructuur

De write-route volgt het bestaande patroon van `setHeatingCurve`:

```
FlowCardManagerService / DashboardService
    ↓ callback / passthrough
ServiceCoordinator.setDiyHeatingCurve(k, b)
    ↓
ModbusConnectionService.setDiyHeatingCurve(k, b)
    ↓
Adlar2ModbusService.setDiyHeatingCurve(k, b)  ← bestaat al
```

### 4.2 Flow card: `calculate_linear_heating_curve`

De bestaande handler berekent `supply_temperature` en `formula` en geeft die terug als tokens. Na de berekening wordt ook geschreven:

```typescript
const k = slopeGrade / 10;
// b = referenceTemp, want bij Tamb=-15: k*(−15+15)+b = b
await this.onSetDiyHeatingCurve?.(k, referenceTemp);
```

`onSetDiyHeatingCurve` is een optionele callback in `FlowCardManagerOptions`. Als de Modbus-verbinding wegvalt, gooit de callback een fout die de flow laat mislukken — consistent met het gedrag van andere schrijf-actions.

### 4.3 Dashboard: nieuwe route en endpoint

`DashboardService` krijgt twee nieuwe routes:

```
GET  /heating-curve        → serveert public/heating_curve_line.html
GET  /heating-curve.html   → zelfde
POST /api/set-diy-curve    → schrijft L27/L28/L29 via callback
```

Requestformaat voor `POST /api/set-diy-curve`:

```json
{ "slope": -0.5, "intercept": 55 }
```

- `slope`: de reële coëfficiënt `k` (bijv. `-0.5`), niet de raw L28-waarde
- `intercept`: de constante `b` = settemperatuur bij −15 °C buiten (L29)

Validatiegrenzen (afgeleid van L28/L29 registermetadata):

| Veld | Min | Max |
|---|---|---|
| `slope` | −5.0 | 0.0 |
| `intercept` | 30 | 80 |

Responsformaat: identiek aan `POST /api/write` (ADR-044).

### 4.4 `heating_curve_line.html` — schrijfknop

De pagina krijgt een "Toepassen op warmtepomp"-knop onder de sliders. Na klik:

1. Haal huidige sliderwaarden op (`l28` en `l29`)
2. Bereken `k = l28 / 10`
3. POST naar `/api/set-diy-curve` met `{ slope: k, intercept: l29 }`
4. Toon feedback (succes / foutmelding) in de pagina

---

## 5. Geraakte bestanden

| Bestand | Wijziging |
|---|---|
| `lib/modbus/modbus-runtime-service.ts` | `setDiyHeatingCurve(k, b)` toevoegen aan interface |
| `lib/services/modbus-connection-service.ts` | Passthrough methode |
| `lib/services/service-coordinator.ts` | Passthrough methode |
| `lib/services/flow-card-manager-service.ts` | `onSetDiyHeatingCurve` callback + aanroep in handler |
| `lib/services/dashboard-service.ts` | Nieuwe routes + `onSetDiyHeatingCurve` callback + `_handleSetDiyCurve()` |
| `drivers/intelligent-heatpump-modbus/device.ts` | DIY callback registreren in `_registerDashboardCallbacks()` + doorgeven aan FlowCardManager |
| `public/heating_curve_line.html` | "Toepassen"-knop + fetch naar `/api/set-diy-curve` |

---

## 6. Validatie

| Test | Verwacht resultaat |
|---|---|
| Flow action uitvoeren met L28=−5, L29=55 | Geen fout; registers L27/L28/L29 worden geschreven |
| Daarna pollingcyclus afwachten | `heating_curve_slope = −0.5`, `heating_curve_intercept = 55` |
| `heating_curve_formula` na read-back | Toont formule op basis van nieuwe waarden |
| Flow action met slope_grade=−60 | Range-fout op L28 |
| Flow action zonder verbinding | Fout; flow mislukt zichtbaar |
| Dashboard `/heating-curve` openen | Pagina laadt met sliders en knop |
| Knop "Toepassen" klikken | POST naar `/api/set-diy-curve`; succesfeedback in pagina |
| POST met `intercept=90` | 400-fout: buiten bereik |
| `npm run build` | Compileert zonder TypeScript-fouten |

---

## 7. Read-back synchronisatie

Na een succesvolle write hoeft niets handmatig bijgewerkt te worden.

Verwachte keten:

1. Write via flow card of dashboard → `setDiyHeatingCurve(k, b)` → Modbus
2. Polling leest L27/L28/L29 opnieuw
3. `buildDiy()` bouwt nieuwe `snapshot.diy`
4. `applyModbusSnapshot()` zet `heating_curve_slope`, `heating_curve_intercept`, `heating_curve_formula`, `heating_curve_ref_outdoor`, `heating_curve_ref_temp`

De bestaande read-back route blijft de single source of truth.
