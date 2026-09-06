import { afterEach, describe, expect, it } from "vitest";
import {
  beginSamplePopulationProgress,
  completeSamplePopulationProgress,
  resetSamplePopulationProgress,
  updateSamplePopulationProgress,
  useSamplePopulationProgress,
} from "./sample-population-progress";

const IDLE = { active: false, percent: 0 };

describe("sample population progress", () => {
  afterEach(() => {
    useSamplePopulationProgress.setState(IDLE);
  });

  it("starts inactive at 0 percent", () => {
    expect(useSamplePopulationProgress.getState()).toEqual(IDLE);
  });

  it("begins an active run at 0 percent", () => {
    completeSamplePopulationProgress();
    beginSamplePopulationProgress();
    expect(useSamplePopulationProgress.getState()).toEqual({
      active: true,
      percent: 0,
    });
  });

  it("updates progress without changing the active flag", () => {
    beginSamplePopulationProgress();
    updateSamplePopulationProgress(37);
    expect(useSamplePopulationProgress.getState()).toEqual({
      active: true,
      percent: 37,
    });

    useSamplePopulationProgress.setState(IDLE);
    updateSamplePopulationProgress(12);
    expect(useSamplePopulationProgress.getState()).toEqual({
      active: false,
      percent: 12,
    });
  });

  it("clamps and rounds updated percentages to whole 0..100 values", () => {
    beginSamplePopulationProgress();

    updateSamplePopulationProgress(42.6);
    expect(useSamplePopulationProgress.getState().percent).toBe(43);

    updateSamplePopulationProgress(99.4);
    expect(useSamplePopulationProgress.getState().percent).toBe(99);

    updateSamplePopulationProgress(99.5);
    expect(useSamplePopulationProgress.getState().percent).toBe(100);

    updateSamplePopulationProgress(-4);
    expect(useSamplePopulationProgress.getState().percent).toBe(0);

    updateSamplePopulationProgress(250);
    expect(useSamplePopulationProgress.getState().percent).toBe(100);

    updateSamplePopulationProgress(0.4);
    expect(useSamplePopulationProgress.getState().percent).toBe(0);
  });

  it("turns non-finite percentages safely into 0", () => {
    beginSamplePopulationProgress();
    updateSamplePopulationProgress(61);
    expect(useSamplePopulationProgress.getState().percent).toBe(61);

    updateSamplePopulationProgress(Number.NaN);
    expect(useSamplePopulationProgress.getState().percent).toBe(0);

    updateSamplePopulationProgress(Number.POSITIVE_INFINITY);
    expect(useSamplePopulationProgress.getState().percent).toBe(0);

    updateSamplePopulationProgress(Number.NEGATIVE_INFINITY);
    expect(useSamplePopulationProgress.getState().percent).toBe(0);
  });

  it("completes at 100 percent and stays active", () => {
    beginSamplePopulationProgress();
    updateSamplePopulationProgress(37);
    completeSamplePopulationProgress();
    expect(useSamplePopulationProgress.getState()).toEqual({
      active: true,
      percent: 100,
    });

    // Completing is its own assertion: it activates even without begin.
    resetSamplePopulationProgress();
    completeSamplePopulationProgress();
    expect(useSamplePopulationProgress.getState()).toEqual({
      active: true,
      percent: 100,
    });
  });

  it("resets to inactive at 0 percent, separately from completing", () => {
    beginSamplePopulationProgress();
    updateSamplePopulationProgress(55);
    completeSamplePopulationProgress();
    expect(useSamplePopulationProgress.getState().active).toBe(true);

    resetSamplePopulationProgress();
    expect(useSamplePopulationProgress.getState()).toEqual(IDLE);
  });
});