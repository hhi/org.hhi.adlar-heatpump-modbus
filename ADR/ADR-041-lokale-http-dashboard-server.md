# ADR-041: Lokale HTTP Dashboard Server voor Temperatuur- en Statusvisualisatie

**Status:** Voorstel  
**Datum:** 2026-04-11  
**Gerelateerd:** [ADR-031 ModbusConnectionService Ontkoppelen](ADR-031-modbus-connection-service-driver-ontkoppeling.md), [ADR-037 Persistentie Runtime-State](ADR-037-persistentie-runtime-state-capability-herstel.md)

---

## 1. Probleem

De huidige Modbus-driver heeft geen directe manier om live sensorwaarden te inspecteren buiten de Homey-app. Diagnostiek en temperatuurverloop zijn alleen zichtbaar via Homey Insights of via de app-logs. Er bestaat een kant-en-klaar React-dashboard (`heatpump-temperature-dashboard.html`) dat flow-, retour-, buiten- en DHW-temperaturen visualiseert met historische grafiek — maar het draait momenteel op volledig gesimuleerde data en is niet gekoppeld aan de echte Modbus-waarden.

Het doel is dat dashboard beschikbaar te maken op het lokale netwerk, gevoed door de live `DataSnapshot`-polls van de Modbus-verbinding.

---

## 2. Kernonderscheid

Het dashboard is een gecompileerde React-app (één `.html` bestand, ~805 KB). De data-generatie zit in de gecompileerde bundle als `useMemo`-aanroep met een pure simulatiefunctie. Er zijn twee strategieën om dit te vervangen door echte data:

| Strategie | Aanpak | Complexiteit | Robuustheid |
| --- | --- | --- | --- |
| **A — Bundle-aanpassing** | Gerichte string-replacement in het gecompileerde `.html` bestand: `useMemo` → `useState` + `useEffect` met `fetch('/api/history')` | Medium — vereist exacte string-match in minified JS | Fragiel bij hercompilatie van het dashboard |
| **B — Server-side injectie** | HTTP-server injecteert een `<script>` met `window.__ADLAR_HISTORY__` vóór de React-bundle; bundle checkt die variabele | Laag — geen aanpassing aan de bundle | Werkt ook als de bundle opnieuw gecompileerd wordt |

**Strategie A is de juiste keuze** voor dit project. De bundle wordt niet hercompileerd via een CI-pipeline; het is een artefact dat handmatig wordt bijgewerkt. De string-replacement is eenmalig, goed testbaar, en levert een zelfstandig HTML-bestand op dat ook zonder actieve server werkt (mock-fallback). Strategie B introduceert server-side string-manipulatie bij élk request, wat de server complexer maakt.

---

## 3. Beslissing

We voegen een lokale HTTP-server toe aan de Homey-app op **poort 8090**, die het dashboard serveert en een `/api/history`-endpoint aanbiedt met de ring-buffer van recente `DataSnapshot`-waarden.

### 3.1 Poort

Poort **8090** — niet in gebruik door standaard Homey-services, duidelijk te onderscheiden van de 8778/8888-range die in andere projecten in gebruik is. Bereikbaar via `http://<homey-ip>:8090/`.

### 3.2 Bestandslocatie

Het dashboard-bestand wordt verplaatst naar `public/dashboard.html`. Het `public/`-mapje zit in de app-root en wordt meegeleverd in de Homey-appbundel.

### 3.3 Bundle-aanpassing (eenmalig)

In `public/dashboard.html` wordt de `useMemo` mock-generator:

```js
u=(0,R.useMemo)(()=>(function(){let e=Date.now(),t=Math.ceil(168),...})(),[])
```

vervangen door een `useState` + `useEffect` combinatie die pollt op `/api/history`:

```js
[u,_U]=(0,R.useState)([]),
_E=(0,R.useEffect)(()=>{
  const _l=()=>fetch('/api/history').then(x=>x.json()).then(_U).catch(()=>{});
  _l();
  const _t=setInterval(_l,15e3);
  return()=>clearInterval(_t);
},[])
```

Aanvullend: het laatste datapunt `d=f[f.length-1]` krijgt een safe default voor wanneer de array nog leeg is (initieel voor de eerste poll):

```js
d=f[f.length-1]||{flowTemp:0,returnTemp:0,outdoorTemp:0,dhwActual:0,dhwSetpoint:0,compressorFreq:0}
```

### 3.4 DashboardService (`lib/services/dashboard-service.ts`)

Nieuwe service die de HTTP-server beheert:

```typescript
export interface DashboardServiceOptions {
  appDir: string;                        // __dirname van de app
  logger: (msg: string, ...args: unknown[]) => void;
  port?: number;                         // default 8090
}

export class DashboardService {
  pushSnapshot(snapshot: DashboardSnapshot): void;  // voeg toe aan ring-buffer
  start(): void;
  destroy(): Promise<void>;
}
```

De ring-buffer bewaart maximaal **2880 snapshots** (48u bij een 60s-pollinterval, of 8u bij een 10s-pollinterval). Oudere entries vallen af.

Het data-formaat dat `/api/history` retourneert:

```typescript
interface DashboardSnapshot {
  ts: number;             // Unix timestamp in ms
  flowTemp: number;       // T5 (aanvoer)
  returnTemp: number;     // T6 (retour)
  outdoorTemp: number;    // T1 (buiten)
  dhwActual: number;      // T4 (tapwater actual)
  dhwSetpoint: number;    // DHW setpoint in °C
  compressorFreq: number; // compressorfrequentie in Hz (0 = standby)
}
```

Routes:
- `GET /` en `GET /dashboard.html` → serveert `public/dashboard.html`
- `GET /api/history` → retourneert ring-buffer als JSON-array
- Alle andere routes → 404

CORS-headers worden meegestuurd (`Access-Control-Allow-Origin: *`) zodat het dashboard ook via een externe browser bereikbaar is.

### 3.5 Wiring in `app.ts`

`DashboardService` wordt geïnstantieerd in `onInit` en opgeruimd in `onUninit`. De service-instantie wordt als eigenschap op de app-klasse gehouden zodat de device-laag er een referentie naar kan opvragen.

```typescript
private dashboard!: DashboardService;
```

### 3.6 Wiring in `service-coordinator.ts`

`ServiceCoordinator` ontvangt een optionele `onDashboardSnapshot`-callback in zijn opties:

```typescript
export interface ServiceCoordinatorOptions {
  device: Homey.Device;
  logger?: (message: string, ...args: unknown[]) => void;
  onDashboardSnapshot?: (snapshot: DashboardSnapshot) => void;  // nieuw
}
```

In `_handleModbusData()` wordt na de bestaande verwerking de callback aangeroepen met een gemapt subset van `DataSnapshot`. Zo blijft `ServiceCoordinator` onwetend van `DashboardService` zelf.

### 3.7 Mapping `DataSnapshot` → `DashboardSnapshot`

De mapping vindt plaats in `device.ts` of `app.ts` — niet in `ServiceCoordinator`. De relevante velden:

| DashboardSnapshot | DataSnapshot-bron |
| --- | --- |
| `flowTemp` | `sensors.outletT7` (of `sensors.waterOutT5` — afhankelijk van registerversie) |
| `returnTemp` | `sensors.inletT8` (of `sensors.waterInT6`) |
| `outdoorTemp` | `sensors.ambientT1` |
| `dhwActual` | `sensors.dhwT4` |
| `dhwSetpoint` | `setpoints.dhwSetpointC` |
| `compressorFreq` | `status.compressorFrequencyHz` |

---

## 4. Rationale

### 4.1 Waarom HTTP en niet WebSocket of SSE

De data verloopt al via een 10–60 seconden pollinterval. Een 15s-polling fetch in de browser is ruimschoots voldoende en vereist geen persistent connection-management in de Homey-app. WebSocket zou overkill zijn en vergroot de kans op resource-lekken bij ongesloten tabs.

### 4.2 Waarom geen gebruik van Homey's ingebouwde API

Homey's cloud-API biedt capability-waarden maar geen tijdreeksen. Voor een lokale historische grafiek is een eigen ring-buffer de enige optie zonder externe opslag.

### 4.3 Waarom poort 8090 en niet 80 of 443

Poorten onder 1024 vereisen root-privileges of capability-toekenning. Poort 8080 is veelgebruikt door lokale proxies en dev-servers. 8090 is vrij en onderscheidend genoeg om niet te botsen met andere services op een Homey Pro of thuis-netwerk.

### 4.4 Waarom geen authenticatie

De Homey Pro is een lokaal apparaat, niet direct bereikbaar van buiten het thuisnetwerk tenzij de gebruiker dit expliciet configureert. Een authenticatielaag toevoegen zou de drempel voor gebruik verhogen zonder zinvolle beveiligingswinst in de normale gebruikssituatie.

---

## 5. Concrete wijzigingen

| Bestand | Wijziging |
| --- | --- |
| `public/dashboard.html` | Nieuw (verplaatst van root, bundle aangepast per §3.3) |
| `lib/services/dashboard-service.ts` | Nieuw (HTTP-server + ring-buffer, §3.4) |
| `app.ts` | `DashboardService` instantiëren en opruimen (§3.5) |
| `lib/services/service-coordinator.ts` | `onDashboardSnapshot`-callback toevoegen aan opties + aanroep in `_handleModbusData` (§3.6) |
| `drivers/intelligent-heatpump-modbus/device.ts` | Callback implementeren + mapping `DataSnapshot` → `DashboardSnapshot` (§3.7) |

Geen wijziging aan:
- `adlar2-modbus-service.ts` — de `DataSnapshot` shape verandert niet
- `.homeycompose/` — geen nieuwe capabilities of flow cards
- `app.json` — geen structuurwijziging

---

## 6. Gevolgen

### Positief

- Live temperatuurverloop direct beschikbaar in de browser op het lokale netwerk
- Geen afhankelijkheid van Homey cloud of externe services
- Diagnostiek wordt eenvoudiger: flow/retour/buiten/DHW in één oogopslag
- Het ring-buffer-mechanisme is herbruikbaar voor toekomstige diagnostiekfuncties

### Negatief

- De HTTP-server verbruikt een open socket en een kleine hoeveelheid extra geheugen
- Poort 8090 moet eventueel worden doorgegeven in firewall- of router-configuratie als toegang van buiten gewenst is
- De bundle-aanpassing in `public/dashboard.html` vereist aandacht bij een hercompilatie van het dashboard

### Bewust Niet Geadresseerd

- Authenticatie of API-sleutel voor het dashboard-endpoint
- Persistentie van de ring-buffer over app-restarts (data gaat verloren bij herstart)
- Configureerbare poort via device-settings
- Exportfunctie van historische data (CSV, InfluxDB, etc.)

---

## 7. Acceptatiecriteria

1. `GET http://<homey-ip>:8090/` serveert het dashboard zonder foutmelding
2. `GET http://<homey-ip>:8090/api/history` retourneert een JSON-array met minimaal één entry na de eerste geslaagde Modbus-poll
3. Het dashboard toont live temperaturen die overeenkomen met de Modbus-registerwaarden
4. De ring-buffer bevat maximaal 2880 entries en overschrijft de oudste entry bij overschrijding
5. Bij `destroy()` van `DashboardService` is de HTTP-server correct gesloten (geen open handles)
6. `npm run build` slaagt zonder TypeScript-fouten
