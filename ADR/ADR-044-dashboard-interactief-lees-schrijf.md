ADR-044: Interactief Dashboard met Lees- en Schrijftoegang (dashboard-interactive.html)
Status: Voorstel
Datum: 2026-04-15
Gerelateerd: ADR-041 Lokale HTTP Dashboard Server, ADR-043 Unsupported Register Blok-Isolatie

---

## 1. Probleem

Het huidige dashboard (`public/dashboard.html`, ADR-041) is puur leesbaar: het visualiseert live temperaturen en sensorwaarden maar biedt geen manier om setpoints of de bedrijfsmodus vanuit de browser aan te passen. Wie een setpoint wil wijzigen, moet daarvoor de Homey-app openen of een flow activeren.

Het doel is een aanvullend interactief dashboard (`public/dashboard-interactive.html`) dat vanuit de browser de meest relevante gebruikersparameters kan schrijven naar de warmtepomp — zonder de Homey-app te hoeven openen. Het read-only dashboard blijft ongewijzigd.

---

## 2. Scope

Alleen de registercategorieën die een eindgebruiker redelijkerwijs wil bijstellen:

| Parameter | Register | Blok | Schrijfmethode |
|---|---|---|---|
| Verwarming setpoint | `CONTROL_REGISTERS.tempSetHeating` (0x0301) | 3 | FC06 (writeRegister) |
| Tapwater setpoint | `CONTROL_REGISTERS.tempSetHotWater` (0x0302) | 3 | FC06 |
| Koeling setpoint | `CONTROL_REGISTERS.tempSetCooling` (0x0300) | 3 | FC06 |
| Hoofdschakelaar | `CONTROL_REGISTERS.mainSwitch` (0x0305) | 3 | FC06 |
| Gebruikersmodus | `CONTROL_REGISTERS.runningMode` (0x0307) | 3 | FC06 |

Stooklijnen (P-parameters, L-parameters, coil-commando's) vallen buiten scope. Die vereisen protocol-versiecontrole of worden al beheerd via flow cards.

---

## 3. Beslissing

### 3.1 Nieuwe route in DashboardService

De bestaande `DashboardService` krijgt twee nieuwe routes:

```
GET  /interactive              → serveert public/dashboard-interactive.html
GET  /interactive.html         → zelfde
POST /api/write                → schrijft één registerwaarde naar de warmtepomp
```

Requestformaat voor `POST /api/write`:

```json
{ "key": "tempSetHeating", "value": 45 }
```

- `key`: naam van een toegestaan register (whitelist in de service)
- `value`: numerieke eindwaarde in gebruikerseenheden (°C, 0/1, etc.) — niet de ruwe registerwaarde

Responsformaat:

```json
{ "ok": true }
```

of bij fout:

```json
{ "ok": false, "error": "Waarde buiten toegestaan bereik: min=15, max=60" }
```

HTTP-statuscodes: 200 voor succesvol, 400 voor validatiefout, 500 voor schrijffout.

### 3.2 Schrijf-whitelist en validatie

De service definieert een interne whitelist met min/max/multiply per sleutel. Waarden buiten bereik worden geweigerd voordat er iets naar Modbus wordt gestuurd:

```typescript
const WRITABLE_REGISTERS: Record<string, WritableRegisterMeta> = {
  tempSetHeating:  { address: 0x0301, min: 15, max: 60, multiply: 0.1 },
  tempSetHotWater: { address: 0x0302, min: 20, max: 75, multiply: 0.1 },
  tempSetCooling:  { address: 0x0300, min:  7, max: 25, multiply: 0.1 },
  mainSwitch:      { address: 0x0305, min:  0, max:  1, multiply: 1   },
  runningMode:     { address: 0x0307, min:  0, max:  2, multiply: 1   },
};
```

De ruwe registerwaarde wordt berekend als `Math.round(value / multiply)`. Temperatuurregisters gebruiken `multiply: 0.1` (registerwaarde = °C × 10).

### 3.3 Callback-architectuur

`DashboardService` weet niets van Modbus. Schrijfverzoeken worden doorgegeven via een optionele callback in de opties:

```typescript
export interface DashboardServiceOptions {
  appDir: string;
  logger: (msg: string, ...args: unknown[]) => void;
  port?: number;
  onWriteRegister?: (address: number, rawValue: number) => Promise<void>;  // nieuw
}
```

- Als `onWriteRegister` niet meegegeven is (bijv. in tests), weigert `POST /api/write` met een 503.
- De callback gooit een `Error` bij mislukking; de service vangt dit op en retourneert een 500-respons.

### 3.4 Wiring in device.ts / service-coordinator.ts

De callback wordt geïmplementeerd in `device.ts` en doorgegeven bij het aanmaken van `DashboardService` in `app.ts`:

```typescript
onWriteRegister: async (address, rawValue) => {
  await this.modbusService.writeRegister(address, rawValue);
}
```

`ServiceCoordinator` hoeft niet aangepast te worden — de callback verwijst rechtstreeks naar de Modbus-laag.

### 3.5 dashboard-interactive.html

Een zelfstandig HTML-bestand (geen React-dependency, puur vanilla JS + inline CSS) met:

- Readonly sectie: huidige waarden uit `GET /api/snapshot` (hergebruik van bestaand endpoint)
- Schrijfsectie: één invoerveld per whitelist-register, met min/max als HTML-attribuut
- Submit per register (niet één groot formulier) zodat een fout bij één register de rest niet blokkeert
- Visuele feedback: groene/rode melding per veld na response
- Automatische refresh van de read-sectie elke 15 seconden (zelfde patroon als dashboard.html)

Het bestand heeft geen externe afhankelijkheden en werkt ook als de server tijdelijk niet bereikbaar is (graceful degradation: foutmelding in de UI).

### 3.6 Geen authenticatie

Zelfde redenering als ADR-041 §4.4: de Homey Pro is een lokaal apparaat, niet rechtstreeks bereikbaar van buiten het thuisnetwerk. Een schrijf-API zonder authenticatie is acceptabel in deze context.

Aanvullend risico t.o.v. het read-only dashboard: een foutieve schrijfopdracht kan het gedrag van de warmtepomp beïnvloeden. Dit wordt gemitigeerd door de whitelist (alleen bekende, veilige registers) en de min/max-validatie (waarden buiten fabrikantspecificaties worden geweigerd).

---

## 4. Overwogen alternatieven

### Alternatief A — Schrijffunctie in bestaand dashboard.html

Voordeel: één enkel bestand, minder routes.

Nadeel: `dashboard.html` is een gecompileerde React-bundle (~805 KB). Schrijf-UI toevoegen vereist opnieuw bundlemanipulatie of een tweede string-replacement. De codebasis wordt dan verstrengeld met twee functies in één artefact, wat onderhoud bemoeilijkt bij een hercompilatie.

**Afgewezen** — interactieve functionaliteit verdient een eigen, overzichtelijk bestand.

### Alternatief B — WebSocket voor bidirectionele communicatie

Voordeel: lagere latentie bij schrijven, server kan proactief updates pushen.

Nadeel: WebSocket-beheer in een Homey-app introduceert extra complexiteit (connection-tracking, heartbeats, cleanup bij app-restart). De setpoint-wijzigingsfrequentie rechtvaardigt dit niet — een gebruiker past setpoints hooguit een paar keer per dag aan.

**Afgewezen** — HTTP POST is ruimschoots voldoende.

### Alternatief C — Schrijven via Homey Flow Cards

Voordeel: geen nieuwe HTTP-routes nodig.

Nadeel: vereist dat de gebruiker flows aanmaakt en de Homey-app opent — precies wat dit dashboard wil vermijden.

**Afgewezen** — buiten scope van het dashboard-concept.

---

## 5. Concrete wijzigingen

| Bestand | Wijziging |
|---|---|
| `public/dashboard-interactive.html` | Nieuw — interactief dashboard (vanilla HTML/JS) |
| `lib/services/dashboard-service.ts` | Routes `GET /interactive`, `POST /api/write` + `onWriteRegister`-callback in opties |
| `app.ts` | `onWriteRegister`-callback meegeven bij aanmaken `DashboardService` |

Geen wijziging aan:

- `public/dashboard.html` — read-only dashboard blijft ongewijzigd
- `adlar2-modbus-service.ts` — `writeRegister()` bestaat al
- `.homeycompose/` — geen nieuwe capabilities of flow cards
- `app.json` — geen structuurwijziging

---

## 6. Gevolgen

**Positief**

- Setpoints aanpassen zonder de Homey-app te openen, direct vanuit de browser
- Min/max-validatie in de service voorkomt out-of-range schrijfacties
- Vanilla HTML/JS: geen build-stap nodig, eenvoudig te onderhouden
- Bestaand read-only dashboard en alle bestaande routes blijven onaangetast

**Negatief**

- `POST /api/write` is een schrijf-API zonder authenticatie — acceptabel in lokale netwerkomgeving
- Een foutieve waarde (binnen bereik maar ongewenst) kan tijdelijk het gedrag van de warmtepomp beïnvloeden; de gebruiker is verantwoordelijk

**Bewust Niet Geadresseerd**

- Schrijven van stooklijnen, P-parameters of L-parameters (vereist protocol-versiecontrole en diepere kennis van fabrikantbeperkingen)
- Authenticatie of API-sleutel
- Opslaan van schrijfhistorie
- Undo/rollback van een schrijfopdracht

---

## 7. Acceptatiecriteria

- `GET http://<homey-ip>:8090/interactive` serveert het interactieve dashboard zonder foutmelding
- `POST /api/write` met een geldige sleutel en waarde retourneert `{ "ok": true }` en het register wordt daadwerkelijk geschreven
- `POST /api/write` met een waarde buiten het bereik retourneert HTTP 400 met `{ "ok": false, "error": "..." }`
- `POST /api/write` met een onbekende sleutel retourneert HTTP 400
- De read-sectie van het interactieve dashboard toont live waarden uit `GET /api/snapshot`
- Het bestaande `GET /dashboard.html` endpoint blijft onaangetast
- `npm run build` slaagt zonder TypeScript-fouten
