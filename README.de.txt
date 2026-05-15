Adlar Castra Waermepumpe (Modbus)

Diese App gibt Homey Pro lokalen Modbus-TCP-Zugriff auf eine Adlar Castra / Aurora II Waermepumpe ueber ein Elfin EW11A oder ein anderes Modbus-TCP-zu-RS485-Gateway. Fuer den taeglichen Betrieb ist keine Cloud-Verbindung erforderlich.

Aktueller Stand der Implementierung

- Beim Koppeln werden nur die Modbus-Gateway-Daten verwendet: IP-Adresse, TCP-Port (Standard 502) und Modbus Unit ID (Standard 1).
- Alte Tuya-Felder wie Device ID, Local Key und Protokollversion werden in dieser Modbus-App nicht verwendet.
- Die Polling-Intervalle sind in den Geraeteeinstellungen konfigurierbar (Standard superschnell/schnell/mittel/langsam: 5 s / 10 s / 30 s / 300 s). Superschnelles Polling kann nach Live-Wertaenderungen kurz auf 2 s beschleunigen.
- Das aktuelle Register-Mapping ist auf Adlar Castra / Aurora II Geraete mit der R32-Modbus-Registerkarte ausgerichtet.
- Die Skalierung von Temperaturregistern wird automatisch aus dem Kaeltemitteltyp (P119) ermittelt: R32 verwendet x1 (°C), R290 verwendet x10 (Dezi-°C).

Voraussetzungen

- Homey Pro mit Firmware 12.2.0 oder neuer
- Adlar Castra / Aurora II Waermepumpe mit Modbus/RS485-Anschluss
- Modbus-TCP-Gateway wie ein Elfin EW11A

Was heute funktioniert

Auslesen
- Heiz-, Kuehl-, Warmwasser- und Fussbodenheizungs-Sollwerte
- Auslass-, Einlass-, Aussen-, Verdampfer-, Saug-, Verdichterauslass-, Warmwasser-, Economizer-, Saettigungs-, Puffer- und Zonentemperaturen
- Leistung, Energie, Spannung, Strom, Verdichterfrequenz, Ventilatordrehzahl, EEV-Schritt, Pumpen-PWM und Wasserdurchfluss
- Betriebszustand, Abtauung, Frostschutz, Sterilisation und decodierte Stoerungsinformationen
- Lokale Dashboards standardmaessig unter http://<homey-ip>:8090/, inklusive Experten-Dashboard mit Modbus-Adressen und P/L-Parameter-IDs wie P88 und L28

Steuerung aus Homey
- Haupt-Ein/Aus
- Betriebsmodus und Arbeitsmodus
- Heiz-Sollwert
- Kuehl-Sollwert
- Warmwasser-Sollwert
- Heizkurven-Preset und Warmwasser-Kurven-Preset
- Gewuenschte Innentemperatur fuer adaptive Regelung
- Flow-Karten fuer direktes Modbus-Register Lesen/Schreiben und eine DIY-Heizkurven-Flow-Karte

Berechnete Werte
- COP auf Basis von Modbus-Leistung, Wasser-Temperaturdifferenz und Wasserdurchfluss
- Externe Leistung, Durchfluss, Aussentemperatur, Innentemperatur, Energiepreise, Solarleistung, Sonnenstrahlung und Winddaten koennen ueber Flow-Karten geliefert werden
- Schwellenwert-, Alarm- und Stoerungs-Flow-Karten sind fuer ueberwachte Modbus-Werte verfuegbar

Aktuelle Einschraenkungen

- Ein Modbus-TCP-Gateway ist erforderlich; diese App verwendet weder Tuya-Cloud noch Tuya-Local-Zugangsdaten.
- Der Fussbodenheizungs-Sollwert wird gelesen, angezeigt und ist ueber die Geraetecapability schreibbar; es gibt noch keine eigene Flow-Aktion dafuer.
- Erweiterte Modbus-Schreibwerkzeuge sind ueber Flow-Karten und das Experten-Dashboard verfuegbar; verwenden Sie sie vorsichtig.
- Der COP kann fehlen oder ungenauer sein, wenn nutzbare Leistungs- oder Durchflussdaten fehlen.
- Der Code gibt eine Warnung aus, wenn das erkannte Kaeltemittel nicht R32 ist; andere Registerkarten sind daher nicht Ziel dieser Version.

Installation

1. Verbinden Sie den RS485/Modbus-Bus der Waermepumpe mit einem Elfin EW11A oder einem vergleichbaren Modbus-TCP-Gateway.
2. Stellen Sie sicher, dass das Gateway von Homey im lokalen Netzwerk erreichbar ist.
3. Fuegen Sie in Homey das Geraet "Adlar Castra Waermepumpe" hinzu.
4. Geben Sie IP-Adresse, TCP-Port und Modbus Unit ID des Gateways ein.
5. Passen Sie nach dem Koppeln bei Bedarf Polling-Intervalle und weitere Geraeteeinstellungen an.

Die vollstaendige Einrichtungsanleitung fuer den Anschluss der Waermepumpe ueber ein Modbus-TCP-Gateway finden Sie unter docs/setup/README.md.

Lokale Dashboards

Oeffnen Sie die Dashboards mit einem Browser im selben lokalen Netzwerk wie Homey:

- http://<homey-ip>:8090/ - Live-Dashboard nur zum Lesen mit aktuellen Waermepumpenwerten
- http://<homey-ip>:8090/interactive - interaktives Dashboard fuer haeufige Bedienung
- http://<homey-ip>:8090/expert - Experten-Dashboard mit Modbus-Adressen, P/L-Parameter-IDs und Live-Lese-/Schreibwerkzeugen
- http://<homey-ip>:8090/heating-curve - Editor fuer die DIY-Heizkurve
- http://<homey-ip>:8090/changelog - Register-Aenderungsprotokoll: Anzahl der Aenderungen, Durchschnittsintervall und empfohlene Polling-Gruppe fuer jedes beobachtete Modbus-Register

Ersetzen Sie <homey-ip> durch die IP-Adresse Ihres Homey Pro. Verwenden Sie das Experten-Dashboard vorsichtig: schreibbare Modbus-Register koennen das Verhalten der Waermepumpe aendern.
Der Standard-Dashboard-Port ist 8090; wenn Sie die Einstellung Dashboard-Port geaendert haben, verwenden Sie diesen Port in der URL.

Geraeteeinstellungen

- IP-Adresse des Modbus-Gateways
- TCP-Port
- Modbus Unit ID
- Dashboard-Port (Standard 8090)
- Superschnelle, schnelle, mittlere und langsame Polling-Intervalle
- Log-Level

Praktische Hinweise

- Empfohlene Standardwerte: Port 502, Unit ID 1.
- Geben Sie dem Gateway nach Moeglichkeit eine feste DHCP-Reservierung oder statische IP-Adresse, um Reconnect-Probleme zu vermeiden.
