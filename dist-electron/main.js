"use strict";
const electron = require("electron");
const path = require("path");
const fs$1 = require("fs/promises");
const fs = require("fs");
const child_process = require("child_process");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs$1);
const IMPORT_DIR = "data/TransactionsData/Import";
const PROCESSED_PATH = "data/TransactionsData/Processed/source_data.csv";
const MERGE_REPORT_PATH = "data/TransactionsData/Processed/merge_report.csv";
const OUTPUT_HEADERS = ["INDEX", "DATE", "TITLE", "AMOUNT", "CURRENCY", "ACCOUNT", "AMOUNT GBP", "TYPE"];
const IMPORT_HEADERS = ["INDEX", "DATE", "TITLE", "AMOUNT", "CURRENCY", "ACCOUNT", "EXPENSE", "INCOME", "TYPE"];
const MAX_AGE_DAYS = 31;
const HEADER_MAP = {
  date: "DATE",
  titre: "TITLE",
  title: "TITLE",
  libellé: "TITLE",
  libelle: "TITLE",
  description: "TITLE",
  account: "ACCOUNT",
  compte: "ACCOUNT",
  expense: "EXPENSE",
  depense: "EXPENSE",
  dépense: "EXPENSE",
  debit: "EXPENSE",
  débit: "EXPENSE",
  income: "INCOME",
  revenu: "INCOME",
  credit: "INCOME",
  crédit: "INCOME",
  "amount gbp": "AMOUNT GBP",
  montant: "AMOUNT GBP",
  type: "TYPE",
  category: "TYPE",
  categorie: "TYPE",
  eur: "AMOUNT",
  amount: "AMOUNT",
  fx: "CURRENCY",
  currency: "CURRENCY"
};
function normalizeHeader(h) {
  const s = (h ?? "").replace(/^\uFEFF/, "").trim();
  return s;
}
function mapToStandardHeader(norm) {
  if (/^index$/i.test(norm)) return null;
  return HEADER_MAP[norm.toLowerCase()] ?? (OUTPUT_HEADERS.includes(norm) || IMPORT_HEADERS.includes(norm) ? norm : null);
}
function firstLineLooksLikeHeader(firstLineValues) {
  const mapped = firstLineValues.map((v) => mapToStandardHeader(normalizeHeader(v)));
  const hasKnownHeader = mapped.some((std) => std !== null);
  if (!hasKnownHeader) return false;
  const firstCell = (firstLineValues[0] ?? "").trim();
  const firstLooksLikeDate = parseDateToTime(firstCell) > 0;
  const firstLooksLikeNumber = !Number.isNaN(parseFloat((firstCell ?? "").replace(/,/, ".")));
  if (firstLooksLikeDate || firstLooksLikeNumber && firstLineValues.length <= 3) return false;
  return true;
}
function parseDateToTime(s) {
  const raw = (s ?? "").trim();
  if (!raw) return 0;
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
    const yy = md[3].length === 2 ? parseInt(md[3], 10) < 50 ? 2e3 + parseInt(md[3], 10) : 1900 + parseInt(md[3], 10) : parseInt(md[3], 10);
    const date = new Date(yy, m - 1, d);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return 0;
}
function formatDateDDMMYY(s) {
  const raw = (s ?? "").trim();
  if (!raw) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  let day, month, year;
  const mi = raw.match(iso);
  if (mi) {
    year = parseInt(mi[1], 10);
    month = parseInt(mi[2], 10);
    day = parseInt(mi[3], 10);
  } else {
    const md = raw.match(dmy);
    if (!md) return raw;
    day = parseInt(md[1], 10);
    month = parseInt(md[2], 10);
    const yy = parseInt(md[3], 10);
    year = md[3].length === 2 ? yy < 50 ? 2e3 + yy : 1900 + yy : yy;
  }
  const d = String(day).padStart(2, "0");
  const m = String(month).padStart(2, "0");
  const y = String(year).slice(-2);
  return `${d}.${m}.${y}`;
}
function normalizeAmount(s) {
  const raw = (s ?? "").trim().replace(/\s/g, "").replace(/[£€$]/g, "");
  if (raw === "") return "";
  const num = parseFloat(raw.replace(",", "."));
  if (Number.isNaN(num)) return null;
  return raw.replace(".", ",");
}
function emptyRow() {
  return {
    DATE: "",
    TITLE: "",
    AMOUNT: "",
    CURRENCY: "",
    ACCOUNT: "",
    "AMOUNT GBP": "",
    TYPE: ""
  };
}
function rowSignature(row) {
  const d = (row.DATE ?? "").trim();
  const t = (row.TITLE ?? "").trim();
  const amt = (row.AMOUNT ?? "").trim();
  const amtGbp = (row["AMOUNT GBP"] ?? "").trim();
  const acc = (row.ACCOUNT ?? "").trim();
  return `${d}|${t}|${amt}|${amtGbp}|${acc}`;
}
function parseCsvLine(line, delimiter) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      current += c;
    } else if (c === delimiter) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}
function inferDateColumnIndex(lines) {
  let bestIdx = 0;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    let dateCount = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      if (parseDateToTime(v) > 0) dateCount++;
    }
    if (filled > 0 && dateCount / filled > bestScore) {
      bestScore = dateCount / filled;
      bestIdx = c;
    }
  }
  return bestScore >= 0.5 ? bestIdx : -1;
}
function inferTitleColumnIndex(lines, dateCol) {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (c === dateCol) continue;
    let textLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      const isDate = parseDateToTime(v) > 0;
      const isNum = !Number.isNaN(parseFloat(v.replace(/,/, ".").replace(/[£€$\s]/g, "")));
      if (!isDate && (!isNum || v.length > 6)) textLike++;
    }
    if (filled >= 2 && textLike / filled > bestScore) {
      bestScore = textLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}
function inferEurColumnIndex(lines, exclude = /* @__PURE__ */ new Set()) {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let withEur = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      if (/€|eur/i.test(v) || normalizeAmount(v) !== null && v.length >= 4) withEur++;
    }
    if (filled > 0 && withEur / filled > bestScore) {
      bestScore = withEur / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}
function inferFxColumnIndex(lines, exclude = /* @__PURE__ */ new Set()) {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let fxLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      const n = parseFloat(v.replace(/,/, "."));
      if (!Number.isNaN(n) && n >= 0.5 && n <= 2 && v.length <= 6) fxLike++;
    }
    if (filled > 0 && fxLike / filled > bestScore) {
      bestScore = fxLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}
function inferAccountColumnIndex(lines, exclude = /* @__PURE__ */ new Set()) {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let shortText = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      const isNum = !Number.isNaN(parseFloat(v.replace(/,/, ".")));
      if (!isNum && v.length >= 2 && v.length <= 20) shortText++;
    }
    if (filled > 0 && shortText / filled > bestScore) {
      bestScore = shortText / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}
function inferExpenseColumnIndex(lines, exclude = /* @__PURE__ */ new Set()) {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let expenseLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      if (/£|gbp|expense|debit|débit|depense/i.test(v) || normalizeAmount(v) !== null) expenseLike++;
    }
    if (filled > 0 && expenseLike / filled > bestScore) {
      bestScore = expenseLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}
function inferIncomeColumnIndex(lines, expenseCol, exclude = /* @__PURE__ */ new Set()) {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (c === expenseCol || exclude.has(c)) continue;
    let incomeLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      if (/£|gbp|income|credit|crédit|revenu/i.test(v) || normalizeAmount(v) !== null) incomeLike++;
    }
    if (filled > 0 && incomeLike / filled > bestScore) {
      bestScore = incomeLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}
function inferTypeColumnIndex(lines, exclude = /* @__PURE__ */ new Set()) {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let textLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      filled++;
      const isNum = !Number.isNaN(parseFloat(v.replace(/,/, ".")));
      if (!isNum && v.length <= 30) textLike++;
    }
    if (filled > 0 && textLike / filled > bestScore) {
      bestScore = textLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}
function inferColumnMapping(parsed) {
  const colToStandardIdx = /* @__PURE__ */ new Map();
  if (parsed.length === 0) return colToStandardIdx;
  const used = /* @__PURE__ */ new Set();
  const dateCol = inferDateColumnIndex(parsed);
  if (dateCol >= 0) {
    colToStandardIdx.set(dateCol, IMPORT_HEADERS.indexOf("DATE"));
    used.add(dateCol);
  }
  const titleCol = inferTitleColumnIndex(parsed, dateCol);
  if (titleCol >= 0) {
    colToStandardIdx.set(titleCol, IMPORT_HEADERS.indexOf("TITLE"));
    used.add(titleCol);
  }
  const eurCol = inferEurColumnIndex(parsed, used);
  if (eurCol >= 0) {
    colToStandardIdx.set(eurCol, IMPORT_HEADERS.indexOf("AMOUNT"));
    used.add(eurCol);
  }
  const fxCol = inferFxColumnIndex(parsed, used);
  if (fxCol >= 0) {
    colToStandardIdx.set(fxCol, IMPORT_HEADERS.indexOf("CURRENCY"));
    used.add(fxCol);
  }
  const accountCol = inferAccountColumnIndex(parsed, used);
  if (accountCol >= 0) {
    colToStandardIdx.set(accountCol, IMPORT_HEADERS.indexOf("ACCOUNT"));
    used.add(accountCol);
  }
  const expenseCol = inferExpenseColumnIndex(parsed, used);
  if (expenseCol >= 0) {
    colToStandardIdx.set(expenseCol, IMPORT_HEADERS.indexOf("EXPENSE"));
    used.add(expenseCol);
  }
  const incomeCol = inferIncomeColumnIndex(parsed, expenseCol, used);
  if (incomeCol >= 0) {
    colToStandardIdx.set(incomeCol, IMPORT_HEADERS.indexOf("INCOME"));
    used.add(incomeCol);
  }
  const typeCol = inferTypeColumnIndex(parsed, used);
  if (typeCol >= 0) colToStandardIdx.set(typeCol, IMPORT_HEADERS.indexOf("TYPE"));
  return colToStandardIdx;
}
function processImportRow(sourceFile, lineNumber, _values, valueByStandardName, rawLine) {
  const row = emptyRow();
  row.DATE = (valueByStandardName.DATE ?? "").trim();
  row.TITLE = (valueByStandardName.TITLE ?? "").trim();
  row.AMOUNT = (valueByStandardName.AMOUNT ?? valueByStandardName.EUR ?? "").trim();
  row.CURRENCY = (valueByStandardName.CURRENCY ?? valueByStandardName.FX ?? "").trim();
  row.ACCOUNT = (valueByStandardName.ACCOUNT ?? "").trim();
  row.TYPE = (valueByStandardName.TYPE ?? "").trim();
  const reasons = [];
  const dateNorm = formatDateDDMMYY(row.DATE);
  const dateTime = parseDateToTime(row.DATE);
  if (!row.DATE.trim()) reasons.push("Date manquante");
  else if (dateTime === 0) reasons.push("Date invalide");
  else {
    row.DATE = dateNorm;
    const referenceTime = Date.now();
    const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1e3;
    if (dateTime < referenceTime - maxAgeMs) reasons.push("Date trop ancienne (plus d'un mois par rapport à la date d'importation)");
  }
  if (!row.TITLE.trim()) reasons.push("Libellé (TITLE) manquant");
  if ((valueByStandardName["AMOUNT GBP"] ?? "").trim()) {
    const amtNorm = normalizeAmount(valueByStandardName["AMOUNT GBP"]);
    if (amtNorm === null) reasons.push("Montant (AMOUNT GBP) non numérique");
    else row["AMOUNT GBP"] = amtNorm;
  } else {
    const expNorm = normalizeAmount(valueByStandardName.EXPENSE ?? "");
    if ((valueByStandardName.EXPENSE ?? "").trim() && expNorm === null) reasons.push("Dépense (EXPENSE) non numérique");
    const incNorm = normalizeAmount(valueByStandardName.INCOME ?? "");
    if ((valueByStandardName.INCOME ?? "").trim() && incNorm === null) reasons.push("Revenu (INCOME) non numérique");
    row["AMOUNT GBP"] = (incNorm ?? "").trim() ? incNorm : (expNorm ?? "").trim() ? "-" + expNorm : "";
  }
  const amountNorm = normalizeAmount(row.AMOUNT);
  if (row.AMOUNT.trim() && amountNorm === null) reasons.push("AMOUNT non numérique");
  else if (amountNorm !== null) row.AMOUNT = amountNorm;
  const currencyNorm = normalizeAmount(row.CURRENCY);
  if (row.CURRENCY.trim() && currencyNorm === null) reasons.push("CURRENCY non numérique");
  else if (currencyNorm !== null) row.CURRENCY = currencyNorm;
  const isEmpty = OUTPUT_HEADERS.slice(1).every((h) => {
    var _a;
    return !((_a = row[h]) == null ? void 0 : _a.trim());
  });
  if (isEmpty) reasons.push("Ligne vide");
  if (reasons.length > 0) {
    return {
      anomaly: {
        sourceFile,
        lineNumber,
        reason: reasons.join(" ; "),
        row: { ...row },
        rawLine
      }
    };
  }
  return { valid: row };
}
async function readExistingProcessed(appPath) {
  const fullPath = path__namespace.join(appPath, PROCESSED_PATH);
  if (!fs.existsSync(fullPath)) {
    return { headerLine: OUTPUT_HEADERS.join(";"), rows: [] };
  }
  const content = await fs__namespace.readFile(fullPath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return { headerLine: OUTPUT_HEADERS.join(";"), rows: [] };
  }
  const headerLine = lines[0];
  const headerNames = parseCsvLine(headerLine, ";").map(normalizeHeader);
  const dataHeaderMap = /* @__PURE__ */ new Map();
  headerNames.forEach((norm, i) => {
    if (/^index$/i.test(norm)) return;
    const std = mapToStandardHeader(norm) ?? (OUTPUT_HEADERS.includes(norm) ? norm : null);
    if (std) dataHeaderMap.set(norm, OUTPUT_HEADERS.indexOf(std));
  });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = parseCsvLine(line, ";");
    const row = emptyRow();
    for (let c = 0; c < headerNames.length; c++) {
      const stdKey = dataHeaderMap.get(headerNames[c]);
      if (stdKey === void 0 || stdKey === 0) continue;
      const val = (values[c] ?? "").trim();
      const key = OUTPUT_HEADERS[stdKey];
      row[key] = key === "DATE" ? formatDateDDMMYY(val) || val : val;
    }
    row.DATE = formatDateDDMMYY(row.DATE) || row.DATE;
    rows.push(row);
  }
  return { headerLine: OUTPUT_HEADERS.join(";"), rows };
}
function parseImportCsv(content, sourceFile) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  const valid = [];
  const anomalies = [];
  if (lines.length === 0) return { valid, anomalies };
  const firstLineValues = parseCsvLine(lines[0], ";");
  const useFirstLineAsHeader = firstLineLooksLikeHeader(firstLineValues);
  let dataStartIndex;
  let colToStandardName;
  if (useFirstLineAsHeader && lines.length >= 2) {
    const rawHeaders = firstLineValues.map(normalizeHeader);
    colToStandardName = /* @__PURE__ */ new Map();
    rawHeaders.forEach((norm, colIdx) => {
      const std = mapToStandardHeader(norm);
      if (std) colToStandardName.set(colIdx, std);
    });
    dataStartIndex = 1;
  } else {
    const dataLines = lines.map((line) => parseCsvLine(line, ";"));
    const colToStandardIdx = inferColumnMapping(dataLines);
    colToStandardName = /* @__PURE__ */ new Map();
    colToStandardIdx.forEach((stdIdx, colIdx) => {
      const name = stdIdx < IMPORT_HEADERS.length ? IMPORT_HEADERS[stdIdx] : OUTPUT_HEADERS[stdIdx];
      if (name && name !== "INDEX") colToStandardName.set(colIdx, name);
    });
    dataStartIndex = 0;
  }
  for (let i = dataStartIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;
    const values = parseCsvLine(rawLine, ";");
    const valueByStandardName = {};
    colToStandardName.forEach((stdName, colIdx) => {
      valueByStandardName[stdName] = (values[colIdx] ?? "").trim();
    });
    const result = processImportRow(sourceFile, i + 1, values, valueByStandardName, rawLine);
    if ("valid" in result) valid.push({ row: result.valid, sourceFile, lineNumber: i + 1, rawLine });
    else anomalies.push(result.anomaly);
  }
  return { valid, anomalies };
}
function rowToCsvLine(row, index) {
  return [
    index,
    row.DATE,
    row.TITLE,
    row.AMOUNT,
    row.CURRENCY,
    row.ACCOUNT,
    row["AMOUNT GBP"],
    row.TYPE
  ].join(";");
}
function sortByDate(rows) {
  rows.sort((a, b) => {
    const ta = parseDateToTime(a.DATE);
    const tb = parseDateToTime(b.DATE);
    if (ta === 0 && tb !== 0) return 1;
    if (tb === 0 && ta !== 0) return -1;
    return ta - tb;
  });
}
async function mergeImportTransactions(appPath) {
  const importDir = path__namespace.join(appPath, IMPORT_DIR);
  const processedFull = path__namespace.join(appPath, PROCESSED_PATH);
  if (!fs.existsSync(importDir)) {
    return { success: true, mergedCount: 0, anomalyCount: 0 };
  }
  const files = await fs__namespace.readdir(importDir);
  const csvFiles = files.filter((f) => f.toLowerCase().endsWith(".csv") && !f.toLowerCase().startsWith("import_report"));
  if (csvFiles.length === 0) {
    const processedDir2 = path__namespace.join(appPath, path__namespace.dirname(MERGE_REPORT_PATH));
    if (!fs.existsSync(processedDir2)) await fs__namespace.mkdir(processedDir2, { recursive: true });
    const reportFull2 = path__namespace.join(appPath, MERGE_REPORT_PATH);
    const reportHeader2 = "fichier_source;ligne;raison;DATE;TITLE;ACCOUNT;AMOUNT GBP;TYPE;ligne_brute";
    await fs__namespace.writeFile(reportFull2, reportHeader2 + "\n", "utf-8");
    return { success: true, mergedCount: 0, anomalyCount: 0 };
  }
  const { headerLine, rows: existingRows } = await readExistingProcessed(appPath);
  const allValid = [...existingRows];
  const allAnomalies = [];
  const existingSignatures = new Set(existingRows.map(rowSignature));
  for (const file of csvFiles) {
    const filePath = path__namespace.join(importDir, file);
    const content = await fs__namespace.readFile(filePath, "utf-8");
    const { valid, anomalies } = parseImportCsv(content, file);
    allAnomalies.push(...anomalies);
    for (const item of valid) {
      const sig = rowSignature(item.row);
      if (existingSignatures.has(sig)) {
        allAnomalies.push({
          sourceFile: item.sourceFile,
          lineNumber: item.lineNumber,
          reason: "Doublon (ligne déjà présente dans source_data.csv)",
          row: { ...item.row },
          rawLine: item.rawLine
        });
      } else {
        existingSignatures.add(sig);
        allValid.push(item.row);
      }
    }
  }
  sortByDate(allValid);
  const processedDir = path__namespace.dirname(processedFull);
  if (!fs.existsSync(processedDir)) {
    await fs__namespace.mkdir(processedDir, { recursive: true });
  }
  const csvLines = [headerLine];
  allValid.forEach((row, i) => {
    csvLines.push(rowToCsvLine(row, i + 1));
  });
  await fs__namespace.writeFile(processedFull, csvLines.join("\n"), "utf-8");
  const reportFull = path__namespace.join(appPath, MERGE_REPORT_PATH);
  const reportHeader = "fichier_source;ligne;raison;DATE;TITLE;ACCOUNT;AMOUNT GBP;TYPE;ligne_brute";
  const reportLines = [reportHeader];
  for (const a of allAnomalies) {
    const safe = (s) => (s ?? "").replace(/;/g, ",").replace(/\r?\n/g, " ");
    reportLines.push(
      [
        safe(a.sourceFile),
        a.lineNumber,
        safe(a.reason),
        safe(a.row.DATE),
        safe(a.row.TITLE),
        safe(a.row.ACCOUNT),
        safe(a.row["AMOUNT GBP"]),
        safe(a.row.TYPE),
        safe(a.rawLine)
      ].join(";")
    );
  }
  await fs__namespace.writeFile(reportFull, reportLines.join("\n"), "utf-8");
  const mergedCount = allValid.length - existingRows.length;
  return {
    success: true,
    mergedCount,
    anomalyCount: allAnomalies.length,
    reportPath: MERGE_REPORT_PATH
  };
}
async function getLastImportReportPath(appPath) {
  const reportFull = path__namespace.join(appPath, MERGE_REPORT_PATH);
  if (!fs.existsSync(reportFull)) return null;
  return MERGE_REPORT_PATH;
}
let mainWindow = null;
const createWindow = () => {
  let preloadPath;
  if (electron.app.isPackaged) {
    const appPath = electron.app.getAppPath();
    preloadPath = path__namespace.join(appPath, "dist-electron", "preload.js");
    if (!fs.existsSync(preloadPath)) {
      const altPath = path__namespace.join(process.resourcesPath, "app.asar", "dist-electron", "preload.js");
      if (fs.existsSync(altPath)) preloadPath = altPath;
    }
  } else {
    preloadPath = path__namespace.join(__dirname, "preload.js");
  }
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    },
    title: "Chamaccounts",
    frame: true,
    autoHideMenuBar: true
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    if (electron.app.isPackaged) {
      const appPath = electron.app.getAppPath();
      mainWindow.loadFile(path__namespace.join(appPath, "dist", "index.html")).catch(console.error);
    } else {
      const htmlPath = path__namespace.join(__dirname, "../dist/index.html");
      if (mainWindow) mainWindow.loadFile(htmlPath);
    }
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};
const getAppPath = () => {
  if (electron.app.isPackaged && process.platform === "linux") {
    return electron.app.getPath("userData");
  }
  if (electron.app.isPackaged) {
    const unpackedPath = path__namespace.join(process.resourcesPath, "app.asar.unpacked");
    if (fs.existsSync(unpackedPath)) return unpackedPath;
    return process.resourcesPath;
  }
  return electron.app.getAppPath();
};
function registerIpcHandlers() {
  if (!electron.ipcMain) return;
  electron.ipcMain.handle("read-file", async (_, filePath) => {
    try {
      const fullPath = path__namespace.isAbsolute(filePath) ? filePath : path__namespace.join(getAppPath(), filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Fichier non trouvé: ${fullPath}` };
      }
      const content = await fs__namespace.readFile(fullPath, "utf-8");
      return { success: true, data: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("write-file", async (_, filePath, content) => {
    try {
      const fullPath = path__namespace.isAbsolute(filePath) ? filePath : path__namespace.join(getAppPath(), filePath);
      const dirPath = path__namespace.dirname(fullPath);
      if (!fs.existsSync(dirPath)) {
        await fs__namespace.mkdir(dirPath, { recursive: true });
      }
      await fs__namespace.writeFile(fullPath, content, "utf-8");
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("read-directory", async (_, dirPath) => {
    try {
      const fullPath = path__namespace.isAbsolute(dirPath) ? dirPath : path__namespace.join(getAppPath(), dirPath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Dossier non trouvé: ${fullPath}` };
      }
      const files = await fs__namespace.readdir(fullPath);
      return { success: true, data: files };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("delete-file", async (_, filePath) => {
    try {
      const fullPath = path__namespace.isAbsolute(filePath) ? filePath : path__namespace.join(getAppPath(), filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Fichier non trouvé: ${fullPath}` };
      }
      await fs__namespace.unlink(fullPath);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("move-file", async (_, sourcePath, destPath) => {
    try {
      const fullSource = path__namespace.isAbsolute(sourcePath) ? sourcePath : path__namespace.join(getAppPath(), sourcePath);
      const fullDest = path__namespace.isAbsolute(destPath) ? destPath : path__namespace.join(getAppPath(), destPath);
      if (!fs.existsSync(fullSource)) {
        return { success: false, error: `Fichier non trouvé: ${fullSource}` };
      }
      const destDir = path__namespace.dirname(fullDest);
      if (!fs.existsSync(destDir)) {
        await fs__namespace.mkdir(destDir, { recursive: true });
      }
      try {
        await fs__namespace.rename(fullSource, fullDest);
      } catch {
        await fs__namespace.copyFile(fullSource, fullDest);
        await fs__namespace.unlink(fullSource);
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("get-app-path", async () => getAppPath());
  electron.ipcMain.handle("select-folder", async () => {
    try {
      if (!mainWindow) return { success: false, error: "Fenêtre non disponible" };
      const result = await electron.dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Sélectionner un dossier" });
      if (result.canceled) return { success: false, canceled: true };
      return { success: true, path: result.filePaths[0] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("select-file", async (_, options) => {
    try {
      if (!mainWindow) return { success: false, error: "Fenêtre non disponible" };
      const opts = { properties: ["openFile"], title: "Sélectionner un fichier" };
      if (options == null ? void 0 : options.filters) opts.filters = options.filters;
      const result = await electron.dialog.showOpenDialog(mainWindow, opts);
      if (result.canceled) return { success: false, canceled: true };
      return { success: true, path: result.filePaths[0] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  const TRANSACTIONS_IMPORT_DIR = "data/TransactionsData/Import";
  electron.ipcMain.handle("import-transaction-files", async () => {
    var _a;
    try {
      if (!mainWindow) return { success: false, error: "Fenêtre non disponible" };
      const result = await electron.dialog.showOpenDialog(mainWindow, {
        properties: ["openFile", "multiSelections"],
        title: "Importer des fichiers (XLSX ou CSV)",
        filters: [
          { name: "Fichiers transactions", extensions: ["xlsx", "csv"] },
          { name: "Tous les fichiers", extensions: ["*"] }
        ]
      });
      if (result.canceled || !((_a = result.filePaths) == null ? void 0 : _a.length)) {
        return { success: true, canceled: true, imported: [] };
      }
      const destDir = path__namespace.join(getAppPath(), TRANSACTIONS_IMPORT_DIR);
      if (!fs.existsSync(destDir)) {
        await fs__namespace.mkdir(destDir, { recursive: true });
      }
      const imported = [];
      for (const srcPath of result.filePaths) {
        const ext = path__namespace.extname(srcPath).toLowerCase();
        if (ext !== ".xlsx" && ext !== ".csv") continue;
        const base = path__namespace.basename(srcPath);
        const destPath = path__namespace.join(destDir, base);
        await fs__namespace.copyFile(srcPath, destPath);
        imported.push(base);
      }
      return { success: true, imported };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("open-import-folder", async () => {
    try {
      const fullPath = path__namespace.join(getAppPath(), TRANSACTIONS_IMPORT_DIR);
      if (!fs.existsSync(fullPath)) {
        await fs__namespace.mkdir(fullPath, { recursive: true });
      }
      await electron.shell.openPath(fullPath);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  const TRANSACTIONS_OLD_DIR = "data/TransactionsData/Old";
  electron.ipcMain.handle("archive-import-folder", async () => {
    try {
      const appPath = getAppPath();
      const importDir = path__namespace.join(appPath, TRANSACTIONS_IMPORT_DIR);
      const oldDir = path__namespace.join(appPath, TRANSACTIONS_OLD_DIR);
      if (!fs.existsSync(importDir)) {
        return { success: true, movedCount: 0, message: "Aucun dossier Import." };
      }
      const entries = await fs__namespace.readdir(importDir, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);
      if (files.length === 0) {
        return { success: true, movedCount: 0, message: "Aucun fichier à archiver." };
      }
      if (!fs.existsSync(oldDir)) {
        await fs__namespace.mkdir(oldDir, { recursive: true });
      }
      let movedCount = 0;
      for (const name of files) {
        const src = path__namespace.join(importDir, name);
        const dest = path__namespace.join(oldDir, name);
        try {
          await fs__namespace.rename(src, dest);
          movedCount++;
        } catch {
          await fs__namespace.copyFile(src, dest);
          await fs__namespace.unlink(src);
          movedCount++;
        }
      }
      return { success: true, movedCount, message: `${movedCount} fichier(s) déplacé(s) vers Old.` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, movedCount: 0 };
    }
  });
  electron.ipcMain.handle("merge-import-transactions", async () => {
    try {
      const appPath = getAppPath();
      const result = await mergeImportTransactions(appPath);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, mergedCount: 0, anomalyCount: 0 };
    }
  });
  electron.ipcMain.handle("get-last-import-report-path", async () => {
    try {
      const appPath = getAppPath();
      const relativePath = await getLastImportReportPath(appPath);
      return { success: true, path: relativePath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("open-import-report", async () => {
    try {
      const appPath = getAppPath();
      const relativePath = await getLastImportReportPath(appPath);
      if (!relativePath) {
        return { success: false, error: "Aucun rapport de fusion trouvé." };
      }
      const fullPath = path__namespace.join(appPath, relativePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "Fichier rapport introuvable." };
      }
      const platform = process.platform;
      if (platform === "darwin") {
        child_process.spawn("open", ["-a", "TextEdit", fullPath], { detached: true });
      } else if (platform === "win32") {
        child_process.spawn("notepad", [fullPath], { detached: true, shell: true });
      } else {
        child_process.spawn("xdg-open", [fullPath], { detached: true });
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  const ANOMALY_REPORT_PATH = "data/TransactionsData/Processed/anomaly_report.csv";
  const MONTHLY_ANOMALY_REPORT_PATH = "data/TransactionsData/Processed/monthly_anomaly_report.csv";
  electron.ipcMain.handle("open-anomaly-report", async () => {
    try {
      const appPath = getAppPath();
      const fullPath = path__namespace.join(appPath, ANOMALY_REPORT_PATH);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "Aucun rapport d'anomalies trouvé." };
      }
      const platform = process.platform;
      if (platform === "darwin") {
        child_process.spawn("open", ["-a", "TextEdit", fullPath], { detached: true });
      } else if (platform === "win32") {
        child_process.spawn("notepad", [fullPath], { detached: true, shell: true });
      } else {
        child_process.spawn("xdg-open", [fullPath], { detached: true });
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("open-monthly-anomaly-report", async () => {
    try {
      const appPath = getAppPath();
      const fullPath = path__namespace.join(appPath, MONTHLY_ANOMALY_REPORT_PATH);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "Aucun rapport d'anomalies mensuel trouvé." };
      }
      const platform = process.platform;
      if (platform === "darwin") {
        child_process.spawn("open", ["-a", "TextEdit", fullPath], { detached: true });
      } else if (platform === "win32") {
        child_process.spawn("notepad", [fullPath], { detached: true, shell: true });
      } else {
        child_process.spawn("xdg-open", [fullPath], { detached: true });
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("download-import-report", async () => {
    try {
      const appPath = getAppPath();
      const relativePath = await getLastImportReportPath(appPath);
      if (!relativePath) {
        return { success: false, error: "Aucun rapport d'importation trouvé." };
      }
      const fullPath = path__namespace.join(appPath, relativePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "Fichier rapport introuvable." };
      }
      if (!mainWindow) return { success: false, error: "Fenêtre non disponible" };
      const defaultName = path__namespace.basename(fullPath);
      const result = await electron.dialog.showSaveDialog(mainWindow, {
        title: "Télécharger le rapport d'importation",
        defaultPath: defaultName,
        filters: [{ name: "Fichiers texte", extensions: ["txt"] }]
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      const content = await fs__namespace.readFile(fullPath, "utf-8");
      await fs__namespace.writeFile(result.filePath, content, "utf-8");
      return { success: true, path: result.filePath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("save-file", async (_, options) => {
    try {
      if (!mainWindow) return { success: false, error: "Fenêtre non disponible" };
      const opts = { title: "Sauvegarder" };
      if (options == null ? void 0 : options.defaultPath) opts.defaultPath = options.defaultPath;
      if (options == null ? void 0 : options.filters) opts.filters = options.filters;
      const result = await electron.dialog.showSaveDialog(mainWindow, opts);
      if (result.canceled) return { success: false, canceled: true };
      return { success: true, path: result.filePath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("read-external-file", async (_, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: `Fichier non trouvé: ${filePath}` };
      const content = await fs__namespace.readFile(filePath, "utf-8");
      return { success: true, data: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("write-external-file", async (_, filePath, content) => {
    try {
      const dirPath = path__namespace.dirname(filePath);
      if (!fs.existsSync(dirPath)) await fs__namespace.mkdir(dirPath, { recursive: true });
      await fs__namespace.writeFile(filePath, content, "utf-8");
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("open-path", async (_, filePath) => {
    try {
      const fullPath = path__namespace.isAbsolute(filePath) ? filePath : path__namespace.join(getAppPath(), filePath);
      if (!fs.existsSync(fullPath)) return { success: false, error: `Fichier non trouvé: ${fullPath}` };
      await electron.shell.openPath(fullPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("write-binary-file", async (_, filePath, base64Content) => {
    try {
      const fullPath = path__namespace.isAbsolute(filePath) ? filePath : path__namespace.join(getAppPath(), filePath);
      const dirPath = path__namespace.dirname(fullPath);
      if (!fs.existsSync(dirPath)) await fs__namespace.mkdir(dirPath, { recursive: true });
      const buffer = Buffer.from(base64Content, "base64");
      await fs__namespace.writeFile(fullPath, buffer);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("convert-xlsx-to-csv", async (_, filePath) => {
    try {
      const fullPath = path__namespace.isAbsolute(filePath) ? filePath : path__namespace.join(getAppPath(), filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "Fichier non trouvé" };
      }
      const ext = path__namespace.extname(fullPath).toLowerCase();
      if (ext !== ".xlsx") {
        return { success: false, error: "Le fichier doit être au format .xlsx" };
      }
      const XLSX = require("xlsx");
      const workbook = XLSX.readFile(fullPath);
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return { success: false, error: "Aucune feuille dans le classeur" };
      }
      const sheet = workbook.Sheets[firstSheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, {
        FS: ";",
        RS: "\n",
        dateNF: "dd.mm.yyyy",
        cellDates: true
      });
      const csvPath = fullPath.replace(/\.xlsx$/i, ".csv");
      await fs__namespace.writeFile(csvPath, csv, "utf-8");
      const csvName = path__namespace.basename(csvPath);
      const oldDir = path__namespace.join(getAppPath(), "data", "TransactionsData", "Old");
      if (!fs.existsSync(oldDir)) {
        await fs__namespace.mkdir(oldDir, { recursive: true });
      }
      const oldXlsxPath = path__namespace.join(oldDir, path__namespace.basename(fullPath));
      try {
        await fs__namespace.rename(fullPath, oldXlsxPath);
      } catch {
        await fs__namespace.copyFile(fullPath, oldXlsxPath);
        await fs__namespace.unlink(fullPath);
      }
      return { success: true, csvName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
}
if (process.versions.electron) {
  electron.app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") electron.app.quit();
  });
}
