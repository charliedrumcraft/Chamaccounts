/**
 * Normalisation compte source_data : Advanz / Advanzia = un seul compte.
 * - Données CSV reconnues sous la forme "Advanz" (forme contractée).
 * - Libellé d'affichage = "Advanzia".
 */

export {
  canonicalAccountFromSource,
  accountLabelFromSource,
} from '@/shared/accountSourceLabels';
