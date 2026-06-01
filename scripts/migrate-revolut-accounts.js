/**
 * Met à jour src_transaction_data.csv : remplace le compte « Revolut » par REV GBP ou REV EUR.
 * Règles :
 * - Account = Revolut et CURRENCY vide → REV GBP
 * - Account = Revolut et CURRENCY contient « EUR » (insensible à la casse) → REV EUR
 *
 * Usage :
 *   node scripts/migrate-revolut-accounts.js           # écrit le fichier
 *   node scripts/migrate-revolut-accounts.js --dry-run # affiche seulement les comptages
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const { resolveDataRoot } = require('./lib/resolve-data-root');
const REPO_ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(
  resolveDataRoot(REPO_ROOT),
  'TransactionsData/Processed/src_transaction_data.csv'
);

function findAccountKey(fields) {
  for (const h of fields) {
    const n = String(h ?? '').trim();
    if (/^account$/i.test(n) || /compte/i.test(n)) return h;
  }
  return null;
}

function findCurrencyKey(fields) {
  for (const h of fields) {
    if (/^currency$/i.test(String(h ?? '').trim())) return h;
  }
  return null;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(CSV_PATH)) {
    console.error('Fichier introuvable:', CSV_PATH);
    process.exit(1);
  }

  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed = Papa.parse(content, {
    header: true,
    delimiter: ';',
    skipEmptyLines: 'greedy',
  });

  const fields = parsed.meta.fields;
  if (!fields || fields.length === 0) {
    console.error('En-têtes manquants.');
    process.exit(1);
  }

  const accountKey = findAccountKey(fields);
  const currencyKey = findCurrencyKey(fields);
  if (!accountKey) {
    console.error('Colonne Account introuvable. En-têtes:', fields.join('; '));
    process.exit(1);
  }
  if (!currencyKey) {
    console.error('Colonne Currency introuvable. En-têtes:', fields.join('; '));
    process.exit(1);
  }

  let toGbp = 0;
  let toEur = 0;
  const remainingRevolut = [];

  const rows = parsed.data.map((row, idx) => {
    const acc = String(row[accountKey] ?? '').trim();
    if (acc !== 'Revolut') return row;

    const cur = String(row[currencyKey] ?? '').trim();
    const upper = cur.toUpperCase();

    if (cur === '') {
      toGbp++;
      return { ...row, [accountKey]: 'REV GBP' };
    }
    if (upper.includes('EUR')) {
      toEur++;
      return { ...row, [accountKey]: 'REV EUR' };
    }

    remainingRevolut.push({ ligneFichier: idx + 2, currency: cur || '(vide)' });
    return row;
  });

  console.log('Migration comptes Revolut (src_transaction_data.csv)');
  console.log(`  → REV GBP (CURRENCY vide)     : ${toGbp} ligne(s)`);
  console.log(`  → REV EUR (CURRENCY → EUR)   : ${toEur} ligne(s)`);
  if (remainingRevolut.length > 0) {
    console.log(
      `  ! ${remainingRevolut.length} ligne(s) encore « Revolut » (currency ni vide ni EUR), non modifiées.`
    );
    remainingRevolut.slice(0, 15).forEach((r) =>
      console.log(`      ligne ${r.ligneFichier}, CURRENCY=${r.currency}`)
    );
    if (remainingRevolut.length > 15) {
      console.log(`      … ${remainingRevolut.length - 15} autre(s)`);
    }
  }

  if (dryRun) {
    console.log('\nMode --dry-run : aucune écriture.');
    return;
  }

  const out = Papa.unparse(rows, { delimiter: ';', columns: fields, newline: '\n' });
  fs.writeFileSync(CSV_PATH, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
  console.log('\nFichier mis à jour :', CSV_PATH);
}

main();
