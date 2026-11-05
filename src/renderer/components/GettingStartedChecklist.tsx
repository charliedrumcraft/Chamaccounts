import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useGettingStartedProgress,
  type GettingStartedStepId,
} from '../hooks/useGettingStartedProgress';
import { useGuidedTour } from '../guidedTour/GuidedTourContext';

const STEP_LABEL_KEYS: Record<GettingStartedStepId, string> = {
  currencies: 'gettingStarted.steps.currencies',
  accounts: 'gettingStarted.steps.accounts',
  types: 'gettingStarted.steps.types',
  importTransactions: 'gettingStarted.steps.importTransactions',
  importBalances: 'gettingStarted.steps.importBalances',
};

const STEP_HINT_KEYS: Record<GettingStartedStepId, string> = {
  currencies: 'gettingStarted.hints.currencies',
  accounts: 'gettingStarted.hints.accounts',
  types: 'gettingStarted.hints.types',
  importTransactions: 'gettingStarted.hints.importTransactions',
  importBalances: 'gettingStarted.hints.importBalances',
};

type Props = {
  /** Compact = bandeau plus court (ex. sous le titre). */
  compact?: boolean;
};

/**
 * Checklist premier usage : prochaine action claire + liens vers Profile / Import.
 * Masquée si dismissée ou si toutes les étapes sont faites.
 */
const GettingStartedChecklist: React.FC<Props> = ({ compact = false }) => {
  const { t } = useTranslation();
  const progress = useGettingStartedProgress();
  const { startQuickTour, active: tourActive } = useGuidedTour();

  const nextStep = useMemo(
    () => progress.steps.find((s) => !s.done) ?? null,
    [progress.steps]
  );

  if (progress.loading || !progress.visible) return null;

  return (
    <section
      role="region"
      aria-label={t('gettingStarted.title')}
      className={`rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white shadow-sm ${
        compact ? 'mb-4 px-4 py-3' : 'mb-6 px-5 py-4'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className={`font-bold text-sky-950 ${compact ? 'text-base' : 'text-lg'}`}>
            {t('gettingStarted.title')}
          </h2>
          <p className="text-sm text-sky-900/80 mt-0.5">
            {t('gettingStarted.subtitle', {
              done: progress.doneCount,
              total: progress.totalCount,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={progress.dismiss}
          className="shrink-0 text-xs font-medium text-sky-800/80 hover:text-sky-950 hover:underline"
        >
          {t('gettingStarted.dismiss')}
        </button>
      </div>

      <ol className="space-y-2 mb-4">
        {progress.steps.map((step, index) => {
          const isNext = nextStep?.id === step.id;
          return (
            <li
              key={step.id}
              className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${
                isNext ? 'bg-sky-100/70 ring-1 ring-sky-200' : ''
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done
                    ? 'bg-emerald-600 text-white'
                    : isNext
                      ? 'bg-sky-700 text-white'
                      : 'bg-sky-100 text-sky-800'
                }`}
                aria-hidden
              >
                {step.done ? '✓' : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`text-sm font-medium ${
                      step.done ? 'text-emerald-800 line-through decoration-emerald-600/40' : 'text-gray-900'
                    }`}
                  >
                    {t(STEP_LABEL_KEYS[step.id])}
                  </span>
                  {!step.done && (
                    <Link
                      to={step.to}
                      className={`text-xs font-semibold rounded-md px-2 py-0.5 ${
                        isNext
                          ? 'bg-sky-700 text-white hover:bg-sky-800'
                          : 'bg-white border border-sky-300 text-sky-900 hover:bg-sky-50'
                      }`}
                    >
                      {t('gettingStarted.go')}
                    </Link>
                  )}
                </div>
                {isNext && (
                  <p className="text-xs text-sky-900/75 mt-0.5">{t(STEP_HINT_KEYS[step.id])}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
        {nextStep && (
          <Link
            to={nextStep.to}
            className="inline-flex items-center rounded-lg bg-sky-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-sky-800 shadow-sm"
          >
            {t('gettingStarted.nextCta', { step: t(STEP_LABEL_KEYS[nextStep.id]) })}
          </Link>
        )}
        <button
          type="button"
          disabled={tourActive}
          onClick={startQuickTour}
          className="inline-flex items-center rounded-lg border border-sky-300 bg-white px-3.5 py-2 text-sm font-semibold text-sky-900 hover:bg-sky-50 disabled:opacity-50"
        >
          {t('gettingStarted.startQuickTour')}
        </button>
      </div>
    </section>
  );
};

export default GettingStartedChecklist;
