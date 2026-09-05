/**
 * Observable progress for sample or demo Library population.
 *
 * PWA-only, in-memory Zustand state. No persistence, timers, or toast
 * integration. Callers own when the empty state disappears by choosing
 * when to call `resetSamplePopulationProgress`.
 */

import { create } from "zustand";

interface SamplePopulationProgressState {
  active: boolean;
  percent: number;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export const useSamplePopulationProgress =
  create<SamplePopulationProgressState>()(() => ({
    active: false,
    percent: 0,
  }));

/** Start a population run, active at 0 percent. */
export function beginSamplePopulationProgress(): void {
  useSamplePopulationProgress.setState({ active: true, percent: 0 });
}

/**
 * Report progress. Clamps and rounds to an integer 0..100; non-finite
 * values become 0. Does not change `active`.
 */
export function updateSamplePopulationProgress(percent: number): void {
  useSamplePopulationProgress.setState({
    percent: clampPercent(percent),
  });
}

/** Finish the run, leaving the state active at 100 percent. */
export function completeSamplePopulationProgress(): void {
  useSamplePopulationProgress.setState({ active: true, percent: 100 });
}

/** Clear the run so the empty state can return when the caller is ready. */
export function resetSamplePopulationProgress(): void {
  useSamplePopulationProgress.setState({ active: false, percent: 0 });
}
