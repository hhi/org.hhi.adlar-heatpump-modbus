ADR-045: Flow Cards voor Generieke Modbus Lees- en Schrijftoegang
Status: Voorstel
Datum: 2026-04-15
Gerelateerd: ADR-041 Dashboard Server, ADR-044 Interactief Dashboard, ADR-012 Modbus Flow Card Runtime Alignment

---

## 1. Probleem

Alle bestaande flow cards werken op hoog niveau: `set_heating_mode`, `set_device_onoff`, `set_heating_curve`. Ze zijn geconfigureerd voor specifieke registers en bieden geen toegang tot registers die (nog) geen dedicated kaartje hebben — zoals minder gangbare setpoints, P-parameters of diagnostische registers.

Power users en integrateurs willen registers direct kunnen benaderen via flows, zonder dat daarvoor per register een nieuw kaartje ontwikkeld moet worden. De Modbus-laag (`adlar2-modbus-service.ts`) heeft al `readRegister(addr)` en `writeRegister(addr, value)` methoden; deze zijn alleen niet bereikbaar vanuit de Homey flow-editor.

---

## 2. Beslissing

Twee nieuwe flow action cards:

| ID | Type | Omschrijving |
|---|---|---|
| `modbus_read_register` | Action | Leest één holding register (FC03) en retourneert de ruwe waarde als flow token |
| `modbus_write_register` | Action | Schrijft één holding register (FC06) met een opgegeven ruwe waarde |

Geen trigger card — zie §4.3.

---

## 3. Ontwerp per kaartje

### 3.1 `modbus_read_register` (action)

**Titel:** `Lees Modbus register [[address]]`

**Args:**

| Naam | Type | Omschrijving |
|---|---|---|
| `device` | device | Filter: `driver_id=intelligent-heatpump-modbus` |
| `address` | text | Registeradres in hex (`0x0301`) of decimaal (`769`) |

**Tokens:**

| Naam | Type | Voorbeeld | Omschrijving |
|---|---|---|---|
| `raw_value` | number | `550` | Ruwe registerwaarde zoals ontvangen via FC03 |

**Gedrag:**
- Adres wordt geparst als hex indien het begint met `0x`, anders decimaal
- Bij ongeldig adresformaat of leesfout: gooit een Error zodat de flow gestopt wordt en Homey een foutmelding toont
- Blokkerende call — de flow wacht tot het register gelezen is (of time-out optreedt)

**Hint (nl):** Leest één Modbus holding register en geeft de ruwe waarde terug. Adres in hex (`0x0301`) of decimaal (`769`). Temperatuurregisters zijn ×10 opgeslagen — deel het resultaat door 10 voor °C.

---

### 3.2 `modbus_write_register` (action)

**Titel:** `Schrijf waarde [[value]] naar Modbus register [[address]]`

**Args:**

| Naam | Type | Omschrijving |
|---|---|---|
| `device` | device | Filter: `driver_id=intelligent-heatpump-modbus` |
| `address` | text | Registeradres in hex (`0x0301`) of decimaal (`769`) |
| `value` | number | Ruwe registerwaarde die geschreven wordt (integer) |

**Geen tokens** — action-only.

**Gedrag:**
- Adres wordt geparst als hex indien het begint met `0x`, anders decimaal
- Waarde wordt afgerond naar een integer (`Math.round`) vóór schrijven
- Bij ongeldig adres, parseerfout of schrijffout: gooit een Error
- Blokkerende call — de flow wacht op bevestiging van de schrijfoperatie

**Hint (nl):** Schrijft een ruwe waarde naar één Modbus holding register (FC06). Adres in hex (`0x0301`) of decimaal (`769`). Temperatuurregisters verwachten ×10 — geef 450 op voor 45 °C. Gebruik met zorg: ongeldige waarden kunnen het gedrag van de warmtepomp beïnvloeden.

---

## 4. Architectuur

### 4.1 Adresbereik en veiligheid

Er is bewust geen whitelist of min/max-validatie op registerniveau. De kaartjes zijn low-level primitieven; de gebruiker is verantwoordelijk voor het invullen van correcte adressen en waarden. Dit is consistent met de verwachting dat deze kaartjes door gevorderde gebruikers worden ingezet.

Eén harde grens: de waarde wordt afgekapt tot het bereik van een unsigned 16-bit integer (0–65535) vóór het schrijven wordt doorgegeven aan `writeSingleRegister`. Waarden buiten dit bereik resulteren in een Error.

### 4.2 Schaalbaarheid (multiply)

Registers met `multiply: 0.1` (temperatuurregisters) slaan de waarde ×10 op. De flow cards werken uitsluitend met **ruwe registerwaarden**. Schaling is de verantwoordelijkheid van de flow-bouwer. De hint-tekst vermeldt dit expliciet.

Redenering: automatische schaling zou metadatakennis per adres vereisen in de flow-handler. Dat koppelt de kaartjes aan `adlar-modbus-registers.ts`, terwijl het juist de bedoeling is dat ze van elk register werken — ook ongedocumenteerde.

### 4.3 Geen trigger card

Een trigger "wanneer register X een nieuwe waarde heeft" vereist dat de polling-engine per flow-instantie een vorige waarde bijhoudt en vergelijkt. Dit voegt state-management toe aan de polling-lus voor een variabel aantal adressen, wat de complexiteit van `adlar2-modbus-service.ts` vergroot zonder duidelijk voordeel: de gebruiker kan hetzelfde bereiken via de bestaande temperatuur- of status-triggers gecombineerd met de nieuwe `modbus_read_register` action.

Bewust buiten scope.

### 4.4 Callback-architectuur

`FlowCardManagerService` communiceert met de Modbus-laag uitsluitend via callbacks (bestaand patroon). De opties worden uitgebreid:

```typescript
export interface FlowCardManagerOptions {
  // ... bestaande velden ...
  onModbusRead?: (address: number) => Promise<number>;
  onModbusWrite?: (address: number, rawValue: number) => Promise<void>;
}
```

De callbacks worden geïmplementeerd in `ServiceCoordinator` en verwijzen naar `ModbusConnectionService` → `Adlar2ModbusService`:

```typescript
onModbusRead: async (addr) => this._modbusService.readRegister(addr),
onModbusWrite: async (addr, value) => this._modbusService.writeRegister(addr, value),
```

Als de callbacks niet meegegeven zijn (bijv. in tests), retourneert `modbus_read_register` een Error en weigert `modbus_write_register` stil.

### 4.5 Adresparsing (gedeelde helper)

```typescript
function parseModbusAddress(input: string): number {
  const trimmed = input.trim();
  const addr = trimmed.startsWith('0x') || trimmed.startsWith('0X')
    ? parseInt(trimmed, 16)
    : parseInt(trimmed, 10);
  if (isNaN(addr) || addr < 0 || addr > 0xFFFF) {
    throw new Error(`Ongeldig Modbus-adres: "${input}"`);
  }
  return addr;
}
```

Deze helper wordt gedefinieerd in `FlowCardManagerService` en hergebruikt in beide handlers.

---

## 5. Flow card JSON (schets)

### `modbus_read_register.json`

```json
{
  "id": "modbus_read_register",
  "title": { "en": "Read Modbus register", "nl": "Lees Modbus register" },
  "titleFormatted": {
    "en": "Read Modbus register [[address]]",
    "nl": "Lees Modbus register [[address]]"
  },
  "hint": {
    "en": "Reads one Modbus holding register (FC03) and returns the raw value as a flow token. Address in hex (0x0301) or decimal (769). Temperature registers store values ×10 — divide the result by 10 for °C.",
    "nl": "Leest één Modbus holding register (FC03) en geeft de ruwe waarde terug als flow token. Adres in hex (0x0301) of decimaal (769). Temperatuurregisters zijn ×10 opgeslagen — deel het resultaat door 10 voor °C."
  },
  "tokens": [
    {
      "name": "raw_value",
      "type": "number",
      "title": { "en": "Raw value", "nl": "Ruwe waarde" },
      "example": 550
    }
  ],
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=intelligent-heatpump-modbus" },
    {
      "type": "text",
      "name": "address",
      "title": { "en": "Register address", "nl": "Registeradres" },
      "placeholder": { "en": "e.g. 0x0301 or 769", "nl": "bijv. 0x0301 of 769" }
    }
  ]
}
```

### `modbus_write_register.json`

```json
{
  "id": "modbus_write_register",
  "title": { "en": "Write Modbus register", "nl": "Schrijf Modbus register" },
  "titleFormatted": {
    "en": "Write [[value]] to Modbus register [[address]]",
    "nl": "Schrijf [[value]] naar Modbus register [[address]]"
  },
  "hint": {
    "en": "Writes a raw value to one Modbus holding register (FC06). Address in hex (0x0301) or decimal (769). Temperature registers expect values ×10 — enter 450 for 45 °C. Use with care: incorrect values may affect heat pump behaviour.",
    "nl": "Schrijft een ruwe waarde naar één Modbus holding register (FC06). Adres in hex (0x0301) of decimaal (769). Temperatuurregisters verwachten ×10 — geef 450 op voor 45 °C. Gebruik met zorg: ongeldige waarden kunnen het gedrag van de warmtepomp beïnvloeden."
  },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=intelligent-heatpump-modbus" },
    {
      "type": "text",
      "name": "address",
      "title": { "en": "Register address", "nl": "Registeradres" },
      "placeholder": { "en": "e.g. 0x0301 or 769", "nl": "bijv. 0x0301 of 769" }
    },
    {
      "type": "number",
      "name": "value",
      "title": { "en": "Raw value", "nl": "Ruwe waarde" },
      "placeholder": { "en": "e.g. 450 for 45 °C", "nl": "bijv. 450 voor 45 °C" }
    }
  ]
}
```

---

## 6. Concrete wijzigingen

| Bestand | Wijziging |
|---|---|
| `.homeycompose/flow/actions/modbus_read_register.json` | Nieuw |
| `.homeycompose/flow/actions/modbus_write_register.json` | Nieuw |
| `lib/services/flow-card-manager-service.ts` | `onModbusRead` + `onModbusWrite` callbacks toevoegen aan opties; handlers registreren voor beide nieuwe kaartjes; `parseModbusAddress` helper |
| `lib/services/service-coordinator.ts` | Callbacks implementeren en doorgeven aan `FlowCardManagerService` |
| `locales/en.json` | Vertalingen voor nieuwe kaartjes |
| `locales/nl.json` | Vertalingen voor nieuwe kaartjes |

Geen wijziging aan:

- `adlar2-modbus-service.ts` — `readRegister()` en `writeRegister()` bestaan al
- `adlar-modbus-registers.ts` — geen registermetadata nodig voor generieke kaartjes
- `device.ts` — geen directe betrokkenheid
- `.homeycompose/capabilities/` — geen nieuwe capabilities

---

## 7. Overwogen alternatieven

### Alternatief A — Dropdown met benoemde registers

Voordeel: type-safe, geen kans op typefouten in adressen, automatische schaling mogelijk.

Nadeel: beperkt tot de registers die in de dropdown staan; nieuwe registers vereisen een app-update; biedt geen toegang tot ongedocumenteerde of fabrikant-specifieke registers.

**Afgewezen** — de meerwaarde van deze kaartjes zit juist in de onbeperkte toegang.

### Alternatief B — Trigger card "register gewijzigd"

Zie §4.3. Vereist per-flow-instantie state in de polling-lus.

**Afgewezen** — te hoge implementatiecomplexiteit voor het toegevoegde nut.

### Alternatief C — Aparte coil-schrijf card (FC05)

Coil-registers (blok 6, protocol ≥ 130) vereisen `writeCoil` (FC05) in plaats van `writeSingleRegister` (FC06). Een apart kaartje hiervoor is denkbaar maar valt buiten de huidige scope: coils zijn service-only registers en worden al beheerd via dedicated flow cards (`set_device_onoff`).

**Bewust buiten scope** — kan als ADR-046 of uitbreiding van dit ADR worden opgepakt.

---

## 8. Gevolgen

**Positief**

- Power users kunnen elk holding register benaderen vanuit flows, zonder app-update
- Consistent met de bestaande callback-architectuur in `FlowCardManagerService`
- Minimale footprint: twee JSON-bestanden + uitbreiding van bestaande service

**Negatief**

- Geen min/max-validatie — een gebruiker kan een out-of-range waarde schrijven
- De "×10" schaling voor temperatuurregisters is niet zichtbaar in de flow-editor; gebruikers moeten de hint lezen
- Foutieve schrijfacties zijn niet ongedaan te maken via de flow-editor

**Bewust Niet Geadresseerd**

- Coil-registers (FC05)
- Meerdere registers tegelijk lezen of schrijven (FC03 multi-read, FC16 multi-write)
- Trigger card voor registerwijzigingen
- Automatische schaling op basis van registermetadata

---

## 9. Acceptatiecriteria

- Flow card `modbus_read_register` met adres `0x0301` retourneert de huidige ruwe waarde van het verwarmingssetpoint register
- Flow card `modbus_read_register` met adres `769` (decimaal equivalent van `0x0301`) retourneert dezelfde waarde
- Flow card `modbus_write_register` met adres `0x0302` en waarde `550` schrijft 550 naar het tapwater-setpointregister en de warmtepomp toont 55 °C
- Ongeldig adres (bijv. `abc`) resulteert in een zichtbare foutmelding in de Homey flow-editor
- Waarde buiten 0–65535 resulteert in een foutmelding
- `onModbusRead` of `onModbusWrite` niet geconfigureerd → kaartje gooit een Error met duidelijke melding
- `npm run build` slaagt zonder TypeScript-fouten
