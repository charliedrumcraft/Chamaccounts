/**
 * Fusionne ~/Desktop/support.csv dans data/TransactionsData/Processed/src_transaction_data.csv.
 * Usage : node scripts/import-desktop-support-csv.js [chemin_support_csv]
 * Défaut chemin_support_csv : ~/Desktop/support.csv
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_RATE = parseFloat(process.env.EUR_GBP_RATE || '0.86'); // aligné défaut Réglages

function parseEuroAmount(cell) {
  let t = (cell ?? '')
    .trim()
    .replace(/\u20ac/g, '')
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .trim();
  if (!t) return NaN;
  // Format type 1.496,07 (milliers avec point)
  const dotThousandsCommaDec = /^(\d{1,3}(?:\.\d{3})*),(\d{2})$/;
  const m = t.match(dotThousandsCommaDec);
  if (m) return parseFloat(m[1].replace(/\./g, '') + '.' + m[2]);
  // 440,00 ou 440.00
  if (/,/.test(t) && !/\.\d{3}/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return parseFloat(t.replace(',', '.'));
}

function formatAmountCsv(n) {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace('.', ',');
}

function parseSupportLines(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(';').map((p) => p.trim());
    if (parts.length < 7 || !parts[0] || !parts[1]) continue;
    const date = parts[0];
    const title = parts[1];
    const amountRaw = parts[5] ?? '';
    const source = (parts[6] ?? '').trim() || 'Perspectives';
    if (!title || !amountRaw) continue;
    const amountEur = parseEuroAmount(amountRaw);
    if (Number.isNaN(amountEur) || amountEur === 0) continue;
    out.push({ date, title, amountEur, source });
  }
  return out;
}

function readMainCsv(mainPath) {
  const content = fs.readFileSync(mainPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  const headerLine = lines[0];
  const headerFields = headerLine.split(';').map((h) => h.replace(/^\uFEFF/, '').trim());
  const dataLines = lines.slice(1);
  return { headerFields, dataLines, headerLine };
}

function parseMainRow(line) {
  return line.split(';');
}

function buildRowByHeader(headerFields, valuesByName) {
  return headerFields.map((h) => valuesByName[h] ?? '');
}

function main() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const supportPath =
    process.argv[2] || path.join(home, 'Desktop', 'support.csv');
  const { resolveDataRoot } = require('./lib/resolve-data-root');
  const repoRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(
    resolveDataRoot(repoRoot),
    'TransactionsData',
    'Processed',
    'src_transaction_data.csv'
  );

  if (!fs.existsSync(supportPath)) {
    console.error('Fichier introuvable:', supportPath);
    process.exit(1);
  }
  if (!fs.existsSync(mainPath)) {
    console.error('Fichier principal introuvable:', mainPath);
    process.exit(1);
  }

  const supportContent = fs.readFileSync(supportPath, 'utf8');
  const imports = parseSupportLines(supportContent);
  console.log('Lignes soutien à importer:', imports.length);

  const { headerFields, dataLines } = readMainCsv(mainPath);
  const idx = {};
  headerFields.forEach((h, i) => {
    idx[h.toLowerCase()] = i;
  });

  const getCol = (row, nameRegex) => {
    const low = headerFields.map((h) => h.toLowerCase());
    const i = low.findIndex((h) => nameRegex.test(h));
    return i >= 0 ? row[i] ?? '' : '';
  };

  const existing = new Set();
  for (const dl of dataLines) {
    const cells = parseMainRow(dl);
    const d = getCol(cells, /^date$/i);
    const t = getCol(cells, /^title$/i);
    const a = getCol(cells, /^amount$/i);
    const ty = getCol(cells, /^type$/i);
    if (ty.toLowerCase() === 'support' && d && t) existing.add(`${d}|${t}|${a}`);
  }

  const newRows = [];
  let skippedDup = 0;
  for (const imp of imports) {
    const sig = `${imp.date}|${imp.title}|${formatAmountCsv(imp.amountEur)}`;
    if (existing.has(sig)) {
      skippedDup++;
      continue;
    }
    existing.add(sig);
    const gbp = imp.amountEur * DEFAULT_RATE;
    const rowObj = {};
    headerFields.forEach((h) => {
      const hl = h.toLowerCase();
      if (/^index$/i.test(h)) rowObj[h] = ''; // réindexé après
      else if (/^date$/i.test(h)) rowObj[h] = imp.date;
      else if (/^title$/i.test(h)) rowObj[h] = imp.title;
      else if (/^amount$/i.test(h)) rowObj[h] = formatAmountCsv(imp.amountEur);
      else if (/^currency$/i.test(h)) rowObj[h] = 'EUR';
      else if (/^account$/i.test(h)) rowObj[h] = 'REV EUR';
      else if (/^amount\s*gbp$/i.test(h)) rowObj[h] = formatAmountCsv(gbp);
      else if (/^type$/i.test(h)) rowObj[h] = 'Support';
      else if (/^source$/i.test(h)) rowObj[h] = imp.source;
      else if (/^exclure/i.test(h) || /^soutien_ignorer$/i.test(h)) rowObj[h] = '';
      else if (/^projet$/i.test(h)) rowObj[h] = '';
      else rowObj[h] = '';
    });
    newRows.push(
      headerFields.map((h) => (rowObj[h] !== undefined ? rowObj[h] : '').toString())
    );
  }

  console.log('Doublons ignorés (même DATE+TITLE+AMOUNT que l’existant):', skippedDup);
  console.log('Nouvelles lignes ajoutées:', newRows.length);

  const allDataLines = [...dataLines];
  for (const r of newRows) {
    allDataLines.push(r.join(';'));
  }

  let indexCol = headerFields.findIndex((h) => /^index$/i.test(h));
  if (indexCol < 0) indexCol = 0;

  const reindexed = allDataLines.map((line, i) => {
    const cells = parseMainRow(line);
    const next = [...cells];
    while (next.length < headerFields.length) next.push('');
    next[indexCol] = String(i + 1);
    return next.join(';');
  });

  const out = [headerFields.join(';'), ...reindexed].join('\n') + '\n';
  fs.writeFileSync(mainPath, out, 'utf8');
  console.log('Écrit:', mainPath);
}

main();
