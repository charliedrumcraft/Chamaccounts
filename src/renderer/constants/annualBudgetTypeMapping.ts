/**
 * Correspondance Type (colonne du tableau des transactions) → id de ligne du bilan budgétisé (Budget annuel).
 * Aligné avec la page Budget annuel.
 */
export const TYPE_TO_BALANCE_LINE_ID: Record<string, string> = {
  'Lampton': 'ni-lampton',
  'Lampton School': 'ni-lampton',
  'LMB': 'ni-lmb',
  'LTL': 'ni-ltl',
  'MPC': 'ni-mpc',
  'LGV': 'ni-lgv',
  'Papa/Maman': 'fsp-papa-maman',
  'Theo Vogt': 'fsp-theo-vogt',
  'Candlefish': 'fsp-candlefish',
  'André': 'fsp-andre',
  'Elsa Vogt': 'fsp-elsa-vogt',
  'Support': 'fsp-other',
  'Perspectives': 'fspers-perspectives',
  'Freddy Riess': 'fspers-freddy-riess',
  'Leopaul Vogt': 'fspers-leopaul-vogt',
  'Andre Vogt': 'fspers-andre-vogt',
  'Refund': 'oi-refund',
  'Other Inc': 'oi-other',
  'Benefit': 'oi-benefit',
  'SLC credit': 'slc-credit',
  'SLCcredit': 'slc-credit',
  'Rent': 'hc-rent',
  'Comm': 'hc-comm',
  'Electricity': 'hc-electricity',
  'Water': 'hc-water',
  'Service Charge': 'hc-service-charge',
  'Transport': 'mob-transport',
  'Fuel': 'mob-fuel',
  'Car': 'mob-car',
  'Food': 'lc-food',
  'Restaurant': 'lc-restaurant',
  'Shopping': 'lc-shopping',
  'Leisure': 'lc-leisure',
  'Holiday': 'lc-holiday',
  'Health': 'lc-health',
  'Misc': 'misc-total',
  'Donation': 'donation-total',
  'LST': 'tr-lst-fees',
  'LST Fees': 'tr-lst-fees',
  'School': 'tr-school',
  'SLC Maria': 'slc-maria',
  'SLC Charlie': 'slc-charlie',
  'SLCdebit': 'slc-maria',
  'Council': 'slc-council-tax',
  'Council tax': 'slc-council-tax',
  'Other taxes': 'slc-other-taxes',
};

/** Pour chaque ligne de bilan, types affectés par défaut (inverse de TYPE_TO_BALANCE_LINE_ID). */
export function getDefaultLineAssignedTypes(): Record<string, string[]> {
  const lineToTypes: Record<string, string[]> = {};
  for (const [type, lineId] of Object.entries(TYPE_TO_BALANCE_LINE_ID)) {
    if (!lineToTypes[lineId]) lineToTypes[lineId] = [];
    lineToTypes[lineId].push(type);
  }
  return lineToTypes;
}

/**
 * Résout l'id de ligne du bilan pour un type de transaction (mapping direct ou types affectés à la ligne).
 */
export function resolveBalanceLineIdForTransactionType(
  type: string,
  lineAssignedTypes: Record<string, string[]>
): string | null {
  const t = type.trim();
  if (!t || t === '—') return null;
  const direct = TYPE_TO_BALANCE_LINE_ID[t];
  if (direct) return direct;
  const defaults = getDefaultLineAssignedTypes();
  const lineIds = new Set([...Object.keys(defaults), ...Object.keys(lineAssignedTypes)]);
  for (const lineId of lineIds) {
    const assigned = lineAssignedTypes[lineId] ?? defaults[lineId] ?? [];
    if (assigned.includes(t)) return lineId;
  }
  return null;
}
