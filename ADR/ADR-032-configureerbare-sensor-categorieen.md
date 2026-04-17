# ADR-032: Configureerbare Sensor-Categorieën met Register-Zichtbaarheid

**Status:** Voorstel
**Datum:** 2026-03-28
**Gerelateerd:** [ADR-031 ModbusConnectionService Ontkoppeling](ADR-031-modbus-connection-service-driver-ontkoppeling.md), [ADR-012 Flow Card Runtime Alignering](ADR-012-modbus-flow-card-runtime-alignment.md)

---

## 1. Probleem

De huidige Modbus driver toont alle ~30 sensor-capabilities altijd in de Homey UI, ongeacht de fysieke installatie. Veel warmtepompinstallaties hebben geen buffervat, geen zone 2, of geen economizer. De gebruiker ziet dan capabilities met waarde `0` of `null`, wat verwarrend is.

Daarnaast is de registerset hardcoded in `adlar-modbus-registers.ts`. Als een andere warmtepomp dezelfde sensoren op andere adressen heeft, is er nu geen manier om dit te configureren zonder code aan te passen.

## 2. Beslissing

We introduceren **categorie-gebaseerde sensor-toggles** in de device settings. Elke categorie krijgt een eigen settingsgroep met een dropdown die bepaalt of de gehele sensorgroep zichtbaar is. Bij `off` worden de capabilities verborgen via `setCapabilityOptions({ uiComponent: null })`.

### 2.1 Strategie: Categorie-toggles Nu, Adres-override Later

We kiezen bewust voor **categorie-toggles** in plaats van per-register adresvelden:

- 6 dropdowns in plaats van 40+ number-velden
- De gebruiker hoeft geen registeradressen te kennen
- Past bij 95% van de use cases (sensorgroep bestaat of bestaat niet)
- Het interne datamodel wordt zo ontworpen dat per-register adres-override later toevoegbaar is zonder architectuurwijziging

### 2.2 Categorie-indeling

| Categorie | Settings-id | Capabilities | Standaard |
|---|---|---|---|
| **Kerntemperaturen** | `reg_core_temps` | `measure_temperature.ambient` (T1), `measure_temperature.inlet` (T6), `measure_temperature.outlet` (T7) | Altijd aan (niet uitschakelbaar) |
| **Koelcircuit** | `reg_refrigerant` | `measure_temperature.outer_coil` (T2), `.inner_coil` (T3), `.suction` (T4), `.exhaust` (T5), `.hp_sat`, `.lp_sat` | Aan |
| **Economizer & DHW** | `reg_econ_dhw` | `measure_temperature.econ_in` (T8), `.econ_out` (T9), `.dhw`, `.dhw_return`, `.plate_hx` | Aan |
| **Zones & Buffer** | `reg_zones` | `measure_temperature.buffer_tank`, `.total_outlet`, `.zone1_mix`, `.zone2` | Uit |
| **Elektrisch** | `reg_electrical` | `measure_voltage`, `measure_current`, `measure_power`, `meter_power`, `measure_current.comp_phase`, `.b_phase`, `.c_phase`, `measure_temperature.ipm` | Aan |
| **Mechanisch** | `reg_mechanical` | `adlar_compressor_freq`, `adlar_comp_target_freq`, `adlar_fan_speed`, `adlar_eev_step`, `adlar_pump_pwm`, `adlar_water_flow` | Aan |

De categorie **Kerntemperaturen** is niet uitschakelbaar omdat T1, T6 en T7 essentieel zijn voor COP-berekening.

### 2.3 Settings-formaat per Categorie

Elke categorie wordt een settingsgroep met één dropdown:

```json
{
  "id": "reg_zones",
  "type": "group",
  "label": {
    "en": "Zone & Buffer Tank Sensors",
    "nl": "Zone- & Buffervatsensoren"
  },
  "children": [
    {
      "id": "reg_zones_enabled",
      "type": "dropdown",
      "label": {
        "en": "Zone and buffer tank sensors",
        "nl": "Zone- en buffervatsensoren"
      },
      "value": "off",
      "values": [
        {
          "id": "on",
          "label": {
            "en": "Enabled (default addresses)",
            "nl": "Ingeschakeld (standaard adressen)"
          }
        },
        {
          "id": "off",
          "label": {
            "en": "Disabled (hidden)",
            "nl": "Uitgeschakeld (verborgen)"
          }
        }
      ],
      "hint": {
        "en": "Disable if your installation has no buffer tank or zone 2. Sensors will be hidden from the dashboard.",
        "nl": "Schakel uit als uw installatie geen buffervat of zone 2 heeft. De sensoren worden verborgen in het dashboard."
      }
    }
  ]
}
```

## 3. Intern Datamodel

### 3.1 RegisterCategoryConfig

Het runtime-model dat de koppeling tussen settings, capabilities en registers beschrijft:

```typescript
interface RegisterCategoryConfig {
  id: string;                          // 'reg_zones'
  settingsKey: string;                 // 'reg_zones_enabled'
  enabled: boolean;                    // uit dropdown
  locked: boolean;                     // true voor kerntemperaturen
  sensors: RegisterSensorConfig[];
}

interface RegisterSensorConfig {
  capabilityId: string;                // 'measure_temperature.buffer_tank'
  snapshotKey: string;                 // 'bufferTankTemp'
  defaultAddress: number;              // 0x0074
  address: number;                     // default of override (toekomstig)
  signed: boolean;
  multiply: number;
  unit: string;
}
```

### 3.2 Waarom `address` al in het model?

Hoewel strategie A (per-register adres-override) niet in deze versie wordt geïmplementeerd, bevat het model al een `address`-veld per sensor. Dit zorgt ervoor dat:

- De `SENSOR_DESCRIPTORS` array in `Adlar2ModbusService` vervangen kan worden door een configuratie-gedreven equivalent
- Strategie A later toevoegbaar is door simpelweg settings-velden per sensor toe te voegen
- Het model bruikbaar is voor ADR-031: een andere driver levert een ander default-profiel maar gebruikt hetzelfde category-config systeem

### 3.3 Default Profielen

Het totale set van categorieën met hun standaardwaarden vormt een **registerprofiel**. Het huidige Adlar Castra Aurora II profiel is het eerste:

```typescript
const ADLAR_AURORA2_PROFILE: RegisterCategoryConfig[] = [
  {
    id: 'reg_core_temps',
    settingsKey: 'reg_core_temps_enabled',
    enabled: true,
    locked: true,
    sensors: [
      { capabilityId: 'measure_temperature.ambient', snapshotKey: 'ambientT1',
        defaultAddress: 0x004A, address: 0x004A, signed: true, multiply: 0.1, unit: '°C' },
      { capabilityId: 'measure_temperature.inlet', snapshotKey: 'inletT6',
        defaultAddress: 0x004F, address: 0x004F, signed: true, multiply: 0.1, unit: '°C' },
      { capabilityId: 'measure_temperature.outlet', snapshotKey: 'outletT7',
        defaultAddress: 0x0050, address: 0x0050, signed: true, multiply: 0.1, unit: '°C' },
    ],
  },
  {
    id: 'reg_zones',
    settingsKey: 'reg_zones_enabled',
    enabled: false,
    locked: false,
    sensors: [
      { capabilityId: 'measure_temperature.buffer_tank', snapshotKey: 'bufferTankTemp',
        defaultAddress: 0x0074, address: 0x0074, signed: true, multiply: 0.1, unit: '°C' },
      { capabilityId: 'measure_temperature.total_outlet', snapshotKey: 'totalOutlet',
        defaultAddress: 0x0075, address: 0x0075, signed: true, multiply: 0.1, unit: '°C' },
      { capabilityId: 'measure_temperature.zone1_mix', snapshotKey: 'zone1MixTemp',
        defaultAddress: 0x007C, address: 0x007C, signed: true, multiply: 0.1, unit: '°C' },
      { capabilityId: 'measure_temperature.zone2', snapshotKey: 'zone2Temp',
        defaultAddress: 0x0073, address: 0x0073, signed: true, multiply: 0.1, unit: '°C' },
    ],
  },
  // ... overige categorieën
];
```

## 4. Runtime Gedrag

### 4.1 `onInit()` — Zichtbaarheid Toepassen

Bij device-initialisatie wordt de zichtbaarheid van capabilities ingesteld op basis van de settings:

```typescript
private async applySensorVisibility(): Promise<void> {
  const categories = this.buildCategoryConfig();

  for (const cat of categories) {
    for (const sensor of cat.sensors) {
      if (!this.hasCapability(sensor.capabilityId)) continue;

      if (cat.enabled && sensor.address > 0) {
        await this.setCapabilityOptions(sensor.capabilityId, {
          uiComponent: 'sensor',
        });
      } else {
        await this.setCapabilityOptions(sensor.capabilityId, {
          uiComponent: null,
        });
      }
    }
  }
}
```

### 4.2 `onSettings()` — Reageren op Wijzigingen

```typescript
const categoryKeys = changedKeys.filter(k => k.startsWith('reg_'));
if (categoryKeys.length > 0) {
  await this.applySensorVisibility();
}
```

### 4.3 `applyModbusSnapshot()` — Conditioneel Mappen

Verborgen sensors worden nog steeds gelezen (de poll-blokken zijn batched), maar niet naar capabilities geschreven:

```typescript
applyModbusSnapshot(snap: DataSnapshot): void {
  const categories = this.getCategoryConfig(); // cached bij init + settings change

  for (const cat of categories) {
    if (!cat.enabled) continue;
    for (const sensor of cat.sensors) {
      if (sensor.address === 0) continue;
      const value = snap.sensors[sensor.snapshotKey]?.value;
      if (value !== undefined) {
        set(sensor.capabilityId, value);
      }
    }
  }
}
```

## 5. Wat Bewust Niet Verandert

### 5.1 Poll-blokken Blijven Intact

De poll-blokken in `Adlar2ModbusService` lezen registers in batches (bijv. 0x0048–0x005D in één `readHoldingRegisters`-aanroep). Een individuele sensor weglaten bespaart niets op de bus en compliceert de poll-logica. De filtering gebeurt pas bij het schrijven naar capabilities.

### 5.2 Capabilities Worden Niet Dynamisch Toegevoegd/Verwijderd

We gebruiken `setCapabilityOptions({ uiComponent: null })` in plaats van `removeCapability()` / `addCapability()`. Dit voorkomt:

- Dangling event listeners
- Verlies van capability-state en Insights-historie
- Migratieproblemen bij app-updates

### 5.3 Hex-adressen Worden Niet aan Gebruikers Getoond

Homey settings hebben geen hex-input type. Decimaal tonen bij hex-documentatie is verwarrend. In strategie B is dit niet relevant; mocht strategie A later komen, dan met decimale weergave en een duidelijke label (bijv. "Buffervat temperatuur (standaard: 116)").

## 6. Gevolgen

### Positief

- Gebruikers zien alleen sensoren die relevant zijn voor hun installatie
- Minder verwarrende `0`-waarden in het dashboard
- Het interne `RegisterCategoryConfig` model bereidt voor op ADR-031 (driver-ontkoppeling) en toekomstige per-register override
- Registerprofiel-concept maakt multi-driver ondersteuning concreter

### Negatief

- 5 extra settings-groepen in de UI (totaal 9)
- `setCapabilityOptions` is duur — vereist zorgvuldig caching om niet bij elke restart alle capabilities te reconfigureren
- UI-update na toggle is soms niet instant (Homey-beperking)

## 7. Relatie met ADR-031

Het `RegisterCategoryConfig` / `RegisterSensorConfig` model uit deze ADR is een concrete invulling van het `ModbusDeviceProfile` concept uit ADR-031:

- ADR-031 beschrijft de **architectuurkeuze** om `ModbusConnectionService` te ontkoppelen via een factory
- ADR-032 beschrijft het **datamodel** waarmee een driver zijn registerset en sensor-mapping beschrijft
- De `ADLAR_AURORA2_PROFILE` constante is het eerste concrete profiel; een tweede driver zou een `XYZ_PROFILE` leveren met andere adressen, andere categorieën, of andere defaults

## 8. Toekomstige Uitbreiding: Per-Register Adres-Override (Strategie A)

Wanneer de behoefte ontstaat om individuele registeradressen aan te passen, kan dit worden toegevoegd door:

1. Per `RegisterSensorConfig` een settings-veld toe te voegen in `driver.settings.compose.json`
2. De `buildCategoryConfig()` methode uit te breiden om per-sensor overrides uit settings te lezen
3. De categorie-dropdown uit te breiden met een derde optie: `custom`

Het interne datamodel verandert niet — alleen de bron van het `address`-veld wijzigt van hardcoded default naar settings-waarde.

## 9. Acceptatiecriteria

1. Elke sensorcategorie (behalve kerntemperaturen) heeft een toggle in de device settings
2. Bij `off` zijn de capabilities verborgen via `uiComponent: null`
3. Bij `on` zijn de capabilities zichtbaar en worden ze gevuld met snapshot-data
4. Het togglen is persistent over device-restarts
5. De `RegisterCategoryConfig` / `RegisterSensorConfig` interfaces bestaan als geëxporteerde types
6. De hardcoded snapshot-mapping in `applyModbusSnapshot()` is vervangen door een profiel-gedreven mapping
7. COP-berekening blijft functioneel ongeacht categorie-settings (kerntemperaturen zijn locked)
