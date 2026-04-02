# ADR-035: Iconstrategie Modbus Driver versus DPS Driver

**Status:** Voorstel
**Datum:** 2026-03-31
**Gerelateerd:** [ADR-034 Timergebruik in Modbus Driver versus DPS Driver](ADR-034-timergebruik-modbus-versus-dps.md)

---

## 1. Probleem

Bij vergelijking van `org.hhi.adlar-heatpump-modbus` met `org.hhi.adlar-heatpump` blijkt dat de visuele basis vrijwel gelijk is, maar de capability-toewijzing niet.

Feitelijke vergelijking op basis van het effectieve `app.json` van beide repos:

- De Modbus driver heeft `82` capability-definities met een expliciet icon en gebruikt `46` unieke icons.
- De DPS driver heeft `69` capability-definities met een expliciet icon en gebruikt `47` unieke icons.
- De Modbus driver gebruikt nog `16` keer het generieke `/assets/adlar-icon-white.svg` als capability-icon.
- De DPS driver gebruikt het generieke app-icoon `0` keer als capability-icon.
- De gedeelde `assets/*.svg` bibliotheek is inhoudelijk identiek tussen beide repos.
- De Modbus driver mist nog steeds `drivers/intelligent-heatpump-modbus/assets/icon.svg`, terwijl de DPS driver die wel heeft in `drivers/intelligent-heat-pump/assets/icon.svg`.

Het probleem zit dus niet in ontbrekende bronassets, maar in:

- fallback naar het generieke app-logo voor Modbus-specifieke capabilities
- ontbreken van afgeleide varianten voor interne flow-, frequentie- en pompfuncties
- ontbreken van een eigen driver-level icon

## 2. Scope en bron van waarheid

Deze ADR baseert de vergelijking expliciet op het gegenereerde `app.json` en niet alleen op `.homeycompose/`.

Reden:

- de gebruiker vroeg naar icons die nu daadwerkelijk in gebruik zijn
- in de Modbus repo lopen compose-bron en build-output voor minstens een deel van de capability-icons niet volledig gelijk
- `adlar_eev_step` en `adlar_evi_step` gebruiken in `app.json` al correct `pulse-steps.svg` en horen dus niet bij de generieke icon-achterstand

De icon-achterstand in Modbus zit effectief in deze `16` capabilities:

- `adlar_antifreeze`
- `adlar_comp_target_freq`
- `adlar_compressor_freq`
- `adlar_compressor_on`
- `adlar_defrosting`
- `adlar_fan_speed`
- `adlar_fault_1`
- `adlar_fault_2`
- `adlar_fault_3`
- `adlar_fault_active`
- `adlar_fault_shutdown`
- `adlar_mode`
- `adlar_pump_pwm`
- `adlar_running`
- `adlar_sterilization`
- `adlar_water_flow`

## 3. Vergelijking met DPS

### 3.1 Wat al goed is in DPS

De DPS driver laat zien dat dezelfde assetbibliotheek voldoende rijk is om capabilityfamilies specifiek te maken zonder terug te vallen op het app-logo.

Relevante families die DPS al consequent gebruikt:

- compressorstatus via `compressor-state.svg`
- defroststatus via `defrost-state.svg`
- faults via `fault.svg`
- pulse/step-waarden via `pulse-steps.svg`
- druk/gauge-semantiek via `pressure.svg`
- flow/externe metingen via `external-flow.svg`
- driver-level branding via `drivers/intelligent-heat-pump/assets/icon.svg`

### 3.2 Wat dit betekent voor Modbus

De Modbus driver heeft twee soorten achterstand:

1. capabilities die direct op een bestaande DPS-familie kunnen worden aangesloten
2. capabilities die geen exact DPS-equivalent hebben, maar wel logisch af te leiden zijn uit bestaande iconfamilies

Dat maakt een volledig nieuw iconpakket onnodig.

## 4. Beslissing

We gebruiken de DPS driver als visuele referentie, maar niet als 1-op-1 pariteitsdoel.

De verbeterstrategie wordt:

1. eerst generieke fallbacks vervangen door bestaand iconhergebruik waar de semantiek al voldoende klopt
2. daarna Modbus-only icons afleiden uit bestaande families in plaats van nieuwe losstaande stijlen te ontwerpen
3. alleen voor concepten die inhoudelijk te abstract blijven een echt nieuw icon ontwerpen

Daarnaast krijgt de Modbus driver een eigen `drivers/intelligent-heatpump-modbus/assets/icon.svg`, afgeleid van de DPS driver-versie.

## 5. Voorstel per capabilityfamilie

### 5.1 Direct hergebruik zonder nieuw asset

| Capability(s) | Tijdelijk / direct voorstel | Rationale |
|---|---|---|
| `adlar_compressor_on`, `adlar_running` | `compressor-state.svg` | Dezelfde mechanische aan/uit-familie als in DPS |
| `adlar_defrosting` | `defrost-state.svg` | Semantisch exact passend |
| `adlar_antifreeze` | `defrost-state.svg` | Zelfde vorst-/koudefamilie; later verfijnen naar beschermingsvariant |
| `adlar_fault_1`, `adlar_fault_2`, `adlar_fault_3`, `adlar_fault_active`, `adlar_fault_shutdown` | `fault.svg` | Faultfamilie mag bewust gedeeld blijven |
| `adlar_compressor_freq`, `adlar_comp_target_freq` | `compressor-state.svg` | Snelle winst: beter compressorfamilie dan generiek logo |
| `adlar_fan_speed` | `external-wind-speed.svg` | Zelfde luchtsnelheidstaal, ondanks dat later een interne variant gewenst is |
| `adlar_pump_pwm` | `pulse-steps.svg` | Duty-cycle / aansturing past beter bij stap-/regelgedrag dan bij app-logo |
| `adlar_water_flow` | `external-flow.svg` | Tijdelijke flowfamilie is semantisch veel sterker dan generiek logo |

Met alleen deze remapping daalt de generieke fallback van `16` naar `2` capabilities:

- `adlar_mode`
- `adlar_sterilization`

### 5.2 Af te leiden icons voor definitieve Modbus-varianten

| Nieuw voorstel | Toepassing | Af te leiden uit | Gewenste visuele afleiding |
|---|---|---|---|
| `compressor-frequency.svg` | `adlar_compressor_freq` | `compressor-state.svg` | Behoud rotor/centrale hub, voeg radiale tick- of snelheidaccenten toe |
| `compressor-target-frequency.svg` | `adlar_comp_target_freq` | `compressor-frequency.svg` | Zelfde basis, plus target-marker of tweede ring |
| `fan-speed.svg` | `adlar_fan_speed` | `external-wind-speed.svg` | Behoud luchtcurves, voeg compacte rotor/RPM-indicatie toe en verwijder externe connotatie |
| `water-flow.svg` | `adlar_water_flow` | `external-flow.svg` en `backwater-state.svg` | Behoud flowgolven en L/min-semantiek, verwijder externe source-box/arrow en maak het intern hydronisch |
| `pump-pwm.svg` | `adlar_pump_pwm` | `water-flow.svg` en `pulse-steps.svg` | Combineer pomp/flow-taal met procentuele aansturings- of stepped-bar indicatie |
| `antifreeze.svg` | `adlar_antifreeze` | `defrost-state.svg` | Behoud sneeuwkristal, voeg beschermings- of lockout-accent toe |

### 5.3 Bewust niet direct afleiden

| Capability | Besluit | Reden |
|---|---|---|
| `adlar_mode` | Nog geen afleiding forceren | Operating mode is te abstract voor een overtuigende reuse uit de huidige families |
| `adlar_sterilization` | Pas later nieuw ontwerp | Sanitatie/pasteurisatie heeft nog geen geloofwaardige bestaande familiebasis |

## 6. Afleidingsregels

Nieuwe Modbus-icons volgen deze regels:

- interne varianten erven de basisvorm van een bestaande familie en verwijderen alleen de "external/source" hints
- frequentie- en snelheidsvarianten gebruiken vormtaal, niet tekstlabels zoals `Hz` of `%`, zodat ze leesbaar blijven op Homey-formaat
- control-/duty-cycle-iconen gebruiken de stepped-bar of pulse-taal uit `pulse-steps.svg`
- frost/protection-varianten blijven binnen de sneeuwkristal-familie van `defrost-state.svg`
- faults blijven bewust een gedeelde alarmfamilie; daar is geen aparte bit-per-register iconset nodig

## 7. Fasering

### Fase 1: directe winst zonder nieuw SVG-ontwerp

- voeg `drivers/intelligent-heatpump-modbus/assets/icon.svg` toe op basis van de DPS driver
- map de `14` semantisch duidelijke generieke fallbacks direct om naar bestaande assets
- laat alleen `adlar_mode` en `adlar_sterilization` voorlopig generiek

### Fase 2: afgeleide Modbus-varianten

- ontwerp `compressor-frequency.svg`
- ontwerp `compressor-target-frequency.svg`
- ontwerp `fan-speed.svg`
- ontwerp `water-flow.svg`
- ontwerp `pump-pwm.svg`
- ontwerp `antifreeze.svg`

### Fase 3: optionele semantische afronding

- ontwerp `operating-mode.svg` als `adlar_mode` visueel nog te generiek blijft
- ontwerp `sterilization.svg` als sanitatie een prominente gebruikersfunctie blijkt

## 8. Gevolgen

### Positief

- De Modbus driver sluit visueel aan op de DPS driver zonder kunstmatige capabilitypariteit af te dwingen.
- De bestaande assetbibliotheek wordt maximaal hergebruikt.
- Het aantal generieke app-logo-fallbacks kan snel van `16` naar `2`.
- Nieuwe icons blijven deel van bestaande families in plaats van een tweede stijl naast de huidige bibliotheek te introduceren.

### Negatief

- Een deel van de iconverbetering vraagt alsnog nieuw SVG-werk.
- `adlar_mode` en `adlar_sterilization` blijven voorlopig mogelijk generiek.
- De compose-bron en build-output voor capability-icons verdienen aparte opschoning om toekomstige vergelijking eenduidig te houden.

## 9. Acceptatiecriteria

1. De Modbus driver heeft een eigen `drivers/intelligent-heatpump-modbus/assets/icon.svg`.
2. Het aantal capabilities dat `/assets/adlar-icon-white.svg` gebruikt daalt van `16` naar maximaal `2`.
3. Nieuwe Modbus-icons worden afgeleid uit bestaande iconfamilies en niet als losse stijlexcepties toegevoegd.
4. `fault.svg` blijft de gedeelde familie voor faultstatussen; daar komt geen afzonderlijk register-per-icon plan voor.
5. `adlar_mode` en `adlar_sterilization` krijgen alleen een uniek nieuw icon als hergebruik of afleiding onvoldoende duidelijk blijkt.

## 10. Bronnen

- Modbus effectief gebruik: `app.json`
- Modbus capabilitybron: `.homeycompose/capabilities/`
- DPS effectief gebruik: `/Users/hermanhilberink/Documents/GitHub/org.hhi.adlar-heatpump/app.json`
- DPS capabilitybron: `/Users/hermanhilberink/Documents/GitHub/org.hhi.adlar-heatpump/.homeycompose/capabilities/`
- DPS driver-icon: `/Users/hermanhilberink/Documents/GitHub/org.hhi.adlar-heatpump/drivers/intelligent-heat-pump/assets/icon.svg`
