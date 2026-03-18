/**
 * Formate un montant avec devise.
 * Style GBP : décimale = point (.), milliers = virgule (,), devise avant la somme (ex. £20,000.50).
 */
export const formatCurrency = (amount: number, currency: string = '£'): string => {
  const abs = Math.abs(amount);
  const [intPart, decPart] = abs.toFixed(2).split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = `${withThousands}.${decPart}`;
  const sign = amount < 0 ? '-' : '';
  return `${sign}${currency}${formatted}`;
};

/**
 * Formate un montant en euros (ex. "200" → "€200.00").
 */
export const formatEur = (value: string): string => {
  const s = (value ?? '').trim();
  if (s === '') return '';
  const num = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(num)) return value;
  return formatCurrency(num, '€');
};

/**
 * Formate un montant en livres sterling (ex. "24,77958" → "£24.78").
 * Virgule → point, arrondi à 2 décimales, préfixe £.
 */
export const formatGbp = (value: string): string => {
  const s = (value ?? '').trim();
  if (s === '') return '';
  const num = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(num)) return value;
  return formatCurrency(num, '£');
};
export const formatFx = (value: string): string => {
  const s = (value ?? '').trim();
  if (s === '') return '';
  const num = parseFloat(s.replace(',', '.'));
  if (Number.isNaN(num)) return value;
  return num.toFixed(2);
};

/** Formate un montant numérique pour la cellule AMOUNT GBP (virgule décimale, 2 décimales). */
export function formatAmountGbpForCsv(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace('.', ',');
}

/**
 * Formate une date en JJ.MM.AAAA (jour, mois, année).
 * Accepte ISO (YYYY-MM-DD), DD/MM/YYYY, DD.MM.YYYY, et DD.MM.AA (année sur 2 chiffres → 20AA si AA < 50, sinon 19AA).
 */
export const formatDateDDMMYYYY = (value: string): string => {
  const s = (value ?? '').trim();
  if (!s) return '';

  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmySlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/;
  const dmyDot = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})/;

  let day: string;
  let month: string;
  let year: string;

  let m = s.match(iso);
  if (m) {
    [, year, month, day] = m;
  } else {
    m = s.match(dmySlash) ?? s.match(dmyDot);
    if (m) {
      [, day, month, year] = m;
      if (year.length === 2) {
        const yy = parseInt(year, 10);
        year = yy < 50 ? `20${year}` : `19${year}`;
      }
    } else {
      return s;
    }
  }

  const j = day.padStart(2, '0');
  const mo = month.padStart(2, '0');
  return `${j}.${mo}.${year}`;
};
