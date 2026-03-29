# ADR-030: DPS vs Modbus Mapping — Gap-Analyse en Verbetervoorstellen

**Status:** Voorstel
**Datum:** 2026-03-28
**Gerelateerd:** [ADR-012 Flow Card Runtime Alignering](ADR-012-modbus-flow-card-runtime-alignment.md), [capability-dps-vs-modbus-mapping](/docs/Dev%20support/capability-dps-vs-modbus-mapping.md), [flow-card-dps-vs-modbus-mapping](/docs/Dev%20support/flow-card-dps-vs-modbus-mapping.md), [sensor-capability-dps-vs-modbus-titles](/docs/Dev%20support/sensor-capability-dps-vs-modbus-titles.md)

---

## 1. Context

Dit document is een analyse-resultaat gedestilleerd uit drie mapping-documenten:

- **capability-dps-vs-modbus-mapping.md** — vergelijkt DPS-capability-ids met Modbus-equivalenten en register-wiring status
- **flow-card-dps-vs-modbus-mapping.md** — vergelijkt runtime implementatiestatus van flow cards tussen DPS en Modbus
- **sensor-capability-dps-vs-modbus-titles.md** — vergelijkt sensor-titels en capability-naamgeving

De analyse destilleert uit deze drie bronnen concrete verbeter-, verander- en uitbreidingssuggesties, gegroepeerd op prioriteit.

## 2. Suggesties — Hoog Prioriteit

### 2.1 Flow-Helpers Bootstrap Activeren in `app.ts`

**Probleem:** Het bestand `lib/flow-helpers.ts` bestaat en exporteert `registerSimpleActions()` en `registerSimpleConditions()`, maar wordt nergens in de Modbus `app.ts` geïmporteerd of aangeroepen. Hierdoor zijn **15 flow cards** (8 actions + 7 conditions) effectief dood.

**Getroffen kaarten:**

| Type | Kaarten |
|---|---|
| Actions | `set_device_onoff`, `set_target_temperature`, `set_hotwater_temperature`, `set_heating_mode`, `set_capacity`, `set_heating_curve`, `set_work_mode`, `set_desired_indoor_temperature` |
| Conditions | `compressor_running`, `fault_active`, `power_above_threshold`, `temperature_above`, `total_consumption_above` |

**Suggestie:** Voeg in `app.ts` de `registerSimpleActions()` en `registerSimpleConditions()` aanroepen toe, maar met **Modbus-specifieke capability-id's** in de pattern-mapping (bijv. `adlar_mode` i.p.v. `adlar_enum_mode`, `target_temperature.dhw` i.p.v. `adlar_hotwater`).

> **Belangrijk:** Dit is de single biggest bang-for-buck verbetering. Eén `app.ts`-wijziging maakt ~15 flow cards functioneel.

**Geschatte impact:** ~15 flow cards actief
**Geschatte effort:** Klein — pattern-arrays aanpassen en bootstrap-call toevoegen
**Relatie met ADR-012:** Sectie 5.1 (App Bootstrap)

---

### 2.2 Device Trigger Hook (`triggerFlowCard`) Blootstellen

**Probleem:** `RollingCOPCalculator` (in `lib/services/rolling-cop-calculator.ts`) verwacht `config.device.triggerFlowCard()`, maar het Modbus device geeft dit niet mee. `EnergyTrackingService` (in `lib/services/energy-tracking-service.ts`) doet een unsafe cast om hetzelfde te bereiken.

**Getroffen triggers:** `cop_trend_detected`, `daily_cop_efficiency_changed`, `monthly_cop_efficiency_changed`, `daily_consumption_threshold`

**Suggestie:** Implementeer een `triggerFlowCard(cardId, tokens, state?)` methode op het Modbus device (of als adapter-interface), en geef deze mee bij constructie van `RollingCOPCalculator` en `EnergyTrackingService`.

**Geschatte impact:** 4 trigger flow cards functioneel
**Geschatte effort:** Klein-Medium
**Relatie met ADR-012:** Sectie 5.3 (Device Trigger Hook)

---

### 2.3 Alias Mismatches Oplossen

**Probleem:** Meerdere condition cards in `FlowCardManagerService` lezen DPS-capability-id's die het Modbus-device niet populateert.

| Condition card | Leest capability | Status | Modbus equivalent |
| --- | --- | --- | --- |
| `heating_mode_is` | `adlar_enum_mode` | ❌ mismatch | `adlar_mode` |
| `capacity_setting_is` | `adlar_enum_capacity_set` | ❌ mismatch | register `0x0315` (ongewired) |
| `heating_curve_is` | `adlar_enum_countdown_set` | ❌ mismatch | register `0x0314` (ongewired) |
| `volume_setting_is` | `adlar_enum_volume_set` | ❌ geen equivalent | — |
| `water_mode_is` | `adlar_enum_water_mode` | ❌ geen equivalent | — |
| `work_mode_is` | `adlar_enum_work_mode` | ❌ mismatch | register `0x0307` (ongewired) |
| `hotwater_temperature_is` | `adlar_hotwater` | ✅ opgelost (2026-03-28) | `adlar_hotwater` gesynchroniseerd via `applyModbusSnapshot` |

**Suggestie:** Maak de `FlowCardManagerService`-condities configureerbaar via een capability-alias-map (de `FlowCapabilityMap` uit ADR-012 sectie 4.2), zodat de Modbus-variant de juiste id's gebruikt zonder code-duplicatie.

**Geschatte impact:** 4-5 condition cards correct werkend
**Geschatte effort:** Medium
**Relatie met ADR-012:** Sectie 5.4 (Flow Capability Mapping Invoeren)

## 3. Suggesties — Medium Prioriteit

### 3.1 Ongewired Registers als Capabilities Exposen

**Probleem:** Vier registers bestaan al in `lib/modbus/adlar-modbus-registers.ts` maar zijn niet gekoppeld aan capabilities:

| Register | Omschrijving | Richting |
|---|---|---|
| `0x0307` | Work mode (Standard/Powerful/Silent) | Read + Write |
| `0x0315` | Hot-water curve setting | Read + Write |
| `0x0314` | Heating curve setting | Read + Write |
| `0x0043` | EVI expansion valve stap | Read |
| `0x0076` / `0x0078` | B/C fase spanning | Read |
| `0x0360-0x0363` | Firmware versies | Read |

**Suggestie:** Voeg capabilities toe (in `driver.compose.json` en read/write-wiring in `device.ts`). Dit maakt de condition cards uit suggestie 2.3 ook meteen mogelijk. Firmware-info is handig voor debugging en support.

> **Opmerking:** De curve-registers (`0x0314`/`0x0315`) vereisen protocol ≥ 130. Implementeer een protocol-versie-guard die de capability alleen registreert als het protocol dit ondersteunt.

**Geschatte impact:** 6+ nieuwe meetwaarden + write-controls
**Geschatte effort:** Medium

---

### 3.2 BuildingInsightsService Injecteren

**Probleem:** `BuildingInsightsService` is momenteel een interface-stub (in `lib/services/building-insights-service.ts`) die niet in de `ServiceCoordinator` wordt geïnjecteerd. Hierdoor zijn 7 flow cards uitgeschakeld:

| Type | Kaarten |
|---|---|
| Actions | `calculate_preheat_time`, `force_insight_analysis` |
| Conditions | `confidence_above`, `insight_is_active`, `savings_above` |
| Triggers | `building_insight_detected`, `building_profile_mismatch`, `pre_heat_recommendation` |

**Suggestie:** Als de volledige service nog niet gereed is, overweeg een minimale implementatie te injecteren zodat in ieder geval de guard wegvalt en flow cards die al bestaan registreerbaar worden (eventueel met een "niet beschikbaar" status teruggeven). Of maak een besluit: is dit fase 3/4 werk of moet het nu al?

**Geschatte effort:** Groot (volledige implementatie) / Klein (stub-injectie)
**Relatie met ADR-012:** Sectie 5.2 (ServiceCoordinator Uitbreiden)

---

### 3.3 Ontbrekende Temperature & Efficiency Triggers

**Probleem:** 15+ trigger cards bestaan als compose JSON maar hebben geen Modbus-runtime bron die ze afvuurt. De belangrijkste categorieën:

| Categorie | Triggers | Benodigde bron |
|---|---|---|
| Temperatuur-alerts | `coiler_temperature_alert`, `high_pressure_temperature_alert`, `low_pressure_temperature_alert`, `suction_temperature_alert`, `tank_temperature_alert`, `discharge_temperature_alert`, `economizer_inlet_temperature_alert`, `economizer_outlet_temperature_alert`, `incoiler_temperature_alert` | Threshold-monitoring op bestaande sensor readings |
| Temperatuur-changes | `ambient_temperature_changed`, `inlet_temperature_changed`, `outlet_temperature_changed` | Delta-detectie in polling loop |
| Efficiency/mechanisch | `compressor_efficiency_alert`, `fan_motor_efficiency_alert`, `cop_efficiency_changed`, `cop_outlier_detected`, `water_flow_alert` | Vergelijking met historische waarden |
| Status-changes | `heating_mode_changed`, `water_mode_changed`, `work_mode_changed`, `fault_detected` | State-change detectie in snapshot verwerking |

**Suggestie:** Implementeer een generiek `ThresholdMonitorService` dat sensor-capabilities bewaakt en triggers afvuurt bij overschrijding. De data is al beschikbaar via de bestaande poll-cycli — er ontbreekt alleen de detectie- en fire-logica.

> **Tip:** Begin met `fault_detected` en de temperatuur-alerts — deze hebben de meeste praktische waarde voor eindgebruikers en de data is al aanwezig.

**Geschatte effort:** Medium-Groot (generiek framework) / Klein per individuele trigger
**Relatie met ADR-012:** Sectie 5.5 (Modbus-side Changed/Alert Bronnen)

## 4. Suggesties — Lage Prioriteit

### 4.1 Titel-Consistentie Verbeteren

**Observaties uit het sensor-titels-document:**

| Issue | Voorbeelden |
|---|---|
| **"Homey standaardtitel" als fallback** | `measure_power`, `measure_current`, `measure_voltage`, `meter_power`, `measure_temperature.indoor` — deze hebben geen custom Modbus-titel en vallen terug op de generieke Homey naam |
| **Taalinconsistentie** | Mix van Nederlands en Engels: "HP saturatietemperatuur" vs "Economizer inlaat (T8)" |
| **Ontbrekende T-nummers** | `measure_temperature.dhw` heeft geen "(T-nummer)" suffix terwijl alle andere die wél hebben |
| **DPS-typo's** | "Hudige stroomsterkte" (moet "Huidige" zijn), "wamtewisselaar" (moet "warmtewisselaar" zijn) — dit betreft de DPS-app |

**Suggestie:** Geef alle sensor capabilities expliciete Nederlandstalige titels in `capabilitiesOptions` met consistente Tx-nummers voor fysieke sensoren. Dit verbetert de UX in het Homey dashboard aanzienlijk.

**Geschatte effort:** Klein — alleen `driver.compose.json` aanpassingen

---

### 4.2 Dode Flow Cards Opruimen of Markeren

**Probleem:** `cop_calculation_method_is` heeft in **geen van beide** repos runtime registratie. Ook `set_volume` en `set_water_mode` hebben geen Modbus-equivalent en zullen dat waarschijnlijk ook niet krijgen.

**Suggestie:** Maak een beslissing per dode kaart:

- **Verwijderen:** als de functionaliteit fundamenteel niet bestaat in Modbus
- **Markeren als "coming soon":** als implementatie gepland is
- **Accepteren als compose-only:** documenteer bewust dat de kaart geen runtime heeft

---

### 4.3 Cross-Referenties in Documentatie

**Suggestie:** Voeg aan elk van de drie mapping-documenten een "Zie ook"-sectie toe die naar de andere twee documenten verwijst. De drie documenten zijn complementair maar linken momenteel niet naar elkaar. Overweeg ook een overkoepelend "Modbus Migration Status" dashboard-document dat de voortgang per categorie samenvat (percentage gewired, aantal gaps, etc.).

## 5. Prioriteits-Matrix

| # | Suggestie | Impact | Effort | Flow cards affected |
|---|---|---|---|---|
| 2.1 | Flow-helpers bootstrap | Hoog | Klein | ~15 |
| 2.2 | Device trigger hook | Hoog | Klein-Medium | 4 |
| 2.3 | Alias mismatches | Hoog | Medium | 4-7 |
| 3.1 | Ongewired registers exposen | Medium | Medium | 6+ |
| 3.2 | BuildingInsightsService | Medium | Klein-Groot | 7 |
| 3.3 | Temp/efficiency triggers | Medium | Medium-Groot | 15+ |
| 4.1 | Titel-consistentie | Laag | Klein | — |
| 4.2 | Dode flow cards opruimen | Laag | Klein | 2-3 |
| 4.3 | Documentatie cross-refs | Laag | Klein | — |

> **Aanbeveling:** Suggesties 2.1, 2.2 en 2.3 samen vormen een **quick-win pakket** dat met relatief weinig inspanning ~25 flow cards functioneel maakt. Dit is de aanbevolen startplek. Merk op dat ADR-012 deze drie suggesties al als concrete wijzigingen beschrijft — zij vormen de kern van dat implementatieplan.

## 6. Relatie met ADR-012

Deze ADR overlapt inhoudelijk significant met ADR-012. Het verschil is de invalshoek:

- **ADR-012** beschrijft de architectuurbeslissing en het gewenste eindplaatje voor flow card runtime alignment
- **ADR-030** is een analyse-resultaat dat vanuit de mapping-documenten verbetervoorstellen destilleert en prioriteert

De high-priority suggesties (2.1-2.3) uit ADR-030 zijn een subset van de concrete wijzigingen uit ADR-012 secties 5.1, 5.3 en 5.4. De medium- en lage-prioriteit suggesties gaan verder dan ADR-012 door ook documentatiekwaliteit, titel-consistentie en ongewired registers te adresseren.

## 7. Niet Besloten in Deze ADR

- De volgorde en fasering van implementatie van de suggesties
- Of alle suggesties daadwerkelijk opgepakt worden
- Welke suggesties eventueel als aparte ADR's of implementatieplannen worden uitgewerkt
