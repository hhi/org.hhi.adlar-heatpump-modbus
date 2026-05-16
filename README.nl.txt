Adlar Castra Warmtepomp (Modbus)

Deze app geeft Homey Pro lokale Modbus TCP-toegang tot een Adlar Castra / Aurora II warmtepomp via een Elfin EW11A of een andere Modbus TCP-naar-RS485-gateway. Voor de dagelijkse werking is geen cloudtoegang nodig.

Huidige status van de implementatie

- Het koppelen gebruikt alleen de gegevens van de Modbus-gateway: IP-adres, TCP-poort (standaard 502) en Modbus Unit ID (standaard 1).
- Oude Tuya-velden zoals Device ID, Local Key en protocolversie worden in deze Modbus-app niet gebruikt.
- Poll-intervallen zijn configureerbaar in de apparaatinstellingen (standaard supersnel/snel/medium/langzaam: 5 s / 10 s / 30 s / 300 s). Supersnel pollen kan na live waardewijzigingen tijdelijk naar 2 s versnellen.
- De huidige registermapping is gericht op Adlar Castra / Aurora II-units die de R32 Modbus-registermap gebruiken.
- De schaal voor temperatuurregisters wordt automatisch bepaald op basis van het koudemiddeltype (P119): R32 gebruikt x1 (°C), R290 gebruikt x10 (deci-°C).

Vereisten

- Homey Pro met firmware 12.2.0 of nieuwer
- Adlar Castra / Aurora II warmtepomp met Modbus/RS485-aansluiting
- Modbus TCP-gateway zoals een Elfin EW11A

Wat werkt vandaag

Uitlezen
- Verwarmings-, koel-, DHW- en vloerverwarming-setpoints
- Uitlaat-, inlaat-, omgevings-, spoel-, zuig-, uitlaat-, DHW-, economizer-, verzadigings-, buffer- en zonetemperaturen
- Vermogen, energie, spanning, stroom, compressorfrequentie, ventilatorsnelheid, EEV-stap, pomp-PWM en waterdebiet
- Bedrijfsstatus, ontdooien, antivries, sterilisatie en gedecodeerde storingsinformatie
- Lokale dashboards standaard op http://<homey-ip>:8090/, inclusief een expertdashboard dat Modbus-adressen plus P/L-parameter-ID's zoals P88 en L28 toont

Bediening vanuit Homey
- Hoofd aan/uit
- Bedrijfsmodus en werkmodus
- Verwarmingssetpoint
- Koelsetpoint
- DHW-setpoint
- Stooklijn-preset en tapwatercurve-preset
- Gewenste binnentemperatuur voor adaptieve regeling
- Flow-kaarten voor direct Modbus-register lezen/schrijven en een DIY-stooklijn flow-kaart

Berekende waarden
- COP op basis van Modbus-vermogen, watertemperatuurverschil en waterdebiet
- Extern vermogen, debiet, buitentemperatuur, binnentemperatuur, energieprijzen, zonnepaneelvermogen, zonnestraling en winddata kunnen via flow-kaarten worden aangeleverd
- Drempel-, alarm- en storings-flowkaarten zijn beschikbaar voor gemonitorde Modbus-waarden

Huidige beperkingen

- Een Modbus TCP-gateway is vereist; deze app gebruikt geen Tuya-cloud of Tuya-local-credentials.
- Het vloerverwarming-setpoint wordt uitgelezen, getoond en is schrijfbaar via de apparaatcapability; er is nog geen eigen flow-actie voor.
- Geavanceerde Modbus-schrijfopties zijn beschikbaar via flow-kaarten en het expertdashboard; gebruik ze zorgvuldig.
- COP kan ontbreken of minder nauwkeurig zijn wanneer bruikbare vermogens- of debietdata niet beschikbaar is.
- De code geeft een waarschuwing als het gedetecteerde koudemiddel niet R32 is, dus andere registermappen vallen buiten het doel van deze versie.

Installatie

1. Verbind de RS485/Modbus-bus van de warmtepomp met een Elfin EW11A of een gelijkwaardige Modbus TCP-gateway.
2. Zorg dat de gateway vanaf Homey bereikbaar is op het lokale netwerk.
3. Voeg in Homey het apparaat "Adlar Castra Warmtepomp" toe.
4. Vul het IP-adres, de TCP-poort en de Modbus Unit ID van de gateway in.
5. Pas na het koppelen desgewenst poll-intervallen en overige apparaatinstellingen aan.

Zie docs/setup/README.md voor de volledige installatieprocedure voor het aansluiten van de warmtepomp via een Modbus TCP-gateway.

Lokale dashboards

Open de dashboards met een browser op hetzelfde lokale netwerk als Homey:

- http://<homey-ip>:8090/ - live read-only dashboard met actuele warmtepompwaarden
- http://<homey-ip>:8090/interactive - interactief dashboard: live sensoroverzicht met COP, temperaturen, compressor en debiet; setpoints direct vanuit de browser aanpassen
- http://<homey-ip>:8090/live - live capability dashboard: alle device-capabilities gegroepeerd per categorie met iconen en een aparte diagnostiek-sectie
- http://<homey-ip>:8090/expert - expertdashboard met Modbus-adressen, P/L-parameter-ID's en live lees-/schrijftools
- http://<homey-ip>:8090/changelog - per-register wijzigingslog: aantal wijzigingen, gemiddeld interval en aanbevolen pollgroep voor elk waargenomen Modbus-register
- http://<homey-ip>:8090/heating-curve - editor voor de DIY-stooklijn

Vervang <homey-ip> door het IP-adres van je Homey Pro. Gebruik het expertdashboard zorgvuldig: schrijfbare Modbus-registers kunnen het gedrag van de warmtepomp wijzigen.
De standaard dashboardpoort is 8090; als je de instelling Dashboardpoort hebt aangepast, gebruik dan die poort in de URL.

Apparaatinstellingen

- IP-adres van de Modbus-gateway
- TCP-poort
- Modbus Unit ID
- Dashboardpoort (standaard 8090)
- Supersnelle, snelle, middelmatige en langzame poll-intervallen
- Logniveau

Praktische opmerkingen

- Aanbevolen standaardwaarden: poort 502, Unit ID 1.
- Geef de gateway een vaste DHCP-reservering of statisch IP-adres om reconnect-problemen te voorkomen.
