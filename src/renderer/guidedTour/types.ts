export type GuidedTourStep = {
  id: string;
  /** Clé sous `guidedTour.steps.<i18nKey>` (titre + paragraphes dans fr.json / en.json) */
  i18nKey: string;
  /** Chemin HashRouter ; absent = page courante */
  path?: string;
  /** Valeur de l’attribut `data-tour` à mettre en évidence ; absent = carte centrée */
  highlight?: string;
};
