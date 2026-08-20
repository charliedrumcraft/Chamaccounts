# Chamaccounts v1.0.7

Assistant d’import pour le soutien, affichage multi-devises, sous-totaux par projet, et budget annuel avec structure de bilan par année.

### Changements par rapport à v1.0.6
- **Soutien — import** : assistant de préparation (collage CSV, mapping des colonnes, prévisualisation, exclusions)
- **Soutien — affichage** : devise d’affichage GBP / EUR / CHF, sous-totaux par projet, suggestions à la saisie
- **Budget annuel** : structure du bilan (actif / passif) propre à chaque année, avec migration depuis l’ancienne clé globale
- **Tableau de bord** : plage de dates alignée sur soldes et transactions ; slider de période plus stable lors des mises à jour

### Installation

| Plateforme | Fichier |
|------------|---------|
| Windows 10/11 (64-bit) | `Chamaccounts-1.0.7-win-x64.exe` |
| macOS Intel | `Chamaccounts-1.0.7-mac-x64.dmg` |
| macOS Apple Silicon | `Chamaccounts-1.0.7-mac-arm64.dmg` |
| Linux (AppImage) | `Chamaccounts-1.0.7-linux-x64.AppImage` |

[Télécharger v1.0.7](https://github.com/charliedrumcraft/Chamaccounts/releases/tag/v1.0.7)

---

# Chamaccounts v1.0.6

Visite guidée intégrée, profil de démonstration **Data Template** et informations utiles dans le menu latéral.

### Changements par rapport à v1.0.5
- **Visite guidée** : parcours en 15 étapes (navigation, Réglages, format des données, pages métier) avec surlignage des zones et fiches centrées
- **Profil Data Template** : données fictives préinstallées pour la démo ; bascule automatique pendant la visite, puis retour au profil précédent
- **Menu latéral** : nom de l’app, profil actif, version installée, bouton pour relancer la visite
- **Mode édition (transactions)** : le tri ne se réapplique plus à chaque frappe (lignes stables pendant la saisie)

### Installation

| Plateforme | Fichier |
|------------|---------|
| Windows 10/11 (64-bit) | `Chamaccounts-1.0.6-win-x64.exe` |
| macOS Intel | `Chamaccounts-1.0.6-mac-x64.dmg` |
| macOS Apple Silicon | `Chamaccounts-1.0.6-mac-arm64.dmg` |
| Linux (AppImage) | `Chamaccounts-1.0.6-linux-x64.AppImage` |

[Télécharger v1.0.6](https://github.com/charliedrumcraft/Chamaccounts/releases/tag/v1.0.6)

---

# Chamaccounts v1.0.5

Correction du filtre de recherche en mode édition sur le tableau des transactions.

### Changements par rapport à v1.0.4
- **Mode édition (transactions)** : le filtre de la barre de recherche ne se réapplique plus à chaque frappe ; les lignes restent visibles pendant la saisie
- Le tableau se met à jour après **enregistrement** ou lors d’un **changement du filtre** (texte ou colonne)

### Installation

| Plateforme | Fichier |
|------------|---------|
| Windows 10/11 (64-bit) | `Chamaccounts-1.0.5-win-x64.exe` |
| macOS Intel | `Chamaccounts-1.0.5-mac-x64.dmg` |
| macOS Apple Silicon | `Chamaccounts-1.0.5-mac-arm64.dmg` |
| Linux (AppImage) | `Chamaccounts-1.0.5-linux-x64.AppImage` |

[Télécharger v1.0.5](https://github.com/charliedrumcraft/Chamaccounts/releases/tag/v1.0.5)

---

# Chamaccounts v1.0.4

Colonnes redimensionnables en mode édition pour une meilleure lisibilité des tableaux.

### Changements par rapport à v1.0.3
- **Mode édition** : glisser le bord droit d’un en-tête pour ajuster la largeur des colonnes (Transactions, Soldes, Comptabilité mensuelle)
- Largeurs mémorisées entre les sessions (localStorage)
- Bouton « Réinitialiser les largeurs de colonnes » lorsque des tailles personnalisées sont actives

### Installation

| Plateforme | Fichier |
|------------|---------|
| Windows 10/11 (64-bit) | `Chamaccounts-1.0.4-win-x64.exe` |
| macOS Intel | `Chamaccounts-1.0.4-mac-x64.dmg` |
| macOS Apple Silicon | `Chamaccounts-1.0.4-mac-arm64.dmg` |
| Linux (AppImage) | `Chamaccounts-1.0.4-linux-x64.AppImage` |

[Télécharger v1.0.4](https://github.com/charliedrumcraft/Chamaccounts/releases/tag/v1.0.4)

---

# Chamaccounts v1.0.3

Profils de données desktop : dossier externe par profil, réglages (`AppState/`) attachés au profil, export/import ZIP portable.

### Changements par rapport à v1.0.2
- **Profils de données** : choix d’un dossier externe par profil (transactions, soldes, soutien, réglages)
- **Assistant de premier lancement** pour configurer ou migrer un dossier existant
- **AppState par profil** : snapshot CSV dans le dossier du profil, partition Electron dédiée, sync au démarrage et à la fermeture
- **Export / import projet (ZIP)** : archive complète du profil actif (CSV + `AppState/`) ; rappel d’exporter avant import
- Scripts CLI : résolution du dossier de données via `--data-root`, `CHAMACCOUNTS_DATA_ROOT` ou profil actif

### Installation

| Plateforme | Fichier |
|------------|---------|
| Windows 10/11 (64-bit) | `Chamaccounts-1.0.3-win-x64.exe` |
| macOS Intel | `Chamaccounts-1.0.3-mac-x64.dmg` |
| macOS Apple Silicon | `Chamaccounts-1.0.3-mac-arm64.dmg` |
| Linux (AppImage) | `Chamaccounts-1.0.3-linux-x64.AppImage` |

[Télécharger v1.0.3](https://github.com/charliedrumcraft/Chamaccounts/releases/tag/v1.0.3)

---

# Chamaccounts v1.0.1

Release recommandée : dépôt open source **sans données personnelles**, installateurs construits à partir de **`data-template/`** (CSV vierges, en-têtes seuls).

### Changements par rapport à v1.0.0
- Suppression de l’historique Git contenant le dossier `data/` (données de dev)
- Empaquetage release : uniquement `data-template/` copié en `data/` en CI
- **Paramètres** : comptes, types d’entrées et de sorties vides par défaut (configuration utilisateur)

### Installation

| Plateforme | Fichier |
|------------|---------|
| Windows 10/11 (64-bit) | `Chamaccounts-1.0.1-win-x64.exe` |
| macOS Intel | `Chamaccounts-1.0.1-mac-x64.dmg` |
| macOS Apple Silicon | `Chamaccounts-1.0.1-mac-arm64.dmg` |
| Linux (AppImage) | `Chamaccounts-1.0.1-linux-x64.AppImage` |

[Télécharger v1.0.1](https://github.com/charliedrumcraft/Chamaccounts/releases/tag/v1.0.1)

---

# Chamaccounts v1.0.0

Première version publique de **Chamaccounts**, application de comptabilité multi-plateforme (Windows, macOS, Linux) pour le suivi des transactions, des soldes de comptes, de la comptabilité mensuelle et du budget annuel.

---

## Fonctionnalités principales

### Import et données
- Assistant d’import **transactions** (mapping CSV, fusion, rapports de merge)
- Assistant d’import **soldes de comptes**
- Détection d’**anomalies** avec rapports et exceptions configurables
- Données centralisées sous `data/` (transactions, soldes, soutien, état applicatif)

### Tableau de bord
- Graphiques des soldes et des mouvements (courbes, camemberts, barres, synthèse annuelle)
- Filtres par période et affichage en **GBP**, **EUR** ou **CHF**
- Taux de change EUR/CHF vers GBP (manuel ou cours en direct)

### Pages métier
- **Tableau des transactions** — consultation et édition des données consolidées
- **Soldes des comptes** — historique par compte
- **Comptabilité mensuelle**
- **Budget annuel**
- **Soutien** — lignes dédiées hors import transactions

### Réglages et portabilité
- Comptes reconnus, projets, types d’entrées et de sorties
- Export / import du projet en **ZIP** (`data/` + préférences)
- **Mises à jour** via GitHub Releases (`electron-updater`)

---

## Installation

Téléchargez les installateurs dans [GitHub Releases](https://github.com/charliedrumcraft/Chamaccounts/releases/tag/v1.0.0).

| Plateforme | Fichier |
|------------|---------|
| Windows 10/11 (64-bit) | `Chamaccounts-1.0.0-win-x64.exe` |
| macOS Intel | `Chamaccounts-1.0.0-mac-x64.dmg` |
| macOS Apple Silicon | `Chamaccounts-1.0.0-mac-arm64.dmg` |
| Linux (AppImage) | `Chamaccounts-1.0.0-linux-x64.AppImage` |

### Premiers pas

1. Installez et lancez Chamaccounts
2. Configurez comptes, types et taux dans **Réglages**
3. Importez vos CSV depuis **Tableau des transactions** ou **Soldes des comptes**
4. Consultez le **Tableau de bord**

---

## Développement et CI

- Build local : `npm run build:win` / `build:mac` / `build:linux`
- Publication : pousser le tag `v1.0.0` déclenche le workflow `.github/workflows/release.yml` (builds Mac, Windows, Linux + publication GitHub)

---

## Licence

MIT — voir [LICENSE](LICENSE).

---

## Notes

> Signalez les problèmes via les [issues GitHub](https://github.com/charliedrumcraft/Chamaccounts/issues).

> Sous Linux, les données utilisateur sont stockées dans le répertoire de configuration Electron de l’application.
