/**
 * Profils de mapping wizard : formes de CSV apprises (par profil de données).
 * Clé de matching = signature des en-têtes normalisés (égalité exacte).
 */

import {
  normalizeHeader,
  WIZARD_STANDARD_KEYS,
  type WizardStandardKey,
} from './transactionsImportCore';

export const MAPPING_WIZARD_PROFILES_FILENAME = 'mapping_wizard_profiles.json';
export const MAPPING_WIZARD_PROFILES_FILE_VERSION = 1 as const;

export type MappingWizardProfile = {
  id: string;
  name: string;
  /** En-têtes normalisés, dans l’ordre du fichier d’exemple. */
  headerSignature: string[];
  /** Label normalisé → champ standard ('' = ignorer). */
  columnMap: Record<string, WizardStandardKey>;
  firstLineAsData?: boolean;
  defaultCurrency?: string;
  updatedAt: string;
};

export type MappingWizardProfilesFile = {
  version: typeof MAPPING_WIZARD_PROFILES_FILE_VERSION;
  profiles: MappingWizardProfile[];
};

export function normalizeMappingHeaderLabel(label: string): string {
  return normalizeHeader(label).toLowerCase().trim();
}

export function buildHeaderSignature(labels: string[]): string[] {
  return labels.map((l) => normalizeMappingHeaderLabel(l));
}

export function headerSignaturesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function findMatchingMappingProfile(
  profiles: MappingWizardProfile[],
  headerLabels: string[]
): MappingWizardProfile | null {
  const sig = buildHeaderSignature(headerLabels);
  if (sig.length === 0) return null;
  for (const p of profiles) {
    if (headerSignaturesEqual(p.headerSignature, sig)) return p;
  }
  return null;
}

const STANDARD_SET = new Set<string>(WIZARD_STANDARD_KEYS);

export function isWizardStandardKey(value: string): value is WizardStandardKey {
  return STANDARD_SET.has(value);
}

function newProfileId(): string {
  return `mwp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type MappingWizardProfileInput = {
  id?: string;
  name: string;
  headerLabels: string[];
  /** Clés = libellés d’origine ou déjà normalisés ; valeurs = champ standard. */
  columnMap: Record<string, string>;
  firstLineAsData?: boolean;
  defaultCurrency?: string;
};

export type SanitizeMappingProfileResult =
  | { ok: true; profile: MappingWizardProfile }
  | { ok: false; errorKey: string };

/** Normalise et valide un profil avant écriture disque. */
export function sanitizeMappingWizardProfileInput(
  input: MappingWizardProfileInput
): SanitizeMappingProfileResult {
  const name = String(input.name ?? '').trim();
  if (!name) return { ok: false, errorKey: 'mappingProfiles.errors.nameRequired' };

  const labels = (input.headerLabels ?? []).map((l) => String(l ?? ''));
  if (labels.length === 0) return { ok: false, errorKey: 'mappingProfiles.errors.headersRequired' };

  const headerSignature = buildHeaderSignature(labels);
  if (headerSignature.some((h) => !h)) {
    return { ok: false, errorKey: 'mappingProfiles.errors.emptyHeader' };
  }

  const columnMap: Record<string, WizardStandardKey> = {};
  const rawMap = input.columnMap ?? {};
  for (const label of labels) {
    const norm = normalizeMappingHeaderLabel(label);
    const raw =
      rawMap[label] ??
      rawMap[norm] ??
      rawMap[normalizeHeader(label)] ??
      '';
    const std = String(raw).trim();
    if (!isWizardStandardKey(std)) {
      return { ok: false, errorKey: 'mappingProfiles.errors.invalidStandard' };
    }
    columnMap[norm] = std;
  }

  let defaultCurrency: string | undefined;
  if (typeof input.defaultCurrency === 'string' && input.defaultCurrency.trim()) {
    defaultCurrency = input.defaultCurrency.trim().toUpperCase();
  }

  return {
    ok: true,
    profile: {
      id: String(input.id ?? '').trim() || newProfileId(),
      name,
      headerSignature,
      columnMap,
      firstLineAsData: input.firstLineAsData === true ? true : undefined,
      defaultCurrency,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function parseMappingWizardProfilesFile(raw: unknown): MappingWizardProfilesFile {
  if (!raw || typeof raw !== 'object') return { version: 1, profiles: [] };
  const obj = raw as { version?: unknown; profiles?: unknown };
  if (obj.version !== 1 || !Array.isArray(obj.profiles)) return { version: 1, profiles: [] };
  const profiles: MappingWizardProfile[] = [];
  for (const item of obj.profiles) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Partial<MappingWizardProfile>;
    const id = String(p.id ?? '').trim();
    const name = String(p.name ?? '').trim();
    if (!id || !name || !Array.isArray(p.headerSignature)) continue;
    const headerSignature = p.headerSignature
      .map((h) => normalizeMappingHeaderLabel(String(h ?? '')))
      .filter(Boolean);
    if (headerSignature.length === 0) continue;
    const columnMap: Record<string, WizardStandardKey> = {};
    const rawMap = p.columnMap && typeof p.columnMap === 'object' ? p.columnMap : {};
    for (const [k, v] of Object.entries(rawMap as Record<string, unknown>)) {
      const nk = normalizeMappingHeaderLabel(k);
      const std = String(v ?? '').trim();
      if (!nk || !isWizardStandardKey(std)) continue;
      columnMap[nk] = std;
    }
    profiles.push({
      id,
      name,
      headerSignature,
      columnMap,
      firstLineAsData: p.firstLineAsData === true ? true : undefined,
      defaultCurrency:
        typeof p.defaultCurrency === 'string' && p.defaultCurrency.trim()
          ? p.defaultCurrency.trim().toUpperCase()
          : undefined,
      updatedAt:
        typeof p.updatedAt === 'string' && p.updatedAt.trim()
          ? p.updatedAt
          : new Date().toISOString(),
    });
  }
  return { version: 1, profiles };
}

/**
 * Applique un profil appris aux colonnes d’un fichier (clés wizard `${file}#${idx}`).
 * Retourne null si aucune signature ne matche pour ce fichier.
 */
export function applyMappingProfileToColumns(
  columns: Array<{ key: string; fileName: string; label: string }>,
  fileName: string,
  profiles: MappingWizardProfile[]
): Record<string, WizardStandardKey> | null {
  const fileCols = columns.filter((c) => c.fileName === fileName);
  if (fileCols.length === 0) return null;
  const profile = findMatchingMappingProfile(
    profiles,
    fileCols.map((c) => c.label)
  );
  if (!profile) return null;
  const out: Record<string, WizardStandardKey> = {};
  for (const col of fileCols) {
    const norm = normalizeMappingHeaderLabel(col.label);
    const mapped = profile.columnMap[norm];
    out[col.key] = mapped !== undefined ? mapped : '';
  }
  return out;
}
