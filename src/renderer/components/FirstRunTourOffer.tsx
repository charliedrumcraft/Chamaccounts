import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  readGettingStartedDismissed,
  readQuickTourOfferSeen,
  writeQuickTourOfferSeen,
} from '../constants/gettingStartedStorage';
import { useGuidedTour } from '../guidedTour/GuidedTourContext';
import { loadWorkingCurrencies } from '../services/workingCurrenciesService';

/**
 * Propose une visite rapide une seule fois au premier usage
 * (profil vide / checklist encore pertinente).
 */
const FirstRunTourOffer: React.FC = () => {
  const { t } = useTranslation();
  const { active: tourActive, startQuickTour } = useGuidedTour();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (tourActive) return;
    if (readQuickTourOfferSeen()) return;
    if (readGettingStartedDismissed()) return;

    let cancelled = false;
    void loadWorkingCurrencies().then((wc) => {
      if (cancelled) return;
      // Profil déjà peuplé : pas d’offre intrusive.
      if ((wc.transactionCount ?? 0) > 0) {
        writeQuickTourOfferSeen(true);
        return;
      }
      setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tourActive]);

  const closeOffer = (startQuick: boolean) => {
    writeQuickTourOfferSeen(true);
    setOpen(false);
    if (startQuick) startQuickTour();
  };

  if (!open || tourActive) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-slate-900/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-tour-offer-title"
    >
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl p-5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 mb-1">
          {t('guidedTour.offer.eyebrow')}
        </p>
        <h2 id="first-run-tour-offer-title" className="text-lg font-bold text-gray-900">
          {t('guidedTour.offer.title')}
        </h2>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">{t('guidedTour.offer.body')}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={() => closeOffer(false)}
            className="order-3 sm:order-1 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            {t('guidedTour.offer.later')}
          </button>
          <button
            type="button"
            onClick={() => closeOffer(false)}
            className="order-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            {t('guidedTour.offer.checklistOnly')}
          </button>
          <button
            type="button"
            onClick={() => closeOffer(true)}
            className="order-1 sm:order-3 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
          >
            {t('guidedTour.offer.startQuick')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default FirstRunTourOffer;
