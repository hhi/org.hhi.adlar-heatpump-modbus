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

L27-L29 zitten momenteel in `POLL_GROUP_SLOW` (interval 300s). Na een write duurt het daardoor tot 5 minuten voordat de capabilities bijgewerkt zijn — onacceptabel voor een interactieve instelling.

---

## 2. Beslissing

Schrijftoegang tot de DIY stooklijn wordt op twee manieren aangeboden:

1. **Nieuwe flow action `set_diy_heating_curve`** — schrijft L28/L29 direct naar Modbus. De bestaande `calculate_linear_heating_curve` card blijft ongewijzigd en verzorgt alleen de berekening.
2. **Webpagina** — `heating_curve_line.html` krijgt een "Toepassen op warmtepomp"-knop en wordt geregistreerd als dashboardroute.

L27-L29 worden verplaatst van `POLL_GROUP_SLOW` naar `POLL_GROUP_MEDIUM` zodat capabilities na een write binnen 30 seconden bijgewerkt zijn.

De capabilities `heating_curve_slope` en `heating_curve_intercept` blijven read-only. Na een write werkt de bestaande polling-keten de capabilities bij via de MEDIUM poll.

---

## 3. Scope

### Niet in scope

- `heating_curve_slope` en `heating_curve_intercept` op `setable: true` zetten
- Capability listeners toevoegen in `device.ts`
- `calculate_linear_heating_curve` flow card aanpassen

---

## 4. Ontwerp

### 4.1 Flow cards

| Card | Verantwoordelijkheid | Wijziging |
| --- | --- | --- |
| `calculate_linear_heating_curve` | Berekent aanvoertemperatuur en formule op basis van L28/L29 en buitentemperatuur | Geen |
| `set_diy_heating_curve` (nieuw) | Schrijft slope (`k`) en intercept (`b`) naar L27/L28/L29 | Nieuw |

Argumenten voor `set_diy_heating_curve`:

| Argument | Type | Beschrijving |
| --- | --- | --- |
| `device` | device | Apparaatselector |
| `slope` | number | Coëfficiënt `k`, bijv. `-0.5` (wordt als `round(k×10)` naar L28 geschreven) |
| `intercept` | number | Constante `b` = settemperatuur bij −15°C buiten (L29), bijv. `55` |

### 4.2 Lagenstructuur

De write-route volgt het bestaande patroon van `setHeatingCurve`:

```
set_diy_heating_curve flow card / DashboardService
    ↓ callback / passthrough
ServiceCoordinator.setDiyHeatingCurve(k, b)
    ↓
ModbusConnectionService.setDiyHeatingCurve(k, b)
    ↓
Adlar2ModbusService.setDiyHeatingCurve(k, b)  ← bestaat al
```

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

- `slope`: de reële coëfficiënt `k`, niet de raw L28-waarde
- `intercept`: de constante `b` = settemperatuur bij −15°C buiten (L29)

Validatiegrenzen (afgeleid van L28/L29 registermetadata):

| Veld | Min | Max |
|---|---|---|
| `slope` | −5.0 | 0.0 |
| `intercept` | 30 | 80 |

Responsformaat: identiek aan `POST /api/write` (ADR-044).

### 4.4 `heating_curve_line.html` — schrijfknop

De pagina krijgt een "Toepassen op warmtepomp"-knop onder de sliders:

1. Haal huidige sliderwaarden op (`l28` en `l29`)
2. Bereken `k = l28 / 10`
3. POST naar `/api/set-diy-curve` met `{ slope: k, intercept: l29 }`
4. Toon feedback (succes / foutmelding) in de pagina

### 4.5 Pollgroep: SLOW → MEDIUM

L27-L29 (0x0810, count 3) worden verplaatst van `POLL_GROUP_SLOW` (300s) naar `POLL_GROUP_MEDIUM` (30s).

Motivatie: zelfde redenering als voor de preset-curves en Smart Grid-registers (eerder al van SLOW naar MEDIUM verplaatst) — registers die door de gebruiker schrijfbaar zijn horen snelle terugkoppeling te geven. Na een write via flow card of webpagina zijn de capabilities `heating_curve_slope` en `heating_curve_intercept` binnen maximaal 30 seconden bijgewerkt.

---

## 5. Read-back synchronisatie

Na een succesvolle write hoeft niets handmatig bijgewerkt te worden.

Verwachte keten:

1. Write via flow card of dashboard → `setDiyHeatingCurve(k, b)` → Modbus
2. MEDIUM poll (≤30s) leest L27/L28/L29 opnieuw
3. `buildDiy()` bouwt nieuwe `snapshot.diy`
4. `applyModbusSnapshot()` zet `heating_curve_slope`, `heating_curve_intercept`, `heating_curve_formula`, `heating_curve_ref_outdoor`, `heating_curve_ref_temp`

De bestaande read-back route blijft de single source of truth.

---

## 6. Geraakte bestanden

| Bestand | Wijziging |
|---|---|
| `lib/modbus/adlar-modbus-registers.ts` | L27-L29 van `POLL_GROUP_SLOW` naar `POLL_GROUP_MEDIUM` |
| `lib/modbus/modbus-runtime-service.ts` | `setDiyHeatingCurve(k, b)` toevoegen aan interface |
| `lib/services/modbus-connection-service.ts` | Passthrough methode |
| `lib/services/service-coordinator.ts` | Passthrough methode |
| `lib/services/flow-card-manager-service.ts` | `onSetDiyHeatingCurve` callback + nieuwe `set_diy_heating_curve` action listener |
| `lib/services/dashboard-service.ts` | Nieuwe routes + `onSetDiyHeatingCurve` callback + `_handleSetDiyCurve()` |
| `drivers/intelligent-heatpump-modbus/device.ts` | DIY callback registreren in `_registerDashboardCallbacks()` + doorgeven aan FlowCardManager |
| `.homeycompose/flow/actions/set_diy_heating_curve.json` | Nieuwe flow action definitie |
| `public/heating_curve_line.html` | "Toepassen"-knop + fetch naar `/api/set-diy-curve` |
| `locales/en.json` + `locales/nl.json` | Vertalingen voor nieuwe flow action |

---

## 7. Validatie

| Test | Verwacht resultaat |
| --- | --- |
| Flow action `set_diy_heating_curve` met slope=−0.5, intercept=55 | Geen fout; L27/L28/L29 geschreven |
| Na ≤30s pollingcyclus | `heating_curve_slope = −0.5`, `heating_curve_intercept = 55` |
| `heating_curve_formula` na read-back | Toont formule op basis van nieuwe waarden |
| Flow action met slope=−6 | Range-fout op L28 |
| Flow action met intercept=90 | Range-fout op L29 |
| Flow action zonder verbinding | Fout; flow mislukt zichtbaar |
| `calculate_linear_heating_curve` flow card | Gedrag ongewijzigd; berekent en retourneert tokens |
| Dashboard `/heating-curve` openen | Pagina laadt met sliders en knop |
| Knop "Toepassen" klikken | POST naar `/api/set-diy-curve`; succesfeedback in pagina |
| POST met intercept=90 | 400-fout: buiten bereik |
| `npm run build` | Compileert zonder TypeScript-fouten |
