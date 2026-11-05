import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { GUIDED_TOUR_QUICK_STEPS, GUIDED_TOUR_STEPS } from './steps';
import type { GuidedTourStep } from './types';
import {
  clearGuidedTourResumeSession,
  readGuidedTourResumeSession,
  restoreProfileAfterGuidedTour,
  switchToDataTemplateProfileForTour,
} from './guidedTourProfileSession';

export type GuidedTourMode = 'full' | 'quick';

type GuidedTourContextValue = {
  active: boolean;
  mode: GuidedTourMode;
  stepIndex: number;
  step: GuidedTourStep | null;
  totalSteps: number;
  /** Visite complète (profil Data Template si disponible). */
  startTour: () => void;
  /** Visite rapide sur le profil courant (sans bascule de profil). */
  startQuickTour: () => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
};

const GuidedTourContext = createContext<GuidedTourContextValue | null>(null);

const NAV_SETTLE_MS = 400;

function stepsForMode(mode: GuidedTourMode): GuidedTourStep[] {
  return mode === 'quick' ? GUIDED_TOUR_QUICK_STEPS : GUIDED_TOUR_STEPS;
}

export const GuidedTourProvider: React.FC<{
  children: React.ReactNode;
  onTourActiveChange?: (active: boolean) => void;
}> = ({ children, onTourActiveChange }) => {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<GuidedTourMode>('full');
  const [stepIndex, setStepIndex] = useState(0);
  const [ready, setReady] = useState(true);
  const modeRef = useRef<GuidedTourMode>('full');

  const steps = stepsForMode(mode);
  const step = active ? steps[stepIndex] ?? null : null;
  const totalSteps = steps.length;

  useEffect(() => {
    onTourActiveChange?.(active);
  }, [active, onTourActiveChange]);

  const applyStep = useCallback(
    (index: number, tourMode: GuidedTourMode) => {
      const s = stepsForMode(tourMode)[index];
      if (!s) return;
      setReady(false);
      if (s.path) {
        navigate(s.path);
      }
      window.setTimeout(() => setReady(true), NAV_SETTLE_MS);
    },
    [navigate]
  );

  const beginTourAtStep = useCallback(
    (index: number, tourMode: GuidedTourMode) => {
      modeRef.current = tourMode;
      setMode(tourMode);
      setStepIndex(index);
      setActive(true);
      applyStep(index, tourMode);
    },
    [applyStep]
  );

  const startTour = useCallback(() => {
    void (async () => {
      const switched = await switchToDataTemplateProfileForTour(0);
      if (switched) return;
      beginTourAtStep(0, 'full');
    })();
  }, [beginTourAtStep]);

  const startQuickTour = useCallback(() => {
    beginTourAtStep(0, 'quick');
  }, [beginTourAtStep]);

  const endTour = useCallback(() => {
    const wasFull = modeRef.current === 'full';
    setActive(false);
    setStepIndex(0);
    setReady(true);
    setMode('full');
    modeRef.current = 'full';
    clearGuidedTourResumeSession();
    if (wasFull) {
      void restoreProfileAfterGuidedTour();
    }
  }, []);

  const nextStep = useCallback(() => {
    const list = stepsForMode(modeRef.current);
    if (stepIndex >= list.length - 1) {
      endTour();
      return;
    }
    const next = stepIndex + 1;
    setStepIndex(next);
    applyStep(next, modeRef.current);
  }, [applyStep, endTour, stepIndex]);

  const prevStep = useCallback(() => {
    if (stepIndex <= 0) return;
    const prev = stepIndex - 1;
    setStepIndex(prev);
    applyStep(prev, modeRef.current);
  }, [applyStep, stepIndex]);

  useEffect(() => {
    const resume = readGuidedTourResumeSession();
    if (!resume) return;
    clearGuidedTourResumeSession();
    beginTourAtStep(resume.stepIndex, 'full');
  }, [beginTourAtStep]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, endTour]);

  const value = useMemo(
    () => ({
      active,
      mode,
      stepIndex,
      step: ready ? step : null,
      totalSteps,
      startTour,
      startQuickTour,
      endTour,
      nextStep,
      prevStep,
    }),
    [
      active,
      endTour,
      mode,
      nextStep,
      prevStep,
      ready,
      startQuickTour,
      startTour,
      step,
      stepIndex,
      totalSteps,
    ]
  );

  return <GuidedTourContext.Provider value={value}>{children}</GuidedTourContext.Provider>;
};

export function useGuidedTour(): GuidedTourContextValue {
  const ctx = useContext(GuidedTourContext);
  if (!ctx) {
    throw new Error('useGuidedTour doit être utilisé dans GuidedTourProvider');
  }
  return ctx;
}
