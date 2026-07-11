import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGuidedTour } from './GuidedTourContext';

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function measureHighlight(selector: string | undefined): SpotlightRect | null {
  if (!selector) return null;
  const el = document.querySelector(`[data-tour="${selector}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const pad = 6;
  return {
    top: Math.max(0, r.top - pad),
    left: Math.max(0, r.left - pad),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

const GuidedTourOverlay: React.FC = () => {
  const { active, step, stepIndex, totalSteps, endTour, nextStep, prevStep } = useGuidedTour();
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);

  const refreshSpotlight = useCallback(() => {
    setSpotlight(measureHighlight(step?.highlight));
  }, [step?.highlight]);

  useLayoutEffect(() => {
    if (!active || !step) {
      setSpotlight(null);
      return;
    }
    refreshSpotlight();
    const target = step.highlight
      ? document.querySelector(`[data-tour="${step.highlight}"]`)
      : null;
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = window.setTimeout(refreshSpotlight, 450);
    return () => window.clearTimeout(t);
  }, [active, step, refreshSpotlight]);

  useEffect(() => {
    if (!active) return;
    const onResize = () => refreshSpotlight();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [active, refreshSpotlight]);

  if (!active || !step) return null;

  const isLast = stepIndex >= totalSteps - 1;

  return createPortal(
    <div className="fixed inset-0 z-[10000]" role="dialog" aria-modal="true" aria-labelledby="guided-tour-title">
      {spotlight ? (
        <div
          className="fixed rounded-lg pointer-events-none ring-2 ring-blue-400 ring-offset-2 ring-offset-transparent"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-900/55 pointer-events-none" aria-hidden />
      )}

      <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm max-h-[min(85vh,calc(100%-2rem))] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 mb-1">
          Visite guidée · {stepIndex + 1} / {totalSteps}
        </p>
        <h2 id="guided-tour-title" className="text-base font-bold text-gray-900">
          {step.title}
        </h2>
        <div className="mt-2 text-sm text-gray-700 leading-relaxed space-y-1">{step.body}</div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={endTour}
            className="text-xs text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline"
          >
            Quitter
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={prevStep}
              disabled={stepIndex === 0}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Précédent
            </button>
            <button
              type="button"
              onClick={nextStep}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              {isLast ? 'Terminer' : 'Suivant'}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default GuidedTourOverlay;
