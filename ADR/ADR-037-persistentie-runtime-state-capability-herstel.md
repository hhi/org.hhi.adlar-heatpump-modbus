# ADR-037: Persistentie van Runtime-State en Capability Herstel

**Status:** Voorstel  
**Datum:** 2026-04-05 (herzien 2026-04-05)  
**Gerelateerd:** [ADR-031 ModbusConnectionService Ontkoppelen van Adlar-Registerset](ADR-031-modbus-connection-service-driver-ontkoppeling.md), [ADR-033 Feature Toggle Settings — Pariteit met DPS Driver](ADR-033-feature-toggles-settings-pariteit.md)

---

## 1. Probleem

De Modbus-driver gebruikt meerdere vormen van state:

- Homey settings via `getSettings()` / `setSettings()`
- device store via `getStoreValue()` / `setStoreValue()`
- capabilitywaarden via `getCapabilityValue()` / `setCapabilityValue()`
- in-memory service state

Bij app-herstart, Homey-restart of app-upgrade is nu niet eenduidig:

- welke waarden expliciet persistent horen te zijn
- welke store-waarden alleen als interne engine-state dienen
- welke user-visible capabilities actief uit store worden hersteld
- welke waarden wel worden opgeslagen maar nooit worden teruggezet
- welke restore-paden nog legacy capability-ids of verouderde aannames gebruiken

Hierdoor ontstaan stille functiefouten die lastig te diagnosticeren zijn. Voorbeeld: het building model bleef op 0 samples steken door een ontbrekende `getEnergyTracking()` methode in `ServiceCoordinator` — zichtbaar geworden pas via UI-gedrag, niet via restorediagnostics. Een tweede voorbeeld: `energy-tracking-service.ts` schrijft naar `meter_power.electric_total` en `meter_power.power_consumption`, maar beide capabilities bestaan niet in `driver.compose.json` (alleen `meter_power`). De `hasCapability()` guards maskeren dit zonder melding.

---

## 2. Beslissing

We hanteren voortaan vier expliciete categorieën voor persistentie:

1. **Configuratie-state**
   Gebruikersinstellingen horen in Homey settings, niet in store.

2. **Engine-state**
   Geleerde modellen, optimizer-state, throttling-info en historische buffers horen in store.

3. **User-visible capability state**
   Als een capability betekenisvol moet blijven over restart/update heen en niet onmiddellijk uit live data kan worden herbouwd, dan moet de driver die capability expliciet uit store herstellen.

4. **TTL- en bronmetadata**
   Timestamps en bronmarkeringen mogen in store staan zonder capability-herstel, mits dat bewust en gedocumenteerd is.

### 2.1 Beslisregels

- Een nieuwe feature krijgt precies één **authoritative source of truth**:
  - settings voor configuratie
  - store voor runtime/geleerde state
  - modbus/live input voor actuele meetwaarden
- Een capability die de gebruiker in de UI verwacht terug te zien na restart moet óf:
  - direct uit store worden hersteld, óf
  - aantoonbaar direct opnieuw uit live polling of berekening worden opgebouwd.
- Waarden die alleen voor TTL of fallbacklogica worden opgeslagen, maar niet voor UI-herstel bedoeld zijn, worden als zodanig benoemd en niet als "persistent capability state" behandeld.
- Restorelogica mag geen capability-ids gebruiken die niet in `driver.compose.json` bestaan.

---

## 3. Huidige Inventarisatie

### 3.1 Expliciet persistent en hersteld (geverifieerd)

| Domein | Store keys | Herstelgedrag | Status |
| --- |---| --- |---|
| COP / SCOP | `rolling_cop_data`, `scop_data` | Calculator-state hersteld in `device.ts` | ✅ Werkt |
| Adaptieve regeling | `adaptive_last_target`, `adaptive_control_enabled`, `adaptive_last_adjustment_time`, `adaptive_accumulated_adjustment`, `adaptive_pi_history` | State hersteld bij `AdaptiveControlService.initialize()` | ✅ Werkt |
| Prijs/COP/defrost optimizers | `energy_optimizer_state`, `cop_optimizer_state`, `defrost_learning_state` | Optimizer-state hersteld | ✅ Werkt |
| Gebouwmodel | `building_model_state` | Learner-state hersteld; capabilities via `updateModelCapabilities()` | ✅ Werkt (na fix 1.2.8) |
| Building Insights | `building_insights_state` | State hersteld en opnieuw geëvalueerd | ✅ Werkt |
| Wind learning | `wind_learned_alpha`, `wind_learning_count` | Interne leercurve hersteld | ✅ Werkt |

### 3.2 Opgeslagen maar niet als capability hersteld

| Waarde | Store key(s) | Huidig gebruik | Actie nodig? |
| --- |---| --- |---|
| Externe binnentemperatuur | `external_indoor_temp` | Opgeslagen in `ExternalTemperatureService`; geen capability-herstel op startup | Ja — capability `measure_temperature.indoor` vullen bij init |
| Externe buitentemperatuur | `external_outdoor_temp`, `external_outdoor_temp_timestamp` | Timestamp voor TTL; capabilitywaarde niet teruggezet | Beslissing vereist (zie §6) |
| Externe windsnelheid | `external_wind_speed`, `external_wind_speed_timestamp` | Timestamp hersteld; capabilitywaarde niet expliciet | Beslissing vereist |
| Extern solar power | `external_solar_power`, `external_solar_power_timestamp` | Fallbacklogica actief; capabilitywaarde niet hersteld | Beslissing vereist |
| Externe solar radiation | `external_solar_radiation`, `external_solar_radiation_timestamp` | Zelfde patroon | Beslissing vereist |
| Externe energieprijzen timestamp | `external_energy_prices_timestamp` | Alleen metadata | TTL-metadata — geen restore nodig |

> **Referentie-implementatie:** `ExternalTemperatureService` (`lib/services/external-temperature-service.ts`) slaat via `setStoreValue('external_indoor_temp', ...)` op bij elke flow-card update, maar leest dit nooit terug bij `initialize()`. Dat is het canonieke voorbeeld van het patroon dat in fase 2 genormaliseerd wordt.

### 3.3 Bekende bugs en inconsistenties

| Onderwerp | Probleem | Bestand / locatie |
| --- |---| --- |
| Energie restore — legacy capability-id | `energy-tracking-service.ts` leest en schrijft naar `meter_power.electric_total` en `meter_power.power_consumption`; beide bestaan niet in `driver.compose.json` (alleen `meter_power`). De `hasCapability()` guards maskeren dit stilletjes — restorelogica bereikt nooit de daadwerkelijke capability. | `lib/services/energy-tracking-service.ts` L242-253, L348-359 |
| Flow-helper mismatch | `flow-helpers.ts` verwijst naar `meter_power.electric_total` als capability-id voor de `total_consumption_above` condition. Capability bestaat niet → condition evalueert altijd via fallback. | `lib/flow-helpers.ts` L297 |
| Building model power dependency | `BuildingModelService` roept `serviceCoordinator.getEnergyTracking()` aan — methode ontbrak in Modbus `ServiceCoordinator` (aanwezig in Tuya). Opgelost in 1.2.8, maar toont dat de service-API niet systematisch geïnventariseerd was. | Opgelost in 1.2.8 |

---

## 4. Plan

De fase-volgorde is bewust aangepast t.o.v. het oorspronkelijke voorstel: diagnostics komen eerst zodat vervolgfasen bouwen op observeerbare feiten in plaats van aannames.

### Fase 1: Restore-diagnostics toevoegen (was fase 4)

We voegen een compacte startup-diagnosticslaag toe die logt:

- welke store-keys aanwezig zijn en welke waarde ze bevatten
- welke capability-waarden actief zijn hersteld
- welke waarden bewust niet zijn hersteld (met reden)
- welke restore-aanroepen zijn overgeslagen door ontbrekende capabilities

Dit voorkomt dat persistence-issues opnieuw alleen via UI-gedrag of klachten worden ontdekt.

**Output:** logregels op `info`-niveau bij `onInit()`, optioneel ook als een `adlar_restore_diagnostics` capability-waarde (string) voor zichtbaarheid in de UI.

---

### Fase 2: Persistentiematrix expliciet maken (was fase 1)

Op basis van de diagnostics-uitvoer leggen we per store-key vast:

| Veld | Toelichting |
| --- |---|
| `key` | Store-key naam |
| `owner` | Verantwoordelijke service |
| `semantiek` | `engine-state` / `user-visible` / `ttl-metadata` / `configuratie` |
| `authoritative source` | `store` / `settings` / `modbus` / `flow-card` |
| `capability-herstel verplicht` | `ja` / `nee` / `n.v.t.` |
| `huidige status` | `correct` / `ontbreekt` / `legacy-id` |

Minimaal op te nemen keys: alle `adaptive_*`, `external_*`, energie/cost stores, `building_model_state`, `building_insights_state`, optimizer states, `rolling_cop_data`, `scop_data`.

---

### Fase 3: Externe input-state normaliseren (was fase 2)

Voor externe flow-card inputs bepalen we per bron:

| Bron | Beslissing |
| --- |---|
| Binnentemperatuur | Herstellen — wordt direct gebruikt door `BuildingModelService` en `AdaptiveControlService`; zonder herstel is de eerste 5-minuten tick gegarandeerd geblokkeerd na herstart |
| Buitentemperatuur | Herstellen — gebruikt als fallback in `getOutdoorTemperatureWithFallback()`; eerste poll na herstart kan dit nodig hebben |
| Windsnelheid | Herstellen als de correctiefactor user-visible is; anders alleen timestamp |
| Solar power / radiation | Herstellen — gebruikt in building model solar gain berekening |
| Energieprijzen | Prijsdata herstellen uit store (payload aanwezig als `external_energy_prices`); timestamp als TTL-metadata |

Herstelpatroon per bron: bij `initialize()` store-key uitlezen, sanity check (range + leeftijd), capability zetten als waarde geldig is.

---

### Fase 4: Legacy restore-paden opschonen (was fase 3)

Concrete fixes:

1. **`energy-tracking-service.ts`:** vervang alle referenties naar `meter_power.electric_total` door `meter_power`. Verwijder de fallback-leeslogica op L242 (capability bestaat niet; store is de authoritative source). Herstellogica op L249-254 sturen naar `meter_power`.
2. **`flow-helpers.ts` L297:** `capabilityName` en `requiresCapability` corrigeren naar `meter_power`.
3. Audit van alle overige restorelogica op capability-ids die niet in `driver.compose.json` staan — verwijderen of corrigeren.

---

## 5. Gevolgen

### Positief

- Eenduidig onderscheid tussen configuratie, engine-state en capability-herstel
- Stille restore-fouten worden zichtbaar via diagnostics vóórdat ze klachten veroorzaken
- Minder verrassingen na app-herstart of upgrade
- Correcte energie-capabilities na het opschonen van de legacy-ids

### Negatief

- Meer expliciete restorecode in services
- Mogelijke éénmalige reset van cumulatieve energie bij bestaande devices wanneer de capability-id wordt gecorrigeerd (waarde staat in store, capability-restore werkt daarna wel correct)

---

## 6. Beslissingen over externe inputs

Anders dan in het oorspronkelijke voorstel is dit nu gedeeltelijk beslist (zie fase 3). Wat nog open staat:

- **Maximale leeftijd voor restore:** hoe oud mag een opgeslagen externe waarde zijn om nog te worden hersteld? Voorstel: 4 uur voor temperaturen, 24 uur voor energieprijzen, geen TTL voor windsnelheid/solar (model compenseert voor verouderde data).
- **Foutgedrag bij ontbrekende store-key:** stil overslaan (huidige aanpak) of expliciete log op `warn`-niveau.

---

## 7. Eerstvolgende Concrete Uitvoering

1. Restore-diagnostics toevoegen in `device.ts` `onInit()` (fase 1).
2. Energie-capability mismatch fixen: `meter_power.electric_total` → `meter_power` in `energy-tracking-service.ts` en `flow-helpers.ts` (fase 4, prioriteit hoog — concrete bug).
3. Persistentiematrix uitschrijven op basis van diagnostics-output (fase 2).
4. Externe inputs normaliseren, te beginnen met binnentemperatuur (fase 3).
