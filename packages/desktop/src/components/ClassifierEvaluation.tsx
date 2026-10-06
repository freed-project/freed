import { useEffect, useRef, useState } from "react";
import { CLASSIFIER_EVAL_CASES, classifierEvalItem, summarizeClassifierEvaluation } from "../lib/classifier-evaluation";
import { getJevClassifierProvider, onJevClassifierProviderChange } from "../lib/jev-provider";
import { requestNativeJev, isJevNative } from "../lib/jev-client";
import { requestLocalKev, kevConnectionStatus } from "../lib/kev-client";
import type { JevPreviewResponse } from "../lib/jev-preview-run";

type Report = ReturnType<typeof summarizeClassifierEvaluation> & { checkpoint?: string };
const percent = (value: number | null) => value === null ? "No accepted decisions" : value.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 });

export function ClassifierEvaluation() {
  const [reports, setReports] = useState<Partial<Record<"jev" | "kev", Report>>>({});
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [provider, setProvider] = useState(getJevClassifierProvider);
  useEffect(() => {
    const unsubscribe = onJevClassifierProviderChange(() => { controller.current?.abort(); setProvider(getJevClassifierProvider()); });
    return () => { controller.current?.abort(); unsubscribe(); };
  }, []);
  async function run() {
    if (provider !== "kev" && provider !== "jev") return;
    const active = new AbortController(); controller.current = active;
    setBusy(true); setCompleted(0); setError(null);
    try {
      const checkpoint = provider === "kev" ? (await kevConnectionStatus()).model : undefined;
      const responses: JevPreviewResponse[] = [];
      for (let index = 0; index < CLASSIFIER_EVAL_CASES.length; index++) {
        active.signal.throwIfAborted();
        const item = classifierEvalItem(index);
        const response = provider === "kev" ? await requestLocalKev(item, active.signal)
          : await requestNativeJev("/api/jev-preview/classify", { item }, active.signal);
        active.signal.throwIfAborted();
        responses.push(response as JevPreviewResponse); setCompleted(responses.length);
      }
      const report = { ...summarizeClassifierEvaluation(responses, provider), checkpoint };
      setReports(previous => ({ ...previous, [provider]: report }));
    } catch (failure) {
      if (!active.signal.aborted) setError(failure instanceof Error ? failure.message : "Evaluation failed.");
    } finally { if (controller.current === active) { controller.current = null; setBusy(false); } }
  }
  return <div className="space-y-2 rounded-lg border border-[var(--theme-border-subtle)] p-3 text-xs" aria-label="Classifier evaluation">
    <h4 className="font-semibold">Compare Kev and Jev</h4>
    <p>Run six labeled examples through the selected classifier, then switch to compare. Examples are synthetic; no Library content is used. This small smoke evaluation is not a quality benchmark.</p>
    <p>{provider === "kev" ? "Kev stays local. Probabilities between 20% and 80% abstain. Thresholds are provisional." : provider === "jev" ? "Jev sends the examples to TypeSafe using your key and spending limits. Six requests may incur API usage." : "Choose Kev or Jev to run the labeled evaluation."}</p>
    <button type="button" className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 disabled:opacity-40" disabled={busy || !isJevNative || provider === "gliclass-base"} onClick={() => void run()}>Run labeled evaluation</button>
    {busy && <><span role="status">{completed.toLocaleString()} / {CLASSIFIER_EVAL_CASES.length.toLocaleString()} complete</span><button type="button" onClick={() => controller.current?.abort()}>Cancel evaluation</button></>}
    {error && <p role="alert">{error}</p>}
    {Object.values(reports).map(report => <div key={report.provider} className="space-y-1" aria-label={`${report.provider} evaluation result`}>
      <p className="font-medium">{report.provider === "kev" ? "Kev" : "Jev"}: {report.checkpoint ?? report.model}</p>
      <p>Raw accuracy {percent(report.accuracy)} · Brier score {report.brier.toLocaleString(undefined, { maximumFractionDigits: 3 })} (lower is better)</p>
      <p>Accepted {report.accepted.toLocaleString()} / {report.labels.toLocaleString()} · Coverage {percent(report.coverage)} · Accepted accuracy {percent(report.acceptedAccuracy)}</p>
      <p>Median {report.medianMs.toLocaleString()} ms · Slowest {report.maxMs.toLocaleString()} ms · Estimated API cost {report.estimatedCostUsd.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 })}</p>
    </div>)}
  </div>;
}
