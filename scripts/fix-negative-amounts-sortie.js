/**
 * Corrige src_transaction_data.csv : pour chaque ligne dont TYPE est un type "sortie",
 * si AMOUNT ou AMOUNT GBP est positif, le remplace par sa valeur négative.
 * Préserve le format (virgule décimale).
 */

const fs = require('fs');
const path = require('path');

const { resolveDataRoot } = require('./lib/resolve-data-root');
const REPO_ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(
  resolveDataRoot(REPO_ROOT),
  'TransactionsData/Processed/src_transaction_data.csv'
);

const SORTIE_TYPES = new Set([
  'Rent', 'Council', 'Comm', 'Electricity', 'Water', 'Service', 'SLCdebit',
  'Transport', 'Fuel', 'Car', 'Food', 'Restaurant', 'Shopping', 'Leasure', 'Leisure',
  'Holiday', 'LST', 'School', 'Misc', 'Health', 'Donation'
]);

function parseAmount(s) {
  if (s == null || String(s).trim() === '') return null;
  const normalized = String(s).trim().replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? null : n;
}

function formatNegative(num) {
  if (num == null || Number.isNaN(num)) return '';
  const neg = num > 0 ? -num : num;
  const s = String(neg);
  return s.replace('.', ',');
}

const content = fs.readFileSync(CSV_PATH, 'utf8');
const lines = content.split(/\r?\n/);
if (lines.length === 0) {
  console.error('Fichier vide');
  process.exit(1);
}

const header = lines[0];
const out = [header];
let modifiedCount = 0;
const modifiedLines = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) {
    out.push(line);
    continue;
  }
  const parts = line.split(';');
  if (parts.length < 8) {
    out.push(line);
    continue;
  }
  const type = (parts[7] || '').trim();
  if (!SORTIE_TYPES.has(type)) {
    out.push(line);
    continue;
  }
  let changed = false;
  const amountRaw = parts[3];
  const amountGbpRaw = parts[6];
  const amountNum = parseAmount(amountRaw);
  const amountGbpNum = parseAmount(amountGbpRaw);
  if (amountNum != null && amountNum > 0) {
    parts[3] = formatNegative(amountNum);
    changed = true;
  }
  if (amountGbpNum != null && amountGbpNum > 0) {
    parts[6] = formatNegative(amountGbpNum);
    changed = true;
  }
  if (changed) {
    modifiedCount++;
    modifiedLines.push({ lineNum: i + 1, type, before: [amountRaw, amountGbpRaw], after: [parts[3], parts[6]] });
  }
  out.push(parts.join(';'));
}

fs.writeFileSync(CSV_PATH, out.join('\n'), 'utf8');
console.log('Lignes modifiées:', modifiedCount);
modifiedLines.forEach(({ lineNum, type, before, after }) => {
  console.log(`  L${lineNum} [${type}] AMOUNT ${before[0]} -> ${after[0]} | AMOUNT GBP ${before[1]} -> ${after[1]}`);
});
