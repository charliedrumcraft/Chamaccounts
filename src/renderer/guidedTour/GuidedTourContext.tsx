import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { GUIDED_TOUR_STEPS } from './steps';
import type { GuidedTourStep } from './types';
import {
  clearGuidedTourResumeSession,
  readGuidedTourResumeSession,
  restoreProfileAfterGuidedTour,
  switchToDataTemplateProfileForTour,
} from './guidedTourProfileSession';

type GuidedTourContextValue = {
  active: boolean;
  stepIndex: number;
  step: GuidedTourStep | null;
  totalSteps: number;
  startTour: () => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
};

const GuidedTourContext = createContext<GuidedTourContextValue | null>(null);

const NAV_SETTLE_MS = 400;

export const GuidedTourProvider: React.FC<{
  children: React.ReactNode;
  onTourActiveChange?: (active: boolean) => void;
}> = ({ children, onTourActiveChange }) => {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [ready, setReady] = useState(true);

  const step = active ? GUIDED_TOUR_STEPS[stepIndex] ?? null : null;
  const totalSteps = GUIDED_TOUR_STEPS.length;

  useEffect(() => {
    onTourActiveChange?.(active);
  }, [active, onTourActiveChange]);

  const applyStep = useCallback(
    (index: number) => {
      const s = GUIDED_TOUR_STEPS[index];
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
    (index: number) => {
      setStepIndex(index);
      setActive(true);
      applyStep(index);
    },
    [applyStep]
  );

  const startTour = useCallback(() => {
    void (async () => {
      const switched = await switchToDataTemplateProfileForTour(0);
      if (switched) return;
      beginTourAtStep(0);
    })();
  }, [beginTourAtStep]);

  const endTour = useCallback(() => {
    setActive(false);
    setStepIndex(0);
    setReady(true);
    clearGuidedTourResumeSession();
    void restoreProfileAfterGuidedTour();
  }, []);

  const nextStep = useCallback(() => {
    if (stepIndex >= GUIDED_TOUR_STEPS.length - 1) {
      endTour();
      return;
    }
    const next = stepIndex + 1;
    setStepIndex(next);
    applyStep(next);
  }, [applyStep, endTour, stepIndex]);

  const prevStep = useCallback(() => {
    if (stepIndex <= 0) return;
    const prev = stepIndex - 1;
    setStepIndex(prev);
    applyStep(prev);
  }, [applyStep, stepIndex]);

  useEffect(() => {
    const resume = readGuidedTourResumeSession();
    if (!resume) return;
    clearGuidedTourResumeSession();
    beginTourAtStep(resume.stepIndex);
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
      stepIndex,
      step: ready ? step : null,
      totalSteps,
      startTour,
      endTour,
      nextStep,
      prevStep,
    }),
    [active, endTour, nextStep, prevStep, ready, startTour, step, stepIndex, totalSteps]
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
