# ADR-033: Feature Toggle Settings — Pariteit met DPS Driver

**Status:** Voorstel
**Datum:** 2026-03-30
**Gerelateerd:** [ADR-032 Configureerbare Sensor-Categorieën](ADR-032-configureerbare-sensor-categorieen.md)

---

## 1. Probleem

De Modbus driver bevat services die via `getSetting()` tientallen feature toggles en configuratieparameters opvragen — maar deze staan niet gedefinieerd in `driver.settings.compose.json`. Homey retourneert voor ontbrekende settings altijd `undefined`, waardoor de hardcoded fallback-waarden in de code worden gebruikt en de gebruiker deze instellingen niet kan beheren via de Homey UI.

De DPS driver (`org.hhi.adlar-heatpump`) heeft deze settings wél volledig uitgewerkt. De Modbus driver deelt dezelfde services (`AdaptiveControlService`, `BuildingModelService`, `EnergyTrackingService`, etc.) en moet dezelfde configuratiemogelijkheden bieden.

## 2. Beslissing

We voegen alle ontbrekende feature toggles toe aan `driver.settings.compose.json`, gegroepeerd per feature-domein. De structuur, labels en standaardwaarden worden overgenomen uit de DPS driver, tenzij hieronder anders aangegeven.

### 2.1 Wat bewust niet wordt overgenomen

| Setting(s) | Reden |
|---|---|
| `flow_temperature_alerts`, `flow_voltage_alerts`, `flow_current_alerts`, `flow_power_alerts`, `flow_state_alerts`, `flow_efficiency_alerts` | Default is `'auto'` — altijd actief. Geen UI-toggles nodig. |
| `flow_expert_mode` | Geen Modbus-specifieke expert flows gedefinieerd. |
| `flow_pulse_steps_alerts` | DPS-specifiek (pulse-sensor). Geen equivalent in Modbus. |
| `device_id`, `local_key`, `ip_address`, `protocol_version` | DPS verbindingsinstellingen. Modbus gebruikt `modbus_host` / `modbus_port`. |
| `enable_curve_controls`, `enable_slider_controls` | DPS UI-componenten zonder Modbus equivalent. |
| `cop_calculation_method` (uitgebreide dropdown) | Modbus COP is direct berekend uit waterflow en temperatuurdelta. Methode-keuze is niet van toepassing. |
| `cop_min_acceptable`, `cop_target`, `cop_strategy` | Code in Modbus leest `cop_optimizer_enabled` maar niet deze parameters. Nog niet geïmplementeerd. |

### 2.2 Toe te voegen settings per groep

#### Groep: COP-berekening

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `cop_calculation_enabled` | checkbox | `true` | Master-schakelaar voor alle COP-capabilities |

**Sensorafhankelijkheid:** elektrisch vermogen (measure_power of adlar_external_power)

---

#### Groep: Intelligente energietracking

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `enable_intelligent_energy_tracking` | checkbox | `true` | Schakelt meter_power / energy cost tracking in |
| `enable_power_measurements` | checkbox | `true` | Schakelt measure_power capability-updates in |
| `power_threshold_watts` | number | `3000` | Drempelwaarde voor vermogensalerts (W) |

**Sensorafhankelijkheid:** elektrisch vermogen

---

#### Groep: Adaptieve regeling

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `adaptive_control_enabled` | checkbox | `false` | Master-schakelaar; vereist binnentemperatuur via flow card |
| `adaptive_pi_kp` | number | `3.0` | Proportionele versterking PI-regelaar |
| `adaptive_pi_ki` | number | `1.5` | Integrale versterking PI-regelaar |
| `adaptive_pi_deadband` | number | `0.3` | Dode band (°C) voordat correctie wordt toegepast |
| `adaptive_min_setpoint` | number | `18` | Minimum watertemperatuur setpoint (°C) |
| `adaptive_cooldown_offset` | number | `1.0` | Offset boven doeltemperatuur voor coast-fase (°C) |
| `adaptive_cooldown_hysteresis` | number | `0.3` | Hysterese voor coast-fase activering (°C) |
| `adaptive_cooldown_strength` | number | `0.80` | Sterkte van setpoint-reductie tijdens coast (0–1) |

**Sensorafhankelijkheid:** binnentemperatuur (via flow card "Stuur binnentemperatuur")

---

#### Groep: Gebouwmodel

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `building_model_enabled` | checkbox | `false` | Schakelt adaptief gebouwmodel in |
| `building_model_forgetting_factor` | number | `0.999` | Vergeetfactor voor gewogen regressie (0.9–1.0) |
| `building_profile` | dropdown | `average` | Thermisch profiel: `light` / `average` / `heavy` / `passive` |
| `enable_dynamic_pint` | checkbox | `true` | Dynamische interne warmtewinst (pint) op basis van profiel |
| `reset_building_model` | checkbox | `false` | Reset geleerde parameters (keert terug naar `false` na reset) |

**Sensorafhankelijkheid:** binnentemperatuur + buitentemperatuur (T1) + elektrisch vermogen

---

#### Groep: Building Insights

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `building_insights_enabled` | checkbox | `true` | Schakelt adviescapabilities in |
| `insights_min_confidence` | number | `70` | Minimale modelzekerheid (%) voor actief advies |

**Sensorafhankelijkheid:** binnentemperatuur + buitentemperatuur + elektrisch vermogen

---

#### Groep: Weersverwachting (Open-Meteo)

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `enable_weather_forecast` | checkbox | `false` | Haalt wind/temp/solar op bij Open-Meteo |
| `forecast_location_lat` | number | `52.37` | Breedtegraad locatie |
| `forecast_location_lon` | number | `4.90` | Lengtegraad locatie |

**Sensorafhankelijkheid:** buitentemperatuur (als fallback-bron)

---

#### Groep: COP Optimizer

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `cop_optimizer_enabled` | checkbox | `false` | Vereist `cop_calculation_enabled` |

**Sensorafhankelijkheid:** elektrisch vermogen

---

#### Groep: Prijsoptimalisatie

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `price_optimizer_enabled` | checkbox | `false` | Master-schakelaar prijsoptimalisatie |
| `price_calculation_mode` | dropdown | `all_in` | `market` / `market_plus` / `all_in` |
| `supplier_fee_inc_vat` | number | `0.0182` | Leverancierstoeslag incl. BTW (€/kWh) |
| `electricity_tax_inc_vat` | number | `0.11085` | Energiebelasting incl. BTW (€/kWh) |
| `vat_percentage` | number | `21` | BTW-percentage (%) |
| `price_threshold_very_low` | number | `0.04` | Drempel zeer goedkoop (€/kWh) |
| `price_threshold_low` | number | `0.06` | Drempel goedkoop (€/kWh) |
| `price_threshold_normal` | number | `0.10` | Drempel normaal (€/kWh) |
| `price_threshold_high` | number | `0.12` | Drempel duur (€/kWh) |
| `daily_cost_threshold` | number | `10` | Dagelijkse kostendrempel voor alarm (€) |
| `adaptive_price_block_hours` | number | `4` | Blokgrootte voor goedkoopste-uren berekening |
| `adaptive_price_warning_hours` | number | `2` | Vooruitkijkperiode voor prijswaarschuwing (uur) |
| `adaptive_price_trend_hours` | number | `6` | Trendperiode voor prijsanalyse (uur) |

**Sensorafhankelijkheid:** elektrisch vermogen

---

#### Groep: Windcorrectie

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `wind_correction_enabled` | checkbox | `false` | Corrigeert setpoint op basis van windsnelheid |
| `wind_max_correction` | number | `3.0` | Maximale setpoint-correctie bij wind (°C) |
| `wind_alpha_manual` | number | `0` | Handmatige alpha-factor (0 = auto) |

**Sensorafhankelijkheid:** buitentemperatuur (windeffect op warmteverlies)

---

#### Groep: Zonnepanelen

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `solar_panel_wp` | number | `0` | Piekvermogen zonnepanelen (Wp), 0 = uitgeschakeld |
| `solar_panel_efficiency` | number | `0.85` | Systeemrendement (0–1) |

**Sensorafhankelijkheid:** buitentemperatuur (instraling via Open-Meteo)

---

#### Groep: Prioriteitsgewichten

| Setting-id | Type | Default | Opmerking |
|---|---|---|---|
| `priority_comfort` | number | `60` | Gewicht comfort (%) |
| `priority_efficiency` | number | `25` | Gewicht efficiëntie (%) |
| `priority_cost` | number | `15` | Gewicht kosten (%) |
| `priority_thermal` | number | `20` | Gewicht thermische opslag (%) |

**Sensorafhankelijkheid:** binnentemperatuur + buitentemperatuur + elektrisch vermogen (alle drie vereist voor gewogen beslissing)

---

## 3. Sensorafhankelijkheden — Overzicht

| Groep | Binnentemp | Buitentemp | El. vermogen |
|---|:---:|:---:|:---:|
| COP-berekening | | | ✓ |
| Energietracking | | | ✓ |
| Adaptieve regeling | ✓ | | |
| Gebouwmodel | ✓ | ✓ | ✓ |
| Building Insights | ✓ | ✓ | ✓ |
| Weersverwachting | | ✓ | |
| COP Optimizer | | | ✓ |
| Prijsoptimalisatie | | | ✓ |
| Windcorrectie | | ✓ | |
| Zonnepanelen | | ✓ | |
| Prioriteitsgewichten | ✓ | ✓ | ✓ |

Settings waarbij een sensorafhankelijkheid ontbreekt zijn technisch inzetbaar maar leveren geen of onjuiste resultaten. De UI-hints in de settings moeten dit duidelijk communiceren (bijv. *"Vereist binnentemperatuur via flow card 'Stuur binnentemperatuur'"*).

## 4. Gevolgen

### Positief

- Gebruikers kunnen alle features in- en uitschakelen zonder een hardcoded default te accepteren
- Pariteit met DPS driver verlaagt de onderhoudslast: wijzigingen in gedeelde services zijn direct toepasbaar op beide drivers
- Hints en labels per setting communiceren de vereiste sensoropstelling

### Negatief

- `driver.settings.compose.json` groeit naar ~60 settings-velden (was: 12)
- Groepen die afhankelijk zijn van meerdere sensoren vereisen correcte UI-hints om gebruikersverwarring te voorkomen
- `adaptive_control_enabled` activeert een PI-regelaar die actief het setpoint wijzigt — een verkeerd geconfigureerde waarde kan oncomfortabele situaties opleveren; een duidelijke waarschuwing in de hint is vereist

## 5. Acceptatiecriteria

1. Alle settings uit sectie 2.2 zijn aanwezig in `driver.settings.compose.json`
2. Elke setting heeft een `hint` in EN en NL die de sensorafhankelijkheid beschrijft waar van toepassing
3. `adaptive_control_enabled` heeft een prominente waarschuwing in de hint
4. `npm run build && homey app validate` slaagt zonder fouten
5. De DPS `driver.settings.compose.json` dient als referentie voor labels, hints en validatiewaarden (`attr.min` / `attr.max`)
