# Elfin EW11 setup voor Adlar Aurora II / Castra

Deze map bevat screenshots en aansluitbeelden voor het koppelen van een Elfin EW11A Modbus TCP naar RS485 gateway aan een Adlar Aurora II / Castra warmtepomp.

## Aansluiten

Schakel de warmtepomp spanningsloos voordat je de RS485-draden aansluit.

Gebruik de aansluitbeelden:

- [Elfin EW11 aansluiting zijkant](<Elfin EW11 - Adlar Aurora 2/Elfin EW11 aansluiting zijkant.pdf>)
- [Elfin EW11 aansluiting boven](<Elfin EW11 - Adlar Aurora 2/Elfin EW11 aansluting boven.pdf>)
- [USB 5V voeding rood/zwart](<Elfin EW11 - Adlar Aurora 2/usb2-5v-rood-zwart.pdf>)

Algemene RS485-regel:

- RS485 `A/+` van de warmtepomp naar `A/+` op de EW11A
- RS485 `B/-` van de warmtepomp naar `B/-` op de EW11A
- gebruik bij voorkeur een getwist aderpaar
- houd de RS485-kabel weg van 230V-bekabeling
- sluit `GND` alleen aan als de warmtepompdocumentatie of gateway dit voorschrijft

Als er geen Modbus-verbinding komt, controleer dan eerst of `A/B` niet omgewisseld moet worden. RS485-labels worden in de praktijk niet altijd consequent gebruikt.

## EW11A configuratie

Gebruik de screenshots als referentie:

- [Serial Port Settings](<Elfin EW11 - Adlar Aurora 2/EW11 - serial port settings - Aurora II series.png>)
- [Communication Settings](<Elfin EW11 - Adlar Aurora 2/EW11 - communication settngs - Aurora II series.png>)
- [System Settings](<Elfin EW11 - Adlar Aurora 2/EW11 - system settings - Aurora II series.png>)

Aanbevolen instellingen voor Aurora II / Castra:

| Onderdeel | Instelling |
|---|---|
| Serial baud rate | `9600` |
| Data bits | `8` |
| Stop bits | `1` |
| Parity | `None` |
| Flow control | `Half Duplex` |
| Serial protocol | `Modbus` |
| TCP mode | `TCP Server` |
| Local port | `502` |
| Route | `UART` |
| Web interface | enabled, port `80` |

Netwerk:

- geef de EW11A bij voorkeur een vast IP-adres of DHCP-reservering
- noteer dit IP-adres voor het koppelen in Homey
- gebruik in Homey poort `502`
- gebruik Modbus Unit ID `1`, tenzij de warmtepomp anders is ingesteld

## Koppelen in Homey

Vul bij het toevoegen van het apparaat in Homey in:

- IP-adres van de EW11A
- TCP-poort `502`
- Modbus Unit ID `1`

Bij verbindingsproblemen:

1. controleer voeding en netwerkbereikbaarheid van de EW11A;
2. controleer TCP Server / poort `502`;
3. controleer seriele instellingen: `9600`, `8N1`, parity `None`;
4. controleer Modbus Unit ID;
5. wissel RS485 `A/B` als alle instellingen kloppen maar er geen antwoord komt.

## Dashboards openen

Als de app draait, start Homey een lokale dashboardserver. De standaardpoort is `8090`; deze poort is instelbaar via de device setting `Dashboardpoort`.

Open vanaf een apparaat op hetzelfde lokale netwerk:

| URL | Doel |
|---|---|
| `http://<homey-ip>:8090/` | Live read-only dashboard met actuele warmtepompwaarden |
| `http://<homey-ip>:8090/interactive` | Interactief dashboard voor veelgebruikte bediening |
| `http://<homey-ip>:8090/expert` | Expertdashboard met Modbus-adressen, P/L-parameter-ID's en live lees-/schrijftools |
| `http://<homey-ip>:8090/heating-curve` | Editor voor de DIY-stooklijn |

Vervang `<homey-ip>` door het IP-adres van je Homey Pro.
Als je de dashboardpoort hebt aangepast, vervang `8090` door de ingestelde poort.

Als de pagina niet opent:

1. controleer of Homey en je browser op hetzelfde netwerk zitten;
2. controleer het IP-adres van Homey;
3. herstart de app of het apparaat als de dashboardserver nog niet gestart is;
4. controleer of poort `8090` niet geblokkeerd wordt.

Gebruik het expertdashboard zorgvuldig: schrijfbare Modbus-registers kunnen het gedrag van de warmtepomp wijzigen.
