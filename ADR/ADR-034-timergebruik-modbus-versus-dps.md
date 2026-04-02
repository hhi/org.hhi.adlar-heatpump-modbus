# ADR-034: Timergebruik in Modbus Driver versus DPS Driver

**Status:** Voorstel
**Datum:** 2026-03-30
**Gerelateerd:** [ADR-031 ModbusConnectionService Ontkoppelen van Adlar-Registerset](ADR-031-modbus-connection-service-driver-ontkoppeling.md)

---

## 1. Probleem

Bij vergelijking van `org.hhi.adlar-heatpump-modbus` met `org.hhi.adlar-heatpump` is onduidelijk welke timers functioneel gelijkwaardig zijn, welke bewust driver-specifiek zijn, en welke in de DPS driver nog legacy of Tuya-specifieke ballast vormen.

Zonder dit onderscheid ontstaat het risico dat:

- Modbus ten onrechte naar DPS-pariteit wordt getrokken op Tuya-specifieke heartbeat- en reconnectlogica
- legacy timers uit `drivers/intelligent-heat-pump/device.ts` als norm worden gezien
- nieuwe timerlogica opnieuw in `device.ts` belandt in plaats van in services

## 2. Beslissing

We hanteren voortaan vier categorieën voor timergebruik:

1. **Gedeelde domein-timers** zijn onderdeel van de gedeelde servicelaag en horen in beide drivers thuis.
2. **Modbus-specifieke timers** horen bij de Modbus transport- en pollinglaag en hebben geen DPS-equivalent nodig.
3. **DPS-specifieke timers** horen bij Tuya/LAN-communicatie en worden niet overgenomen naar de Modbus driver.
4. **Legacy timers in DPS `device.ts`** zijn geen pariteitsdoel voor Modbus. De Modbus-driver houdt `device.ts` timer-vrij tenzij een Homey-boundary dat expliciet vereist.

## 3. Timeroverzicht

### 3.1 Gedeeld en actief in beide drivers

| Domein | Timer(s) | Modbus | DPS |
|---|---|---|---|
| Flow cards | `initializationRetryTimer`, `hourlyScoreInterval`, `initReportTimeout`, `dailyReportTimer`, `dailyReportInterval` | Ja | Ja |
| Energietracking | `energyTrackingInterval`, `dailyResetTimeout`, `dailyResetInterval` | Ja | Ja |
| Gebouwmodel | `updateInterval` | Ja | Ja |
| Capability health | `healthCheckInterval` | Ja | Ja |
| Self-healing | per-feature `setTimeout`, `cleanupTimer` | Ja | Ja |
| Adaptieve regeling | `controlLoopInterval` + korte follow-up `setTimeout`s | Ja | Ja |
| Weersverwachting | `updateInterval` + fetch-abort timeout | Ja | Ja |
| Building Insights | `evaluationTimer` | Ja | Ja |

### 3.2 Alleen actief in Modbus

| Domein | Timer(s) | Reden |
|---|---|---|
| ModbusConnectionService | `retryTimer` | Retry na mislukte initiële connect |
| ModbusTcpService | `_reconnectTm` | Exponential backoff reconnect voor TCP |
| ModbusTcpService | `_pollTimers` | Pollgroepen `fast` / `medium` / `slow` |
| ModbusTcpService | batch delay timeout | Rate limiting tussen writes |
| ServiceCoordinator | `_disconnectStatusTimer` | Grace period voordat disconnect zichtbaar wordt |

### 3.3 Alleen actief in DPS

| Domein | Timer(s) | Reden |
|---|---|---|
| TuyaConnectionService | `reconnectInterval` | Reconnect-monitoring voor Tuya/LAN |
| TuyaConnectionService | `heartbeatInterval` | Applicatie-level heartbeat |
| TuyaConnectionService | `nativeHeartbeatMonitorInterval` | Layer-0 zombie-detectie op native heartbeat |
| TuyaConnectionService | `dpsRefreshInterval` | Periodieke DPS refresh bij idle verbinding |
| TuyaConnectionService | `contextResetTimer` | Opruimen van diagnostische data-event context |
| TuyaConnectionService | diverse korte `setTimeout`s | Wake-up, query, write en cooldown orchestration |
| DPS `device.ts` | `copCalculationInterval`, `scopUpdateInterval` | Nog niet naar service verplaatst |
| DPS `device.ts` | `idleCheckInterval` | Device-level COP idle monitoring |
| DPS `device.ts` | `connectionStatusInterval` | Statuspolling in device boundary |
| DPS `device.ts` | `dailyEnergyResetTimeout`, `dailyEnergyResetInterval` | Dagreset nog in device |
| DPS `device.ts` | `flowCardInitRetryTimeout` | Flow-card retry nog in device |
| DPS `device.ts` | `defrost24hRefreshInterval` | Periodieke defrost 24h decay refresh |

### 3.4 Gedeclareerd maar niet actief

| Driver | Timer | Status |
|---|---|---|
| Modbus | `preHeatRecommendationTimer` | Gedeclareerd en opgeruimd, maar nergens gestart |
| DPS | `preHeatRecommendationTimer` | Gedeclareerd en opgeruimd, maar nergens gestart |
| DPS | reconnect-fallback timers in `device.ts` | Expliciet als dead code gemarkeerd; actieve logica zit in `TuyaConnectionService` |

## 4. Rationale

### 4.1 Waarom Modbus geen Tuya-timerpariteit nodig heeft

De Modbus driver gebruikt een andere verbindingsarchitectuur:

- `ModbusConnectionService` verzorgt de connection lifecycle
- `ModbusTcpService` verzorgt reconnect backoff en polling
- `ServiceCoordinator` verzorgt slechts een zichtbare disconnect-grace-period

De Tuya timers in DPS bestaan voor een ander protocolprobleem: heartbeat-monitoring, idle DPS refresh, zombie-detectie en LAN reconnect orchestration. Die zijn geen inhoudelijke eis voor Modbus.

### 4.2 Waarom DPS `device.ts` geen norm is

De DPS driver bevat nog timerlogica in `device.ts` die in de Modbus driver al is opgesplitst naar services of bewust niet is overgenomen. Dat geldt met name voor:

- COP/SCOP intervallen
- flow-card retry orchestration
- connection status interval
- daily energy reset
- defrost 24h refresh

Dat zijn architectonisch historische resten, geen gewenste doelstructuur voor Modbus.

### 4.3 Gewenste richting voor Modbus

De Modbus driver houdt timerverantwoordelijkheid zoveel mogelijk in:

- protocolservices
- domeinservices
- coordinatorservices

en niet in `drivers/intelligent-heatpump-modbus/device.ts`.

## 5. Gevolgen

### Positief

- Duidelijk onderscheid tussen gedeelde timers en protocolspecifieke timers
- Minder kans op foutieve DPS-pariteitseisen in de Modbus driver
- Bevestigt de architectuurrichting dat `device.ts` in Modbus zo dun mogelijk blijft

### Negatief

- De twee drivers blijven bewust asymmetrisch in hun connectielaag
- DPS bevat nog timerlogica die bij vergelijking verwarrend kan blijven zolang die niet verder is opgeschoond

## 6. Richtlijnen voor vervolgwerk

1. Nieuwe Modbus timers alleen toevoegen in services of transportlagen, niet in `device.ts`, tenzij het een expliciete Homey device-boundary betreft.
2. Nieuwe vergelijkingen met DPS moeten eerst bepalen of een timer domeingedeeld of protocolspecifiek is.
3. DPS timers in `device.ts` gelden niet automatisch als ontbrekende functionaliteit in Modbus.
4. `preHeatRecommendationTimer` geldt in beide drivers voorlopig als ongebruikt en mag pas blijven bestaan als er een concrete startlocatie wordt toegevoegd.

## 7. Bronnen

- Modbus: `lib/services/modbus-connection-service.ts`, `lib/modbus/modbus-tcp-service.ts`, `lib/services/service-coordinator.ts`, `lib/services/flow-card-manager-service.ts`, `lib/services/energy-tracking-service.ts`, `lib/services/building-model-service.ts`, `lib/services/capability-health-service.ts`, `lib/services/adaptive-control-service.ts`, `lib/services/weather-forecast-service.ts`, `lib/services/building-insights-service.ts`, `lib/self-healing-registry.ts`
- DPS: `lib/services/tuya-connection-service.ts`, `drivers/intelligent-heat-pump/device.ts` en dezelfde gedeelde services als hierboven
