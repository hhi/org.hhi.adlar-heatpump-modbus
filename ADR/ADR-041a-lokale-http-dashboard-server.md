# ADR-041a: Lokale HTTP Dashboard Server — Register-overzicht in Tabelformaat

**Status:** Voorstel  
**Datum:** 2026-04-12  
**Gerelateerd:** [ADR-031 ModbusConnectionService Ontkoppelen](ADR-031-modbus-connection-service-driver-ontkoppeling.md), [ADR-037 Persistentie Runtime-State](ADR-037-persistentie-runtime-state-capability-herstel.md)

---

## 1. Probleem

De Modbus-driver pollt tientallen registers verdeeld over vier pollgroepen (FAST/MEDIUM/SLOW/ONCE). De actuele waarden zijn alleen indirect zichtbaar via Homey capabilities of app-logs — er is geen overzichtspagina die alle bekende registers en hun gerapporteerde waarden in één oogopslag toont.

Diagnostiek vereist nu ofwel het lezen van raw logs of het afzonderlijk opvragen van capabilities in de Homey-app. Dat maakt het lastig om snel te beoordelen welke registers recent gepolld zijn, wat de ruwe en geschaalde waarden zijn, en welke registers nog geen waarde hebben (cache miss).

---

## 2. Beslissing

We voegen een lokale HTTP-server toe aan de Homey-app op **poort 8090** die:

1. Een statisch scrollbaar HTML-dashboard serveert met alle bekende registers in tabelformaat
2. Een `/api/snapshot`-endpoint aanbiedt dat de meest recente `DataSnapshot` als JSON teruggeeft
3. Geen ring-buffer of historische data bijhoudt — het gaat om de actuele toestand

### 2.1 Poort

Poort **8090** — niet in gebruik door standaard Homey-services, ver van de 8778/8888-range die in andere projecten in gebruik is. Bereikbaar via `http://<homey-ip>:8090/`.

---

## 3. Dashboard HTML

Het dashboard is een **plain HTML-bestand** zonder externe afhankelijkheden of bouwstap — geen framework, geen bundler. Het pollt zelf `/api/snapshot` elke 15 seconden en hertekent de tabel via `innerHTML`. Dit maakt het onderhoudbaar en hernoem-proof: het bestand kan direct worden aangepast zonder compilatie.

### 3.1 Tabelkolommen

Elke rij vertegenwoordigt één register of afgeleid veld. De kolommen:

| Kolom | Beschrijving |
| --- | --- |
| **Adres** | Hex-adres (bijv. `0x004A`) — leeg voor afgeleide velden (COP, status-flags) |
| **Naam** | Beschrijvende registernaam (bijv. `Ambient Temp (T1)`) |
| **Waarde** | Geschaalde waarde inclusief eenheid (bijv. `5.2 °C`) |
| **Ruw** | Unsigned 16-bit ruw register-getal; `—` bij cache miss of afgeleid veld |
| **Categorie** | Sensors / Status / Control / Power / COP / Version / Faults |
| **Poll-groep** | FAST / MEDIUM / SLOW / ONCE / Afgeleid |

### 3.2 Categorieën

De registers worden gegroepeerd op categorie, overeenkomend met de secties in `adlar-modbus-registers.ts` en de sub-interfaces van `DataSnapshot`:

| Categorie | Bron in DataSnapshot | Typische registers |
| --- | --- | --- |
| **Sensors** | `snapshot.sensors` | T1–T9, stroom, spanning, vermogen, debiet |
| **Status** | `snapshot.status` | Running, defrosting, antifreeze, activeFaults |
| **Control** | `snapshot.control` | Mode, setpoints, curves, protocol |
| **Power** | `snapshot.power` | Input kW, A, V, totalEnergyKwh |
| **COP** | `snapshot.cop` | Thermisch vermogen, COP, ΔT, flow |
| **Version** | `snapshot.version` | Firmware, product type, protocol versie |
| **Faults** | `snapshot.status.activeFaults` | Actieve foutcodes als badge-lijst |

### 3.3 Visuele weergave

- Rijen met een **actieve fault** of `faultAlarm: true` worden rood gemarkeerd
- De kolom **Ruw** toont `—` als het adres nog niet in de Modbus-cache zit (cache miss na herstart)
- Een **"Laatst bijgewerkt"**-tijdstempel bovenaan geeft aan wanneer de snapshot is ontvangen
- De pagina toont een **verbindingsindicator**: groen (snapshot minder dan 30s oud), oranje (30–120s), rood (ouder of geen data)

---

## 4. API-ontwerp

### `GET /api/snapshot`

Retourneert de meest recente `DataSnapshot` als JSON. Als er nog geen snapshot beschikbaar is, retourneert `204 No Content`.

Het response-body is de `DataSnapshot`-interface zoals gedefinieerd in `adlar2-modbus-service.ts`, aangevuld met het `ts`-veld (Unix timestamp in ms). Geen transformatie — de ruwe shape wordt rechtstreeks geserialiseerd.

```typescript
// Voorbeeld response (vereenvoudigd):
{
  "ts": 1744430400000,
  "status": { "running": true, "defrosting": false, "activeFaults": [] },
  "control": { "on": true, "mode": 1, "heatingSetpointC": 45.0, ... },
  "power": { "inputPowerKw": 1.42, "inputCurrentA": 6.2, ... },
  "cop": { "cop": 3.8, "thermalPowerKw": 5.4, "valid": true, ... },
  "sensors": {
    "ambientT1": { "address": 74, "raw": 52, "value": 5.2, "unit": "°C", "label": "Ambient Temp (T1)" },
    ...
  }
}
```

### `GET /` en `GET /dashboard.html`

Serveert `public/dashboard.html` met `Content-Type: text/html`.

Alle andere routes retourneren HTTP 404.

---

## 5. Architectuur

### 5.1 `DashboardService` (`lib/services/dashboard-service.ts`)

```typescript
export interface DashboardServiceOptions {
  appDir: string;   // __dirname van de app (voor pad naar public/)
  logger: (msg: string, ...args: unknown[]) => void;
  port?: number;    // default 8090
}

export class DashboardService {
  /** Sla de meest recente snapshot op (overschrijft de vorige). */
  setSnapshot(snapshot: DataSnapshot): void;

  /** Start de HTTP-server. */
  start(): void;

  /** Sluit de server en ruimt resources op. */
  destroy(): Promise<void>;
}
```

De service bewaart exact **één snapshot** (de meest recente). Er is geen ring-buffer of persistentie.

### 5.2 Wiring in `app.ts`

`DashboardService` wordt geïnstantieerd in `onInit` en opgeruimd in `onUninit`:

```typescript
private dashboard!: DashboardService;
```

### 5.3 Wiring in `service-coordinator.ts`

`ServiceCoordinator` ontvangt een optionele callback in zijn opties:

```typescript
export interface ServiceCoordinatorOptions {
  device: Homey.Device;
  logger?: (message: string, ...args: unknown[]) => void;
  onSnapshot?: (snapshot: DataSnapshot) => void;  // nieuw
}
```

In `_handleModbusData()` wordt de callback aangeroepen na de bestaande verwerking. De coordinator blijft onwetend van `DashboardService` zelf.

### 5.4 Bestandslocatie

```text
public/
  dashboard.html    ← statisch HTML-bestand (geen build-stap)
lib/services/
  dashboard-service.ts
```

`public/` zit in de app-root en wordt meegeleverd in de Homey-appbundel.

---

## 6. Rationale

### 6.1 Waarom plain HTML en geen framework

Een register-overzicht is een lees-only weergave van een flat datastructuur. React, Svelte of een andere bundler voegt niets toe ten opzichte van `document.querySelector` + `innerHTML`. Een plain HTML-bestand is direct aanpasbaar, heeft geen bouwstap, en blijft leesbaar voor iedereen die het register-overzicht wil uitbreiden.

### 6.2 Waarom één snapshot en geen ring-buffer

Het doel is diagnostiek van de **actuele toestand** van alle registers. Een tijdreeks per register is een ander probleem (Homey Insights dekt dat voor capabilities). Een ring-buffer toevoegen zonder een bijbehorende grafiekweergave heeft geen meerwaarde en verhoogt het geheugengebruik onnodig.

### 6.3 Waarom `DataSnapshot` rechtstreeks serialiseren

`DataSnapshot` bevat al alle informatie die de tabel nodig heeft: adres, raw waarde, geschaalde waarde, eenheid en label zitten in `SensorValue`. Geen aparte mapping of tussenlaag nodig. Een projectie toevoegen zou alleen informatie weggooien die de tabel juist wil tonen.

### 6.4 Waarom geen authenticatie

De Homey Pro is een lokaal apparaat, niet direct bereikbaar van buiten het thuisnetwerk tenzij de gebruiker dit expliciet configureert. Een authenticatielaag verhoogt de drempel zonder zinvolle beveiligingswinst in de normale gebruikssituatie.

---

## 7. Gevolgen

### Positief

- Alle bekende registers en hun actuele waarden in één scrollbaar overzicht
- Directe diagnostiek van cache misses, foutieve schaalfactoren en stale waarden
- Geen bouwstap, geen externe afhankelijkheden, direct aanpasbaar
- Minimale impact op bestaande code: één nieuwe service, één callback in coordinator

### Negatief

- De HTTP-server houdt een open socket en verbruikt een kleine hoeveelheid extra geheugen
- Geen historische grafiek (bewust buiten scope)
- Geen live-push: de pagina pollt elke 15s, waarden kunnen maximaal 15s oud zijn

### Bewust Niet Geadresseerd

- Historische tijdreeks per register
- Schrijf-interface (registers aanpassen vanuit het dashboard)
- Authenticatie of API-sleutel
- Configureerbare poort via device-settings
- Persistentie van de snapshot over app-restarts

---

## 8. Acceptatiecriteria

1. `GET http://<homey-ip>:8090/` serveert het dashboard zonder foutmelding
2. `GET http://<homey-ip>:8090/api/snapshot` retourneert geldige JSON met `DataSnapshot`-structuur na de eerste geslaagde Modbus-poll
3. De tabel toont voor elke `SensorValue` in `snapshot.sensors` een rij met adres, naam, waarde, ruw en eenheid
4. Rijen met actieve faults worden visueel gemarkeerd
5. De verbindingsindicator is groen als de snapshot minder dan 30 seconden oud is
6. Bij `destroy()` van `DashboardService` is de HTTP-server correct gesloten (geen open handles)
7. `npm run build` slaagt zonder TypeScript-fouten
