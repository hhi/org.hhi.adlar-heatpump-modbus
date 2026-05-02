Adlar Castra Warmtepomp (Modbus)

Deze app geeft Homey Pro lokale Modbus TCP-toegang tot een Adlar Castra / Aurora II warmtepomp via een Elfin EW11A of een andere Modbus TCP-naar-RS485-gateway. Voor de dagelijkse werking is geen cloudtoegang nodig.

Huidige status van de implementatie

- Het koppelen gebruikt alleen de gegevens van de Modbus-gateway: IP-adres, TCP-poort (standaard 502) en Modbus Unit ID (standaard 1).
- Oude Tuya-velden zoals Device ID, Local Key en protocolversie worden in deze Modbus-app niet gebruikt.
- Poll-intervallen zijn configureerbaar in de apparaatinstellingen (standaard 10 s / 30 s / 300 s).
- De huidige registermapping is gericht op Adlar Castra / Aurora II-units die de R32 Modbus-registermap gebruiken.
- De schaal voor temperatuurregisters is instelbaar (x1 of x10) voor units die temperaturen anders rapporteren.

Vereisten

- Homey Pro met firmware 12.2.0 of nieuwer
- Adlar Castra / Aurora II warmtepomp met Modbus/RS485-aansluiting
- Modbus TCP-gateway zoals een Elfin EW11A

Wat werkt vandaag

Uitlezen
- Verwarmings-, koel- en DHW-setpoints
- Uitlaat-, inlaat-, omgevings-, spoel-, zuig-, uitlaat-, DHW-, economizer-, verzadigings-, buffer- en zonetemperaturen
- Vermogen, energie, spanning, stroom, compressorfrequentie, ventilatorsnelheid, EEV-stap, pomp-PWM en waterdebiet
- Bedrijfsstatus, ontdooien, antivries, sterilisatie en gedecodeerde storingsinformatie
- Lokale dashboards standaard op http://<homey-ip>:8090/, inclusief een expertdashboard dat Modbus-adressen plus P/L-parameter-ID's zoals P88 en L28 toont

Bediening vanuit Homey
- Hoofd aan/uit
- Bedrijfsmodus
- Verwarmingssetpoint
- Koelsetpoint
- DHW-setpoint

Berekende waarden
- COP op basis van Modbus-vermogen, watertemperatuurverschil en waterdebiet
- Externe debietdata kan indien nodig via flow kaarten worden aangeleverd voor COP-berekeningen

Huidige beperkingen

- Een Modbus TCP-gateway is vereist; deze app gebruikt geen Tuya-cloud of Tuya-local-credentials.
- Het setpoint voor vloerverwarming en verschillende geavanceerde Modbus-schrijffuncties bestaan in de servicelaag, maar zijn nog niet zichtbaar in de huidige Homey UI/flow-implementatie.
- COP kan ontbreken of minder nauwkeurig zijn wanneer bruikbare vermogens- of debietdata niet beschikbaar is.
- De code geeft een waarschuwing als het gedetecteerde koudemiddel niet R32 is, dus andere registermappen vallen buiten het doel van deze versie.

Installatie

1. Verbind de RS485/Modbus-bus van de warmtepomp met een Elfin EW11A of een gelijkwaardige Modbus TCP-gateway.
2. Zorg dat de gateway vanaf Homey bereikbaar is op het lokale netwerk.
3. Voeg in Homey het apparaat "Adlar Castra Warmtepomp" toe.
4. Vul het IP-adres, de TCP-poort en de Modbus Unit ID van de gateway in.
5. Pas na het koppelen desgewenst polling, temperatuurschaal en overige apparaatinstellingen aan.

Zie [docs/setup](docs/setup/README.md) voor EW11A-aansluitbeelden en configuratiescreenshots.

Lokale dashboards

Open de dashboards met een browser op hetzelfde lokale netwerk als Homey:

- http://<homey-ip>:8090/ - live read-only dashboard met actuele warmtepompwaarden
- http://<homey-ip>:8090/interactive - interactief dashboard voor veelgebruikte bediening
- http://<homey-ip>:8090/expert - expertdashboard met Modbus-adressen, P/L-parameter-ID's en live lees-/schrijftools
- http://<homey-ip>:8090/heating-curve - editor voor de DIY-stooklijn

Vervang <homey-ip> door het IP-adres van je Homey Pro. Gebruik het expertdashboard zorgvuldig: schrijfbare Modbus-registers kunnen het gedrag van de warmtepomp wijzigen.
De standaard dashboardpoort is 8090; als je de instelling Dashboardpoort hebt aangepast, gebruik dan die poort in de URL.

Apparaatinstellingen

- IP-adres van de Modbus-gateway
- TCP-poort
- Modbus Unit ID
- Temperatuur register schaal (x1 of x10)
- Dashboardpoort (standaard 8090)
- Snelle, middelmatige en langzame poll-intervallen
- Logniveau

Praktische opmerkingen

- Aanbevolen standaardwaarden: poort 502, Unit ID 1.
- Gebruik temperatuurschaal x1 als register 35 betekent 35 graden C; gebruik x10 als register 350 betekent 35,0 graden C.
- Geef de gateway een vaste DHCP-reservering of statisch IP-adres om reconnect-problemen te voorkomen.
