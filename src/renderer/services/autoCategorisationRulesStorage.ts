/**
 * Persistance des règles fixes d’auto-catégorisation TITLE → TYPE (localStorage / AppState).
 */

import type { FixedAutoCatMatch, FixedAutoCatRule } from '@/shared/autoCategorisation';

export const AUTO_CATEGORISATION_RULES_STORAGE_KEY = 'settings-auto-categorisation-rules';

function newId(): string {
  return `acr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMatch(m: unknown): FixedAutoCatMatch {
  if (m === 'equals' || m === 'startsWith' || m === 'contains') return m;
  return 'contains';
}

export function normalizeFixedAutoCatRule(raw: Partial<FixedAutoCatRule> | null | undefined): FixedAutoCatRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const pattern = String(raw.pattern ?? '').trim();
  const type = String(raw.type ?? '').trim();
  if (!pattern || !type) return null;
  return {
    id: String(raw.id ?? '').trim() || newId(),
    pattern,
    match: normalizeMatch(raw.match),
    type,
    enabled: raw.enabled !== false,
  };
}

export function loadFixedAutoCatRules(): FixedAutoCatRule[] {
  try {
    const raw = localStorage.getItem(AUTO_CATEGORISATION_RULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((r) => normalizeFixedAutoCatRule(r as Partial<FixedAutoCatRule>))
      .filter((r): r is FixedAutoCatRule => r !== null);
    const seen = new Set<string>();
    const deduped: FixedAutoCatRule[] = [];
    for (const r of normalized) {
      const key = fixedAutoCatRuleIdentityKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    return deduped;
  } catch {
    return [];
  }
}

/** Clé d’unicité : motif + mode + TYPE (insensible à la casse). */
export function fixedAutoCatRuleIdentityKey(
  rule: Pick<FixedAutoCatRule, 'pattern' | 'match' | 'type'>
): string {
  return [
    normalizeMatch(rule.match),
    String(rule.pattern ?? '').trim().toUpperCase(),
    String(rule.type ?? '').trim().toUpperCase(),
  ].join('\0');
}

/** Règle déjà présente (même motif, correspondance et TYPE) ? */
export function findDuplicateFixedAutoCatRule(
  rules: FixedAutoCatRule[],
  candidate: Pick<FixedAutoCatRule, 'pattern' | 'match' | 'type'>,
  excludeId?: string
): FixedAutoCatRule | undefined {
  const key = fixedAutoCatRuleIdentityKey(candidate);
  if (!String(candidate.pattern ?? '').trim() || !String(candidate.type ?? '').trim()) {
    return undefined;
  }
  return rules.find(
    (r) => r.id !== excludeId && fixedAutoCatRuleIdentityKey(r) === key
  );
}

export function saveFixedAutoCatRules(rules: FixedAutoCatRule[]): void {
  const normalized = rules
    .map((r) => normalizeFixedAutoCatRule(r))
    .filter((r): r is FixedAutoCatRule => r !== null);
  const seen = new Set<string>();
  const deduped: FixedAutoCatRule[] = [];
  for (const r of normalized) {
    const key = fixedAutoCatRuleIdentityKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  localStorage.setItem(AUTO_CATEGORISATION_RULES_STORAGE_KEY, JSON.stringify(deduped));
}

export function createFixedAutoCatRule(
  partial: Pick<FixedAutoCatRule, 'pattern' | 'type'> & Partial<FixedAutoCatRule>
): FixedAutoCatRule {
  return {
    id: newId(),
    pattern: String(partial.pattern ?? '').trim(),
    match: normalizeMatch(partial.match),
    type: String(partial.type ?? '').trim(),
    enabled: partial.enabled !== false,
  };
}
