# ADR-012: Flow Card Runtime Alignering voor de Modbus App

**Status:** Grotendeels geïmplementeerd (2026-03-29)
**Datum:** 2026-03-26
**Gerelateerd:** [ADR-004 Standalone Modbus Driver](ADR-004-standalone-modbus-driver.md), [ADR-005a Protocol Integration Revised](ADR-005a-protocol-integration-revised.md), [flow-card-dps-vs-modbus-mapping](../../docs/Dev%20support/flow-card-dps-vs-modbus-mapping.md)

---

## 1. Probleem

De Modbus-app en de DPS-app delen op dit moment vrijwel dezelfde `.homeycompose/flow` catalogus, maar niet dezelfde runtime-implementatie.

Dat geeft vijf concrete klassen van gaten:

1. **Helper-based simple actions en simple conditions ontbreken runtime-matig**
   De DPS-app registreert deze centraal vanuit `app.ts` via `registerSimpleActions()` en `registerSimpleConditions()`. De Modbus-app doet dat niet.
2. **Custom app-level kaarten ontbreken**
   Calculator-acties en enkele complexe conditions worden in de DPS-app expliciet in `app.ts` geregistreerd. De Modbus-app heeft die registratie niet.
3. **DPS trigger listeners ontbreken**
   Voor temperatuur-alerts, pulse-steps, veranderde temperaturen, efficiency-alerts, mode-wijzigingen en faults bestaat in DPS zowel een app-level trigger-listener als device-side triggerbron. In Modbus ontbreekt die combinatie grotendeels.
4. **Building Insights flow cards worden overgeslagen**
   `FlowCardManagerService` kan ze registreren, maar `BuildingInsightsService` wordt in de huidige Modbus `ServiceCoordinator` niet geïnjecteerd.
5. **Bepaalde service-triggers missen een device hook**
   `RollingCOPCalculator` en `EnergyTrackingService` verwachten een device met `triggerFlowCard(...)`. De Modbus-driver levert dat nu niet.

Daarnaast is er een inhoudelijk probleem:

- gedeelde flow-logica gebruikt op meerdere plekken nog DPS-capability-ids zoals `adlar_enum_mode`, `adlar_hotwater` en `adlar_enum_countdown_set`
- de Modbus-driver gebruikt native ids zoals `adlar_mode` en `target_temperature.dhw`
- daardoor ontstaan `alias mismatch` gevallen: de kaart is geregistreerd, maar kijkt naar de verkeerde capability

Het gevolg is dat de Modbus-app op flow-card niveau deels “dezelfde catalogus” heeft als DPS, maar niet hetzelfde gedrag.

## 2. Beslissing

We brengen de Modbus-app flow-card runtime op lijn met de DPS-app via een combinatie van:

1. **Gedeelde bootstrap voor app-level flow-card registratie**
2. **Expliete device-scoped uitvoering**
3. **Een protocol-specifieke flow capability mapping**
4. **Injectie van Building Insights in de Modbus service graph**
5. **Een uniforme `triggerFlowCard()` device hook**
6. **Modbus-side triggerbronlogica voor ontbrekende changed/alert kaarten**

Belangrijk:

- we kiezen **niet** voor een strategie waarbij we in de Modbus-driver steeds meer DPS-achtige compatibiliteitscapabilities gaan vullen alleen om bestaande flow cards te laten werken
- we kiezen **wel** voor een strategie waarbij de flow-laag werkt met semantische begrippen, en per protocol naar de juiste capability-id resolveert

Concreet bedoelen we met de ongewenste richting bijvoorbeeld:

- zowel `adlar_hotwater` als `target_temperature.dhw` vullen voor hetzelfde warmwater-setpoint
- zowel `adlar_enum_mode` als `adlar_mode` vullen voor dezelfde bedrijfsmodus
- zowel `measure_temperature.around_temp` als `measure_temperature.ambient` vullen voor dezelfde buitentemperatuur
- zowel `adlar_state_compressor_state` als `adlar_compressor_on` vullen voor dezelfde compressorsituatie

Dat lijkt op korte termijn makkelijk, maar heeft structurele nadelen:

- dubbele capabilities in de Homey UI en in Insights
- meer kans dat alias-capabilities uit sync raken
- extra migratie- en onderhoudslast
- flow-logica blijft impliciet afhankelijk van DPS-erfenis

De gewenste richting is daarom:

- de flow-laag werkt met semantische sleutels zoals `hotwaterSetpoint`, `heatingMode`, `ambientTemp`, `compressorRunning` en `faultState`
- de DPS-driver levert daarvoor een DPS-mapping
- de Modbus-driver levert daarvoor een Modbus-mapping

Compatibiliteitsaliases mogen eventueel tijdelijk bestaan als migratiebrug, maar zijn **niet** de primaire architectuurkeuze.

## 3. Device Scope en `app.ts`

Registratie vanuit `app.ts` is **app-breed**, maar kan nog steeds volledig **device-scoped** zijn.

### 3.1 Actions en Conditions

Een action- of condition-listener die in `app.ts` wordt geregistreerd, wordt één keer per flow card type geregistreerd. Dat is niet hetzelfde als “één globale device-instantie gebruiken”.

Het blijft device-scoped als:

- Homey een `device` argument meegeeft
- de listener vervolgens werkt via `args.device`

Dat is precies hoe de gedeelde helpers zijn opgezet:

- `registerSimpleActions()` gebruikt `args.device.triggerCapabilityListener(...)`
- `registerSimpleConditions()` gebruikt `args.device.getCapabilityValue(...)`

Dus:

- **registratie**: app-breed
- **uitvoering**: device-scoped

### 3.2 Device Triggers

Voor trigger cards geldt hetzelfde principe:

- de app kan centraal een `getDeviceTriggerCard(id).registerRunListener(...)` registreren
- de trigger zelf blijft device-scoped zolang de code `trigger(device, tokens, state)` aanroept met de juiste device-instantie

Dus:

- `app.ts` bepaalt hoe een triggercard args/state filtert
- het device of een device-owned service bepaalt **welk device** de trigger afvuurt

### 3.3 Architectuurregel

We accepteren app-level flow-card registratie als correct patroon, mits:

1. de listener geen mutable device-state op de app singleton bewaart
2. alle device-data via `args.device` of via een expliciet meegegeven device-instance loopt
3. daadwerkelijke trigger-emissie altijd gebeurt met een concrete device-instance

## 4. Gewenste Architectuur

### 4.1 Gedeelde App-Level Bootstrap

De Modbus-app moet dezelfde bootstrap-keten krijgen als de DPS-app, bij voorkeur via gedeelde code:

- pattern-based helper registratie
- custom calculator action registratie
- custom complex condition registratie
- device-trigger run listeners voor temperatuur- en pulse-alerts
- device-trigger run listeners voor changed/efficiency kaarten waar argumentfiltering nodig is

Voorkeursrichting:

- verplaats de DPS `initFlowCards()` bootstrap naar een gedeelde module in `lib/`
- laat zowel DPS `app.ts` als Modbus `app.ts` die bootstrap aanroepen

Dit voorkomt dat flow-runtime logica twee keer uit elkaar groeit.

### 4.2 Flow Capability Mapping

De flow-laag mag niet langer hard-coded DPS-capability-ids aannemen.

We introduceren een kleine mappinglaag, bijvoorbeeld:

```typescript
interface FlowCapabilityMap {
  hotwaterSetpoint: string;
  heatingMode: string;
  workMode: string;
  waterMode: string;
  heatingCurve: string;
  capacityCurve: string;
  ambientTemp: string;
  compressorRunning: string;
  faultState: string;
}
```

Voorbeelden:

```typescript
// DPS
{
  hotwaterSetpoint: 'adlar_hotwater',
  heatingMode: 'adlar_enum_mode',
  workMode: 'adlar_enum_work_mode',
  waterMode: 'adlar_enum_water_mode',
  heatingCurve: 'adlar_enum_countdown_set',
  capacityCurve: 'adlar_enum_capacity_set',
  ambientTemp: 'measure_temperature.around_temp',
  compressorRunning: 'adlar_state_compressor_state',
  faultState: 'adlar_fault',
}

// Modbus
{
  hotwaterSetpoint: 'target_temperature.dhw',
  heatingMode: 'adlar_mode',
  workMode: '<modbus-native-or-compat-work-mode-capability>',
  waterMode: '<modbus-native-or-compat-water-mode-capability>',
  heatingCurve: '<modbus-native-or-compat-heating-curve-capability>',
  capacityCurve: '<modbus-native-or-compat-capacity-curve-capability>',
  ambientTemp: 'measure_temperature.ambient',
  compressorRunning: 'adlar_compressor_on',
  faultState: 'adlar_fault_active',
}
```

De exacte Modbus capability-ids kunnen nog veranderen, maar de beslissing is:

- de **flow-laag werkt met semantische velden**
- de **driver/protocol-laag levert de mapping**

> **Herbeoordeling (2026-03-29):** De `FlowCapabilityMap` is niet geïmplementeerd en achteraf ook niet nodig gebleken. De alias-mismatches zijn opgelost door elke handler zijn eigen expliciete capability-naam te geven. Dit werkt omdat DPS en Modbus geen gedeelde flow-laag hebben — elke handler is toch al per driver geschreven. Een formele mapping-laag zou alleen meerwaarde hebben als één gedeelde `flow-helpers.ts` door beide drivers gebruikt wordt met wisselende capability-namen. Dat is niet de richting geworden. Dit voorstel kan als vervallen worden beschouwd.

### 4.3 `triggerFlowCard()` als Device Contract

De Modbus-deviceklasse moet dezelfde device hook bieden die de DPS-deviceklasse al gebruikt:

```typescript
triggerFlowCard(cardId: string, tokens: Record<string, unknown>, state?: Record<string, unknown>): Promise<void>
```

Die hook wordt vervolgens gebruikt door:

- `RollingCOPCalculator`
- `EnergyTrackingService`
- eventuele Modbus-side changed/alert detectie

Dat lost niet alles op, maar het is de noodzakelijke onderlaag voor service-driven triggers.

### 4.4 Triggerbronlogica in de Modbus Driver

De volgende triggerfamilies hebben een expliciete bron nodig aan Modbus-zijde:

- temperatuurverandering
- temperatuur-alerts
- pulse-step alerts
- fault detectie
- mode changes
- efficiency alerts
- COP outlier detectie

Voor deze kaarten is alleen app-level registratie niet genoeg. Er moet ook code bestaan die:

1. vorige waarde onthoudt
2. delta of threshold beoordeelt
3. bij relevante verandering `triggerFlowCard(...)` aanroept

Die logica hoort primair thuis in:

- de deviceklasse, als de bron direct uit snapshot-comparatie komt
- of in een device-owned service, als het domeincomplexiteit betreft

## 5. Concrete Wijzigingen in de Modbus App

### 5.1 App Bootstrap

Toevoegen in Modbus `app.ts`:

1. gedeelde flow bootstrap aanroepen
2. helper-based actions/conditions registreren
3. custom calculator actions registreren
4. custom conditions registreren
5. device-trigger run listeners registreren

Resultaat:

- `set_target_temperature`
- `set_device_onoff`
- `temperature_above`
- `compressor_running`
- temperatuur/pulse alert cards
- calculator cards

worden niet langer alleen compose-defined, maar runtime-actief.

### 5.2 ServiceCoordinator Uitbreiden

Aanpassen in Modbus `ServiceCoordinator`:

1. `BuildingInsightsService` aanmaken
2. die service injecteren in `FlowCardManagerService`
3. lifecycle meenemen in initialize/destroy

Resultaat:

- `force_insight_analysis`
- `calculate_preheat_time`
- `insight_is_active`
- `confidence_above`
- `savings_above`
- `building_insight_detected`
- `building_profile_mismatch`
- `pre_heat_recommendation`

kunnen in Modbus ook werkelijk meedoen.

### 5.3 Device Trigger Hook

Aanpassen in Modbus device:

1. `triggerFlowCard()` implementeren
2. `RollingCOPCalculator` initialiseren met `config.device`
3. `EnergyTrackingService` laten werken tegen hetzelfde contract

Resultaat:

- `cop_trend_detected`
- `daily_cop_efficiency_changed`
- `monthly_cop_efficiency_changed`
- `daily_consumption_threshold`

kunnen daadwerkelijk afvuren.

### 5.4 Flow Capability Mapping Invoeren

Aanpassen in gedeelde flow-helpers en `FlowCardManagerService`:

1. vervang hard-coded DPS capability-ids door semantische namen
2. resolve die namen per driver naar echte capability-ids
3. gebruik dezelfde mapping voor zowel actions als conditions

Resultaat:

- geen `alias mismatch` meer bij `hotwater_temperature_is`
- geen `alias mismatch` meer bij `heating_mode_is`
- geen `alias mismatch` meer bij `temperature_above`
- flow-runtime wordt protocol-onafhankelijker

### 5.5 Modbus-side Changed/Alert Bronnen

Aanpassen in Modbus device of ondersteunende services:

1. vergelijk nieuwe snapshots met vorige toestand
2. detecteer relevante veranderingen en threshold crossings
3. trigger device trigger cards met tokens en state

Minimaal voor:

- `ambient_temperature_changed`
- `inlet_temperature_changed`
- `outlet_temperature_changed`
- `fault_detected`
- `heating_mode_changed`
- `work_mode_changed`
- `water_mode_changed`
- `cop_efficiency_changed`
- `cop_outlier_detected`
- `compressor_efficiency_alert`
- `fan_motor_efficiency_alert`
- `water_flow_alert`
- temperatuur-alerts
- pulse-step alerts

## 6. Gevolgen

### Positief

- De gedeelde flow-card catalogus krijgt ook gedeeld gedrag.
- Minder documentatieverschil tussen DPS en Modbus.
- Minder verborgen regressies waarbij een kaart zichtbaar is maar niets doet.
- Protocol-specifieke capability-namen lekken minder door naar de flow-laag.

### Negatief

- Er komt extra abstractie in de flow-laag.
- De Modbus-deviceklasse of services krijgen meer event- en triggerlogica.
- Er is migratie- en regressietestwerk nodig, vooral bij kaarten die nu wel zichtbaar maar niet actief zijn.

## 7. Niet Besloten in Deze ADR

Deze ADR legt nog niet vast:

- de definitieve Modbus capability-id voor elke semantische flow-rol
- of sommige DPS-compatibiliteitscapabilities verborgen, verwijderd of behouden moeten worden
- of alle changed/alert triggers device-side blijven, of deels naar services verhuizen

Dat volgt in implementatieontwerp en PR-uitwerking.

## 8. Acceptatiecriteria

De ADR is geslaagd als de Modbus-app:

1. helper-based actions en simple conditions runtime-actief heeft
2. custom calculator cards runtime-actief heeft
3. Building Insights flow cards niet meer overslaat
4. service-driven triggers via `triggerFlowCard()` kan afvuren
5. geen bekende `alias mismatch` meer heeft in de gedeelde flow-laag
6. device-scoped blijft ondanks centrale registratie vanuit `app.ts`

---

## 9. Implementatiehistorie (2026-03-29)

### 9.1 Gerealiseerd

#### Criterium 1 — Helper-based actions en simple conditions ✅

`app.ts` roept al `registerSimpleActions()` en `registerSimpleConditions()` aan met `FLOW_PATTERNS`. De volgende cards zijn runtime-actief:

- Actions: `set_target_temperature`, `set_hotwater_temperature`, `set_work_mode`, `set_capacity`
- Conditions: `fault_active`, `temperature_above`, `compressor_running`, `power_above_threshold`, `total_consumption_above`

Inzicht: `set_heating_mode`, `set_heating_curve`, `set_device_onoff` en `set_desired_indoor_temperature` zijn opzettelijk *niet* via `simpleActions` geregistreerd. Reden:

- `set_heating_mode`: arg `"heating"` → capability `adlar_mode` verwacht numerieke string `"1"` — transformatie vereist
- `set_heating_curve`: enum-id → register 0x0314 via `enumIdToHeatingCurve()` — transformatie vereist
- `set_device_onoff`: dropdown geeft `"on"`/`"off"` (string), `onoff` capability verwacht `boolean`
- `set_desired_indoor_temperature`: geen `registerCapabilityListener` voor `target_temperature.indoor` beschikbaar via simpleActions patroon

Alle vier hebben custom handlers in `FlowCardManagerService.registerDeviceControlActionCards()`.

`set_work_mode` en `set_capacity` werken wél via `simpleActions`: de dropdown-waarden (ECO/Normal/Boost resp. OFF/H1–H4) komen exact overeen met de enum-ids van `adlar_enum_work_mode` resp. `adlar_enum_capacity_set`.

#### Criterium 2 — Custom calculator cards ✅

Nieuwe methode `registerCalculatorActionCards()` in `FlowCardManagerService`. De utility-klassen (`CurveCalculator`, `TimeScheduleCalculator`, `SeasonalModeCalculator`) bestonden al in `lib/`. Geregistreerde cards:

- `calculate_curve_value` — input + curve-regels → `result_value` token
- `calculate_linear_heating_curve` — L28/L29 stooklijn → `supply_temperature` + `formula` tokens
- `calculate_time_based_value` — tijdschema evaluatie → `result_value` token
- `get_seasonal_mode` — datum-gebaseerde seizoensmodus → `mode`, `is_heating_season`, `is_cooling_season`, `days_until_season_change` tokens

#### Criterium 4 — service-driven triggers via `triggerFlowCard()` ✅

`triggerFlowCard()` bestaat in `device.ts` en wordt aangeroepen door `RollingCOPCalculator`. `EnergyTrackingService` cast `this.device` intern al naar een type met `triggerFlowCard` — geen wijziging nodig in `ServiceCoordinator`.

#### Criterium 5 — Geen alias mismatch ✅

`FlowCardManagerService` gebruikte DPS-capability-ids die de Modbus-driver nooit vult:

| Condition card | Was | Nu |
| --- | --- | --- |
| `heating_mode_is` | `adlar_enum_mode` | `adlar_mode` + waardetransformatie (string-id → numeriek) |
| `work_mode_is` | `adlar_enum_work_mode` (nooit gevuld) | goedaardig falen met `throw new Error(...)` |
| `water_mode_is` | `adlar_enum_water_mode` (nooit gevuld) | goedaardig falen |
| `capacity_setting_is` | `adlar_enum_capacity_set` (nooit gevuld) | goedaardig falen |
| `volume_setting_is` | `adlar_enum_volume_set` (nooit gevuld) | goedaardig falen |

Inzicht: stille `undefined`-vergelijkingen geven altijd `false` terug zonder enige indicatie dat de conditie niet ondersteund wordt. Een expliciete fout is beter voor debugbaarheid en gedrag in flows.

#### Criterium 6 — Device-scoped execution ✅

Al correct geïmplementeerd via `args.device` pattern in `registerSimpleActions()` / `registerSimpleConditions()`.

#### Nieuwe capability `adlar_enum_countdown_set` ✅

Register 0x0314 (heating curve) is nu volledig doorverbonden:

- Capability JSON: `.homeycompose/capabilities/adlar_enum_countdown_set.json` (OFF, H1–H8, L1–L8)
- Lezen: `applyModbusSnapshot()` → `heatingCurveToEnumId(snap.control.heatingCurve)`
- Schrijven: `set_heating_curve` flow action → custom handler → `triggerCapabilityListener('adlar_enum_countdown_set', ...)` → `enumIdToHeatingCurve()` → `coordinator.setHeatingCurve()` → register 0x0314
- `heating_curve_is` conditie leest correct `adlar_enum_countdown_set`

#### `set_heating_mode` flow action ✅

Custom handler in `FlowCardManagerService.registerDeviceControlActionCards()`. Mapt dropdown-waarden (`cold`→0, `heating`→1, `hot_water`→2, `floor_heating`→3, `cold_and_hotwater`→4, `heating_and_hot_water`→5, `floor_heatign_and_hot_water`→7) naar `adlar_mode` capability → register 0x0304.

#### Sectie 5.5 — Modbus-side changed/alert bronnen ✅

`_detectAndTrigger(snap)` methode toegevoegd in `device.ts`. Vergelijkt elke snapshot met de vorige, vuurt bij significante wijziging (±0.5 drempel) `triggerFlowCard()` aan. Gedekte triggers:

- Changed: `ambient_temperature_changed`, `inlet_temperature_changed`, `outlet_temperature_changed`, `heating_mode_changed`, `work_mode_changed`, `fault_detected`
- Alert: `tank_temperature_alert`, `coiler_temperature_alert`, `discharge_temperature_alert`, `eev_pulse_steps_alert`, `evi_pulse_steps_alert`, `water_flow_alert`, `compressor_efficiency_alert`, `fan_motor_efficiency_alert`

Run listeners geregistreerd in `app.ts` voor alle bovenstaande triggers.

#### Nieuwe capabilities `adlar_enum_work_mode` en `adlar_enum_capacity_set` ✅

- `adlar_enum_work_mode` — register 0x0307: ECO (Silent) / Normal (Standard) / Boost (High Power). Lezen + schrijven + `work_mode_changed` trigger + `work_mode_is` condition + `set_work_mode` flow action.
- `adlar_enum_capacity_set` — register 0x0315: OFF/H1–H4 hot water curve. Lezen + schrijven + `capacity_setting_is` condition + `set_capacity` flow action.
- `adlar_evi_step` — register 0x0043: EVI valve opening steps. Lezen + `evi_pulse_steps_alert` trigger.

### 9.2 Openstaand

#### Criterium 3 — Building Insights flow cards ⚠️

`BuildingInsightsService` is enkel een interface (`lib/services/building-insights-service.ts`), geen concrete klasse. `FlowCardManagerService` checkt al `if (this.buildingInsightsService)` en heeft de handlers klaar (`force_insight_analysis`, `calculate_preheat_time`, `insight_is_active`, `confidence_above`, `savings_above`). Blocker: er is geen klasse-implementatie die `ServiceCoordinator` kan instantiëren.

#### Criterium 5 — Grotendeels gesloten

`work_mode_is` en `capacity_setting_is` zijn alsnog geïmplementeerd nadat `adlar_enum_work_mode` (register 0x0307) en `adlar_enum_capacity_set` (register 0x0315) als capabilities zijn toegevoegd in deze sessie.

Nog openstaand:

- `water_mode_is` — geen Modbus-register equivalent gevonden
- `volume_setting_is` — geen Modbus-register equivalent gevonden

Beide geven een expliciete `throw new Error(...)` in plaats van stil `false`.
