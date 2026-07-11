import type { ReactNode } from 'react';

export type GuidedTourStep = {
  id: string;
  title: string;
  /** Chemin HashRouter ; absent = page courante */
  path?: string;
  /** Valeur de l’attribut `data-tour` à mettre en évidence ; absent = carte centrée */
  highlight?: string;
  body: ReactNode;
};
