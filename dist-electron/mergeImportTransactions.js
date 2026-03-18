"use strict";
/**
 * Fusionne les CSV du dossier Import dans Processed/source_data.csv.
 * Ignore la colonne INDEX des fichiers d'import ; l'index final est attribué par chronologie.
 * Génère un rapport CSV des lignes anormales si nécessaire.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeImportTransactions = mergeImportTransactions;
exports.getLastImportReportPath = getLastImportReportPath;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const IMPORT_DIR = 'data/TransactionsData/Import';
const PROCESSED_PATH = 'data/TransactionsData/Processed/source_data.csv';
const MERGE_REPORT_PATH = 'data/TransactionsData/Processed/merge_report.csv';
/** En-têtes du fichier source_data.csv (une seule colonne AMOUNT : négatif = dépense, positif = revenu). */
const OUTPUT_HEADERS = ['INDEX', 'DATE', 'TITLE', 'Column4', 'Column5', 'EUR', 'FX', 'ACCOUNT', 'AMOUNT', 'TYPE'];
/** En-têtes reconnus à l'import (fichiers peuvent avoir EXPENSE et INCOME séparés). */
const IMPORT_HEADERS = ['INDEX', 'DATE', 'TITLE', 'Column4', 'Column5', 'EUR', 'FX', 'ACCOUNT', 'EXPENSE', 'INCOME', 'TYPE'];
/** Âge max en jours : une date plus vieille que (aujourd'hui - MAX_AGE_DAYS) est signalée comme anomalie à l'import. */
const MAX_AGE_DAYS = 31;
/** Mappe un en-tête import vers le nom standard (sans INDEX). */
const HEADER_MAP = {
    date: 'DATE',
    titre: 'TITLE',
    title: 'TITLE',
    libellé: 'TITLE',
    libelle: 'TITLE',
    description: 'TITLE',
    account: 'ACCOUNT',
    compte: 'ACCOUNT',
    expense: 'EXPENSE',
    depense: 'EXPENSE',
    dépense: 'EXPENSE',
    debit: 'EXPENSE',
    débit: 'EXPENSE',
    income: 'INCOME',
    revenu: 'INCOME',
    credit: 'INCOME',
    crédit: 'INCOME',
    amount: 'AMOUNT',
    montant: 'AMOUNT',
    type: 'TYPE',
    category: 'TYPE',
    categorie: 'TYPE',
    eur: 'EUR',
    fx: 'FX',
    column4: 'Column4',
    column5: 'Column5',
};
function normalizeHeader(h) {
    const s = (h ?? '').replace(/^\uFEFF/, '').trim();
    return s;
}
function mapToStandardHeader(norm) {
    if (/^index$/i.test(norm))
        return null;
    return HEADER_MAP[norm.toLowerCase()] ?? (OUTPUT_HEADERS.includes(norm) || IMPORT_HEADERS.includes(norm) ? norm : null);
}
/** Indique si la première ligne semble être une ligne d'en-tête (noms de colonnes) plutôt que des données. */
function firstLineLooksLikeHeader(firstLineValues) {
    const mapped = firstLineValues.map((v) => mapToStandardHeader(normalizeHeader(v)));
    const hasKnownHeader = mapped.some((std) => std !== null);
    if (!hasKnownHeader)
        return false;
    const firstCell = (firstLineValues[0] ?? '').trim();
    const firstLooksLikeDate = parseDateToTime(firstCell) > 0;
    const firstLooksLikeNumber = !Number.isNaN(parseFloat((firstCell ?? '').replace(/,/, '.')));
    if (firstLooksLikeDate || (firstLooksLikeNumber && firstLineValues.length <= 3))
        return false;
    return true;
}
/** Parse une date ISO ou DD/MM/YYYY ou DD.MM.YYYY ou DD.MM.YY → timestamp ou 0 si invalide. */
function parseDateToTime(s) {
    const raw = (s ?? '').trim();
    if (!raw)
        return 0;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/;
    const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
    const mi = raw.match(iso);
    if (mi) {
        const y = parseInt(mi[1], 10);
        const m = parseInt(mi[2], 10);
        const d = parseInt(mi[3], 10);
        const date = new Date(y, m - 1, d);
        return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }
    const md = raw.match(dmy);
    if (md) {
        const d = parseInt(md[1], 10);
        const m = parseInt(md[2], 10);
        const yy = md[3].length === 2
            ? parseInt(md[3], 10) < 50
                ? 2000 + parseInt(md[3], 10)
                : 1900 + parseInt(md[3], 10)
            : parseInt(md[3], 10);
        const date = new Date(yy, m - 1, d);
        return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }
    return 0;
}
/** Formate une date en DD.MM.YY pour le CSV de sortie. */
function formatDateDDMMYY(s) {
    const raw = (s ?? '').trim();
    if (!raw)
        return '';
    const iso = /^(\d{4})-(\d{2})-(\d{2})/;
    const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
    let day, month, year;
    const mi = raw.match(iso);
    if (mi) {
        year = parseInt(mi[1], 10);
        month = parseInt(mi[2], 10);
        day = parseInt(mi[3], 10);
    }
    else {
        const md = raw.match(dmy);
        if (!md)
            return raw;
        day = parseInt(md[1], 10);
        month = parseInt(md[2], 10);
        const yy = parseInt(md[3], 10);
        year = md[3].length === 2 ? (yy < 50 ? 2000 + yy : 1900 + yy) : yy;
    }
    const d = String(day).padStart(2, '0');
    const m = String(month).padStart(2, '0');
    const y = String(year).slice(-2);
    return `${d}.${m}.${y}`;
}
/** Normalise un montant : virgule décimale, signe négatif autorisé (AMOUNT). Retourne la chaîne ou null si invalide. */
function normalizeAmount(s) {
    const raw = (s ?? '').trim().replace(/\s/g, '').replace(/[£€$]/g, '');
    if (raw === '')
        return '';
    const num = parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(num))
        return null;
    return raw.replace('.', ',');
}
function emptyRow() {
    return {
        DATE: '',
        TITLE: '',
        Column4: '',
        Column5: '',
        EUR: '',
        FX: '',
        ACCOUNT: '',
        AMOUNT: '',
        TYPE: '',
    };
}
/** Signature d'une ligne pour la détection de doublons (même transaction = même DATE, TITLE, montants, compte). */
function rowSignature(row) {
    const d = (row.DATE ?? '').trim();
    const t = (row.TITLE ?? '').trim();
    const eur = (row.EUR ?? '').trim();
    const amt = (row.AMOUNT ?? '').trim();
    const acc = (row.ACCOUNT ?? '').trim();
    return `${d}|${t}|${eur}|${amt}|${acc}`;
}
function parseCsvLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        }
        else if (inQuotes) {
            current += c;
        }
        else if (c === delimiter) {
            result.push(current.trim());
            current = '';
        }
        else {
            current += c;
        }
    }
    result.push(current.trim());
    return result;
}
/** Pour un ensemble de lignes (valeurs par colonne), renvoie l'index de la colonne qui ressemble le plus à DATE. */
function inferDateColumnIndex(lines) {
    let bestIdx = 0;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        let dateCount = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            if (parseDateToTime(v) > 0)
                dateCount++;
        }
        if (filled > 0 && dateCount / filled > bestScore) {
            bestScore = dateCount / filled;
            bestIdx = c;
        }
    }
    return bestScore >= 0.5 ? bestIdx : -1;
}
/** Colonne qui ressemble à un libellé (texte, pas date, pas que des chiffres). */
function inferTitleColumnIndex(lines, dateCol) {
    let bestIdx = -1;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        if (c === dateCol)
            continue;
        let textLike = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            const isDate = parseDateToTime(v) > 0;
            const isNum = !Number.isNaN(parseFloat(v.replace(/,/, '.').replace(/[£€$\s]/g, '')));
            if (!isDate && (!isNum || v.length > 6))
                textLike++;
        }
        if (filled >= 2 && textLike / filled > bestScore) {
            bestScore = textLike / filled;
            bestIdx = c;
        }
    }
    return bestIdx;
}
/** Colonne avec des montants type EUR (souvent € ou grands nombres). */
function inferEurColumnIndex(lines, exclude = new Set()) {
    let bestIdx = -1;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        if (exclude.has(c))
            continue;
        let withEur = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            if (/€|eur/i.test(v) || (normalizeAmount(v) !== null && v.length >= 4))
                withEur++;
        }
        if (filled > 0 && withEur / filled > bestScore) {
            bestScore = withEur / filled;
            bestIdx = c;
        }
    }
    return bestIdx;
}
/** Colonne avec taux de change (petits décimaux 0.5-1.5). */
function inferFxColumnIndex(lines, exclude = new Set()) {
    let bestIdx = -1;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        if (exclude.has(c))
            continue;
        let fxLike = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            const n = parseFloat(v.replace(/,/, '.'));
            if (!Number.isNaN(n) && n >= 0.5 && n <= 2 && v.length <= 6)
                fxLike++;
        }
        if (filled > 0 && fxLike / filled > bestScore) {
            bestScore = fxLike / filled;
            bestIdx = c;
        }
    }
    return bestIdx;
}
/** Colonne avec noms de comptes (courte chaîne alphanum). */
function inferAccountColumnIndex(lines, exclude = new Set()) {
    let bestIdx = -1;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        if (exclude.has(c))
            continue;
        let shortText = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            const isNum = !Number.isNaN(parseFloat(v.replace(/,/, '.')));
            if (!isNum && v.length >= 2 && v.length <= 20)
                shortText++;
        }
        if (filled > 0 && shortText / filled > bestScore) {
            bestScore = shortText / filled;
            bestIdx = c;
        }
    }
    return bestIdx;
}
/** Colonne avec montants type EXPENSE (£ ou débit). */
function inferExpenseColumnIndex(lines, exclude = new Set()) {
    let bestIdx = -1;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        if (exclude.has(c))
            continue;
        let expenseLike = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            if (/£|gbp|expense|debit|débit|depense/i.test(v) || normalizeAmount(v) !== null)
                expenseLike++;
        }
        if (filled > 0 && expenseLike / filled > bestScore) {
            bestScore = expenseLike / filled;
            bestIdx = c;
        }
    }
    return bestIdx;
}
/** Colonne avec montants type INCOME. */
function inferIncomeColumnIndex(lines, expenseCol, exclude = new Set()) {
    let bestIdx = -1;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        if (c === expenseCol || exclude.has(c))
            continue;
        let incomeLike = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            if (/£|gbp|income|credit|crédit|revenu/i.test(v) || normalizeAmount(v) !== null)
                incomeLike++;
        }
        if (filled > 0 && incomeLike / filled > bestScore) {
            bestScore = incomeLike / filled;
            bestIdx = c;
        }
    }
    return bestIdx;
}
/** Colonne type catégorie (texte en fin de ligne souvent). */
function inferTypeColumnIndex(lines, exclude = new Set()) {
    let bestIdx = -1;
    let bestScore = 0;
    const colCount = Math.max(0, ...lines.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
        if (exclude.has(c))
            continue;
        let textLike = 0;
        let filled = 0;
        for (const row of lines) {
            const v = (row[c] ?? '').trim();
            if (!v)
                continue;
            filled++;
            const isNum = !Number.isNaN(parseFloat(v.replace(/,/, '.')));
            if (!isNum && v.length <= 30)
                textLike++;
        }
        if (filled > 0 && textLike / filled > bestScore) {
            bestScore = textLike / filled;
            bestIdx = c;
        }
    }
    return bestIdx;
}
/** Infère le mapping colonne index → standard header à partir des lignes de données (sans en-tête). */
function inferColumnMapping(parsed) {
    const colToStandardIdx = new Map();
    if (parsed.length === 0)
        return colToStandardIdx;
    const used = new Set();
    const dateCol = inferDateColumnIndex(parsed);
    if (dateCol >= 0) {
        colToStandardIdx.set(dateCol, IMPORT_HEADERS.indexOf('DATE'));
        used.add(dateCol);
    }
    const titleCol = inferTitleColumnIndex(parsed, dateCol);
    if (titleCol >= 0) {
        colToStandardIdx.set(titleCol, IMPORT_HEADERS.indexOf('TITLE'));
        used.add(titleCol);
    }
    const eurCol = inferEurColumnIndex(parsed, used);
    if (eurCol >= 0) {
        colToStandardIdx.set(eurCol, IMPORT_HEADERS.indexOf('EUR'));
        used.add(eurCol);
    }
    const fxCol = inferFxColumnIndex(parsed, used);
    if (fxCol >= 0) {
        colToStandardIdx.set(fxCol, IMPORT_HEADERS.indexOf('FX'));
        used.add(fxCol);
    }
    const accountCol = inferAccountColumnIndex(parsed, used);
    if (accountCol >= 0) {
        colToStandardIdx.set(accountCol, IMPORT_HEADERS.indexOf('ACCOUNT'));
        used.add(accountCol);
    }
    const expenseCol = inferExpenseColumnIndex(parsed, used);
    if (expenseCol >= 0) {
        colToStandardIdx.set(expenseCol, IMPORT_HEADERS.indexOf('EXPENSE'));
        used.add(expenseCol);
    }
    const incomeCol = inferIncomeColumnIndex(parsed, expenseCol, used);
    if (incomeCol >= 0) {
        colToStandardIdx.set(incomeCol, IMPORT_HEADERS.indexOf('INCOME'));
        used.add(incomeCol);
    }
    const typeCol = inferTypeColumnIndex(parsed, used);
    if (typeCol >= 0)
        colToStandardIdx.set(typeCol, IMPORT_HEADERS.indexOf('TYPE'));
    return colToStandardIdx;
}
function processImportRow(sourceFile, lineNumber, _values, valueByStandardName, rawLine) {
    const row = emptyRow();
    row.DATE = (valueByStandardName.DATE ?? '').trim();
    row.TITLE = (valueByStandardName.TITLE ?? '').trim();
    row.Column4 = (valueByStandardName.Column4 ?? '').trim();
    row.Column5 = (valueByStandardName.Column5 ?? '').trim();
    row.EUR = (valueByStandardName.EUR ?? '').trim();
    row.FX = (valueByStandardName.FX ?? '').trim();
    row.ACCOUNT = (valueByStandardName.ACCOUNT ?? '').trim();
    row.TYPE = (valueByStandardName.TYPE ?? '').trim();
    const reasons = [];
    const dateNorm = formatDateDDMMYY(row.DATE);
    const dateTime = parseDateToTime(row.DATE);
    if (!row.DATE.trim())
        reasons.push('Date manquante');
    else if (dateTime === 0)
        reasons.push('Date invalide');
    else {
        row.DATE = dateNorm;
        const referenceTime = Date.now();
        const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
        if (dateTime < referenceTime - maxAgeMs)
            reasons.push('Date trop ancienne (plus d\'un mois par rapport à la date d\'importation)');
    }
    if (!row.TITLE.trim())
        reasons.push('Libellé (TITLE) manquant');
    if ((valueByStandardName.AMOUNT ?? '').trim()) {
        const amtNorm = normalizeAmount(valueByStandardName.AMOUNT);
        if (amtNorm === null)
            reasons.push('Montant (AMOUNT) non numérique');
        else
            row.AMOUNT = amtNorm;
    }
    else {
        const expNorm = normalizeAmount(valueByStandardName.EXPENSE ?? '');
        if ((valueByStandardName.EXPENSE ?? '').trim() && expNorm === null)
            reasons.push('Dépense (EXPENSE) non numérique');
        const incNorm = normalizeAmount(valueByStandardName.INCOME ?? '');
        if ((valueByStandardName.INCOME ?? '').trim() && incNorm === null)
            reasons.push('Revenu (INCOME) non numérique');
        row.AMOUNT = (incNorm ?? '').trim() ? incNorm : (expNorm ?? '').trim() ? '-' + expNorm : '';
    }
    const eurNorm = normalizeAmount(row.EUR);
    if (row.EUR.trim() && eurNorm === null)
        reasons.push('EUR non numérique');
    else if (eurNorm !== null)
        row.EUR = eurNorm;
    const fxNorm = normalizeAmount(row.FX);
    if (row.FX.trim() && fxNorm === null)
        reasons.push('FX non numérique');
    else if (fxNorm !== null)
        row.FX = fxNorm;
    const isEmpty = OUTPUT_HEADERS.slice(1).every((h) => !row[h]?.trim());
    if (isEmpty)
        reasons.push('Ligne vide');
    if (reasons.length > 0) {
        return {
            anomaly: {
                sourceFile,
                lineNumber,
                reason: reasons.join(' ; '),
                row: { ...row },
                rawLine,
            },
        };
    }
    return { valid: row };
}
async function readExistingProcessed(appPath) {
    const fullPath = path.join(appPath, PROCESSED_PATH);
    if (!(0, fs_1.existsSync)(fullPath)) {
        return { headerLine: OUTPUT_HEADERS.join(';'), rows: [] };
    }
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) {
        return { headerLine: OUTPUT_HEADERS.join(';'), rows: [] };
    }
    const headerLine = lines[0];
    const headerNames = parseCsvLine(headerLine, ';').map(normalizeHeader);
    const dataHeaderMap = new Map();
    headerNames.forEach((norm, i) => {
        if (/^index$/i.test(norm))
            return;
        const std = mapToStandardHeader(norm) ?? (OUTPUT_HEADERS.includes(norm) ? norm : null);
        if (std)
            dataHeaderMap.set(norm, OUTPUT_HEADERS.indexOf(std));
    });
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const values = parseCsvLine(line, ';');
        const row = emptyRow();
        for (let c = 0; c < headerNames.length; c++) {
            const stdKey = dataHeaderMap.get(headerNames[c]);
            if (stdKey === undefined || stdKey === 0)
                continue;
            const val = (values[c] ?? '').trim();
            const key = OUTPUT_HEADERS[stdKey];
            row[key] = key === 'DATE' ? (formatDateDDMMYY(val) || val) : val;
        }
        row.DATE = formatDateDDMMYY(row.DATE) || row.DATE;
        rows.push(row);
    }
    return { headerLine: OUTPUT_HEADERS.join(';'), rows };
}
function parseImportCsv(content, sourceFile) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
    const valid = [];
    const anomalies = [];
    if (lines.length === 0)
        return { valid, anomalies };
    const firstLineValues = parseCsvLine(lines[0], ';');
    const useFirstLineAsHeader = firstLineLooksLikeHeader(firstLineValues);
    let dataStartIndex;
    /** Mapping colonne index → nom d'en-tête standard (pour fichier avec en-têtes). */
    let colToStandardName;
    if (useFirstLineAsHeader && lines.length >= 2) {
        const rawHeaders = firstLineValues.map(normalizeHeader);
        colToStandardName = new Map();
        rawHeaders.forEach((norm, colIdx) => {
            const std = mapToStandardHeader(norm);
            if (std)
                colToStandardName.set(colIdx, std);
        });
        dataStartIndex = 1;
    }
    else {
        const dataLines = lines.map((line) => parseCsvLine(line, ';'));
        const colToStandardIdx = inferColumnMapping(dataLines);
        colToStandardName = new Map();
        colToStandardIdx.forEach((stdIdx, colIdx) => {
            const name = stdIdx < IMPORT_HEADERS.length ? IMPORT_HEADERS[stdIdx] : OUTPUT_HEADERS[stdIdx];
            if (name && name !== 'INDEX')
                colToStandardName.set(colIdx, name);
        });
        dataStartIndex = 0;
    }
    for (let i = dataStartIndex; i < lines.length; i++) {
        const rawLine = lines[i];
        if (!rawLine.trim())
            continue;
        const values = parseCsvLine(rawLine, ';');
        const valueByStandardName = {};
        colToStandardName.forEach((stdName, colIdx) => {
            valueByStandardName[stdName] = (values[colIdx] ?? '').trim();
        });
        const result = processImportRow(sourceFile, i + 1, values, valueByStandardName, rawLine);
        if ('valid' in result)
            valid.push({ row: result.valid, sourceFile, lineNumber: i + 1, rawLine });
        else
            anomalies.push(result.anomaly);
    }
    return { valid, anomalies };
}
function rowToCsvLine(row, index) {
    return [
        index,
        row.DATE,
        row.TITLE,
        row.Column4,
        row.Column5,
        row.EUR,
        row.FX,
        row.ACCOUNT,
        row.AMOUNT,
        row.TYPE,
    ].join(';');
}
function sortByDate(rows) {
    rows.sort((a, b) => {
        const ta = parseDateToTime(a.DATE);
        const tb = parseDateToTime(b.DATE);
        if (ta === 0 && tb !== 0)
            return 1;
        if (tb === 0 && ta !== 0)
            return -1;
        return ta - tb;
    });
}
async function mergeImportTransactions(appPath) {
    const importDir = path.join(appPath, IMPORT_DIR);
    const processedFull = path.join(appPath, PROCESSED_PATH);
    if (!(0, fs_1.existsSync)(importDir)) {
        return { success: true, mergedCount: 0, anomalyCount: 0 };
    }
    const files = await fs.readdir(importDir);
    const csvFiles = files.filter((f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().startsWith('import_report'));
    if (csvFiles.length === 0) {
        // Écrase quand même le rapport de fusion (en-tête seul)
        const processedDir = path.join(appPath, path.dirname(MERGE_REPORT_PATH));
        if (!(0, fs_1.existsSync)(processedDir))
            await fs.mkdir(processedDir, { recursive: true });
        const reportFull = path.join(appPath, MERGE_REPORT_PATH);
        const reportHeader = 'fichier_source;ligne;raison;DATE;TITLE;ACCOUNT;AMOUNT;TYPE;ligne_brute';
        await fs.writeFile(reportFull, reportHeader + '\n', 'utf-8');
        return { success: true, mergedCount: 0, anomalyCount: 0 };
    }
    const { headerLine, rows: existingRows } = await readExistingProcessed(appPath);
    const allValid = [...existingRows];
    const allAnomalies = [];
    const existingSignatures = new Set(existingRows.map(rowSignature));
    for (const file of csvFiles) {
        const filePath = path.join(importDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const { valid, anomalies } = parseImportCsv(content, file);
        allAnomalies.push(...anomalies);
        for (const item of valid) {
            const sig = rowSignature(item.row);
            if (existingSignatures.has(sig)) {
                allAnomalies.push({
                    sourceFile: item.sourceFile,
                    lineNumber: item.lineNumber,
                    reason: 'Doublon (ligne déjà présente dans source_data.csv)',
                    row: { ...item.row },
                    rawLine: item.rawLine,
                });
            }
            else {
                existingSignatures.add(sig);
                allValid.push(item.row);
            }
        }
    }
    sortByDate(allValid);
    const processedDir = path.dirname(processedFull);
    if (!(0, fs_1.existsSync)(processedDir)) {
        await fs.mkdir(processedDir, { recursive: true });
    }
    const csvLines = [headerLine];
    allValid.forEach((row, i) => {
        csvLines.push(rowToCsvLine(row, i + 1));
    });
    await fs.writeFile(processedFull, csvLines.join('\n'), 'utf-8');
    // Rapport de fusion toujours écrit dans Processed (écrase à chaque fusion)
    const reportFull = path.join(appPath, MERGE_REPORT_PATH);
    const reportHeader = 'fichier_source;ligne;raison;DATE;TITLE;ACCOUNT;AMOUNT;TYPE;ligne_brute';
    const reportLines = [reportHeader];
    for (const a of allAnomalies) {
        const safe = (s) => (s ?? '').replace(/;/g, ',').replace(/\r?\n/g, ' ');
        reportLines.push([
            safe(a.sourceFile),
            a.lineNumber,
            safe(a.reason),
            safe(a.row.DATE),
            safe(a.row.TITLE),
            safe(a.row.ACCOUNT),
            safe(a.row.AMOUNT),
            safe(a.row.TYPE),
            safe(a.rawLine),
        ].join(';'));
    }
    await fs.writeFile(reportFull, reportLines.join('\n'), 'utf-8');
    const mergedCount = allValid.length - existingRows.length;
    return {
        success: true,
        mergedCount,
        anomalyCount: allAnomalies.length,
        reportPath: MERGE_REPORT_PATH,
    };
}
async function getLastImportReportPath(appPath) {
    const reportFull = path.join(appPath, MERGE_REPORT_PATH);
    if (!(0, fs_1.existsSync)(reportFull))
        return null;
    return MERGE_REPORT_PATH;
}
