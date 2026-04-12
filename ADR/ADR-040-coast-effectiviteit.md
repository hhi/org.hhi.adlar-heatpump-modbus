# ADR-040: Coast Effectiviteitsverbetering — Conditioneel Gewicht en Outlet-Dalingstrend

**Status:** Voorstel
**Datum:** 2026-04-09
**Gerelateerd:** [ADR-024 Adaptive Cooldown Mode](implementation-plan-adaptive-cooldown-mode.md)

---

## 1. Aanleiding

Veldklacht: bij een buitentemperatuur boven 5°C en een kamerthermostaat ingesteld op 20,5°C werd de outlet watertemperatuur (>45°C) na 3 uur niet teruggeregeld. Gevolg: kamertemperatuur opgelopen tot ~23°C. Handmatige verlaging van de PI-parameters (P omlaag, I en D minimaal) bracht geen oplossing.

---

## 2. Analyse

### 2.1 Simulatie

Een simulatie over 36 cycli (= 3 uur, cyclus = 5 minuten) met de volgende parameters:

- `indoorTemp` start: 23°C, `desiredIndoorTemp`: 20,5°C
- `outletTemp` start: 45°C, `currentSetpoint` start: 45°C
- Outlet-respons: `outlet += 0.1 × (setpoint − outlet)` per cyclus
- Kamertemperatuur: +0,017°C/cyclus zolang outlet > 32°C (evenwichts-outlet)
- Coast strength: 0,80, offset: 1°C, throttle: 20 min

**Resultaat na 36 cycli:**

| Grootheid | Start | Na 3 uur |
|-----------|-------|----------|
| Setpoint | 45°C | 32°C (−13°C) |
| Outlet | 45°C | 35°C (−10°C) |
| Kamertemperatuur | 23,0°C | 23,6°C (nog stijgend) |

Coast leverde in **31 van de 36 cycli een bijdrage van 0°C**, terwijl het 88% van het gewichtsbudget bezette.

### 2.2 Oorzaak

De coast-formule ([adaptive-control-service.ts:601](../../lib/services/adaptive-control-service.ts)):

```typescript
const rawAdjustment = (outletTemp - offset) - currentSetpoint;
const adjustment = Math.min(0, rawAdjustment);
```

Na elke setpoint-verlaging loopt de gemeten outlet door hydraulische traagheid tijdelijk achter. In die periode geldt:

```
outletTemp > currentSetpoint + offset  →  rawAdjustment > 0  →  coastAdj = 0
```

Tegelijkertijd bezet coast via `coastStrength = 0.80` altijd 88% van het gewichtsbudget zodra `_coastActive = true`, ongeacht of `coastAdj` nul of negatief is. De PI-controller — die correct −3°C wil bijsturen — krijgt daardoor slechts 11% gewicht en levert effectief −0,33°C per cyclus.

### 2.3 Causale keten

```
Setpoint verlaging
      ↓
Hydraulische traagheid (minuten)
      ↓
Outlet daalt  ← leading indicator (vroeg signaal)
      ↓
Thermische traagheid (uren)
      ↓
Kamertemperatuur daalt  ← lagging indicator (laat signaal)
```

De huidige coast-formule is afhankelijk van het **momentele** verschil tussen outlet en setpoint. Door hydraulische traagheid is dit verschil na een setpoint-verlaging tijdelijk positief, waardoor coast zichzelf blokkeert — precies in de fase dat ingrijpen het meest nodig is.

---

## 3. Beslissing

### Beslissing A — Conditioneel gewicht

Coast krijgt alleen gewicht wanneer `coastAdj < 0`. Bij `coastAdj = 0` (hydraulische vertraging na setpoint-verlaging) valt het coast-gewicht terug naar nul, zodat PI het volledige budget overneemt.

**Wijziging in `WeightedDecisionMaker.combineActionsWithThermal()`:**

```typescript
// Huidig — weight altijd 0.80 zodra coastAction aanwezig is
const effectiveCoastWeight = coastStrength;

// Nieuw — weight alleen wanneer coast daadwerkelijk bijdraagt
const effectiveCoastWeight = (coastAdjust < 0) ? coastStrength : 0;
```

Dit sluit aan bij het bestaande patroon voor COP-optimizer en prijs-optimizer:

```typescript
// Vergelijk: COP en prijs krijgen ook nul gewicht wanneer ze niets te bieden hebben
const effectiveEfficiencyWeight = this.priorities.efficiency * confidenceMetrics.copConfidence;
const effectiveCostWeight = this.priorities.cost * (confidenceMetrics.priceDataAvailable ? 1.0 : 0.0);
```

**Effect op simulatie:**

| Cyclus | coastAdj | Oud: PI bijdrage | Nieuw: PI bijdrage |
|--------|----------|------------------|---------------------|
| 6−36 (31 cycli) | 0 | −0,33°C (11%) | −3,0°C (100%) |
| 1−5 (5 cycli) | < 0 | ongewijzigd | ongewijzigd |

### Beslissing B — Outlet-dalingstrend als leading indicator

In plaats van het momentele verschil `outletTemp − setpoint` te gebruiken als ankerpunt, meet het systeem de **dalingsnelheid van de outlet** over een venster van 4 cycli × 5 minuten (= 20 minuten).

**Redenering:**

- De outlet-dalingstrend is een leading indicator — hij reageert op setpoint-wijzigingen binnen minuten, terwijl de kamertemperatuur uren achterloopt
- Een trage outlet-daling bij een grote kamer-fout signaleert dat de installatie onvoldoende reageert en meer bijsturing nodig heeft
- Een versnellende outlet-daling geeft aan dat eerdere setpoint-verlagingen doorwerken — verdere verlaging is dan minder urgent
- De dalingsnelheid is empirisch bepaalbaar per installatie (hydraulische traagheid verschilt per type installatie, volume, afgiftesysteem)

**Principe:**

```
dOutlet/dt = (outletTemp_nu − outletTemp_4_cycli_geleden) / 20 min

Snel dalend  →  installatie reageert goed  →  kleine extra correctie
Traag dalend →  installatie reageert traag →  grotere extra correctie
Stabiliseert →  plafond bereikt            →  geen verdere vergroting
```

**Implementatie-aanpak:**

- Voeg een `_outletTempHistory` sliding window toe (4 metingen, analoog aan `_indoorTempHistory`)
- Bereken `outletDropRate` per cyclus in °C/cyclus
- Gebruik `outletDropRate` als schaalfactor voor de coast-correctie in `_buildCoastAction()`

**Leeraspect:**

De optimale relatie tussen setpoint-verlaging en outlet-dalingsnelheid is installatiespecifiek. Een toekomstige uitbreiding kan — analoog aan de `BuildingModelLearner` — deze relatie empirisch leren via een eenvoudige regressie over historische `(setpoint-delta, outletDropRate)`-paren.

---

## 4. Afwegingen

| Aspect | Beslissing A | Beslissing B |
|--------|-------------|-------------|
| Complexiteit | Minimaal (1 regel) | Matig (history + berekening) |
| Directe impact | Groot | Groot |
| Installatiespecifiek | Nee | Ja (empirisch) |
| Leerperiode nodig | Nee | Initieel niet, later optioneel |
| Risico | Laag | Laag — graceful degradation bij ontbrekende history |

Beide beslissingen zijn complementair en kunnen gelijktijdig geïmplementeerd worden:

- **A** voorkomt dat coast het PI-budget verspilt
- **B** zorgt dat coast eerder en betrouwbaarder een negatieve waarde produceert

---

## 5. Wat buiten scope valt

- Wijziging van de coast-activeringsdrempel (hysteresis, cycleCount) — die logica is correct
- Wijziging van de throttle (20 min) — dit is een anti-oscillatie maatregel die los staat van dit probleem
- Koppeling met de BuildingModelLearner voor τ-gebaseerde voorspelling — dit is een toekomstige uitbreiding

---

## 6. Gerelateerde observaties

De veldklacht onthult een bredere architecturale spanning: de coast-strategie reageert op een **lagging indicator** (kamertemperatuur te warm) terwijl de **leading indicator** (outlet te hoog voor de omstandigheden) al veel eerder beschikbaar is. ADR-040 adresseert de directe effectiviteit van coast; een toekomstige ADR kan de activeringslogica uitbreiden met outlet-gebaseerde vroegtijdige activering.
