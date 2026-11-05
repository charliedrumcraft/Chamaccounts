import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

type HelpInfoButtonProps = {
  onClick: () => void;
  label: string;
  className?: string;
};

/** Bouton ⓘ d’ouverture d’une {@link HelpInfoDialog}. */
export const HelpInfoButton: React.FC<HelpInfoButtonProps> = ({ onClick, label, className = '' }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title={label}
    aria-label={label}
    aria-haspopup="dialog"
    className={`flex-shrink-0 p-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 ${className}`}
  >
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  </button>
);

/**
 * Petite fenêtre d’aide (modale compacte), format partagé dans l’app.
 */
const HelpInfoDialog: React.FC<Props> = ({ open, onClose, title, children }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9500] flex items-center justify-center p-4 bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-info-dialog-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[min(75vh,32rem)] flex flex-col rounded-xl border border-sky-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-3 shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            <span className="mt-0.5 shrink-0 text-sky-700" aria-hidden>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            <h2 id="help-info-dialog-title" className="text-sm font-bold text-sky-950 leading-snug">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-sky-800/70 hover:bg-sky-100 hover:text-sky-950"
            aria-label={t('helpInfo.close')}
            title={t('helpInfo.close')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-3 overflow-y-auto text-[12px] leading-relaxed text-gray-700">
          {children}
        </div>
        <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-2.5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800"
          >
            {t('helpInfo.gotIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HelpInfoDialog;
