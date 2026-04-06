# ADR-036: Flow Cards Zonder Werkende Handler — Analyse en Beslissing

**Status:** Voorstel  
**Datum:** 2026-04-04  
**Gerelateerd:** [ADR-030 DPS vs Modbus Mapping Gap-Analyse](ADR-030-dps-vs-modbus-mapping-gap-analyse.md), [ADR-012 Flow Card Runtime Alignering](ADR-012-modbus-flow-card-runtime-alignment.md)

---

## 1. Context

Uit een volledige codebase-scan (april 2026) blijkt dat **12 flow cards** gedefinieerd zijn in `.homeycompose/flow/` maar geen werkende runtime-handler hebben in de Modbus TypeScript code. Dit zijn kaarten die zichtbaar zijn voor gebruikers in de Homey app maar bij gebruik geen enkel effect hebben.

De kaarten vallen in drie categorieën:

### 1.1 Triggers zonder `triggerFlowCard`-aanroep (3)

| Card ID | Situatie |
|---|---|
| `cop_efficiency_changed` | Compose JSON aanwezig. Alleen `daily_cop_efficiency_changed` en `monthly_cop_efficiency_changed` worden getriggerd in `rolling-cop-calculator.ts`. De base-variant ontbreekt. |
| `cop_outlier_detected` | Compose JSON aanwezig. Geen enkele `triggerFlowCard('cop_outlier_detected', ...)` aanroep in de gehele codebase. |
| `water_mode_changed` | Compose JSON aanwezig. `snapshot-trigger-service.ts` triggert `heating_mode_changed` en `work_mode_changed`, maar `water_mode_changed` is overgeslagen. |

### 1.2 Conditions zonder `registerRunListener` (5)

| Card ID | Situatie |
|---|---|
| `electrical_balance_check` | Compose JSON aanwezig. Niet geregistreerd in `flow-card-manager-service.ts` noch in `flow-helpers.ts`. |
| `temperature_differential` | Compose JSON aanwezig. Niet geregistreerd. |
| `system_pulse_steps_differential` | Compose JSON aanwezig. Niet geregistreerd. |
| `water_flow_rate_check` | Compose JSON aanwezig. Niet geregistreerd. |
| `cop_calculation_method_is` | Compose JSON aanwezig. Niet geregistreerd in Tuya-app noch Modbus-app. |

### 1.3 Actions zonder `registerRunListener` (4)

| Card ID | Situatie |
|---|---|
| `get_seasonal_mode` | Compose JSON aanwezig. Nergens geregistreerd. |
| `calculate_curve_value` | Compose JSON aanwezig. Nergens geregistreerd. |
| `calculate_linear_heating_curve` | Compose JSON aanwezig. Nergens geregistreerd. |
| `calculate_time_based_value` | Compose JSON aanwezig. Nergens geregistreerd. |

---

## 2. Probleemstelling

Een flow card zonder handler gedraagt zich als volgt:
- **Trigger:** vuurt nooit — flows die hierop wachten starten nooit
- **Condition:** evalueert altijd `false` — flows die hierop vertrouwen worden altijd geblokkeerd
- **Action:** doet niets — flows die hierop steunen geven de indruk van werking maar hebben geen effect

Homey geeft geen foutmelding aan de gebruiker wanneer een kaart geen handler heeft. Dit leidt tot stille falen die voor de gebruiker moeilijk te diagnosticeren zijn.

---

## 3. Analyse per kaart — inclusief Tuya-referentie

### 3.1 `water_mode_changed` (trigger)

**Tuya-implementatie:** `device.ts` regel 2935. Vuurt wanneer `adlar_enum_water_mode` (DPS 10) wijzigt via change-detectie: `this.lastWaterMode !== null && currentMode !== this.lastWaterMode`. Tokens: `mode`, `previous_mode`. Geen `registerRunListener` nodig (geen conditionele filtering).

**Modbus root cause:** `snapshot-trigger-service.ts` triggert `heating_mode_changed` (regel 83) en `work_mode_changed` (regel 94), maar `water_mode_changed` is overgeslagen. De capability `adlar_water_mode` moet aanwezig zijn in het Modbus-device — dit vereist verificatie.

**Modbus oplossing:** Één `checkAndTrigger()`-aanroep toevoegen in `snapshot-trigger-service.ts`, analoog aan de bestaande mode-triggers.

**Effort:** Minimaal (< 10 regels).

---

### 3.2 `cop_efficiency_changed` (trigger)

**Tuya-implementatie:** Twee onderdelen:
1. **Fire-locaties:** `device.ts` regels 2173 en 2576 — vuren wanneer COP-efficiëntiestatus wijzigt, met tokens `current_cop`, `previous_cop`, `change`, `calculation_method`, `confidence_level`.
2. **Conditionele filter:** `app.ts` regels 998-1029 — `getDeviceTriggerCard('cop_efficiency_changed').registerRunListener()` evalueert of `state.cop_value` boven of onder `args.threshold` ligt, afhankelijk van de gebruikersinstelling `args.condition` (`'above'` of `'below'`).

**Modbus root cause:** Geen van beide onderdelen is geïmplementeerd. De daily/monthly varianten worden wél getriggerd in `rolling-cop-calculator.ts` (regels 618/636), maar de base-variant mist zowel de fire-aanroep als de conditionele `registerRunListener`.

**Modbus oplossing:**
- Change-detectie op COP-efficiëntielabel toevoegen (in `snapshot-trigger-service.ts` of `rolling-cop-calculator.ts`)
- `registerRunListener` toevoegen in `flow-card-manager-service.ts` met threshold-vergelijking

**Effort:** Klein-Medium.

---

### 3.3 `cop_outlier_detected` (trigger)

**Tuya-implementatie:** `device.ts` regels 2149 en 2218. Vuurt wanneer `copResult.isOutlier && !this.lastCOPOutlierStatus` (state-change detectie op outlier-vlag). Tokens: `outlier_cop`, `outlier_reason`, `calculation_method`. Geen `registerRunListener` (geen conditionele filtering).

**Modbus root cause:** `RollingCopCalculator` berekent al outliers intern (`outlier_detection_enabled` instelling bestaat), maar het resultaat wordt nooit via `triggerFlowCard` naar buiten gebracht.

**Modbus oplossing:** Bij outlier-detectie in `rolling-cop-calculator.ts` een `triggerFlowCard('cop_outlier_detected', { outlier_cop, outlier_reason, calculation_method })` toevoegen. Vereist het device-trigger-hook patroon (ADR-030 §2.2).

**Effort:** Klein, maar afhankelijk van ADR-030 §2.2.

---

### 3.4 `electrical_balance_check` (condition)

**Tuya-implementatie:** `app.ts` regels 362-442. Leest driefasige stromen: `measure_current.cur_current` (fase A), `measure_current.b_cur` (fase B), `measure_current.c_cur` (fase C). Berekent gemiddelde en controleert of alle drie fasen binnen de gebruikersingestelde tolerantie (%) vallen: `|fase - gem| ≤ tolerantieValue` voor alle drie. Self-healing actief (uitschakelen na 50+ fouten/uur).

**Modbus vraag:** Beschikt het Modbus-device over driefasige stroomcapabilities (`measure_current.cur_current`, `b_cur`, `c_cur`)? De Adlar Castra heeft driefasige spanning/stroom registers — dit vereist verificatie in `adlar-modbus-registers.ts`.

**Modbus oplossing (als registers beschikbaar):** `registerRunListener` toevoegen in `flow-card-manager-service.ts` met identieke driehoeksbalans-logica als Tuya.

**Effort:** Klein (conditioneel op register-beschikbaarheid).

---

### 3.5 `temperature_differential` (condition)

**Tuya-implementatie:** `app.ts` regels 303-359. Leest `measure_temperature.temp_top` (inlaat) en `measure_temperature.temp_bottom` (uitlaat). Berekent `|inlaat - uitlaat|` en vergelijkt met `args.differential`. Self-healing actief.

**Modbus capability-mapping:**

| Tuya capability | Modbus equivalent |
|---|---|
| `measure_temperature.temp_top` | `measure_temperature.inlet` (inlaatwater T3) |
| `measure_temperature.temp_bottom` | `measure_temperature.outlet` (uitlaatwater T4W) |

**Modbus oplossing:** `registerRunListener` toevoegen in `flow-card-manager-service.ts` met `measure_temperature.inlet` en `measure_temperature.outlet`. Logica identiek aan Tuya.

**Effort:** Minimaal.

---

### 3.6 `system_pulse_steps_differential` (condition)

**Tuya-implementatie:** `app.ts` regels 496-554. Leest `adlar_measure_pulse_steps_temp_current` (EEV-stappen) en `adlar_measure_pulse_steps_effluent_temp` (EVI-stappen). Berekent `|EEV - EVI|` en vergelijkt met `args.differential`. Self-healing actief.

**Modbus situatie:** De Tuya-capabilities `adlar_measure_pulse_steps_temp_current` en `adlar_measure_pulse_steps_effluent_temp` zijn DPS-specifieke waarden. In de Modbus-app zijn geen equivalente registers of capabilities aanwezig voor EEV/EVI-pulsestappen.

**Conclusie:** Geen Modbus-equivalent beschikbaar. De condition kan niet zinvol geïmplementeerd worden in de Modbus-app.

**Actie:** Verwijderen uit de Modbus-app.

---

### 3.7 `water_flow_rate_check` (condition)

**Tuya-implementatie:** `app.ts` regels 445-493. Leest `measure_water` en vergelijkt met `args.flowRate`. Retourneert `currentFlowRate > args.flowRate`. Self-healing actief.

**Modbus capability-mapping:** De Modbus-app heeft `measure_water_flow` (via Modbus-register). De logica is identiek, alleen de capability-naam verschilt.

**Modbus oplossing:** `registerRunListener` toevoegen in `flow-card-manager-service.ts` met `measure_water_flow` als capability-id.

**Effort:** Minimaal.

---

### 3.8 `cop_calculation_method_is` (condition)

**Tuya-implementatie:** Niet geïmplementeerd. Compose JSON aanwezig in Tuya-app, maar geen `registerRunListener` in `app.ts`. Identieke status als Modbus-app.

**Conclusie:** Nooit geïmplementeerd in enige app. Waarschijnlijk een compose-artefact.

**Actie:** Verwijderen uit beide apps.

---

### 3.9 `get_seasonal_mode` (action)

**Tuya-implementatie:** `app.ts` regels 775-812. Gebruikt `SeasonalModeCalculator.getCurrentSeason()`. Geen capability nodig (puur datumgebaseerd). Stookseizoen: 1 oktober – 15 mei (EN 14825 SCOP-norm). Output-tokens: `mode`, `is_heating_season`, `is_cooling_season`, `days_until_season_change`.

**Modbus situatie:** `SeasonalModeCalculator` is een stateless utility-klasse. De klasse is beschikbaar in `lib/` en vereist geen device-specifieke capabilities.

**Modbus oplossing:** `registerRunListener` toevoegen in `flow-card-manager-service.ts` als directe wrapper om `SeasonalModeCalculator.getCurrentSeason()`. Identiek aan Tuya.

**Effort:** Minimaal.

---

### 3.10 `calculate_curve_value` (action)

**Tuya-implementatie:** `app.ts` regels 564-615. Parameters: `input_value` (getal of numerieke string), `curve` (curve-definitiestring). Gebruikt `CurveCalculator.evaluate(inputValue, curve)`. Output-token: `result_value`. Validatie op niet-lege curve-definitie en numerieke input.

**Modbus situatie:** `CurveCalculator` is een stateless utility. Beschikbaar in `lib/`. Geen device-capabilities nodig.

**Modbus oplossing:** `registerRunListener` toevoegen als directe wrapper om `CurveCalculator.evaluate()`. Identiek aan Tuya.

**Effort:** Minimaal.

---

### 3.11 `calculate_linear_heating_curve` (action)

**Tuya-implementatie:** `app.ts` regels 633-720. Parameters: `outdoor_temp`, `reference_temp` (aanvoertemp bij referentiepunt), `slope_grade` (Adlar L28-parameter, bijv. -5 → -0.5/°C). Vaste referentie-buitentemperatuur: **-15°C** (Adlar-specificatie). Berekening: `intercept = referenceTemp - (slope × -15)`, `supplyTemp = slope × outdoorTemp + intercept`. Output-tokens: `supply_temperature`, `formula`.

**Modbus situatie:** De berekening bestaat al in `DiyHeatingCurve.calcSetpoint()` in `adlar2-modbus-service.ts`. De flow card-handler is een dunne wrapper. Let op: Tuya gebruikt L28-slopeGrade-omrekening (`slopeGrade / 10`), terwijl de Modbus-app directe `slopeK`-waarden hanteert — de handler moet de juiste parameterconventie volgen.

**Modbus oplossing:** `registerRunListener` toevoegen met L28-omrekening, identiek aan Tuya. De referentietemperatuur van -15°C is Adlar-specifiek en geldt voor beide apps.

**Effort:** Minimaal.

---

### 3.12 `calculate_time_based_value` (action)

**Tuya-implementatie:** `app.ts` regels 729-766. Parameter: `schedule` (schedule-definitiestring in `TimeScheduleCalculator`-formaat). Gebruikt `TimeScheduleCalculator.evaluate(schedule)`. Output-token: `result_value`. Retourneert een geïnterpoleerde waarde op basis van tijdstip en schema.

**Modbus situatie:** `TimeScheduleCalculator` is een stateless utility. Beschikbaar in `lib/`. Geen device-capabilities nodig.

**Modbus oplossing:** `registerRunListener` toevoegen als directe wrapper om `TimeScheduleCalculator.evaluate()`. Identiek aan Tuya.

**Effort:** Minimaal. (Eerder ingeschat als "geen implementatie" — herzien op basis van Tuya-analyse.)

---

## 4. Herziene beslissing

### 4.1 Implementeren (hoge waarde, lage effort)

| Card ID | Type | Modbus-aanpak | Tuya-referentie |
|---|---|---|---|
| `water_mode_changed` | Trigger | `checkAndTrigger()` toevoegen in `snapshot-trigger-service.ts` | `device.ts` L2935 |
| `water_flow_rate_check` | Condition | `registerRunListener` met `measure_water_flow` | `app.ts` L445-493 |
| `temperature_differential` | Condition | `registerRunListener` met `measure_temperature.inlet` / `.outlet` | `app.ts` L303-359 |
| `get_seasonal_mode` | Action | Wrapper om `SeasonalModeCalculator.getCurrentSeason()` | `app.ts` L775-812 |
| `calculate_curve_value` | Action | Wrapper om `CurveCalculator.evaluate()` | `app.ts` L564-615 |
| `calculate_linear_heating_curve` | Action | Wrapper om `DiyHeatingCurve.calcSetpoint()` met L28-omrekening | `app.ts` L633-720 |
| `calculate_time_based_value` | Action | Wrapper om `TimeScheduleCalculator.evaluate()` | `app.ts` L729-766 |
| `electrical_balance_check` | Condition | `registerRunListener` met driefasige stroomcapabilities — conditioneel op register-beschikbaarheid | `app.ts` L362-442 |

### 4.2 Implementeren (afhankelijk van andere ADR)

| Card ID | Type | Blocker |
|---|---|---|
| `cop_outlier_detected` | Trigger | Vereist device trigger hook (ADR-030 §2.2); fire in `rolling-cop-calculator.ts` |
| `cop_efficiency_changed` | Trigger | Vereist change-detectie + `registerRunListener` met threshold-filter; zie Tuya `app.ts` L998-1029 |

### 4.3 Verwijderen

| Card ID | Type | Reden |
|---|---|---|
| `cop_calculation_method_is` | Condition | Niet geïmplementeerd in Tuya-app noch Modbus-app; compose-artefact |
| `system_pulse_steps_differential` | Condition | DPS-specifiek (EEV/EVI pulsestappen); geen Modbus-register-equivalent |

---

## 5. Niet besloten in deze ADR

- De exacte implementatievolgorde van de §4.1-kaarten
- Of `electrical_balance_check` haalbaar is (afhankelijk van register-verificatie)
- Of de verwijdering van `cop_calculation_method_is` en `system_pulse_steps_differential` ook in de Tuya-app wordt doorgevoerd
- De fasering van de §4.2-kaarten t.o.v. ADR-030 §2.2
