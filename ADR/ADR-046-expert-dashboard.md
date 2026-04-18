ADR-046: Expert Dashboard — Volledig Registeroverzicht met Lees- en Schrijftoegang
Status: Voorstel
Datum: 2026-04-15
Gerelateerd: ADR-041 Dashboard Server, ADR-044 Interactief Dashboard, ADR-045 Flow Cards Modbus Lees/Schrijf

---

## 1. Probleem

ADR-044 biedt een interactief dashboard voor de vijf meest gangbare gebruikerssetpoints. Voor diagnose, inbedrijfstelling en geavanceerde configuratie is een breder instrument nodig: een overzicht van alle registers die in `adlar-modbus-registers.ts` zijn gedocumenteerd, gegroepeerd per blok, met live lees- én schrijftoegang vanuit de browser.

Het doelpubliek is een technisch expert (installateur, ontwikkelaar) die:
- de volledige registerinhoud wil inspecteren zonder Modbus-tooling te installeren
- incidenteel een P- of L-parameter wil aanpassen zonder de Homey-app te openen
- serviceregisters en foutbitmasks wil uitlezen bij diagnose

---

## 2. Registerblokken in scope

| # | Constante | Adresbereik | R/W | Bijzonderheden |
|---|---|---|---|---|
| 1 | `STATUS_REGISTER_MAP` | 0x0000–0x0028 | Read-Only | Bitmask-registers; bits worden individueel getoond |
| 2 | `SENSOR_REGISTERS` | 0x0040–0x00FF | Read-Only | Multiply 0.1 voor temperaturen, 0.01 voor stroom/vermogen |
| 3 | `CONTROL_REGISTERS` | 0x0300–0x0319 | Read-Write | Gebruikerssetpoints; multiply 0.1 voor temperaturen |
| 4 | `P_PARAMETERS` | 0x0100–0x020B | Read-Write | 91 parameters; min/max/default in metadata |
| 5 | `L_PARAMETERS` | 0x0800–0x0819 | Read-Write | 27 parameters; sommige serviceOnly |
| 6 | `COIL_ADDRESSES` | 0x1000–0x1023 | Read-Write (FC05) | Boolean; lezen via FC01, schrijven via FC05 |
| 7 | `USER_COMMANDS_REGISTERS` | 0x0330–0x0345 | Read-Write | Bitmask en numeriek gemengd; sommige serviceOnly |
| 8 | `VERSION_REGISTERS` | 0x0360–0x0363 | Read-Only | Firmware, protocol, product type |

---

## 3. Beslissing

Een nieuw zelfstandig HTML-bestand `public/dashboard-expert.html` (vanilla HTML/JS, geen build-stap) dat:

1. Registermetadata laadt via `GET /api/registers` — een statisch endpoint dat de geserialiseerde inhoud van `adlar-modbus-registers.ts` retourneert
2. Live registerwaarden ophaalt via `POST /api/expert/read` (per register on-demand)
3. Schrijfacties uitvoert via `POST /api/expert/write` — uitsluitend na bevestiging in een popup
4. De registers per blok toont in een uitklapbare sectie (accordion)

---

## 4. Gedetailleerd ontwerp

### 4.1 Nieuwe HTTP-routes in DashboardService

```
GET  /expert                 → public/dashboard-expert.html
GET  /expert.html            → zelfde
GET  /api/registers          → geserialiseerde registermetadata (statisch, geen Modbus-call)
POST /api/expert/read        → lees één register live via Modbus
POST /api/expert/write       → schrijf één register via Modbus (hergebruik én uitbreiding van ADR-044)
```

De bestaande `POST /api/write` uit ADR-044 blijft intact; het expert-write-endpoint is een apart pad dat ook coils ondersteunt.

---

### 4.2 GET /api/registers

Retourneert een JSON-structuur met alle blokken en hun registers. De server genereert dit éénmalig bij start door de geëxporteerde constanten uit `adlar-modbus-registers.ts` te importeren en te serialiseren.

```typescript
interface RegisterMeta {
  key: string;           // bijv. "tempSetHeating"
  address: number;       // decimaal
  name: string;
  unit?: string;
  multiply?: number;     // default 1
  min?: number;
  max?: number;
  default?: number;
  desc?: string;
  isCoil?: boolean;      // FC01/FC05 i.p.v. FC03/FC06
  serviceOnly?: boolean; // visuele markering + extra waarschuwing
  readOnly?: boolean;    // blokken 1, 2, 8
  bits?: Record<string, number>; // bitmask registers (blok 1)
}

interface RegisterBlock {
  id: string;            // bijv. "blok3_control"
  label: string;         // bijv. "Blok 3 — User Control (0x0300–0x0319)"
  readOnly: boolean;
  registers: RegisterMeta[];
}

// Response: RegisterBlock[]
```

Dit endpoint maakt geen Modbus-verbinding. Het retourneert altijd 200 zolang de server draait.

---

### 4.3 POST /api/expert/read

Leest één register live via Modbus (FC03 voor holding registers, FC01 voor coils).

Requestbody:
```json
{ "address": 769, "isCoil": false }
```

Responsformaat:
```json
{ "ok": true, "rawValue": 450, "scaledValue": 45.0 }
```

of bij fout (geen verbinding, time-out):
```json
{ "ok": false, "error": "Geen actieve Modbus-verbinding" }
```

- `scaledValue` = `rawValue × multiply` (multiply uit de metadata, default 1)
- Voor coils: `rawValue` is 0 of 1; `scaledValue` is gelijk aan `rawValue`
- De callback `onReadRegister` wordt toegevoegd aan `DashboardServiceOptions` (zie §4.7)

---

### 4.4 POST /api/expert/write

Schrijft één register via Modbus. Ondersteunt holding registers (FC06) én coils (FC05).

Requestbody:
```json
{ "address": 769, "rawValue": 450, "isCoil": false }
```

- `rawValue` is altijd de **ruwe registerwaarde** — geen automatische schaling
- Voor coils: `rawValue` is 0 (false) of 1 (true)
- Validatie: adres 0–0xFFFF, rawValue 0–65535 (voor registers) of 0–1 (voor coils)
- Geen whitelist — het expert-dashboard heeft bewust toegang tot alle registers

Responsformaat: identiek aan `POST /api/write` uit ADR-044:
```json
{ "ok": true }
```
of:
```json
{ "ok": false, "error": "..." }
```

---

### 4.5 UI-structuur van dashboard-expert.html

#### Algemene layout

```
┌─────────────────────────────────────────────────────┐
│  Expert Dashboard — Adlar Castra / Aurora II        │
│  Verbindingsstatus: ● Verbonden  [Ververs alles]    │
├─────────────────────────────────────────────────────┤
│  [▼] Blok 1 — Status & Fault (0x0000–0x0028) [R]  │
│  [▶] Blok 2 — Sensoren (0x0040–0x00FF) [R]        │
│  [▶] Blok 3 — User Control (0x0300–0x0319) [R/W]  │
│  [▶] Blok 4 — P-Parameters (0x0100–0x020B) [R/W]  │
│  [▶] Blok 5 — L-Parameters (0x0800–0x0819) [R/W]  │
│  [▶] Blok 6 — Coils (0x1000–0x1023) [R/W]        │
│  [▶] Blok 7 — User Commands (0x0330–0x0345) [R/W] │
│  [▶] Blok 8 — Versie Info (0x0360–0x0363) [R]     │
└─────────────────────────────────────────────────────┘
```

Accordions zijn standaard ingeklapt. Uitklappen triggert automatisch een bulk-read van het blok.

#### Kolomstructuur per register (expanded blok)

| Adres | Naam | Ruw | Geschaald | Eenheid | Bereik | Actie |
|---|---|---|---|---|---|---|
| 0x0301 | Heating Set Temperature | 450 | 45.0 | °C | 15–60 | [✏ Schrijf] |
| 0x0305 | On/Off | 1 | 1 | — | 0–1 | [✏ Schrijf] |
| 0x1000 | Powerful Mode | 0 | false | — | bool | [✏ Schrijf] |

- **Adres**: altijd in hex, bijv. `0x0301`
- **Ruw**: decimale registerwaarde zoals uit FC03 ontvangen
- **Geschaald**: `ruw × multiply`, afgerond op 1 decimaal
- **Bereik**: `min–max` als aanwezig; "bool" voor coils; "—" als onbekend
- **Actie**: alleen voor beschrijfbare registers; voor read-only: leeg
- **[⟳ Ververs]**: per rij, haalt live waarde op via `POST /api/expert/read`

#### Bitmask-registers (Blok 1)

Bitmask-registers (STATUS_REGISTER_MAP) tonen de ruwe waarde én een uitklap met de individuele bits als boolean vlaggen:

```
0x0000  Status 1  [ruw: 0x0042]  [▼ bits]
  ├─ Bit1 HEAT_MODE      ●  aan
  ├─ Bit6 COMPRESSOR_ON  ●  aan
  └─ Bit0 POWER_ON       ○  uit
```

#### serviceOnly-registers

Registers met `serviceOnly: true` zijn visueel onderscheiden met een oranje achtergrondkleur en een waarschuwingstekst in het schrijf-popup. Ze zijn niet verborgen.

---

### 4.6 Popup voor schrijfacties

De popup verschijnt na het klikken op `[✏ Schrijf]` van een beschrijfbaar register. Het is een `<dialog>`-element (native HTML5, geen externe library).

**Regulier register (FC06):**
```
┌─────────────────────────────────────────┐
│ Schrijf naar Heating Set Temperature    │
│ Adres: 0x0301  ·  Eenheid: °C          │
│                                         │
│ Huidige waarde: 45.0 °C  (ruw: 450)    │
│                                         │
│ Nieuwe waarde (°C):  [____45.0___]      │
│ → Ruwe registerwaarde: 450             │
│ Bereik: 15–60 °C                       │
│                                         │
│              [Annuleren]  [OK Schrijven]│
└─────────────────────────────────────────┘
```

- Invoer in **geschaalde eenheden** (°C, Hz, etc.) — de popup converteert naar ruw vóór het versturen
- Ruwe registerwaarde wordt live getoond terwijl de gebruiker typt (`ruw = Math.round(input / multiply)`)
- Validatie op min/max vóór activering van OK-knop

**Coil-register (FC05):**
```
┌─────────────────────────────────────────┐
│ Schrijf naar Powerful Mode              │
│ Adres: 0x1000  ·  Type: Coil (FC05)    │
│                                         │
│ Huidige waarde: ○ Uit                  │
│                                         │
│  ● Aan    ○ Uit                        │
│                                         │
│              [Annuleren]  [OK Schrijven]│
└─────────────────────────────────────────┘
```

**serviceOnly-register — extra waarschuwing:**
```
┌─────────────────────────────────────────┐
│ ⚠ Service-only Register                │
│ Compressor 1 forced freq               │
│ Adres: 0x0332  ·  Eenheid: Hz         │
│                                         │
│ Dit register is uitsluitend bedoeld     │
│ voor servicemonteurs. Ongeldige waarden │
│ kunnen de warmtepomp beschadigen.       │
│                                         │
│ Huidige waarde: 0  (0 Hz)             │
│ Nieuwe waarde (Hz): [________]          │
│ Bereik: 0–120 Hz                       │
│                                         │
│              [Annuleren]  [OK Schrijven]│
└─────────────────────────────────────────┘
```

Na een geslaagde schrijfactie:
1. Popup sluit
2. Na 1,5 seconden wordt de betreffende rij automatisch ververst (`POST /api/expert/read`)
3. De bijgewerkte waarde wordt visueel gehighlight (groene flash)

---

### 4.7 Callback-architectuur

`DashboardService` wordt uitgebreid met twee callbacks:

```typescript
export interface DashboardServiceOptions {
  appDir: string;
  logger: (msg: string, ...args: unknown[]) => void;
  port?: number;
  onWriteRegister?: (address: number, rawValue: number) => Promise<void>;      // ADR-044
  onReadRegister?: (address: number, isCoil: boolean) => Promise<number>;      // ADR-046 nieuw
  onWriteExpert?: (address: number, rawValue: number, isCoil: boolean) => Promise<void>; // ADR-046 nieuw
}
```

- `onReadRegister`: voor `POST /api/expert/read`
- `onWriteExpert`: voor `POST /api/expert/write` — apart van `onWriteRegister` (ADR-044) zodat de schrijf-whitelist van ADR-044 intact blijft

De callbacks worden geïmplementeerd in `app.ts` en verwijzen naar `Adlar2ModbusService`:

```typescript
onReadRegister: async (addr, isCoil) =>
  isCoil
    ? this.modbusService.readCoil(addr)
    : this.modbusService.readRegister(addr),

onWriteExpert: async (addr, rawValue, isCoil) =>
  isCoil
    ? this.modbusService.writeCoil(addr, rawValue === 1)
    : this.modbusService.writeRegister(addr, rawValue),
```

`readCoil()` bestaat nog niet in `Adlar2ModbusService`; deze methode moet worden toegevoegd:

```typescript
async readCoil(addr: number): Promise<number> {
  await this.tcp.readCoils(addr, 1);
  return this.tcp.getBit(addr, 0) ? 1 : 0;
}
```

---

### 4.8 Metadata-generatie voor /api/registers

Een hulpfunctie in `dashboard-service.ts` bouwt de `RegisterBlock[]`-structuur eenmalig bij het aanmaken van de service:

```typescript
import {
  STATUS_REGISTER_MAP, SENSOR_REGISTERS,
  CONTROL_REGISTERS, P_PARAMETERS, L_PARAMETERS,
  COIL_ADDRESSES, USER_COMMANDS_REGISTERS, VERSION_REGISTERS,
} from '../modbus/adlar-modbus-registers';

function buildRegisterBlocks(): RegisterBlock[] { ... }
```

De functie itereert over de bekende exportconstanten en serialiseert elk register naar `RegisterMeta`. Bitmask-velden (`bits`) worden meegenomen zodat de UI afzonderlijke bits kan tonen.

Het resultaat wordt gecached als `private readonly registerBlocksJson: string` op de service-instantie; `/api/registers` retourneert dit zonder verdere verwerking.

---

## 5. Overwogen alternatieven

### Alternatief A — Registermetadata inbakken in dashboard-expert.html

Voordeel: geen extra API-endpoint; het HTML-bestand is zelfstandig.

Nadeel: de metadata is ~200KB als inline JSON. Het bestand wordt groot en moeilijk te onderhouden bij registerwijzigingen. De metadata zou handmatig worden gesynchroniseerd met `adlar-modbus-registers.ts`.

**Afgewezen** — `/api/registers` houdt metadata en weergave automatisch gesynchroniseerd.

### Alternatief B — Bulk-read van een heel adresbereik in één FC03-call

Voordeel: minder round-trips bij het openen van een blok.

Nadeel: P-parameters beslaan 0x0100–0x020B (268 adressen). Veel apparaten hebben een maximale leeslengte van 125 registers per FC03-call. Meerdere calls zouden nodig zijn, en de UI zou data ontvangen voor adressen die niet in de metadata zitten (reserveregisters).

**Gedeeltelijk afgewezen** — per blok een bulk-read is mogelijk voor compacte blokken (blok 3, 6, 7, 8), maar voor blok 4 (P-params) worden individuele reads on-demand gedaan om time-outs te vermijden. Dit wordt uitgewerkt in de implementatie.

### Alternatief C — WebSocket voor live push van alle registerwaarden

Zie ook ADR-044 §4.2. De polling-frequentie van de Modbus-driver (10–60s) maakt live push niet zinvol. On-demand reads via POST zijn ruimschoots voldoende.

**Afgewezen.**

### Alternatief D — Inline schrijven zonder popup (inline invoerveld per rij)

Voordeel: minder klikken.

Nadeel: geen bevestigingsstap. Bij een mistype wordt een waarde direct naar de warmtepomp geschreven. Dit is onacceptabel voor serviceregisters en onwenselijk voor gebruikerssetpoints.

**Afgewezen** — popup is verplicht per de probleemstelling.

---

## 6. Concrete wijzigingen

| Bestand | Wijziging |
|---|---|
| `public/dashboard-expert.html` | Nieuw — expert dashboard (vanilla HTML/JS) |
| `lib/services/dashboard-service.ts` | Routes `GET /expert`, `GET /api/registers`, `POST /api/expert/read`, `POST /api/expert/write`; callbacks `onReadRegister` + `onWriteExpert`; `buildRegisterBlocks()` helper |
| `lib/modbus/adlar2-modbus-service.ts` | Nieuw: `readCoil(addr): Promise<number>` |
| `app.ts` | Callbacks `onReadRegister` + `onWriteExpert` meegeven bij aanmaken `DashboardService` |

Geen wijziging aan:

- `public/dashboard.html` — read-only dashboard blijft ongewijzigd
- `public/dashboard-interactive.html` — ADR-044 scope ongewijzigd
- `adlar-modbus-registers.ts` — registermetadata wordt alleen geïmporteerd, niet gewijzigd
- `.homeycompose/` — geen nieuwe capabilities of flow cards
- `lib/services/service-coordinator.ts` — callbacks lopen via `app.ts` direct naar `ModbusConnectionService`

---

## 7. Gevolgen

**Positief**

- Volledige registerinspectie en -modificatie zonder externe Modbus-tooling
- Registermetadata altijd gesynchroniseerd met de broncode (geen handmatig bijhouden)
- Popup met OK/Annuleren voorkomt onbedoelde schrijfacties
- serviceOnly-registers zijn zichtbaar maar duidelijk gemarkeerd
- Bitmask-registers zijn leesbaar als individuele vlaggen

**Negatief**

- `POST /api/expert/write` heeft geen whitelist — elke geldig geadresseerd register is beschrijfbaar
- De UI toont ook registers waarvoor de multiply of min/max onbekend is; de gebruiker ziet dan rauwe waarden zonder schaalconversie
- On-demand reads genereren extra Modbus-verkeer dat interfereert met de bestaande poll-engine (dit is bestaand gedrag bij `writeRegister`; geen nieuw probleem)

**Bewust Niet Geadresseerd**

- Authenticatie of sessietoken voor het expert-dashboard
- Export van alle registerwaarden naar CSV of JSON
- Schrijven van meerdere registers tegelijk (bulk write)
- Historische grafiek van een register (dit valt onder ADR-041 ring-buffer)
- Protocolversionering: coil-ondersteuning vereist `protocolVersion >= 130`; het dashboard toont een waarschuwing als de protocolversie onbekend is, maar blokkeert niet

---

## 8. Acceptatiecriteria

- `GET http://<homey-ip>:8090/expert` serveert het expertdashboard zonder foutmelding
- `GET /api/registers` retourneert een JSON-array met minimaal 8 blokken, elk met registers inclusief adres, naam en readOnly-vlag
- Alle 8 blokken zijn zichtbaar in de accordionlijst
- Uitklappen van Blok 3 (Control) triggert automatisch een live read van alle registers in dat blok
- Klikken op `[✏ Schrijf]` bij `tempSetHeating` (0x0301) opent een popup met de huidige waarde, invoerveld, bereik en OK/Annuleer-knoppen
- Invoer van 50 in de popup (= 50 °C) resulteert in ruwe waarde 500 en na OK wordt 500 geschreven naar 0x0301
- Invoer buiten het bereik (bijv. 999) deactiveert de OK-knop
- Na succesvol schrijven wordt de rij binnen 2 seconden ververst en toont de nieuwe waarde
- Een coil-register (bijv. `powerfulMode`, 0x1000) toont een radio-button popup (Aan/Uit)
- Een serviceOnly-register (bijv. `compressor1ForcedFreq`, 0x0332) toont een oranje markering en een waarschuwingstekst in de popup
- Het bestaande `GET /dashboard.html` en `GET /interactive` blijven onaangetast
- `npm run build` slaagt zonder TypeScript-fouten
- `readCoil()` in `Adlar2ModbusService` retourneert 0 of 1 op basis van de FC01-respons
