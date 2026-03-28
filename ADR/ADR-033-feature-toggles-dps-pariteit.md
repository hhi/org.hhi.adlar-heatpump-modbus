# ADR-033: Feature Toggles voor DPS-Pariteit Flow Cards

**Status:** Voorstel
**Datum:** 2026-03-28
**Gerelateerd:** [ADR-012 Flow Card Runtime Alignering](ADR-012-modbus-flow-card-runtime-alignment.md), [ADR-030 DPS vs Modbus Gap-Analyse](ADR-030-dps-vs-modbus-mapping-gap-analyse.md), [ADR-032 Configureerbare Sensor-Categorieën](ADR-032-configureerbare-sensor-categorieen.md)

---

## 1. Probleem

De Modbus-app deelt met de DPS-app dezelfde `.homeycompose/flow` catalogus (25 actions, 29 conditions, 43 triggers), maar een groot deel van die flow cards heeft geen runtime-registratie in de Modbus-app. De DPS-app activeert deze via `app.ts` bootstrap, custom listeners en device-side triggerlogica — code die in de Modbus-app ontbreekt of niet wordt aangeroepen.

De ongeactiveerde features zijn niet allemaal relevant voor elke gebruiker. Sommige vereisen specifieke hardware (3-fase, buffervat), sommige zijn geavanceerd (stooklijnberekeningen), en sommige zijn nog niet volledig geïmplementeerd (Building Insights). Een alles-of-niets activering is daarom onwenselijk.

## 2. Beslissing

We introduceren **7 feature-toggles** in de device settings die groepen van gerelateerde flow cards activeren of deactiveren. Elke toggle controleert een logisch samenhangende set van flow cards die dezelfde runtime-infrastructuur delen.

### 2.1 Toggle-overzicht

| # | Setting-id | Label | Flow cards | Default | Categorie |
|---|---|---|---|---|---|
| 1 | `flow_helpers_enabled` | Basis flow actions & conditions | 13 | `true` | A: code bestaat, niet gebootstrapt |
| 2 | `calculator_cards_enabled` | Stooklijn-calculators | 4 | `false` | C: compose-only, geen runtime |
| 3 | `sensor_alerts_enabled` | Temperatuur- & efficiency-alerts | 14 | `false` | C: compose-only + device trigger bron nodig |
| 4 | `status_triggers_enabled` | Status-wijziging triggers | 7 | `true` | C: compose-only, snapshot-vergelijking nodig |
| 5 | `cop_triggers_enabled` | COP trend & verbruik triggers | 4 | `true` | D: service bestaat, device hook ontbreekt |
| 6 | `building_insights_enabled` | Building Insights (experimenteel) | 7 | `false` | B: service-stub, niet geïnjecteerd |
| 7 | `advanced_conditions_enabled` | Geavanceerde conditions | 4 | `false` | C: compose-only, geen runtime |

**Totaal:** ~53 flow cards activeerbaar via 7 toggles.

### 2.2 Default-principe

- **`true`** voor features die alleen monitoring vereisen en lage overhead hebben
- **`false`** voor features die schrijfacties doen, geavanceerde berekeningen vereisen, of nog niet volledig geïmplementeerd zijn

## 3. Feature-Beschrijvingen

### 3.1 Flow Helpers Bootstrap (`flow_helpers_enabled`)

**Activeert:**

| Type | Flow cards |
|---|---|
| Actions | `set_target_temperature`, `set_device_onoff`, `set_hotwater_temperature`, `set_heating_mode`, `set_capacity`, `set_heating_curve`, `set_work_mode`, `set_desired_indoor_temperature` |
| Conditions | `compressor_running`, `fault_active`, `power_above_threshold`, `temperature_above`, `total_consumption_above` |

**Huidige status:** `lib/flow-helpers.ts` bevat volledige implementatie van `registerSimpleActions()` en `registerSimpleConditions()`. De `FLOW_PATTERNS` constante bevat alle patronen. Wordt niet aangeroepen in `app.ts`.

**Vereiste wijzigingen:**
1. Bootstrap-aanroep toevoegen in `app.ts`
2. `FLOW_PATTERNS.simpleActions` en `.simpleConditions` aanpassen naar Modbus capability-id's (zie ADR-012 sectie 5.4)

**Capability-mapping vereist:**

| DPS capability in FLOW_PATTERNS | Modbus equivalent |
|---|---|
| `adlar_hotwater` | `target_temperature.dhw` |
| `adlar_enum_mode` | `adlar_mode` |
| `adlar_enum_work_mode` | register `0x0307` (te wiren) |
| `adlar_enum_capacity_set` | register `0x0315` (te wiren) |
| `adlar_enum_volume_set` | geen equivalent |
| `adlar_enum_countdown_set` | register `0x0314` (te wiren) |
| `adlar_enum_water_mode` | geen equivalent |
| `adlar_fault` | `adlar_fault_active` |
| `measure_temperature.around_temp` | `measure_temperature.ambient` |
| `adlar_state_compressor_state` | `adlar_compressor_on` |
| `meter_power.electric_total` | `meter_power` |

---

### 3.2 Calculator Flow Cards (`calculator_cards_enabled`)

**Activeert:**
- `calculate_curve_value` — berekent een waarde op een stooklijn
- `calculate_linear_heating_curve` — berekent lineaire stooklijn parameters
- `calculate_time_based_value` — berekent tijdgebonden waarden
- `get_seasonal_mode` — bepaalt seizoensmodus op basis van buitentemperatuur

**Huidige status:** Compose JSON bestaat. In DPS worden deze via custom action listeners in `app.ts` geregistreerd. Geen Modbus equivalent.

**Vereiste wijzigingen:**
1. Custom action listeners toevoegen in `app.ts` (of in een gedeelde module)
2. Implementatielogica overnemen of abstraheren uit DPS `app.ts`

---

### 3.3 Temperatuur- & Efficiency-Alerts (`sensor_alerts_enabled`)

**Activeert:**

| Subcategorie | Triggers |
|---|---|
| Temperatuur-alerts | `coiler_temperature_alert`, `high_pressure_temperature_alert`, `low_pressure_temperature_alert`, `suction_temperature_alert`, `discharge_temperature_alert`, `tank_temperature_alert`, `economizer_inlet_temperature_alert`, `economizer_outlet_temperature_alert`, `incoiler_temperature_alert` |
| Pulse-step alerts | `eev_pulse_steps_alert`, `evi_pulse_steps_alert` |
| Efficiency | `compressor_efficiency_alert`, `fan_motor_efficiency_alert`, `water_flow_alert` |

**Huidige status:** `flow-helpers.ts` bevat `FLOW_PATTERNS.temperatureAlerts` en `.pulseStepsAlerts` met volledige patronen. Twee ontbrekende stukken:
1. App-level trigger run listeners worden niet geregistreerd
2. Device-side triggerlogica (delta-detectie, threshold-crossing) bestaat niet

**Vereiste wijzigingen:**
1. `registerTemperatureAlerts()` en `registerPulseStepsAlerts()` aanroepen in `app.ts`
2. Threshold-monitoring implementeren in device of in een `ThresholdMonitorService`
3. `triggerFlowCard` device hook vereist (zie toggle 5)

---

### 3.4 Status Change Triggers (`status_triggers_enabled`)

**Activeert:**
- `heating_mode_changed`
- `work_mode_changed`
- `water_mode_changed`
- `fault_detected`
- `ambient_temperature_changed`
- `inlet_temperature_changed`
- `outlet_temperature_changed`

**Huidige status:** Compose JSON bestaat. In DPS worden deze door de device getriggerd bij DPS-data wijzigingen.

**Vereiste wijzigingen:**
1. Snapshot state-change detectie toevoegen in `applyModbusSnapshot()` of een aparte vergelijkingslaag
2. Vorige snapshot-waarden bijhouden voor delta-detectie
3. `triggerFlowCard` device hook vereist

---

### 3.5 COP Trend & Consumption Triggers (`cop_triggers_enabled`)

**Activeert:**
- `cop_trend_detected`
- `daily_cop_efficiency_changed`
- `monthly_cop_efficiency_changed`
- `daily_consumption_threshold`

**Huidige status:**
- `RollingCOPCalculator` bevat triggerlogica op regels 586, 618, 636 — roept `this.config.device.triggerFlowCard()` aan
- `EnergyTrackingService` bevat triggerlogica op regel 747 — doet een unsafe cast naar een device met `triggerFlowCard`
- Beide services missen de device hook

**Vereiste wijzigingen:**
1. `triggerFlowCard()` methode implementeren op het Modbus device (zie ADR-012 sectie 5.3)
2. `RollingCOPCalculator` initialiseren met `config.device` referentie
3. `EnergyTrackingService` unsafe cast vervangen door het formele device contract

---

### 3.6 Building Insights (`building_insights_enabled`)

**Activeert:**

| Type | Flow cards |
|---|---|
| Actions | `calculate_preheat_time`, `force_insight_analysis` |
| Conditions | `confidence_above`, `insight_is_active`, `savings_above` |
| Triggers | `building_insight_detected`, `building_profile_mismatch`, `pre_heat_recommendation` |

**Huidige status:** `BuildingInsightsService` is een interface-stub in `lib/services/building-insights-service.ts` (22 regels). `FlowCardManagerService` bevat registratiecode achter een `if (this.buildingInsightsService)` guard. `ServiceCoordinator` injecteert de service niet.

**Vereiste wijzigingen:**
1. Volledige `BuildingInsightsService` implementatie
2. Injectie in `ServiceCoordinator` en doorgave aan `FlowCardManagerService`
3. Lifecycle-management (initialize/destroy) in `ServiceCoordinator`

---

### 3.7 Geavanceerde Conditions (`advanced_conditions_enabled`)

**Activeert:**
- `temperature_differential` — vergelijkt twee temperatuursensoren
- `electrical_balance_check` — controleert elektrische balans (3-fase)
- `system_pulse_steps_differential` — vergelijkt EEV/EVI stappen
- `water_flow_rate_check` — controleert waterdebiet

**Huidige status:** Compose JSON bestaat. In DPS worden deze als custom conditions in `app.ts` geregistreerd. Geen Modbus equivalent.

**Vereiste wijzigingen:**
1. Custom condition listeners toevoegen in `app.ts`
2. Implementatielogica overnemen of abstraheren uit DPS `app.ts`
3. Capability-id mapping aanpassen voor Modbus-equivalenten

## 4. Settings-formaat

Alle toggles komen in één settingsgroep:

```json
{
  "id": "feature_toggles",
  "type": "group",
  "label": {
    "en": "Feature Toggles",
    "nl": "Feature Toggles"
  },
  "children": [
    {
      "id": "flow_helpers_enabled",
      "type": "checkbox",
      "label": {
        "en": "Basic flow actions & conditions",
        "nl": "Basis flow actions & conditions"
      },
      "value": true,
      "hint": {
        "en": "Enables set/get flow cards for temperature, mode, on/off.",
        "nl": "Activeert set/get flow cards voor temperatuur, modus, aan/uit."
      }
    },
    {
      "id": "status_triggers_enabled",
      "type": "checkbox",
      "label": {
        "en": "Status change triggers",
        "nl": "Status-wijziging triggers"
      },
      "value": true,
      "hint": {
        "en": "Triggers on mode, fault and temperature changes.",
        "nl": "Triggers bij modus-, fout- en temperatuurwijzigingen."
      }
    },
    {
      "id": "cop_triggers_enabled",
      "type": "checkbox",
      "label": {
        "en": "COP trend & consumption triggers",
        "nl": "COP trend & verbruik triggers"
      },
      "value": true,
      "hint": {
        "en": "Daily/monthly COP trends and consumption thresholds.",
        "nl": "Dagelijkse/maandelijkse COP trends en verbruiksdrempels."
      }
    },
    {
      "id": "sensor_alerts_enabled",
      "type": "checkbox",
      "label": {
        "en": "Temperature & efficiency alerts",
        "nl": "Temperatuur- & efficiency-alerts"
      },
      "value": false,
      "hint": {
        "en": "Triggers for temperature threshold crossings, pulse-step alerts, COP anomalies.",
        "nl": "Triggers voor temperatuuroverschrijdingen, pulse-step alerts, COP-afwijkingen."
      }
    },
    {
      "id": "calculator_cards_enabled",
      "type": "checkbox",
      "label": {
        "en": "Heating curve calculators",
        "nl": "Stooklijn-calculators"
      },
      "value": false,
      "hint": {
        "en": "Advanced flow cards for heating curve calculations.",
        "nl": "Geavanceerde flow cards voor stooklijnberekeningen."
      }
    },
    {
      "id": "advanced_conditions_enabled",
      "type": "checkbox",
      "label": {
        "en": "Advanced conditions",
        "nl": "Geavanceerde conditions"
      },
      "value": false,
      "hint": {
        "en": "Temperature differential, electrical balance, pulse-step comparison.",
        "nl": "Temperatuurdifferentiaal, elektrische balans, pulse-step vergelijking."
      }
    },
    {
      "id": "building_insights_enabled",
      "type": "checkbox",
      "label": {
        "en": "Building Insights (experimental)",
        "nl": "Building Insights (experimenteel)"
      },
      "value": false,
      "hint": {
        "en": "Building insights, preheat advice, savings analysis. Requires full BuildingInsightsService.",
        "nl": "Gebouwinzichten, voorwarmadvies, besparingsanalyse. Vereist volledige BuildingInsightsService."
      }
    }
  ]
}
```

## 5. Runtime Gedrag

### 5.1 Registratie-moment

Flow cards worden geregistreerd in `app.ts` (app-breed) en/of `FlowCardManagerService` (service-scoped). De toggle wordt gelezen bij:

- **App-level registratie (`app.ts`):** Bij app-start. Herstart vereist voor wijzigingen.
- **Service-level registratie (`FlowCardManagerService`):** Bij `initialize()`. Herstart vereist voor wijzigingen.
- **Device-level trigger bronnen (`device.ts`):** Bij `onSettings()`. Direct activeerbaar/deactiveerbaar.

### 5.2 Toggle-wijziging

Bij wijziging van een toggle in de settings:

1. **Trigger bronnen** (toggles 3, 4, 5): kunnen direct aan/uit gezet worden via `onSettings()` — de delta-detectie en threshold-monitoring in de device-klasse kijkt naar de setting
2. **Registratie-based** (toggles 1, 2, 6, 7): vereisen een app-herstart omdat Homey flow card registratie niet dynamisch kan worden ingetrokken

### 5.3 Interactie met Bestaande Toggles

De nieuwe toggles zijn **onafhankelijk** van de bestaande toggles (`adaptive_control_enabled`, `building_model_enabled`, etc.):

- Bestaande toggles controleren of een **service** actief is
- Nieuwe toggles controleren of een **groep flow cards** geregistreerd en actief is
- Een flow card kan geregistreerd zijn maar toch geen data leveren als de onderliggende service uit staat

Voorbeeld: `cop_triggers_enabled = true` + `cop_calculation_enabled = false` → de trigger is geregistreerd maar vuurt nooit af omdat er geen COP-data is.

## 6. Fasering

### Fase 1 — Quick Wins (toggles 1, 4, 5)

- Flow helpers bootstrap met Modbus capability-mapping
- Status change triggers met snapshot-vergelijking
- COP triggers met `triggerFlowCard` device hook
- **Impact:** ~24 flow cards actief
- **Effort:** Klein
- **Relatie:** ADR-012 secties 5.1, 5.3, 5.4

### Fase 2 — Geavanceerd (toggles 2, 3, 7)

- Calculator cards met app-level registratie
- Sensor alerts met device-side delta-detectie
- Advanced conditions met app-level registratie
- **Impact:** ~22 extra flow cards
- **Effort:** Medium-Groot

### Fase 3 — Building Insights (toggle 6)

- Volledige `BuildingInsightsService` implementatie
- **Impact:** 7 extra flow cards
- **Effort:** Groot

## 7. Gevolgen

### Positief

- Gebruiker bepaalt zelf welke flow cards beschikbaar zijn
- Minder "dode" flow cards in de flow editor
- Stapsgewijze feature-activering in lijn met de implementatievoortgang
- Lagere runtime-overhead voor gebruikers die geavanceerde features niet nodig hebben
- Duidelijke documentatie van wat elke feature-groep doet en vereist

### Negatief

- 7 extra settings in de UI (totaal met ADR-032: 12 nieuwe settings)
- App-herstart vereist voor sommige toggle-wijzigingen
- Complexere `app.ts` bootstrap met conditionele registratie
- Risico dat gebruikers niet weten dat ze features moeten inschakelen

### Mitigatie van het Ontdekbaarheidsprobleem

- Default `true` voor de meest waardevolle low-overhead features
- Duidelijke `hint`-teksten per toggle
- Documentatie in de app-beschrijving over beschikbare features
- Overweeg een eerste-keer-setup wizard die de gebruiker door de toggles leidt

## 8. Niet Besloten in Deze ADR

- De exacte implementatiedetails van de calculator en custom condition logica
- Of sommige toggles gecombineerd moeten worden (bijv. 3 en 4 samenvoegen)
- De UX voor het communiceren dat een herstart vereist is na toggle-wijziging
- Of de toggle-settings naar de pairing-wizard moeten verhuizen

## 9. Acceptatiecriteria

1. Alle 7 toggles bestaan als device settings in `driver.settings.compose.json`
2. Elke toggle controleert de registratie en/of activering van de bijbehorende flow cards
3. Flow cards die bij een uitgeschakelde toggle horen zijn niet zichtbaar in de flow editor of retourneren een duidelijke foutmelding
4. Het in-/uitschakelen van een toggle veroorzaakt geen runtime-fouten
5. De bestaande toggles (`adaptive_control_enabled` etc.) blijven onafhankelijk functioneren
6. `fault_detected` en basis status-triggers werken met default settings (geen handmatige activering nodig)
