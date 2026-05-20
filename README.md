# Chamaccounts

Application desktop de comptabilité **multi-plateforme** (Windows, macOS, Linux) pour le suivi des transactions, des soldes de comptes et de la comptabilité mensuelle et budgétaire.

Dérivée de [Comptal2](https://github.com/LeopaulV/Comptal2), Chamaccounts réutilise la base Electron + React tout en ciblant un flux de travail orienté import CSV, contrôles d’anomalies et vues financières en GBP / EUR / CHF.

## Description

Chamaccounts est une application desktop (Electron + React + TypeScript) pour centraliser vos données financières : import et fusion de fichiers CSV, tableaux interactifs, tableau de bord avec graphiques, comptabilité mensuelle, budget annuel et page **Soutien**. Les réglages permettent de configurer comptes reconnus, projets, types d’entrées/sorties et taux de change.

## Fonctionnalités principales

- **Import de transactions** — Assistant de préparation (mapping des colonnes, politique de fusion), rapports de fusion et détection d’anomalies
- **Import des soldes de comptes** — Même logique d’import avec rapports dédiés
- **Tableau de bord** — Soldes, mouvements, graphiques (courbes, camemberts, barres, synthèse annuelle), filtres par période et devise d’affichage (GBP, EUR, CHF)
- **Tableau des transactions** — Consultation et édition des données consolidées, exceptions d’anomalies
- **Soldes des comptes** — Historique et suivi par compte
- **Comptabilité mensuelle** — Vue dédiée au suivi mensuel
- **Budget annuel** — Planification et suivi budgétaire
- **Soutien** — Saisie et gestion des lignes de soutien (données séparées des transactions importées)
- **Multi-devises** — Taux EUR/CHF vers GBP (manuel ou cours en direct), comptes en GBP, EUR ou CHF
- **Réglages** — Comptes reconnus, projets, types d’entrées et de sorties, export/import du dossier `data/` (ZIP), sauvegarde des préférences
- **Mises à jour** — Vérification et installation des versions publiées sur GitHub Releases

## Installation

Téléchargez la dernière version dans la [section Releases](https://github.com/charliedrumcraft/Chamaccounts/releases).

Les noms des artefacts suivent le modèle `Chamaccounts-{version}-{plateforme}-{arch}.{ext}` (voir `electron-builder.yml`).

### Windows

1. Téléchargez `Chamaccounts-1.0.0-win-x64.exe` (ou la version indiquée sur la release)
2. Double-cliquez sur l’installateur et suivez les instructions
3. Lancez Chamaccounts depuis le menu Démarrer ou le raccourci bureau

**Système requis :** Windows 10/11 (64-bit)

### macOS

- **Intel** : `Chamaccounts-1.0.0-mac-x64.dmg`
- **Apple Silicon (M1/M2/M3/M4)** : `Chamaccounts-1.0.0-mac-arm64.dmg`

Ouvrez le DMG, puis glissez Chamaccounts dans le dossier **Applications**. macOS 10.15 (Catalina) ou supérieur recommandé.

### Linux

1. Téléchargez `Chamaccounts-1.0.0-linux-x64.AppImage`
2. Rendez-le exécutable : `chmod +x Chamaccounts-1.0.0-linux-x64.AppImage`
3. Lancez-le : `./Chamaccounts-1.0.0-linux-x64.AppImage` ou double-clic dans le gestionnaire de fichiers

**Note :** sous Linux, les données utilisateur sont stockées dans le répertoire Electron (`~/.config/Chamaccounts` ou équivalent selon la distribution).

## Utilisation

### Première utilisation

1. Lancez l’application
2. Ouvrez **Réglages** pour configurer les comptes reconnus, les types d’entrées/sorties, les projets et les taux de change
3. Depuis **Tableau des transactions** ou **Soldes des comptes**, utilisez l’assistant d’import pour déposer vos CSV dans `data/…/Import` et lancer la fusion
4. Consultez le **Tableau de bord** pour visualiser soldes et mouvements

### Import de fichiers

1. Placez vos fichiers CSV dans le dossier d’import (géré par l’assistant dans l’application)
2. Mappez les colonnes (date, libellé, montant, compte, type, etc.)
3. Validez la fusion : un rapport de merge et, le cas échéant, un rapport d’anomalies sont générés sous `data/…/Processed/`

### Sauvegarde et portabilité

Dans **Réglages**, utilisez **Exporter le projet (ZIP)** pour archiver le dossier `data/` et vos préférences, puis **Importer projet (ZIP)** pour restaurer sur une autre machine.

## Technologies utilisées

- **Electron** — Application desktop
- **React** — Interface utilisateur
- **TypeScript** — Typage statique
- **Vite** — Build et développement
- **Chart.js** — Graphiques du tableau de bord
- **Tailwind CSS** — Styles utilitaires
- **Papa Parse** — Lecture et écriture CSV
- **electron-updater** — Mises à jour depuis GitHub Releases

## Développement

### Prérequis

- Node.js 18 ou supérieur (20 recommandé pour la CI)
- npm

### Installation des dépendances

```bash
npm install
```

### Développement

```bash
npm run dev
# ou, avec rechargement Electron :
npm run electron:dev
```

### Build

```bash
# Windows
npm run build:win

# macOS (depuis macOS uniquement)
npm run build:mac

# Linux
npm run build:linux

# Plateforme courante
npm run build
```

### Publication d’une release

Les builds Mac, Windows et Linux sont déclenchés par un tag `v*` (workflow `.github/workflows/release.yml`). Exemple :

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Structure du projet

```
Chamaccounts/
├── src/
│   ├── main/                 # Processus principal Electron (IPC, import, ZIP, mises à jour)
│   ├── renderer/             # Interface React
│   │   ├── components/       # UI (Dashboard, import, réglages, layout…)
│   │   ├── pages/            # Routes : tableau de bord, transactions, soldes, budget…
│   │   ├── services/         # Accès CSV, taux de change, assistants d’import
│   │   └── hooks/            # Assistants d’import (transactions, soldes)
│   └── shared/               # Chemins data/, logique d’import partagée
├── data/                     # Données utilisateur (transactions, soldes, soutien, AppState)
├── build/                    # Ressources de build (entitlements macOS, notes de release)
├── scripts/                  # CI, notes de release, migrations
├── electron-builder.yml      # Configuration des installateurs et publication GitHub
└── package.json
```

**Dossiers générés** (à ne pas versionner) : `node_modules/`, `dist/`, `dist-electron/`, `release/`.

## Licence

Ce projet est distribué sous licence **MIT**. Voir le fichier [LICENSE](LICENSE).

## Liens

- **Releases** : [github.com/charliedrumcraft/Chamaccounts/releases](https://github.com/charliedrumcraft/Chamaccounts/releases)
- **Projet d’origine** : [Comptal2](https://github.com/LeopaulV/Comptal2)
