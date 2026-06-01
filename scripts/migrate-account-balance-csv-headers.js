/**
 * Migre src_account_balance.csv : en-têtes alignés sur les comptes actifs (Paramètres),
 * fusion Revolut GBP + Revolut GBP Savings → REV GBP.
 * Usage : node scripts/migrate-account-balance-csv-headers.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const { resolveDataRoot } = require('./lib/resolve-data-root');
const REPO_ROOT = path.join(__dirname, '..');
const INPUT = path.join(
  resolveDataRoot(REPO_ROOT),
  'AccountBalanceData/Processed/src_account_balance.csv'
);

const OUTPUT_HEADERS = [
  'DATE',
  'CM',
  'REV EUR',
  'REV GBP',
  'REV CHF',
  'N26FR',
  'N26DE',
  'HSBC A/C',
  'HSBC OBS',
  'Advanzia',
  'Cash',
];

function parseAmount(raw) {
  if (raw === undefined || raw === null) return 0;
  const s = String(raw).trim();
  if (s === '' || s === '-' || /^-?\s*(€|£|CHF)?\s*$/i.test(s)) return 0;
  const cleaned = s.replace(/[\s£€CHF]/gi, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function fmtEur(n) {
  if (Math.abs(n) < 1e-9) return '';
  const neg = n < 0;
  const v = Math.abs(n);
  const [intPart, dec] = v
    .toFixed(2)
    .replace('.', ',')
    .split(',');
  const intDotted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${intDotted},${dec} €`;
}

function fmtGbp(n) {
  if (Math.abs(n) < 1e-9) return '';
  const neg = n < 0;
  const v = Math.abs(n);
  const [intPart, dec] = v
    .toFixed(2)
    .replace('.', ',')
    .split(',');
  const intDotted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}£${intDotted},${dec}`;
}

function fmtChf(n) {
  if (Math.abs(n) < 1e-9) return '';
  const neg = n < 0;
  const v = Math.abs(n);
  const [intPart, dec] = v
    .toFixed(2)
    .replace('.', ',')
    .split(',');
  const intDotted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${intDotted},${dec} CHF`;
}

function rowFromOld(row) {
  const revGbp = parseAmount(row['Revolut GBP']) + parseAmount(row['Revolut GBP Savings']);
  return [
    (row.DATE ?? row.Date ?? '').trim(),
    fmtEur(parseAmount(row['LB CM'])),
    fmtEur(parseAmount(row['Revolut EUR'])),
    fmtGbp(revGbp),
    fmtChf(parseAmount(row['Revolut CHF'])),
    fmtEur(parseAmount(row['N26 Charlie'])),
    fmtEur(parseAmount(row['N26 Maria'])),
    fmtGbp(parseAmount(row['HSBC A/C'])),
    fmtGbp(parseAmount(row['HSBC SAVINGS'])),
    fmtEur(parseAmount(row['Advanzia'])),
    fmtEur(parseAmount(row['Cash EUR'])),
  ];
}

const content = fs.readFileSync(INPUT, 'utf8');
const parsed = Papa.parse(content, {
  header: true,
  delimiter: ';',
  skipEmptyLines: true,
});

if (!parsed.data?.length) {
  console.error('CSV vide ou illisible');
  process.exit(1);
}

const outData = [];
for (const row of parsed.data) {
  if (!row || typeof row !== 'object') continue;
  const dateVal = (row.DATE ?? row.Date ?? '').trim();
  if (!dateVal) continue;
  outData.push(rowFromOld(row));
}

const out = Papa.unparse(
  {
    fields: OUTPUT_HEADERS,
    data: outData,
  },
  { delimiter: ';' }
);

fs.writeFileSync(INPUT, out, 'utf8');
console.log(`OK : ${outData.length} lignes écrites dans ${INPUT}`);
