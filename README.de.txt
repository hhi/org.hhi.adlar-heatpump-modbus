Adlar Castra Waermepumpe (Modbus)

Diese App gibt Homey Pro lokalen Modbus-TCP-Zugriff auf eine Adlar Castra / Aurora II Waermepumpe ueber ein Elfin EW11A oder ein anderes Modbus-TCP-zu-RS485-Gateway. Fuer den taeglichen Betrieb ist keine Cloud-Verbindung erforderlich.

Aktueller Stand der Implementierung

- Beim Koppeln werden nur die Modbus-Gateway-Daten verwendet: IP-Adresse, TCP-Port (Standard 502) und Modbus Unit ID (Standard 1).
- Alte Tuya-Felder wie Device ID, Local Key und Protokollversion werden in dieser Modbus-App nicht verwendet.
- Die Polling-Intervalle sind in den Geraeteeinstellungen konfigurierbar (Standard 10 s / 30 s / 300 s).
- Das aktuelle Register-Mapping ist auf Adlar Castra / Aurora II Geraete mit der R32-Modbus-Registerkarte ausgerichtet.

Voraussetzungen

- Homey Pro mit Firmware 12.2.0 oder neuer
- Adlar Castra / Aurora II Waermepumpe mit Modbus/RS485-Anschluss
- Modbus-TCP-Gateway wie ein Elfin EW11A

Was heute funktioniert

Auslesen
- Heiz-, Kuehl- und Warmwasser-Sollwerte
- Auslass-, Einlass-, Aussen-, Verdampfer-, Saug-, Verdichterauslass-, Warmwasser-, Economizer-, Saettigungs-, Puffer- und Zonentemperaturen
- Leistung, Energie, Spannung, Strom, Verdichterfrequenz, Ventilatordrehzahl, EEV-Schritt, Pumpen-PWM und Wasserdurchfluss
- Betriebszustand, Abtauung, Frostschutz, Sterilisation und decodierte Stoerungsinformationen

Steuerung aus Homey
- Haupt-Ein/Aus
- Betriebsmodus
- Heiz-Sollwert
- Kuehl-Sollwert
- Warmwasser-Sollwert

Berechnete Werte
- COP auf Basis von Modbus-Leistung, Wasser-Temperaturdifferenz und Wasserdurchfluss
- Wenn kein physischer Durchflusssensor angeschlossen ist, kann in den Geraeteeinstellungen ein fester Ersatzwert konfiguriert werden

Aktuelle Einschraenkungen

- Ein Modbus-TCP-Gateway ist erforderlich; diese App verwendet weder Tuya-Cloud noch Tuya-Local-Zugangsdaten.
- Der Fussbodenheizungs-Sollwert und mehrere erweiterte Modbus-Schreibfunktionen existieren in der Service-Schicht, sind aber in der aktuellen Homey-UI/Flow-Implementierung noch nicht freigeschaltet.
- Der COP kann fehlen oder ungenauer sein, wenn nutzbare Leistungs- oder Durchflussdaten fehlen.
- Der Code gibt eine Warnung aus, wenn das erkannte Kaeltemittel nicht R32 ist; andere Registerkarten sind daher nicht Ziel dieser Version.

Installation

1. Verbinden Sie den RS485/Modbus-Bus der Waermepumpe mit einem Elfin EW11A oder einem vergleichbaren Modbus-TCP-Gateway.
2. Stellen Sie sicher, dass das Gateway von Homey im lokalen Netzwerk erreichbar ist.
3. Fuegen Sie in Homey das Geraet "Adlar Castra Waermepumpe" hinzu.
4. Geben Sie IP-Adresse, TCP-Port und Modbus Unit ID des Gateways ein.
5. Passen Sie nach dem Koppeln bei Bedarf die Einstellungen fuer Durchflusssensor und Polling an.

Geraeteeinstellungen

- IP-Adresse des Modbus-Gateways
- TCP-Port
- Modbus Unit ID
- Externer Durchflusssensor angeschlossen: ja/nein
- Standard-Durchfluss in L/min als COP-Ersatzwert
- Schnelle, mittlere und langsame Polling-Intervalle
- Log-Level

Praktische Hinweise

- Empfohlene Standardwerte: Port 502, Unit ID 1, Ersatz-Durchfluss 20 L/min.
- Geben Sie dem Gateway nach Moeglichkeit eine feste DHCP-Reservierung oder statische IP-Adresse, um Reconnect-Probleme zu vermeiden.
