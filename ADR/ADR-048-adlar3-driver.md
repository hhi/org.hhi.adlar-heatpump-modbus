# ADR-048: Tweede driver — Adlar Aurora III Pro (aparte registerset)

**Status:** Voorstel
**Datum:** 2026-04-17
**Scope:** `org.hhi.adlar-heatpump-modbus` — nieuwe driver voor Adlar Aurora III Pro met afwijkende Modbus-registerset
**Gerelateerd:** ADR-044 (interactief dashboard), ADR-045 (Modbus flow cards), ADR-046 (expert dashboard)

---

## 1. Aanleiding

De Adlar Aurora III Pro gebruikt een fundamenteel andere Modbus-registerset dan de Adlar Castra / Aurora II:

- Sensoren zitten in **input registers** (FC04), niet in holding registers (FC03)
- Register-adressen liggen in een volledig ander adresbereik (38–79 voor sensoren, 2100–2107 voor instellingen)
- Statusbits zijn geconsolideerd in één bitfield-register (adres 38) in plaats van meerdere dedicated registers
- Silent mode is bit-packed in één holding register (adres 2103)
- Waterdebiet wordt uitgedrukt in m³/h in plaats van L/min

Beide warmtepompen delen dezelfde gateway-infrastructuur (Elfin EW11A of gelijkwaardig) en hetzelfde Modbus TCP transport.

---

## 2. Bekende Adlar III Pro registers

### 2.1 Input registers — FC04 (read-only sensoren)

| Adres | Naam | Type | Schaal | Eenheid |
|---|---|---|---|---|
| 38 | System status bits | uint16 | — | bitfield |
| 42 | Retour temperatuur | int16 | ×0.1 | °C |
| 43 | Aanvoer temperatuur | int16 | ×0.1 | °C |
| 50 | Buiten temperatuur | int16 | ×0.1 | °C |
| 61 | Waterdruk uitlaat | uint16 | ×0.1 | bar |
| 62 | PWM output | uint16 | ×1 | % |
| 64 | Waterdebiet | uint16 | ×0.1 | m³/h |
| 72 | Ventilatorsnelheid | uint16 | ×1 | RPM |
| 79 | Compressorfrequentie | uint16 | ×1 | Hz |

### 2.2 Holding registers — FC03/FC06 (lezen/schrijven)

| Adres | Naam | Type | Schaal | Schrijfbaar |
|---|---|---|---|---|
| 2100 | HVAC modus (heat=2, auto=4, cool=1) | uint16 | — | ✅ |
| 2103 | Silent mode (bits 4–5: 0=uit, 1=niveau1, 2=niveau2) | uint16 | — | ✅ |
| 2107 | Setpoint zone 1 verwarming | int16 | ×0.1 | ✅ |

### 2.3 Status bitfield — register 38

| Bit | Betekenis |
|---|---|
| 0 (0x0001) | Oil return actief |
| 1 (0x0002) | Defrost actief |
| 2 (0x0004) | Anti-freeze actief |
| 4 (0x0010) | Desinfectie actief |
| 11 (0x0800) | Buiten temperatuur te laag (compressor geblokkeerd) |

### 2.4 Silent mode codering — register 2103

Bits 4–5 bepalen het niveau. Lees/schrijf via mask: `(waarde // 16) % 4`.

| Bits 4–5 | Modus |
|---|---|
| 0 | Uit |
| 1 | Stil niveau 1 |
| 2 | Stil niveau 2 |

---

## 3. Analyse van aanpakken

### Optie A — Aparte driver, gedeelde transport-laag

Elke driver krijgt een volledig eigen device-specifieke laag (`*-modbus-registers.ts`, `*-modbus-service.ts`, `device.ts`). Alleen `modbus-tcp-service.ts` wordt gedeeld. Alle adaptive services zijn al driver-onafhankelijk omdat ze uitsluitend via `device.getCapabilityValue()` communiceren.

| | |
|---|---|
| ✅ | Drivers zijn volledig onafhankelijk — wijzigingen in Adlar III raken Adlar II niet |
| ✅ | Geen refactor van bestaande code vereist |
| ✅ | Makkelijk te begrijpen: één driver = één registermap = één snapshot-type |
| ✅ | Adlar III kan eigen FC04-gebruik, bitfield-logica en eenheden volledig zelfstandig implementeren |
| ✅ | Toekomstige drivers (Adlar IV, ander merk) volgen hetzelfde patroon zonder historische abstractielaag |
| ❌ | Duplicatie van structureel vergelijkbare code (pollgroep-opbouw, snapshot-publicatie, service-coordinator boilerplate) |
| ❌ | Bug in gedeelde patronen (bijv. reconnect-afhandeling) moet op twee plaatsen worden opgelost |
| ❌ | Dashboard-service moet per driver worden geconfigureerd |

### Optie B — Gedeelde `DataSnapshot` interface, twee concrete implementaties

`DataSnapshot` wordt omgezet naar een gemeenschappelijke interface (of union type). `ServiceCoordinator` en `ModbusConnectionService` werken tegen die interface. Elke driver levert een eigen implementatie van `IModbusService` die de interface vult.

| | |
|---|---|
| ✅ | `ServiceCoordinator`, `ModbusConnectionService` en `DashboardService` hoeven niet geforkt te worden |
| ✅ | Nieuwe driver hoeft alleen registers + service + `applyModbusSnapshot()` te implementeren |
| ✅ | Dashboard kan generiek over capabilities werken als de interface dat ondersteunt |
| ❌ | Vereist refactor van de bestaande `DataSnapshot`-structuur en alle consumers (`service-coordinator.ts`, `dashboard-service.ts`, `snapshot-trigger-service.ts`) |
| ❌ | De twee snapshot-structuren zijn fundamenteel anders (Adlar II heeft ~10 sub-interfaces; Adlar III heeft een plattere structuur) — een zinvolle gemeenschappelijke interface is moeilijk te definiëren zonder kunstmatige velden |
| ❌ | Verhoogt koppeling: een wijziging in de interface-definitie raakt beide drivers |
| ❌ | Hogere abstractie maakt de code moeilijker te volgen voor iemand die één driver wil begrijpen |

### Optie C — Overerving: basisklasse `device.ts`, override per driver

Een abstracte basisklasse bevat de gedeelde coordinator-lifecycle, capability-listeners en instellingen. Elke driver erft en overschrijft alleen `applyModbusSnapshot()` en de service-factory.

| | |
|---|---|
| ✅ | Minste code-duplicatie in `device.ts` |
| ✅ | Coordinator-lifecycle en fout-afhandeling zijn op één plek gedefinieerd |
| ✅ | Goed als de twee drivers grotendeels dezelfde capabilities en instellingen delen |
| ❌ | TypeScript-overerving werkt slecht met Homey SDK `Homey.Device` als basisklasse — de SDK verwacht `module.exports = class extends Homey.Device` per driver |
| ❌ | Snapshot-types blijven divergeren; cast of overloading nodig in de basisklasse |
| ❌ | Koppelt de twee drivers aan een gezamenlijke basisklasse — refactors in de ene driver drukken door op de andere |
| ❌ | Verbergt welke capabilities en settings een specifieke driver heeft |

---

## 4. Beslissing

### 4.1 Gekozen aanpak: Optie A — aparte driver, gedeelde transport-laag

De nieuwe driver krijgt een volledig eigen device-specifieke laag. De protocol-agnostische transport-laag (`modbus-tcp-service.ts`) wordt gedeeld. Alle adaptive services werken al via `device.getCapabilityValue()` en zijn daarmee van nature driver-onafhankelijk.

**Motivatie:**

- Registersets wijken fundamenteel af — niet alleen qua adressen maar ook qua protocol (FC04 vs. FC03) en codering (bitfields, bit-packed settings). Een zinvolle gemeenschappelijke `DataSnapshot` interface is daardoor moeilijk te definiëren.
- De bestaande driver hoeft niet aangeraakt te worden — nul risico op regressie voor bestaande gebruikers.
- Twee concrete implementaties zijn beter uitlegbaar en onafhankelijk te onderhouden dan een gedeelde abstractie die beide registersets moet accommoderen.

### 4.2 Nieuwe bestanden per driver

| Bestand | Scope |
|---|---|
| `lib/modbus/adlar3-modbus-registers.ts` | Register-adressen, schaalfactoren, pollgroepen, bitfield-helpers |
| `lib/modbus/adlar3-modbus-service.ts` | FC04 poll, bitfield-decode, m³/h→L/min conversie, `DataSnapshot`-equivalent |
| `drivers/adlar3-heatpump-modbus/driver.ts` | Pairing, exclusiviteitsguard, device-aanmaak |
| `drivers/adlar3-heatpump-modbus/device.ts` | Capability-mapping, `onInit`, `onSettings` |
| `drivers/adlar3-heatpump-modbus/driver.compose.json` | Capabilities, pairing |
| `drivers/adlar3-heatpump-modbus/driver.settings.compose.json` | Device-instellingen |

### 4.3 Bewuste parallellen tussen beide drivers

Optie A betekent niet dat de twee drivers willekeurig uit elkaar mogen groeien. De parallel moet bewust worden gezocht op **contracten, lifecycle en naming**, niet op een geforceerd gedeeld datamodel.

#### Parallel te houden

| Onderdeel | Richtlijn |
|---|---|
| `driver.ts` | Zelfde pairingstructuur, zelfde validatiestijl, zelfde exclusiviteitsguard, zelfde basis-settings |
| Device lifecycle | Zelfde opbouw van `onInit`, `onSettings`, restart bij gewijzigde verbindingssettings, cleanup in `onUninit` / `onDeleted` |
| Runtime-contract | Beide drivers implementeren hetzelfde `ModbusRuntimeService<TSnapshot>` contract en gebruiken `ModbusConnectionService<TSnapshot>` |
| Settings-contract | Zelfde settings keys voor host, port, unit-id, pollintervallen en logniveau |
| Capability-taxonomie | Zelfde capability IDs waar de semantiek werkelijk gelijk is, bijvoorbeeld `onoff`, temperatuurmetingen, compressorstatus, defroststatus |
| Diagnostiek | Zelfde semantiek voor connection quality, beschikbaar/unavailable gedrag, reconnect en logging |
| Registermetadata-stijl | Zelfde vorm voor registerdefinities: adres, registertype, schaalfactor, signed/unsigned, unit, pollgroep, bitmasks |
| Externe inputs | Zelfde paden voor externe flow, externe power en energieprijzen zolang de capability-sematiek gelijk blijft |

#### Bewust driver-specifiek te houden

| Onderdeel | Waarom niet forceren |
|---|---|
| Snapshot-structuur | Aurora II en III hebben inhoudelijk verschillende registersets; een kunstmatig gedeeld `DataSnapshot` verhoogt koppeling |
| Registermapping | Adressen, function codes, bitfields en schaalfactoren verschillen wezenlijk |
| Dashboard-data | Het huidige dashboard is Aurora II-specifiek in server én HTML; gelijktrekken zou een aparte refactor zijn |
| Write-surface | Alleen parallel houden waar de functie ook echt op beide apparaten bestaat; geen schijnpariteit voor DHW-, curve- of mode-features |
| Triggerlogica op snapshots | Huidige triggerdetectie leunt op Aurora II-sensorkeys; parallelisering kan pas na expliciete normalisatie |

#### Vuistregel

Parallel trekken we dus vooral in:

- lifecycle
- interfaces
- settings
- capability IDs
- fout- en diagnostiekgedrag

Niet in:

- snapshotvorm
- dashboardmodel
- registerlayout
- apparaat-specifieke write-operaties

### 4.4 Transport-laag uitbreiding: FC04

`modbus-tcp-service.ts` ondersteunt momenteel FC03, FC05 en FC06. Voor de Adlar III moeten sensoren via **FC04** (Read Input Registers) worden uitgelezen. Dit vereist:

- Toevoeging van een `readInputRegisters(address, count)` methode naast de bestaande `readHoldingRegisters()`
- De pollgroep-definitie in `adlar3-modbus-registers.ts` onderscheidt `holding` en `input` registerblokken

**Risico:** `modbus-tcp-service.ts` is gedeelde code. Na de FC04-uitbreiding moet de bestaande Adlar II-integratie handmatig worden geverifieerd (FC03-paden ongewijzigd, reconnect-logica intact).

### 4.5 `DataSnapshot`-equivalent voor Adlar III

De nieuwe service definieert een eigen snapshot-interface (`Adlar3DataSnapshot`) met de velden die beschikbaar zijn voor dit apparaat. `device.ts` van de Adlar III driver implementeert `applyModbusSnapshot(snap: Adlar3DataSnapshot)` en mapt naar Homey capabilities.

Minimale veldset op basis van §2.1 en §2.2:

| Veld | Bron | Type |
|---|---|---|
| `returnTemp` | reg 42 | `number` (°C) |
| `supplyTemp` | reg 43 | `number` (°C) |
| `outsideTemp` | reg 50 | `number` (°C) |
| `waterPressure` | reg 61 | `number` (bar) |
| `pwmOutput` | reg 62 | `number` (%) |
| `waterFlow` | reg 64 | `number` (m³/h) |
| `fanSpeed` | reg 72 | `number` (RPM) |
| `compressorFrequency` | reg 79 | `number` (Hz) |
| `hvacMode` | reg 2100 | `number` |
| `silentMode` | reg 2103 bits 4–5 | `0 \| 1 \| 2` |
| `heatingSetpoint` | reg 2107 | `number` (°C) |
| `statusBits` | reg 38 | `number` (bitfield) |
| `isDefrost` | reg 38 bit 1 | `boolean` |
| `isAntiFrost` | reg 38 bit 2 | `boolean` |
| `isTempTooLow` | reg 38 bit 11 | `boolean` |

### 4.6 Register-naar-capability transformaties

De exacte schaalfactoren en coderingen van Adlar III-registers zijn nog niet volledig gedocumenteerd. Bij de implementatie moet voor elk register worden vastgesteld:

- **Schaalfactor** — bijv. raw `520` → `52.0 °C` (×0.1), of raw `52` → `52 °C` (×1). Dit verschilt mogelijk per registertype en moet worden afgeleid uit de Adlar III-specificaties of via meting.
- **Signed vs. unsigned** — buitentemperatuur en andere waarden die negatief kunnen zijn vereisen `s16()`-interpretatie; de meeste statusregisters zijn `u16()`.
- **Bitfields** — meerdere waarden in één register (zie register 38 en 2103). De maskers en bit-posities horen thuis in `adlar3-modbus-registers.ts` als constanten.
- **Omgekeerde transformatie bij schrijven** — setpoints die als `×0.1` worden opgeslagen vereisen `Math.round(value * 10)` vóór schrijven naar het register.

`adlar3-modbus-registers.ts` legt per register minimaal vast: adres, schaalfactor (`multiply`), signed/unsigned, en eventuele bit-definities. `adlar3-modbus-service.ts` past de transformatie toe bij het bouwen van de snapshot en keert hem om bij schrijfoperaties.

### 4.7 Gedeelde services — geen aanpassingen nodig


De volgende services werken zonder wijziging voor de nieuwe driver omdat ze uitsluitend via `device.getCapabilityValue()` en `device.getSetting()` communiceren:

- `adaptive-control-service.ts`
- `performance-report-service.ts`
- `energy-tracking-service.ts`
- `flow-card-manager-service.ts`
- `capability-health-service.ts`
- `cop-calculator.ts`, `rolling-cop-calculator.ts`

### 4.8 Dashboard

#### Huidige koppeling

De dashboards zijn nu op drie niveaus hard gekoppeld aan Adlar II:

1. **`dashboard-service.ts` importeert Adlar II-specifieke code rechtstreeks** — `DataSnapshot` uit `adlar2-modbus-service.ts` én 20+ register-metadata symbolen (`STATUS_REGISTER_MAP`, `SENSOR_REGISTERS`, `CONTROL_REGISTERS`, ...) uit `adlar-modbus-registers.ts`. Het expert-dashboard bouwt zijn register-overzicht volledig op basis van deze imports.

2. **`app.ts` heeft één globale `DashboardService`-instantie** — beide drivers zouden via `app.dashboard?.setSnapshot()` pushen, maar de snapshot-structuur is per driver anders. De Adlar III kent geen `StatusSnapshot`, `ControlSnapshot` etc. in de Adlar II-indeling.

3. **`device.ts` koppelt write/read-callbacks aan de coordinator** — `setWriteRegisterCallback`, `setReadRegisterCallback` en `setWriteExpertCallback` zijn aan de Adlar II coordinator gebonden. Een tweede actief device zou de callbacks overschrijven.

#### Alternatieven

| Aanpak | Beschrijving | Voordeel | Nadeel |
|---|---|---|---|
| **D1 — Twee aparte dashboard-instanties** | Aparte `DashboardService` per driver op een eigen poort (bijv. 8090 voor Adlar II, 8091 voor Adlar III). Elke instantie importeert zijn eigen register-metadata. | Geen wijziging in bestaande `DashboardService` | Twee URL's; `app.ts` moet per actieve driver een instantie beheren |
| **D2 — Generieke `DashboardService`, metadata geïnjecteerd** | `DashboardService` importeert geen register-metadata meer. Snapshot-type, register-metadata en schrijfbare registers worden bij instantiatie geïnjecteerd door de driver. | Éénmalige refactor; daarna volledig driver-onafhankelijk; één poort en één URL-structuur | Substantiële refactor: `DashboardService` heeft nu 20+ hardcoded imports uit `adlar-modbus-registers.ts` en `adlar2-modbus-service.ts`; ontkoppeling raakt de volledige service inclusief HTML-templates |
| **D3 — Adlar III zonder expert-dashboard** | Adlar III-driver serveert alleen een read-only snapshot via `/api/snapshot`. Geen expert- of interactief dashboard in eerste versie. | Minimale inspanning | Feature-ongelijkheid tussen drivers; interactief schrijven van setpoints ontbreekt |

#### Beslissing

**Aanpak D2** — `DashboardService` wordt generiek via constructor-injectie. Dit sluit aan bij de separatie van optie A: elke driver beheert zijn eigen register-metadata en snapshot-structuur, en de `DashboardService` is daar onkundig van.

Concrete wijzigingen:

- `DashboardService` vervangt de hardcoded imports door twee geïnjecteerde parameters:
  - `registerMetadata` — het register-overzicht voor het expert-dashboard (type-definitie geëxporteerd uit `dashboard-service.ts`)
  - `writableRegisters` — de whitelist voor het interactieve dashboard
- De `setSnapshot()`-methode accepteert `unknown` (of een minimale interface met alleen de velden die het basis-dashboard gebruikt); het type-specifieke renderen verhuist naar de HTML-template via de JSON-serialisatie
- `app.ts` behoudt één `DashboardService`-instantie; de actieve driver registreert zijn metadata bij opstart via een nieuwe methode `app.dashboard?.configure(metadata, writableRegisters)`
- Write/read-callbacks blijven per driver gebonden — de laatste geregistreerde driver wint. Dit is alleen acceptabel in combinatie met de exclusiviteitsregel uit §4.9. Zonder die guard zou stille callback-overschrijving onaanvaardbaar zijn.

### 4.9 Driver-exclusiviteit en pairingbeleid

Omdat `app.ts` één globale `DashboardService`-instantie heeft en dashboard-callbacks app-breed worden geregistreerd, kiest dit ADR expliciet voor **wederzijdse exclusiviteit** tussen de Aurora II- en Aurora III-driver.

**Beslissing:**

- Op één Homey mag slechts één van beide driverfamilies actief zijn: óf `intelligent-heatpump-modbus` óf `adlar3-heatpump-modbus`
- Deze regel wordt afgedwongen tijdens pairing in beide drivers (`driver.ts`)
- Als er al een device van driver A bestaat, faalt pairing van driver B met een duidelijke foutmelding; hetzelfde geldt omgekeerd
- Homey biedt geen runtime-mechanisme om een driver conditioneel uit de "voeg apparaat toe"-lijst te verwijderen; handhaving gebeurt daarom via een pairing-guard, niet via manifestconfiguratie

**Concrete implementatie:**

De check vindt plaats aan het begin van de `list_devices`-handler, vóórdat er een device-object wordt teruggegeven. De Homey SDK biedt `this.homey.drivers.getDriver(driverId)` waarmee een driver zijn tegenpartij kan opvragen; `.getDevices()` geeft de lijst van gekoppelde devices terug.

Patroon in `drivers/intelligent-heatpump-modbus/driver.ts`:

```typescript
session.setHandler('list_devices', async () => {
  const adlar3Driver = this.homey.drivers.getDriver('adlar3-heatpump-modbus');
  if (adlar3Driver && adlar3Driver.getDevices().length > 0) {
    throw new Error(this.homey.__('errors.exclusivity_adlar3_active'));
  }
  // ... rest van list_devices
});
```

Patroon in `drivers/adlar3-heatpump-modbus/driver.ts` (spiegelbeeldig):

```typescript
session.setHandler('list_devices', async () => {
  const adlar2Driver = this.homey.drivers.getDriver('intelligent-heatpump-modbus');
  if (adlar2Driver && adlar2Driver.getDevices().length > 0) {
    throw new Error(this.homey.__('errors.exclusivity_adlar2_active'));
  }
  // ... rest van list_devices
});
```

De foutsleutels `errors.exclusivity_adlar3_active` en `errors.exclusivity_adlar2_active` worden toegevoegd aan `locales/en.json` en `locales/nl.json` met een gebruiksvriendelijke melding die aangeeft welke driver al actief is en dat de bestaande koppeling eerst verwijderd moet worden.

**Motivatie:**

- voorkomt stille overschrijving van dashboard snapshot-bron en read/write-callbacks
- houdt fase 1 van de tweede driver beperkt zonder directe multi-driver refactor van `app.ts` en `dashboard-service.ts`
- maakt het tijdelijke single-dashboardmodel verdedigbaar totdat een device-scoped dashboardarchitectuur bestaat

**Afgrenzing:**

- Deze exclusiviteitsregel gaat over **Aurora II versus Aurora III**
- Dit ADR introduceert hiermee geen generiek multi-device model
- Als later meerdere devices binnen dezelfde driver ondersteund moeten worden, moet de dashboard- en callbackregistratie alsnog device-scoped worden gemaakt

### 4.10 Capability overlap

De Adlar III deelt een groot deel van de Homey capability-namen met de Adlar II (temperaturen, setpoints, compressorstatus). Capability-definitiebestanden in `.homeycompose/capabilities/` worden gedeeld. Adlar III-specifieke capabilities (bijv. waterdruk, PWM-percentage) krijgen een eigen definitie.

---

## 5. Scopegrenzen

Dit ADR dekt:

1. Analyse van drie architectuuralternatieven met voor- en nadelen
2. Architectuurbeslissing voor de tweede driver (optie A)
3. Registermap zoals bekend uit de HA-configuratie
4. Verdeling van nieuwe vs. gedeelde bestanden
5. Ontwerpregels voor wat parallel wordt gehouden tussen beide drivers
6. Transportlaag-uitbreiding (FC04)
7. Wederzijdse exclusiviteitsregel tussen Aurora II- en Aurora III-driver

Dit ADR dekt **niet**:

1. Volledigheid van de Adlar III registermap — er zijn vermoedelijk meer registers (tapwater, koeling, foutregisters, curven). Nader onderzoek vereist voor een volledige implementatie.
2. Concrete capability-set van de nieuwe driver
3. Detailuitwerking van pairing-UX en driver-instellingen, behalve de exclusiviteitsregel uit §4.9

---

## 6. Openstaande vragen

| Vraag | Impact |
|---|---|
| Zijn er tapwater- en koelingssetpoints op de Adlar III? | Capability-set nieuwe driver |
| Zijn er dedicated foutregisters naast de statusbits? | Fault-reporting volledigheid |
| Wat is het Modbus slave-adres (default 1)? | Configuratie gateway |
| Zijn er firmware/protocolversie-registers? | Compatibiliteitsbewaking |
| Ondersteunt de Adlar III meerdere zones? | Setpoint-mapping |

---

## 7. Relevante bestanden

| Onderdeel | Bestand |
|---|---|
| Transport (gedeeld) | `lib/modbus/modbus-tcp-service.ts` |
| Adlar II registers (referentie) | `lib/modbus/adlar-modbus-registers.ts` |
| Adlar II service (referentie) | `lib/modbus/adlar2-modbus-service.ts` |
| Huidige driver pairing | `drivers/intelligent-heatpump-modbus/driver.ts` |
| Adlar III specs | `docs/Heatpump specs/modbus/Adlar III/ha-modbus-regs.txt` |
| Nieuwe driver pairing (te maken) | `drivers/adlar3-heatpump-modbus/driver.ts` |
| Nieuwe registers (te maken) | `lib/modbus/adlar3-modbus-registers.ts` |
| Nieuwe service (te maken) | `lib/modbus/adlar3-modbus-service.ts` |
