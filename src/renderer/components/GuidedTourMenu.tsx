import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { restoreGettingStartedChecklist } from '../constants/gettingStartedStorage';
import { useGuidedTour } from '../guidedTour/GuidedTourContext';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Menu ouvert depuis « Visite guidée » : visite rapide, visite complète, checklist.
 */
const GuidedTourMenu: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { startTour, startQuickTour, active: tourActive } = useGuidedTour();

  if (!open) return null;

  const runAndClose = (action: () => void) => {
    onClose();
    action();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-slate-900/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-tour-menu-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="guided-tour-menu-title" className="text-lg font-bold text-gray-900">
          {t('guidedTour.menu.title')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{t('guidedTour.menu.subtitle')}</p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled={tourActive}
            onClick={() => runAndClose(startQuickTour)}
            className="w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-left hover:bg-sky-100 disabled:opacity-50"
          >
            <span className="block text-sm font-semibold text-sky-950">
              {t('guidedTour.menu.quickTour')}
            </span>
            <span className="block text-xs text-sky-900/75 mt-0.5">
              {t('guidedTour.menu.quickTourHint')}
            </span>
          </button>

          <button
            type="button"
            disabled={tourActive}
            onClick={() => runAndClose(startTour)}
            className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-left hover:bg-blue-100 disabled:opacity-50"
          >
            <span className="block text-sm font-semibold text-blue-950">
              {t('guidedTour.menu.fullTour')}
            </span>
            <span className="block text-xs text-blue-900/75 mt-0.5">
              {t('guidedTour.menu.fullTourHint')}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              runAndClose(() => {
                restoreGettingStartedChecklist();
                navigate('/');
              })
            }
            className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-left hover:bg-emerald-100"
          >
            <span className="block text-sm font-semibold text-emerald-950">
              {t('guidedTour.menu.showChecklist')}
            </span>
            <span className="block text-xs text-emerald-900/75 mt-0.5">
              {t('guidedTour.menu.showChecklistHint')}
            </span>
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            {t('guidedTour.menu.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default GuidedTourMenu;
