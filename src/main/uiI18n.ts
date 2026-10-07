/**
 * Messages UI côté main process (dialogs Electron, erreurs IPC visibles).
 * Locale synchronisée depuis le renderer via IPC `set-ui-locale`.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type AppLocale = 'fr' | 'en';

const DEFAULT_LOCALE: AppLocale = 'fr';
const LOCALE_FILE = 'ui-locale.json';

let currentLocale: AppLocale = DEFAULT_LOCALE;

type Vars = Record<string, string | number>;

const MESSAGES: Record<AppLocale, Record<string, string>> = {
  fr: {
    'dialog.selectFolder': 'Sélectionner un dossier',
    'dialog.selectFile': 'Sélectionner un fichier',
    'dialog.selectFiles': 'Sélectionner un ou plusieurs fichiers',
    'dialog.importFiles': 'Importer des fichiers (XLSX ou CSV)',
    'dialog.downloadAnomalyReport': 'Télécharger le rapport d’anomalies',
    'dialog.saveFile': 'Enregistrer le fichier',
    'dialog.exportZip': 'Exporter le projet (ZIP)',
    'dialog.importZip': 'Importer projet (ZIP)',
    'dialog.downloadImportReport': 'Télécharger le rapport d’importation',
    'dialog.filterTransactions': 'Fichiers transactions',
    'dialog.filterAll': 'Tous les fichiers',
    'dialog.filterText': 'Fichiers texte',
    'dialog.filterZip': 'Archives ZIP',

    'error.windowUnavailable': 'Fenêtre non disponible',
    'error.fileNotFound': 'Fichier non trouvé: {{path}}',
    'error.fileNotFoundShort': 'Fichier non trouvé',
    'error.folderNotFound': 'Dossier non trouvé: {{path}}',
    'error.folderNotFoundShort': 'Dossier introuvable.',
    'error.noActiveProfile': 'Aucun profil de données configuré.',
    'error.noActiveProfileOrFolder': 'Aucun profil de données actif ou dossier introuvable.',
    'error.profileNotFound': 'Profil introuvable.',
    'error.profileFolderNotFound': 'Dossier introuvable : {{path}}',
    'error.cannotRemoveLastProfile': 'Impossible de supprimer le dernier profil.',
    'error.noImportFolder': 'Aucun dossier Import.',
    'error.noImportFiles': 'Aucun fichier dans le dossier Import.',
    'error.filesMovedTrash_one': '1 fichier déplacé vers la corbeille.',
    'error.filesMovedTrash_other': '{{count}} fichiers déplacés vers la corbeille.',
    'error.noMergeReport': 'Aucun rapport de fusion trouvé.',
    'error.reportFileNotFound': 'Fichier rapport introuvable.',
    'error.noAnomalyReport': 'Aucun rapport d’anomalies trouvé.',
    'error.noMonthlyAnomalyReport': 'Aucun rapport d’anomalies mensuel trouvé.',
    'error.noBalanceAnomalyReport': 'Aucun rapport d’anomalies (soldes) trouvé.',
    'error.noImportReport': 'Aucun rapport d’importation trouvé.',
    'error.configMissing': 'Configuration absente.',
    'error.invalidMonthKey': 'monthKey invalide (attendu YYYY-MM).',
    'error.invalidIndex': 'Index invalide.',
    'error.zipNoFiles':
      'Aucun fichier importé. Utilisez une archive créée avec « Exporter le projet (ZIP) » (racine data/).',
    'error.xlsxRequired': 'Le fichier doit être au format .xlsx',
    'error.xlsxNoSheets': 'Aucune feuille dans le classeur',
    'error.sqliteWriteFailed': 'Écriture SQLite impossible',
    'error.bundleTemplateMissing': 'Bundle profil template introuvable : {{path}}',
    'error.macBundleMissing': 'Bundle macOS introuvable (application non packagée ?).',
    'error.updateArchiveMissing': 'Archive de mise à jour introuvable.',
    'error.updateArchiveNoApp': 'L’archive de mise à jour ne contient pas d’application .app.',
    'error.balanceCsvMissing': 'src_account_balance.csv introuvable ou vide.',
    'error.noTransactions': 'Aucune transaction.',
    'error.noRowWithIndex': 'Aucune ligne avec Index {{index}}.',

    'update.readyTitle': 'Mise à jour prête',
    'update.readyMessage': 'La nouvelle version a été téléchargée.',
    'update.readyDetailMac':
      'Redémarrer maintenant pour remplacer Chamaccounts et relancer l’application ?',
    'update.readyDetail': 'Redémarrer maintenant pour installer la mise à jour ?',
    'update.restart': 'Redémarrer',
    'update.later': 'Plus tard',
    'update.checkTimeout': 'Délai dépassé lors de la vérification des mises à jour.',
    'update.downloadTimeout': 'Délai dépassé lors du téléchargement.',
    'update.downloadInProgress': 'Un téléchargement est déjà en cours.',
    'update.packagedOnly':
      'Les mises à jour automatiques ne fonctionnent que dans l’application installée (build packagé).',
    'update.devDownloadUnavailable': 'Téléchargement indisponible en mode développement.',
    'update.macZipMissing':
      'Impossible d’installer automatiquement : le paquet macOS .zip est absent de la release GitHub. Ouverture de la page des releases pour installation manuelle.',
    'update.macSignatureFirstInstall':
      'Impossible d’installer automatiquement depuis cette version. Installez une fois le .dmg depuis GitHub (glisser dans Applications) : les mises à jour suivantes se feront dans l’app, sans certificat Apple.',
    'update.macReplaceFailedDialog':
      'Impossible de remplacer Chamaccounts automatiquement. Glissez la nouvelle version dans le dossier Applications.',

    'dataDir.devRepo': 'Dossier data/ du dépôt de développement',
    'dataDir.devName': 'Développement',
    'dataDir.legacyApp': 'Données dans le dossier application (ancienne version)',
    'dataDir.embeddedMigration': 'Données embarquées (migration)',
    'dataDir.mainName': 'Principal',
    'workingCurrencies.primaryRequired': 'La devise principale est obligatoire.',
    'workingCurrencies.unknownPrimary': 'Devise principale inconnue : {{code}}',
    'workingCurrencies.unknownSecondary': 'Devise secondaire inconnue : {{code}}',
    'workingCurrencies.distinct': 'Les devises doivent être distinctes.',
    'workingCurrencies.maxSecondaries': 'Au plus deux devises secondaires.',

    'merge.duplicateRow': 'Doublon (ligne déjà présente dans src_transaction_data.csv)',
  },
  en: {
    'dialog.selectFolder': 'Select a folder',
    'dialog.selectFile': 'Select a file',
    'dialog.selectFiles': 'Select one or more files',
    'dialog.importFiles': 'Import files (XLSX or CSV)',
    'dialog.downloadAnomalyReport': 'Download anomaly report',
    'dialog.saveFile': 'Save file',
    'dialog.exportZip': 'Export project (ZIP)',
    'dialog.importZip': 'Import project (ZIP)',
    'dialog.downloadImportReport': 'Download import report',
    'dialog.filterTransactions': 'Transaction files',
    'dialog.filterAll': 'All files',
    'dialog.filterText': 'Text files',
    'dialog.filterZip': 'ZIP archives',

    'error.windowUnavailable': 'Window unavailable',
    'error.fileNotFound': 'File not found: {{path}}',
    'error.fileNotFoundShort': 'File not found',
    'error.folderNotFound': 'Folder not found: {{path}}',
    'error.folderNotFoundShort': 'Folder not found.',
    'error.noActiveProfile': 'No data profile configured.',
    'error.noActiveProfileOrFolder': 'No active data profile or folder not found.',
    'error.profileNotFound': 'Profile not found.',
    'error.profileFolderNotFound': 'Folder not found: {{path}}',
    'error.cannotRemoveLastProfile': 'Cannot remove the last profile.',
    'error.noImportFolder': 'No Import folder.',
    'error.noImportFiles': 'No files in the Import folder.',
    'error.filesMovedTrash_one': '1 file moved to the trash.',
    'error.filesMovedTrash_other': '{{count}} files moved to the trash.',
    'error.noMergeReport': 'No merge report found.',
    'error.reportFileNotFound': 'Report file not found.',
    'error.noAnomalyReport': 'No anomaly report found.',
    'error.noMonthlyAnomalyReport': 'No monthly anomaly report found.',
    'error.noBalanceAnomalyReport': 'No anomaly report (balances) found.',
    'error.noImportReport': 'No import report found.',
    'error.configMissing': 'Configuration missing.',
    'error.invalidMonthKey': 'Invalid monthKey (expected YYYY-MM).',
    'error.invalidIndex': 'Invalid Index.',
    'error.zipNoFiles':
      'No files imported. Use an archive created with “Export project (ZIP)” (data/ root).',
    'error.xlsxRequired': 'The file must be in .xlsx format',
    'error.xlsxNoSheets': 'No sheets in the workbook',
    'error.sqliteWriteFailed': 'SQLite write failed',
    'error.bundleTemplateMissing': 'Template profile bundle not found: {{path}}',
    'error.macBundleMissing': 'macOS bundle not found (app not packaged?).',
    'error.updateArchiveMissing': 'Update archive not found.',
    'error.updateArchiveNoApp': 'The update archive does not contain a .app application.',
    'error.balanceCsvMissing': 'src_account_balance.csv missing or empty.',
    'error.noTransactions': 'No transactions.',
    'error.noRowWithIndex': 'No row with Index {{index}}.',

    'update.readyTitle': 'Update ready',
    'update.readyMessage': 'The new version has been downloaded.',
    'update.readyDetailMac': 'Restart now to replace Chamaccounts and relaunch the application?',
    'update.readyDetail': 'Restart now to install the update?',
    'update.restart': 'Restart',
    'update.later': 'Later',
    'update.checkTimeout': 'Timed out while checking for updates.',
    'update.downloadTimeout': 'Timed out while downloading.',
    'update.downloadInProgress': 'A download is already in progress.',
    'update.packagedOnly':
      'Automatic updates only work in the installed application (packaged build).',
    'update.devDownloadUnavailable': 'Download unavailable in development mode.',
    'update.macZipMissing':
      'Automatic install failed: the macOS .zip package is missing from the GitHub release. Opening the releases page for manual install.',
    'update.macSignatureFirstInstall':
      'Automatic install is not possible from this version. Install the .dmg from GitHub once (drag it into Applications): later updates will install from within the app, without an Apple certificate.',
    'update.macReplaceFailedDialog':
      'Could not replace Chamaccounts automatically. Drag the new version into the Applications folder.',

    'dataDir.devRepo': 'Development repo data/ folder',
    'dataDir.devName': 'Development',
    'dataDir.legacyApp': 'Data in the application folder (legacy)',
    'dataDir.embeddedMigration': 'Bundled data (migration)',
    'dataDir.mainName': 'Main',
    'workingCurrencies.primaryRequired': 'The primary currency is required.',
    'workingCurrencies.unknownPrimary': 'Unknown primary currency: {{code}}',
    'workingCurrencies.unknownSecondary': 'Unknown secondary currency: {{code}}',
    'workingCurrencies.distinct': 'Currencies must be distinct.',
    'workingCurrencies.maxSecondaries': 'At most two secondary currencies.',

    'merge.duplicateRow': 'Duplicate (row already present in src_transaction_data.csv)',
  },
};

function localeFilePath(): string {
  return path.join(app.getPath('userData'), LOCALE_FILE);
}

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'fr' || value === 'en';
}

export function initUiLocaleFromDisk(): void {
  try {
    const raw = fs.readFileSync(localeFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { locale?: unknown };
    if (isAppLocale(parsed.locale)) {
      currentLocale = parsed.locale;
    }
  } catch {
    currentLocale = DEFAULT_LOCALE;
  }
}

export function setUiLocale(locale: AppLocale): void {
  currentLocale = locale;
  try {
    fs.writeFileSync(localeFilePath(), JSON.stringify({ locale }, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

export function getUiLocale(): AppLocale {
  return currentLocale;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ''
  );
}

/** Traduction main-process (dialogs / erreurs IPC). */
export function tm(key: string, vars?: Vars): string {
  const table = MESSAGES[currentLocale] ?? MESSAGES[DEFAULT_LOCALE];
  let resolvedKey = key;
  if (vars && typeof vars.count === 'number') {
    const pluralKey = vars.count === 1 ? `${key}_one` : `${key}_other`;
    if (table[pluralKey] || MESSAGES[DEFAULT_LOCALE][pluralKey]) {
      resolvedKey = pluralKey;
    }
  }
  const template =
    table[resolvedKey] ?? MESSAGES[DEFAULT_LOCALE][resolvedKey] ?? MESSAGES.fr[resolvedKey] ?? key;
  return interpolate(template, vars);
}
