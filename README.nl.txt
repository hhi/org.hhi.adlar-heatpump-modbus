Adlar Castra Warmtepomp (Modbus)

Deze app geeft Homey Pro lokale Modbus TCP-toegang tot een Adlar Castra / Aurora II warmtepomp via een Elfin EW11A of een andere Modbus TCP-naar-RS485-gateway. Voor de dagelijkse werking is geen cloudtoegang nodig.

Huidige status van de implementatie

- Het koppelen gebruikt alleen de gegevens van de Modbus-gateway: IP-adres, TCP-poort (standaard 502) en Modbus Unit ID (standaard 1).
- Oude Tuya-velden zoals Device ID, Local Key en protocolversie worden in deze Modbus-app niet gebruikt.
- Poll-intervallen zijn configureerbaar in de apparaatinstellingen (standaard 10 s / 30 s / 300 s).
- De huidige registermapping is gericht op Adlar Castra / Aurora II-units die de R32 Modbus-registermap gebruiken.

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

Bediening vanuit Homey
- Hoofd aan/uit
- Bedrijfsmodus
- Verwarmingssetpoint
- Koelsetpoint
- DHW-setpoint

Berekende waarden
- COP op basis van Modbus-vermogen, watertemperatuurverschil en waterdebiet
- Als er geen fysieke debietmeter is aangesloten, kan in de apparaatinstellingen een fallback-debietwaarde worden ingesteld

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
5. Pas na het koppelen desgewenst de instellingen voor debietmeter en polling aan.

Apparaatinstellingen

- IP-adres van de Modbus-gateway
- TCP-poort
- Modbus Unit ID
- Externe debietmeter aangesloten: ja/nee
- Standaard debiet in L/min voor COP-fallback
- Snelle, middelmatige en langzame poll-intervallen
- Logniveau

Praktische opmerkingen

- Aanbevolen standaardwaarden: poort 502, Unit ID 1, fallback-debiet 20 L/min.
- Geef de gateway een vaste DHCP-reservering of statisch IP-adres om reconnect-problemen te voorkomen.
