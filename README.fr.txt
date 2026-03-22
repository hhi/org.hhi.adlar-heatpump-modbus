Pompe a chaleur Adlar Castra (Modbus)

Cette application donne a Homey Pro un acces local en Modbus TCP a une pompe a chaleur Adlar Castra / Aurora II via un Elfin EW11A ou une autre passerelle Modbus TCP vers RS485. Le fonctionnement quotidien ne depend pas d'un acces cloud.

Etat actuel de l'implementation

- L'appairage utilise uniquement les informations de la passerelle Modbus : adresse IP, port TCP (502 par defaut) et Modbus Unit ID (1 par defaut).
- Les anciens champs Tuya comme Device ID, Local Key et version de protocole ne sont pas utilises dans cette application Modbus.
- Les intervalles de polling sont configurables dans les parametres du peripherique (10 s / 30 s / 300 s par defaut).
- La cartographie actuelle des registres vise les unites Adlar Castra / Aurora II qui utilisent la table de registres Modbus R32.

Prerequis

- Homey Pro avec le firmware 12.2.0 ou plus recent
- Pompe a chaleur Adlar Castra / Aurora II avec connexion Modbus/RS485
- Passerelle Modbus TCP comme un Elfin EW11A

Ce qui fonctionne aujourd'hui

Lecture
- Consignes chauffage, refroidissement et eau chaude sanitaire
- Temperatures de sortie, d'entree, ambiante, serpentins, aspiration, refoulement, ECS, economiseur, saturation, ballon tampon et zones
- Puissance, energie, tension, courant, frequence compresseur, vitesse ventilateur, pas EEV, PWM pompe et debit d'eau
- Etat de marche, degivrage, antigel, sterilisation et informations de defaut decodees

Commande depuis Homey
- Marche/arret principal
- Mode de fonctionnement
- Consigne de chauffage
- Consigne de refroidissement
- Consigne d'eau chaude sanitaire

Valeurs calculees
- COP calcule a partir de la puissance Modbus, du delta de temperature d'eau et du debit d'eau
- Si aucun debitmetre physique n'est connecte, une valeur de debit de secours peut etre configuree dans les parametres du peripherique

Limites actuelles

- Une passerelle Modbus TCP est obligatoire ; cette application n'utilise ni Tuya cloud ni des identifiants Tuya local.
- La consigne chauffage sol et plusieurs fonctions d'ecriture Modbus avancees existent dans la couche service, mais ne sont pas encore exposees dans l'implementation actuelle de l'interface/flows Homey.
- Le COP peut etre absent ou moins precis si les donnees de puissance ou de debit exploitables sont indisponibles.
- Le code signale un avertissement si le refrigerant detecte n'est pas du R32 ; les autres tables de registres ne sont donc pas la cible de cette version.

Installation

1. Connectez le bus RS485/Modbus de la pompe a chaleur a un Elfin EW11A ou a une passerelle Modbus TCP equivalente.
2. Verifiez que la passerelle est joignable depuis Homey sur le reseau local.
3. Ajoutez dans Homey le peripherique "Adlar Castra Heat Pump".
4. Saisissez l'adresse IP, le port TCP et le Modbus Unit ID de la passerelle.
5. Apres l'appairage, ajustez si besoin les parametres du debitmetre et du polling.

Parametres du peripherique

- Adresse IP de la passerelle Modbus
- Port TCP
- Modbus Unit ID
- Debitmetre externe connecte : oui/non
- Debit par defaut en L/min pour le repli du COP
- Intervalles de polling rapides, moyens et lents
- Niveau de journalisation

Remarques pratiques

- Valeurs recommandees : port 502, Unit ID 1, debit de repli 20 L/min.
- Attribuez de preference a la passerelle une reservation DHCP fixe ou une adresse IP statique pour eviter les problemes de reconnexion.
