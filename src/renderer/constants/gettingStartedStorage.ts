/** Préférence « checklist de démarrage » (localStorage → miroir AppState). */

export const GETTING_STARTED_DISMISSED_KEY = 'chamaccounts-getting-started-dismissed';
/** Forcer l’affichage après « Relancer la checklist » (même si tout est fait). */
export const GETTING_STARTED_FORCE_SHOW_KEY = 'chamaccounts-getting-started-force-show';
/** Offre de visite rapide déjà proposée (acceptée, refusée ou reportée). */
export const QUICK_TOUR_OFFER_SEEN_KEY = 'chamaccounts-quick-tour-offer-seen';

/** Query `/transactions?focus=import` : ouvrir le module et activer le mapping. */
export const TRANSACTIONS_FOCUS_IMPORT_QUERY = 'import';

export function readGettingStartedDismissed(): boolean {
  try {
    return localStorage.getItem(GETTING_STARTED_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeGettingStartedDismissed(dismissed: boolean): void {
  try {
    if (dismissed) localStorage.setItem(GETTING_STARTED_DISMISSED_KEY, 'true');
    else localStorage.removeItem(GETTING_STARTED_DISMISSED_KEY);
  } catch {
    /* ignore */
  }
}

export function readGettingStartedForceShow(): boolean {
  try {
    return localStorage.getItem(GETTING_STARTED_FORCE_SHOW_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeGettingStartedForceShow(force: boolean): void {
  try {
    if (force) localStorage.setItem(GETTING_STARTED_FORCE_SHOW_KEY, 'true');
    else localStorage.removeItem(GETTING_STARTED_FORCE_SHOW_KEY);
  } catch {
    /* ignore */
  }
}

/** Événement same-tab pour rafraîchir la checklist (Dashboard déjà monté). */
export const GETTING_STARTED_CHANGED_EVENT = 'chamaccounts-getting-started-changed';

/** Réaffiche la checklist (annule dismiss + force l’affichage). */
export function restoreGettingStartedChecklist(): void {
  writeGettingStartedDismissed(false);
  writeGettingStartedForceShow(true);
  try {
    window.dispatchEvent(new Event(GETTING_STARTED_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export function readQuickTourOfferSeen(): boolean {
  try {
    return localStorage.getItem(QUICK_TOUR_OFFER_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeQuickTourOfferSeen(seen: boolean): void {
  try {
    if (seen) localStorage.setItem(QUICK_TOUR_OFFER_SEEN_KEY, 'true');
    else localStorage.removeItem(QUICK_TOUR_OFFER_SEEN_KEY);
  } catch {
    /* ignore */
  }
}
