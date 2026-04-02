# ADR-031: ModbusConnectionService Ontkoppelen van Adlar-Registerset

**Status:** Voorstel
**Datum:** 2026-03-28
**Gerelateerd:** [ADR-012 Flow Card Runtime Alignering](ADR-012-modbus-flow-card-runtime-alignment.md)

---

## 1. Probleem

`ModbusConnectionService` is op drie plaatsen hard gekoppeld aan `Adlar2ModbusService`:

```typescript
// modbus-connection-service.ts, regel 7
import { Adlar2ModbusService, DataSnapshot } from '../modbus/adlar2-modbus-service';

// modbus-connection-service.ts, regel 37
private service: Adlar2ModbusService | null = null;

// modbus-connection-service.ts, regel 69
this.service = new Adlar2ModbusService({ ... });
```

Met een andere registerset kun je niet simpelweg een andere driver toevoegen zonder ofwel te vertakken in deze klasse, ofwel een tweede bijna-identieke connection service te maken.

De impact beperkt zich niet tot `ModbusConnectionService`. De `DataSnapshot`-interface en de Adlar-specifieke veldnamen lopen door de hele stack:

- `service-coordinator.ts` (regel 12, 231): importeert `DataSnapshot`, leest `snapshot.sensors.ambientT1`, `snapshot.status.defrosting`, etc.
- `device.ts` (regel 322, `applyModbusSnapshot()`): mapt hardcoded snapshot-keys naar capability-id's

## 2. Kernonderscheid

De impact hangt af van één kernvraag: **kan de andere registerset normaliseren naar hetzelfde `DataSnapshot` en dezelfde write-API?**

| Scenario | DataSnapshot | Write-API | Impact op ConnectionService | Impact op Coordinator + Device |
|---|---|---|---|---|
| Ander merk, zelfde type warmtepomp (bijv. ook T1–T9, heating/cooling/dhw setpoints) | Normaliseert naar hetzelfde `DataSnapshot` | Zelfde `setTemperature` / `setMode` / `setMainSwitch` | **Laag** — alleen de factory injecteerbaar maken | **Geen** |
| Fundamenteel ander apparaat (andere sensoren, andere modi, andere schrijfoperaties) | Ander snapshot-model nodig | Andere API nodig | **Medium** — generiek interface nodig | **Groot** — alles wat `outletT7`, `heatingSetpointC` etc. gebruikt moet mee |

Dit onderscheid bepaalt de architectuurkeuze: bij scenario 1 is een factory-injectie voldoende. Bij scenario 2 moet de generieke `TSnapshot` door de hele stack propageren.

## 3. Beslissing

We ontkoppelen `ModbusConnectionService` van `Adlar2ModbusService` via een **runtime-service interface** en een **factory-functie**.

### 3.1 ModbusRuntimeService Interface

De onderliggende Modbus-protocolservice wordt beschreven door een interface in plaats van door een concrete klasse:

```typescript
interface ModbusRuntimeService<TSnapshot> {
  connect(): Promise<void>;
  destroy(): Promise<void>;
  startPolling(ms?: { fast?: number; medium?: number; slow?: number }): void;
  setTemperature(type: string, value: number): Promise<void>;
  setMainSwitch(value: boolean): Promise<void>;
  setMode(mode: number): Promise<void>;
  on(event: 'connected', cb: () => void): this;
  on(event: 'disconnected', cb: (reason: string) => void): this;
  on(event: 'reconnecting', cb: (attempt: number, delayMs: number) => void): this;
  on(event: 'error', cb: (err: Error, ctx: string) => void): this;
  on(event: 'data', cb: (snapshot: TSnapshot) => void): this;
}
```

### 3.2 Factory in ModbusConnectionOptions

De constructie van de concrete service verhuist van `ModbusConnectionService` naar de aanroeper via een factory-functie:

```typescript
export interface ModbusConnectionOptions<TSnapshot = DataSnapshot> {
  device: Homey.Device;
  logger?: (message: string, ...args: unknown[]) => void;
  createService: (args: {
    config: ModbusConnectionConfig;
    timerProvider: TimerProvider;
  }) => ModbusRuntimeService<TSnapshot>;
  onData: (snapshot: TSnapshot) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onError: (err: Error, context: string) => void;
}
```

### 3.3 ModbusConnectionService Wordt Generiek

```typescript
export class ModbusConnectionService<TSnapshot = DataSnapshot> extends EventEmitter {
  private service: ModbusRuntimeService<TSnapshot> | null = null;
  // ...
}
```

De default type-parameter `= DataSnapshot` zorgt ervoor dat alle bestaande code ongewijzigd blijft — `ModbusConnectionService` zonder type-argument gedraagt zich identiek aan de huidige implementatie.

## 4. Rationale

### 4.1 Waarom een Factory in Plaats van Subclassing

Een alternatief zou zijn om `ModbusConnectionService` te subclassen:

```typescript
class XyzModbusConnectionService extends ModbusConnectionService { ... }
```

Dit is onwenselijk omdat:

- `ModbusConnectionService` bevat retrylogica, event-forwarding, en lifecycle-management die **niet** per driver moeten variëren
- Het enige dat verschilt is **welke service-instantie** wordt aangemaakt
- Dat is precies wat een factory-functie oplost zonder overerving
- Subclassing maakt het verleidelijk om ook retrylogica aan te passen per driver, wat onnodige divergentie veroorzaakt

### 4.2 Waarom Geen `if driver === ...` in ModbusConnectionService

De voor de hand liggende "snelle" oplossing zou zijn:

```typescript
// ❌ Anti-pattern
if (driverType === 'adlar') {
  this.service = new Adlar2ModbusService(...);
} else if (driverType === 'xyz') {
  this.service = new XyzModbusService(...);
}
```

Dit maakt `ModbusConnectionService` de plek waar alle devicevarianten samenklonteren. Elke nieuwe driver vereist dan een wijziging in deze klasse, wat het Open-Closed principe schendt.

### 4.3 Waarom de Generieke `TSnapshot` de Juiste Keuze Is

Door `TSnapshot` als type-parameter te gebruiken in plaats van altijd `DataSnapshot` te eisen, ontstaat flexibiliteit per scenario:

- **Scenario 1** (zelfde semantiek): de factory retourneert `ModbusRuntimeService<DataSnapshot>`, alle bestaande code blijft werken
- **Scenario 2** (andere semantiek): de factory retourneert `ModbusRuntimeService<XyzSnapshot>`, en `ServiceCoordinator` en `device.ts` worden ook geparametriseerd

Voor scenario 1 hoeft de generiek niet eens zichtbaar te zijn — de default type-parameter zorgt daarvoor.

## 5. Concrete Wijzigingen

### 5.1 Nieuw Bestand: `lib/modbus/modbus-runtime-service.ts`

Bevat het `ModbusRuntimeService<TSnapshot>` interface.

### 5.2 Wijziging: `lib/services/modbus-connection-service.ts`

- Verwijder directe import van `Adlar2ModbusService`
- Importeer `ModbusRuntimeService` interface
- Voeg `createService` factory toe aan `ModbusConnectionOptions`
- Vervang `new Adlar2ModbusService(...)` door `this.createService(...)`
- Voeg generieke type-parameter `TSnapshot` toe met default `DataSnapshot`
- `isDeviceConnected()` en `getDiagnostics()` blijven op de connection service — die zijn protocol-onafhankelijk

### 5.3 Wijziging: `lib/services/service-coordinator.ts`

Levert de factory-functie aan bij constructie van `ModbusConnectionService`:

```typescript
this.modbusConnection = new ModbusConnectionService({
  ...opts,
  createService: ({ config, timerProvider }) => new Adlar2ModbusService({
    transport: {
      host: config.host,
      port: config.port ?? 502,
      unitId: config.unitId ?? 1,
      timeoutMs: 5_000,
      batchDelayMs: 90,
      maxReconnects: 0,
    },
    hasFlowMeter: config.hasFlowMeter ?? false,
    defaultFlowLpm: config.defaultFlowLpm ?? 20,
    timerProvider,
  }),
  onData: this._handleModbusData.bind(this),
  onConnected: this._handleConnected.bind(this),
  onDisconnected: this._handleDisconnected.bind(this),
  onError: this._handleError.bind(this),
});
```

De `Adlar2ModbusService`-import verhuist van `modbus-connection-service.ts` naar `service-coordinator.ts`.

### 5.4 Geen Wijziging: `device.ts`

`applyModbusSnapshot()` verandert niet. Die methode werkt met `DataSnapshot`, wat het output-contract van de Adlar-factory is. Een toekomstige driver met een ander snapshot-model zou een eigen device-klasse met een eigen snapshot-mapping hebben.

### 5.5 Geen Wijziging: `Adlar2ModbusService`

De bestaande service verandert niet. Hij implementeert impliciet al het `ModbusRuntimeService<DataSnapshot>` interface — de factory wraps hem alleen met een expliciete type-toekenning.

## 6. Gevolgen

### Positief

- `ModbusConnectionService` wordt herbruikbaar voor andere registersets zonder codewijziging
- Retrylogica, event-forwarding en lifecycle-management worden gedeeld
- Nieuwe drivers hoeven alleen een factory-functie te leveren
- Bestaande code verandert minimaal (default type-parameter)
- Testbaarheid verbetert: mock-services zijn eenvoudig injecteerbaar via de factory

### Negatief

- Extra abstractie in de modbus-laag
- Eén extra bestand (`modbus-runtime-service.ts`)
- De generieke `TSnapshot` kan verwarrend zijn als er maar één concrete implementatie is

### Bewust Niet Geadresseerd

- Hoe `ServiceCoordinator` en `device.ts` generiek worden als het snapshot-model verschilt — dat is scenario 2 en volgt pas wanneer die behoefte concreet is
- Of `Adlar2ModbusService` formeel `implements ModbusRuntimeService<DataSnapshot>` moet declareren — dat kan, maar is niet strikt nodig door TypeScript's structurele typesysteem

## 7. Acceptatiecriteria

1. `ModbusConnectionService` importeert geen concrete Modbus-service meer
2. De concrete service-instantie wordt via een factory-functie geïnjecteerd
3. Alle bestaande functionaliteit blijft ongewijzigd (geen gedragsverandering)
4. Een nieuwe registerset-service is toevoegbaar zonder `ModbusConnectionService` te wijzigen
