Pompe a chaleur Adlar Castra (Modbus)

Cette application donne a Homey Pro un acces local en Modbus TCP a une pompe a chaleur Adlar Castra / Aurora II via un Elfin EW11A ou une autre passerelle Modbus TCP vers RS485. Le fonctionnement quotidien ne depend pas d'un acces cloud.

Etat actuel de l'implementation

- L'appairage utilise uniquement les informations de la passerelle Modbus : adresse IP, port TCP (502 par defaut) et Modbus Unit ID (1 par defaut).
- Les anciens champs Tuya comme Device ID, Local Key et version de protocole ne sont pas utilises dans cette application Modbus.
- Les intervalles de polling sont configurables dans les parametres du peripherique (super rapide/rapide/moyen/lent par defaut : 5 s / 10 s / 30 s / 300 s). Le polling super rapide peut accelerer temporairement a 2 s apres un changement de valeur live.
- La cartographie actuelle des registres vise les unites Adlar Castra / Aurora II qui utilisent la table de registres Modbus R32.
- L'echelle des registres de temperature est detectee automatiquement a partir du type de refrigerant (P119) : R32 utilise x1 (°C), R290 utilise x10 (deci-°C).

Prerequis

- Homey Pro avec le firmware 12.2.0 ou plus recent
- Pompe a chaleur Adlar Castra / Aurora II avec connexion Modbus/RS485
- Passerelle Modbus TCP comme un Elfin EW11A

Ce qui fonctionne aujourd'hui

Lecture
- Consignes chauffage, refroidissement, eau chaude sanitaire et chauffage au sol
- Temperatures de sortie, d'entree, ambiante, serpentins, aspiration, refoulement, ECS, economiseur, saturation, ballon tampon et zones
- Puissance, energie, tension, courant, frequence compresseur, vitesse ventilateur, pas EEV, PWM pompe et debit d'eau
- Etat de marche, degivrage, antigel, sterilisation et informations de defaut decodees
- Tableaux de bord locaux sur http://<homey-ip>:8090/ par defaut, avec un tableau expert qui affiche les adresses Modbus et les identifiants de parametres P/L comme P88 et L28

Commande depuis Homey
- Marche/arret principal
- Mode de fonctionnement et mode de travail
- Consigne de chauffage
- Consigne de refroidissement
- Consigne d'eau chaude sanitaire
- Prereglage de courbe de chauffage et prereglage de courbe eau chaude
- Temperature interieure souhaitee pour le controle adaptatif
- Cartes Flow pour lecture/ecriture directe de registres Modbus et carte Flow de courbe de chauffe DIY

Valeurs calculees
- COP calcule a partir de la puissance Modbus, du delta de temperature d'eau et du debit d'eau
- Puissance externe, debit, temperature exterieure, temperature interieure, prix de l'energie, puissance solaire, rayonnement solaire et vent peuvent etre fournis via des cartes Flow
- Des cartes Flow de seuil, d'alerte et de defaut sont disponibles pour les valeurs Modbus surveillees

Limites actuelles

- Une passerelle Modbus TCP est obligatoire ; cette application n'utilise ni Tuya cloud ni des identifiants Tuya local.
- La consigne de chauffage au sol est lue, affichee et modifiable via la capacite de l'appareil ; il n'existe pas encore d'action Flow dediee.
- Des outils d'ecriture Modbus avances sont disponibles via les cartes Flow et le tableau expert ; utilisez-les avec prudence.
- Le COP peut etre absent ou moins precis si les donnees de puissance ou de debit exploitables sont indisponibles.
- Le code signale un avertissement si le refrigerant detecte n'est pas du R32 ; les autres tables de registres ne sont donc pas la cible de cette version.

Installation

1. Connectez le bus RS485/Modbus de la pompe a chaleur a un Elfin EW11A ou a une passerelle Modbus TCP equivalente.
2. Verifiez que la passerelle est joignable depuis Homey sur le reseau local.
3. Ajoutez dans Homey le peripherique "Adlar Castra Heat Pump".
4. Saisissez l'adresse IP, le port TCP et le Modbus Unit ID de la passerelle.
5. Apres l'appairage, ajustez si besoin les intervalles de polling et les autres parametres du peripherique.

Pour la procedure d'installation complete de raccordement de la pompe a chaleur via une passerelle Modbus TCP, voir docs/setup/README.md.

Tableaux de bord locaux

Ouvrez les tableaux de bord avec un navigateur sur le meme reseau local que Homey :

- http://<homey-ip>:8090/ - tableau live en lecture seule avec les valeurs actuelles de la pompe a chaleur
- http://<homey-ip>:8090/interactive - tableau interactif pour les commandes courantes
- http://<homey-ip>:8090/expert - tableau expert avec adresses Modbus, identifiants de parametres P/L et outils de lecture/ecriture live
- http://<homey-ip>:8090/heating-curve - editeur de courbe de chauffe DIY
- http://<homey-ip>:8090/changelog - journal de modifications par registre : nombre de changements, intervalle moyen et groupe de polling recommande pour chaque registre Modbus observe

Remplacez <homey-ip> par l'adresse IP de votre Homey Pro. Utilisez le tableau expert avec prudence : les registres Modbus modifiables peuvent changer le comportement de la pompe a chaleur.
Le port par defaut des tableaux de bord est 8090 ; si vous avez modifie le parametre Port des tableaux de bord, utilisez ce port dans l'URL.

Parametres du peripherique

- Adresse IP de la passerelle Modbus
- Port TCP
- Modbus Unit ID
- Port des tableaux de bord (8090 par defaut)
- Intervalles de polling super rapides, rapides, moyens et lents
- Niveau de journalisation

Remarques pratiques

- Valeurs recommandees : port 502, Unit ID 1.
- Attribuez de preference a la passerelle une reservation DHCP fixe ou une adresse IP statique pour eviter les problemes de reconnexion.
