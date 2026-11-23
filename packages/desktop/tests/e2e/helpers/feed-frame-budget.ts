/** Classify measured fast-scroll frame budgets; callers handle missing telemetry. */
export function classifyFeedFrameBudgets(
  measured: { p95Ms: number; droppedFrames: number },
  budgets: { p95Ms: number; droppedFrames: number },
): { type: string; description: string }[] {
  const annotations: { type: string; description: string }[] = [];
  const type = "perf budget exceeded (report-only)";
  if (measured.p95Ms >= budgets.p95Ms) {
    annotations.push({
      type,
      description: `frame p95: ${measured.p95Ms.toLocaleString()} ms >= ${budgets.p95Ms.toLocaleString()} ms budget (requires <)`,
    });
  }
  if (measured.droppedFrames > budgets.droppedFrames) {
    annotations.push({
      type,
      description: `dropped frames: ${measured.droppedFrames.toLocaleString()} > ${budgets.droppedFrames.toLocaleString()} budget (requires <=)`,
    });
  }
  return annotations;
}
