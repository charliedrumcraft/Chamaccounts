import type { GuidedTourStep } from './types';
import GuidedTourExampleTable from './GuidedTourExampleTable';

export const GUIDED_TOUR_STEPS: GuidedTourStep[] = [
  {
    id: 'welcome',
    title: 'Bienvenue dans Chamaccounts',
    path: '/',
    body: (
      <>
        <p>
          Cette application centralise vos transactions, soldes de comptes, comptabilité mensuelle et budget.
          Les données vivent dans un <strong>dossier sur votre disque</strong> (profil actif), pas dans le dépôt Git.
        </p>
        <p className="mt-2">
          Cette visite guidée présente la navigation, la personnalisation dans Réglages et le rôle de chaque page.
          Elle utilise le profil <strong>Data Template</strong> (données fictives) ; à la fin, votre profil actif est
          rétabli.
        </p>
      </>
    ),
  },
  {
    id: 'navigation',
    title: 'Menu de navigation',
    highlight: 'sidebar-nav',
    body: (
      <>
        <p>
          Utilisez la barre latérale pour passer d’une vue à l’autre. Le <strong>profil actif</strong> et la{' '}
          <strong>version</strong> de l’app s’affichent en bas du menu.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Vous pouvez réduire le menu avec la flèche en haut ; relancez la visite guidée à tout moment depuis le même
          emplacement.
        </p>
      </>
    ),
  },
  {
    id: 'profiles',
    title: 'Profils de données',
    path: '/settings',
    highlight: 'settings-profiles',
    body: (
      <>
        <p>
          Un <strong>profil</strong> = un dossier de travail (transactions, soldes, soutien, réglages dans{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">AppState/</code>). Vous pouvez en avoir plusieurs
          (perso, pro, etc.) et basculer entre eux.
        </p>
        <p className="mt-2">
          Changer de profil enregistre d’abord les réglages du profil courant, puis recharge l’application avec le
          dossier choisi.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Comptes actifs',
    path: '/settings',
    highlight: 'settings-accounts',
    body: (
      <>
        <p>
          Définissez ici vos <strong>comptes bancaires</strong> (ordre important). Chaque compte correspond à une
          colonne dans <code className="text-xs bg-slate-100 px-1 rounded">src_account_balance.csv</code>, après la
          colonne date.
        </p>
        <p className="mt-2">
          La devise (£, €, CHF) fixe l’affichage, pas la conversion automatique. Les <strong>alias</strong> permettent
          de reconnaître le même compte sous d’autres libellés à l’import.
        </p>
        <p className="mt-2 text-sm text-amber-800">
          Mode édition → modifiez la liste → « Sauvegarder les listes » pour aligner les fichiers CSV.
        </p>
      </>
    ),
  },
  {
    id: 'entry-types',
    title: 'Types d’entrées',
    path: '/settings',
    highlight: 'settings-entry-types',
    body: (
      <>
        <p>
          Les <strong>types d’entrées</strong> sont vos catégories de revenus et crédits (ex. salaire, remboursement).
          Ils alimentent la colonne <code className="text-xs bg-slate-100 px-1 rounded">TYPE</code> et les filtres du
          tableau de bord.
        </p>
        <p className="mt-2">Personnalisez la liste selon votre vocabulaire comptable ; enregistrez en mode édition.</p>
      </>
    ),
  },
  {
    id: 'output-types',
    title: 'Types de sorties',
    path: '/settings',
    highlight: 'settings-output-types',
    body: (
      <>
        <p>
          Les <strong>types de sorties</strong> classent vos dépenses (loyer, courses, transport…). Comme les entrées,
          ils sont proposés à la saisie et contrôlés à l’import.
        </p>
      </>
    ),
  },
  {
    id: 'projects',
    title: 'Projets (étiquettes)',
    path: '/settings',
    highlight: 'settings-projects',
    body: (
      <>
        <p>
          Les <strong>projets</strong> sont des étiquettes colorées (colonne <code className="text-xs bg-slate-100 px-1 rounded">PROJET</code>
          ) pour segmenter vos lignes : travaux, vacances, activité pro, etc.
        </p>
        <p className="mt-2">
          Le fichier enregistre l’<strong>identifiant</strong> du projet : vous pouvez renommer l’affichage ici sans
          casser l’historique.
        </p>
      </>
    ),
  },
  {
    id: 'data-format',
    title: 'Format des données attendues',
    path: '/settings',
    body: (
      <>
        <p className="text-sm text-gray-700">
          Exemples fictifs — les dates sont au format <strong>JJ.MM.AA</strong>. Les montants en{' '}
          <strong>AMOUNT GBP</strong> : négatif = dépense, positif = revenu.
        </p>

        <p className="mt-3 font-medium text-gray-800 text-sm">Transactions traitées</p>
        <GuidedTourExampleTable
          fileName="src_transaction_data.csv"
          caption="fichier principal après import"
          headers={['DATE', 'TITLE', 'AMOUNT', 'CURRENCY', 'ACCOUNT', 'AMOUNT GBP', 'TYPE', 'PROJET']}
          rows={[
            ['15.03.26', 'Courses marché', '-42,50', 'EUR', 'Revolut Perso', '-36,55', 'Food', 'maison-01'],
            ['28.02.26', 'Salaire ACME Ltd', '3 200,00', 'GBP', 'HSBC Joint', '3 200,00', 'Lampton', ''],
            ['03.02.26', 'Loyer février', '-850,00', 'GBP', 'HSBC Joint', '-850,00', 'Rent', 'maison-01'],
          ]}
        />

        <p className="mt-3 font-medium text-gray-800 text-sm">Import bancaire (dossier Import)</p>
        <GuidedTourExampleTable
          fileName="releve_banque.csv"
          caption="colonnes reconnues ; mapping possible vers le fichier traité"
          headers={['DATE', 'TITLE', 'EXPENSE', 'INCOME', 'ACCOUNT']}
          rows={[
            ['14.03.26', 'PRET A MANGER PARIS', '12,80', '', 'Revolut Perso'],
            ['01.03.26', 'VIREMENT EMPLOYEUR', '', '3 200,00', 'HSBC Joint'],
            ['28.02.26', 'SPOTIFY', '9,99', '', 'Revolut Perso'],
          ]}
        />

        <p className="mt-3 font-medium text-gray-800 text-sm">Soldes mensuels</p>
        <GuidedTourExampleTable
          fileName="src_account_balance.csv"
          caption="une colonne par compte actif (ordre = Réglages)"
          headers={['DATE', 'Revolut Perso', 'HSBC Joint']}
          rows={[
            ['01.03.26', '1 245,30', '8 420,00'],
            ['01.02.26', '892,10', '6 100,50'],
            ['01.01.26', '1 104,00', '5 880,25'],
          ]}
        />

        <p className="mt-3 text-xs text-gray-600">
          Les taux EUR/CHF → GBP se configurent dans Réglages pour calculer <strong>AMOUNT GBP</strong> à l’import.
        </p>
      </>
    ),
  },
  {
    id: 'dashboard',
    title: 'Tableau de bord',
    path: '/',
    highlight: 'nav-/',
    body: (
      <>
        <p>
          Vue synthétique : évolution des soldes, mouvements, graphiques comparés et tableaux filtrables. Idéal pour
          une lecture globale avant d’entrer dans le détail.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Les filtres (dates, types, comptes) peuvent se synchroniser entre les blocs selon vos préférences.
        </p>
      </>
    ),
  },
  {
    id: 'transactions',
    title: 'Tableau des transactions',
    path: '/transactions',
    highlight: 'nav-/transactions',
    body: (
      <>
        <p>
          Consultez et éditez ligne par ligne le fichier <code className="text-xs bg-slate-100 px-1 rounded">src_transaction_data.csv</code>.
          Importez des CSV depuis le dossier Import, corrigez les anomalies signalées, mode édition pour modifier
          plusieurs cellules.
        </p>
      </>
    ),
  },
  {
    id: 'account-balance',
    title: 'Soldes des comptes',
    path: '/account-balance',
    highlight: 'nav-/account-balance',
    body: (
      <>
        <p>
          Saisie et import des soldes mensuels par compte. Les colonnes suivent la liste des comptes actifs dans
          Réglages.
        </p>
      </>
    ),
  },
  {
    id: 'monthly-accounting',
    title: 'Comptabilité mensuelle',
    path: '/monthly-accounting',
    highlight: 'nav-/monthly-accounting',
    body: (
      <>
        <p>
          Rapprochement et suivi mois par mois : ventilation par type, contrôles de cohérence et rapports d’anomalies
          mensuels.
        </p>
      </>
    ),
  },
  {
    id: 'annual-budget',
    title: 'Budget annuel',
    path: '/annual-budget',
    highlight: 'nav-/annual-budget',
    body: (
      <>
        <p>Planification et comparaison budget / réalisé sur l’année, par types et comptes.</p>
      </>
    ),
  },
  {
    id: 'support',
    title: 'Soutien',
    path: '/soutien',
    highlight: 'nav-/soutien',
    body: (
      <>
        <p>
          Lignes de soutien hors flux bancaire classique, enregistrées dans{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">Support_data.csv</code>, avec les mêmes notions de
          types et projets.
        </p>
      </>
    ),
  },
  {
    id: 'finish',
    title: 'Vous êtes prêt',
    path: '/',
    body: (
      <>
        <p>
          Commencez par configurer <strong>Réglages</strong> (profil, comptes, types, projets), puis importez vos
          fichiers. En cas de doute, rouvrez cette visite depuis le menu latéral.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Les mises à jour et l’export ZIP du projet complet sont aussi dans Réglages.
        </p>
      </>
    ),
  },
];
