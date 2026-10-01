import { useSettingsStore } from "@freed/ui/lib/settings-store";
import { isJevNative, jevConnectionStatus, onJevCredentialChange } from "../lib/jev-client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONTENT_SIGNAL_KEYS,
  CONTENT_SIGNAL_THRESHOLD,
  PLATFORM_LABELS,
  inferContentSignals,
  type FeedItem,
} from "@freed/shared";
import { applyJevPreviewSignals, loadJevPreviewSample, refreshJevPreviewLibrary } from "../lib/jev-library";
import { applyJevPreviewComparison, jevPreviewSourceKey, runJevPreview, type JevPreviewDecision, type JevPreviewResult } from "../lib/jev-preview-run";
import { JEV_EXPERIMENTAL_SIGNAL_KEYS, JEV_SIGNAL_KEYS } from "../lib/jev-classification";
import { useAppStore } from "../lib/store";
import { JevOpportunityPreview } from "./JevOpportunityPreview";

interface ConnectionStatus {
  configured: boolean;
  model: string;
  questionPackVersion: string;
  inputUsdPerMillion: number;
  maxConcurrency: number;
  attemptsRemaining?: number;
}

const secondaryButton = "rounded-lg border border-[var(--theme-border-subtle)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--theme-bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = "theme-accent-button rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const money = (value: number) => value.toLocaleString(undefined, {
  style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4,
});
const score = (value: number | undefined) => value === undefined
  ? "Pending"
  : value.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 });

/** Session-local evaluation controls shared by native settings and the browser preview. */
export function JevClassificationPreview({ embedded = false }: { embedded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"classification" | "help" | "collaborate">("classification");
  const [opportunityBusy, setOpportunityBusy] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [results, setResults] = useState<readonly JevPreviewResult[]>([]);
  const [decisions, setDecisions] = useState<Record<string, JevPreviewDecision>>({});
  const decisionsRef = useRef(decisions);
  const [selectedId, setSelectedId] = useState("");
  const [flags, setFlags] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<"existing" | "rules" | "jev" | "mixed">("existing");
  const [job, setJob] = useState<"loading" | "classifying" | "comparing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [sessionUsage, setSessionUsage] = useState({ input: 0, output: 0, cost: 0 });
  const mounted = useRef(true);
  const libraryVersion = useAppStore((state) => state.libraryItemVersion);
  const readGeneration = useRef(0);
  const connectionGeneration = useRef(0);
  useEffect(() => {
    if (!isJevNative) return;
    readGeneration.current += 1;
    controller.current?.abort();
    setItems([]); setResults([]);
    decisionsRef.current = {}; setDecisions({});
  }, [libraryVersion]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  async function refreshConnection() {
    const generation = ++connectionGeneration.current;
    setConnectionBusy(true);
    try {
      const status = await jevConnectionStatus();
      if (!mounted.current || generation !== connectionGeneration.current) return;
      setConnection(status);
      setError(null);
    } catch (failure) {
      if (!mounted.current || generation !== connectionGeneration.current) return;
      setConnection(null);
      setError(failure instanceof Error ? failure.message : "Could not read Jev key status.");
    } finally {
      if (mounted.current && generation === connectionGeneration.current) setConnectionBusy(false);
    }
  }

  useEffect(() => onJevCredentialChange(() => {
    controller.current?.abort();
    void refreshConnection();
  }), []);

  function togglePanel() {
    setExpanded((value) => !value);
    if (!expanded && !connection && !connectionBusy) void refreshConnection();
  }

  function updateDecisions(update: (current: Record<string, JevPreviewDecision>) => Record<string, JevPreviewDecision>) {
    const next = update(decisionsRef.current);
    // Async run/compare callbacks must see a completed load's pruning before
    // React publishes its next render.
    decisionsRef.current = next;
    setDecisions(next);
  }

  async function loadSample() {
    const generation = ++readGeneration.current;
    const version = useAppStore.getState().libraryItemVersion;
    const sample = await loadJevPreviewSample(isJevNative ? 100 : 500);
    if (isJevNative && (generation !== readGeneration.current || version !== useAppStore.getState().libraryItemVersion)) {
      throw new Error("The Library changed. Load posts again before evaluating them.");
    }
    const sourceKeys = new Map(sample.map((item) => [item.globalId, jevPreviewSourceKey(item)]));
    updateDecisions((current) => Object.fromEntries(Object.entries(current)
      .filter(([id, decision]) => sourceKeys.get(id) === decision.sourceKey)));
    setItems(sample);
    setSelectedId((current) => sample.some((item) => item.globalId === current)
      ? current : sample[0]?.globalId ?? "");
    return sample;
  }

  async function reloadSample() {
    setJob("loading");
    setError(null);
    try {
      await loadSample();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load the sample.");
    } finally {
      setJob(null);
    }
  }

  async function finishJob() {
    try {
      await refreshJevPreviewLibrary();
    } catch (failure) {
      if (mounted.current) setError((current) => {
        const message = failure instanceof Error ? failure.message : "Unknown refresh error.";
        return `${current ? `${current} ` : ""}Could not refresh the feed: ${message}`;
      });
    } finally {
      if (mounted.current) setJob(null);
      controller.current = null;
    }
  }

  async function classify(reclassify: boolean) {
    const activeController = new AbortController();
    controller.current = activeController;
    setJob("classifying");
    setError(null);
    try {
      const sample = await loadSample();
      if (!sample.length) throw new Error("No eligible posts were loaded. Load posts, then try again.");
      // A comparison changes the actual feed signals. Restore known Jev decisions before resuming.
      if (!isJevNative && mode !== "jev") {
        setMode("mixed");
        for (const item of sample) {
          if (activeController.signal.aborted) break;
          const decision = decisionsRef.current[item.globalId];
          if (decision?.sourceKey === jevPreviewSourceKey(item)) {
            await applyJevPreviewSignals(item, decision.contentSignals);
          }
        }
      }
      setMode("jev");
      const sourceVersion = useAppStore.getState().libraryItemVersion;
      const completed = await runJevPreview(sample, {
        signal: activeController.signal,
        reclassify,
        apply: async (item, signals) => {
          if (isJevNative && sourceVersion !== useAppStore.getState().libraryItemVersion) {
            activeController.abort();
            throw new Error("The Library changed. Evaluate the current posts again.");
          }
          const sourceKey = jevPreviewSourceKey(item);
          await applyJevPreviewSignals(item, signals);
          if (mounted.current && sourceKey) updateDecisions((current) => ({
            ...current,
            [item.globalId]: {
              sourceKey,
              contentSignals: signals,
              experimentalSignals: current[item.globalId]?.sourceKey === sourceKey
                ? current[item.globalId].experimentalSignals : undefined,
            },
          }));
        },
        onUpdate: (next) => { if (mounted.current) setResults(next); },
      });
      if (mounted.current) updateDecisions((current) => {
        const next = { ...current };
        for (const result of completed) {
          const decision = next[result.item.globalId];
          if (result.status === "success" && result.response?.experimentalSignals &&
            decision?.sourceKey === jevPreviewSourceKey(result.item)) {
            next[result.item.globalId] = { ...decision, experimentalSignals: result.response.experimentalSignals };
          }
        }
        return next;
      });
      if (mounted.current) setSessionUsage((current) => completed.reduce((total, result) => ({
        input: total.input + (result.response?.cached ? 0 : result.response?.usage.input_tokens ?? 0),
        output: total.output + (result.response?.cached ? 0 : result.response?.usage.output_tokens ?? 0),
        cost: total.cost + (result.response?.estimatedCostUsd ?? 0),
      }), current));
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not classify the sample.");
    } finally {
      await finishJob();
    }
  }

  async function compare(nextMode: "rules" | "jev") {
    const activeController = new AbortController();
    controller.current = activeController;
    setJob("comparing");
    setMode("mixed");
    setError(null);
    try {
      const sample = await loadSample();
      await applyJevPreviewComparison(sample, nextMode, decisionsRef.current, {
        signal: activeController.signal,
        apply: applyJevPreviewSignals,
      });
      setMode(nextMode);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not apply this comparison.");
    } finally {
      await finishJob();
    }
  }

  const counts = useMemo(() => {
    const value = { queued: 0, running: 0, success: 0, failed: 0, skipped: 0, cancelled: 0, cached: 0, input: 0, output: 0, cost: 0 };
    for (const result of results) {
      value[result.status] += 1;
      if (result.response) {
        if (result.response.cached) value.cached += 1;
        else {
          value.input += result.response.usage.input_tokens;
          value.output += result.response.usage.output_tokens;
        }
        value.cost += result.response.estimatedCostUsd;
      }
    }
    return value;
  }, [results]);
  // Source signatures change only with a refreshed sample, not every progress
  // tick. Keep the full fixed question pack out of repeated render work.
  const sourceKeys = useMemo(() => new Map(items.map((item) =>
    [item.globalId, jevPreviewSourceKey(item)])), [items]);
  const currentDecisions = useMemo(() => Object.fromEntries(Object.entries(decisions)
    .filter(([id, decision]) => sourceKeys.get(id) === decision.sourceKey)), [decisions, sourceKeys]);
  const coverage = useMemo(() => {
    const byPlatform = new Map<FeedItem["platform"], { total: number; classified: number }>();
    for (const item of items) {
      const current = byPlatform.get(item.platform) ?? { total: 0, classified: 0 };
      current.total += 1;
      if (currentDecisions[item.globalId]) current.classified += 1;
      byPlatform.set(item.platform, current);
    }
    return [...byPlatform];
  }, [items, currentDecisions]);
  const selected = items.find((item) => item.globalId === selectedId);
  const selectedResult = useMemo(() => {
    const result = results.find((entry) => entry.item.globalId === selectedId);
    return result && sourceKeys.get(selectedId) === jevPreviewSourceKey(result.item) ? result : undefined;
  }, [results, selectedId, sourceKeys]);
  const selectedRules = useMemo(() => selected ? inferContentSignals(selected) : null, [selected]);
  const selectedJev = currentDecisions[selectedId]?.contentSignals;
  const selectedExperimental = selectedResult?.status === "success"
    ? selectedResult.response?.experimentalSignals ?? currentDecisions[selectedId]?.experimentalSignals
    : currentDecisions[selectedId]?.experimentalSignals;
  const completedCount = counts.success + counts.failed + counts.skipped + counts.cancelled;
  const hasDecisions = Object.keys(currentDecisions).length > 0;
  const busy = job !== null || opportunityBusy;

  function openInFreed(item: FeedItem) {
    const store = useAppStore.getState();
    store.setActiveView("feed");
    store.setSelectedItem(item.globalId);
    useSettingsStore.getState().close();
    setExpanded(false);
  }

  return (
    <aside
      aria-label="Jev classification preview"
      data-testid="jev-classification-preview"
      className={`theme-floating-panel ${embedded ? "relative" : "fixed right-3 top-16 z-40"} rounded-2xl border border-[var(--theme-border-subtle)] text-[var(--theme-text-primary)] shadow-2xl ${embedded ? "w-full" : expanded ? "w-[min(34rem,calc(100vw-1.5rem))]" : "max-w-[calc(100vw-1.5rem)]"}`}
    >
      <button
        type="button"
        onClick={togglePanel}
        aria-expanded={expanded}
        aria-controls="jev-preview-content"
        className="flex w-full items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left text-sm font-semibold"
      >
        <span>Jev classification {busy ? "· Working" : ""}</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
        <div hidden={!expanded} id="jev-preview-content" className="max-h-[min(72vh,48rem)] space-y-4 overflow-y-auto border-t border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-4 text-xs">
          <p className="leading-relaxed text-[var(--theme-text-secondary)]">
            Explore {JEV_SIGNAL_KEYS.length.toLocaleString()} social content signals and requests you could contribute to. Images, audio, and video are not analyzed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{connectionBusy ? "Checking key…" : connection?.configured ? "Key configured" : "Key not configured"}</span>
            <button type="button" onClick={() => void refreshConnection()} disabled={connectionBusy || busy} className={secondaryButton}>Refresh key status</button>
          </div>
          {connection && <p className="text-[var(--theme-text-secondary)]">{connection.model} · Questions {connection.questionPackVersion} · {connection.inputUsdPerMillion.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 3 })} / million input tokens{connection.attemptsRemaining !== undefined ? ` · ${connection.attemptsRemaining.toLocaleString()} requests remaining at last check` : ""}</p>}
          {!connection?.configured && <p className="text-[var(--theme-text-secondary)]">Add your Jev key above. You can inspect local rule scores and example matches without a key.</p>}
          <div role="tablist" aria-label="Jev preview views" className="flex flex-wrap gap-2" onKeyDown={(event) => {
            if (busy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const tabs = ["classification", "help", "collaborate"] as const;
            const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
              : (tabs.indexOf(activeTab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            const next = tabs[index];
            setActiveTab(next);
            document.getElementById(`jev-tab-${next}`)?.focus();
          }}>
            {([
              ["classification", "Classification"],
              ["help", "People I can help"],
              ["collaborate", "Make something together"],
            ] as const).map(([tab, label]) => (
              <button key={tab} id={`jev-tab-${tab}`} role="tab" type="button"
                aria-selected={activeTab === tab} aria-controls={tab === "classification" ? "jev-tabpanel-classification" : "jev-tabpanel-opportunities"}
                tabIndex={activeTab === tab ? 0 : -1}
                disabled={busy} onClick={() => setActiveTab(tab)}
                className={activeTab === tab ? primaryButton : secondaryButton}>{label}</button>
            ))}
          </div>
          <div hidden={activeTab !== "classification"} role="tabpanel" id="jev-tabpanel-classification" aria-labelledby="jev-tab-classification" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void classify(false)} disabled={busy || !connection?.configured} className={primaryButton}>{isJevNative ? "Classify Library posts" : "Classify sample"}</button>
            <button type="button" onClick={() => void classify(true)} disabled={busy || !connection?.configured || !items.length} className={secondaryButton}>Reclassify</button>
            <button type="button" onClick={() => void reloadSample()} disabled={busy} className={secondaryButton}>{isJevNative ? "Load Library posts" : items.length ? "Reload sample" : "Load sample"}</button>
            {job && job !== "loading" && <button type="button" onClick={() => controller.current?.abort()} className={secondaryButton}>Cancel</button>}
          </div>
          <p className="text-[var(--theme-text-secondary)]">{isJevNative ? "Evaluation mode: reads up to 100 local posts. Scores stay in this view and do not change Library filters or event data. Closing settings clears results." : "Feed filters refresh after a run or comparison finishes or is cancelled."} Reclassify requests fresh decisions. Cancel stops queued work and aborts active requests; the provider may already have processed them.</p>
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-red-400">{error}</p>}
          {job === "loading" && <p role="status">Loading posts…</p>}
          {job === "comparing" && <p role="status">Applying signals to the feed…</p>}
          {items.length > 0 && (
            <>
              <div className="space-y-2">
                <p className="font-semibold">{items.length.toLocaleString()} {isJevNative ? "Library items" : "sample items"} · {items.filter((item) => item.contentType === "post").length.toLocaleString()} posts · {items.filter((item) => item.contentType === "story").length.toLocaleString()} stories</p>
                <p className="text-[var(--theme-text-secondary)]">Jev coverage: {coverage.map(([platform, count]) => `${PLATFORM_LABELS[platform]} ${count.classified.toLocaleString()}/${count.total.toLocaleString()}`).join(" · ")}</p>
                {!isJevNative && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Apply comparison to feed">
                  <span>Feed signals{mode === "existing" ? " (existing sample)" : mode === "mixed" ? " (partly applied)" : ""}:</span>
                  <button type="button" aria-pressed={mode === "rules"} onClick={() => void compare("rules")} disabled={busy} className={mode === "rules" ? primaryButton : secondaryButton}>Rules</button>
                  <button type="button" aria-pressed={mode === "jev"} onClick={() => void compare("jev")} disabled={busy || !hasDecisions} className={mode === "jev" ? primaryButton : secondaryButton}>Jev</button>
                </div>}
                <p className="text-[var(--theme-text-secondary)]">{isJevNative ? "Compare rule and Jev scores below. This evaluation does not change your feed." : "Rules recalculates items with usable source text. Jev restores completed decisions and uses rules for other eligible items. Compare the filters in your feed."}</p>
              </div>
              {results.length > 0 && (
                <div className="space-y-2 rounded-xl border border-[var(--theme-border-subtle)] p-3">
                  <progress aria-label="Classification progress" max={results.length} value={completedCount} className="h-2 w-full accent-[var(--theme-accent-primary)]" />
                  <p role="status">{completedCount.toLocaleString()}/{results.length.toLocaleString()} finished · {counts.success.toLocaleString()} evaluated · {counts.failed.toLocaleString()} failed · {counts.skipped.toLocaleString()} skipped · {counts.cancelled.toLocaleString()} cancelled</p>
                  <p>{counts.running.toLocaleString()} active · {counts.queued.toLocaleString()} queued · {counts.cached.toLocaleString()} cached</p>
                  <p>Run usage: {counts.input.toLocaleString()} input / {counts.output.toLocaleString()} output tokens · Estimated {money(counts.cost)}</p>
                  <p className="text-[var(--theme-text-secondary)]">Usage covers successful responses received by this tab. Failed or cancelled requests may incur additional charges. Cache hits add no new token usage.</p>
                  {counts.failed > 0 && <p role="alert" className="text-red-400">{results.find((result) => result.status === "failed")?.error}</p>}
                </div>
              )}
              {!busy && sessionUsage.input > 0 && <p className="text-[var(--theme-text-secondary)]">Session total: {sessionUsage.input.toLocaleString()} input / {sessionUsage.output.toLocaleString()} output tokens · Estimated {money(sessionUsage.cost)}</p>}
              <div className="space-y-2">
                <label htmlFor="jev-preview-item" className="block font-semibold">Inspect an item</label>
                <select id="jev-preview-item" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="w-full min-w-0 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] px-2 py-2 text-[var(--theme-text-primary)]">
                  {items.map((item) => <option key={item.globalId} value={item.globalId}>{PLATFORM_LABELS[item.platform]} · {item.contentType} · {(item.content.linkPreview?.title || item.content.text || "Media without caption").slice(0, 90)} · ...{item.globalId.slice(-8)}</option>)}
                </select>
                {selected && <>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-2 leading-relaxed">{selected.content.linkPreview?.title && <strong className="mb-1 block">{selected.content.linkPreview?.title}</strong>}{selected.content.text || selected.content.linkPreview?.description || "No text or caption."}</p>
                  <p className="text-[var(--theme-text-secondary)]">{selectedResult?.status ?? "Not classified"}{selectedResult?.response ? ` · ${selectedResult.response.elapsedMs.toLocaleString()} ms${selectedResult.response.cached ? " · Cached" : ""}` : ""}{selectedResult?.error ? ` · ${selectedResult.error}` : ""}</p>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={flags.has(selectedId)} onChange={(event) => setFlags((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(selectedId); else next.delete(selectedId);
                    return next;
                  })} />Flag incorrect classification</label>
                  <p className="text-[var(--theme-text-secondary)]">{flags.size.toLocaleString()} flagged in this tab. Flags are cleared when the page reloads.</p>
                  <table className="w-full text-left">
                    <caption className="mb-2 text-left text-[var(--theme-text-secondary)]">Rules are calculated from source text for comparison. Independent signals activate at {score(CONTENT_SIGNAL_THRESHOLD)}. Overlap is expected.</caption>
                    <thead><tr className="border-b border-[var(--theme-border-subtle)]"><th className="py-2 font-semibold">Signal</th><th className="py-2 text-right font-semibold">Rules</th><th className="py-2 text-right font-semibold">Jev</th></tr></thead>
                    <tbody>
                      {CONTENT_SIGNAL_KEYS.map((signal) => <tr key={signal} className="border-b border-[var(--theme-border-subtle)]"><td className="py-1.5">{signal.replaceAll("_", " ")}</td><td className="py-1.5 text-right tabular-nums">{score(selectedRules?.scores[signal] ?? 0)}</td><td className={`py-1.5 text-right tabular-nums ${(selectedJev?.scores[signal] ?? 0) >= CONTENT_SIGNAL_THRESHOLD ? "font-semibold text-[var(--theme-accent-primary)]" : ""}`}>{score(selectedJev?.scores[signal])}</td></tr>)}
                      <tr><th colSpan={3} className="pb-1 pt-4 text-left font-medium">Preview signals</th></tr>
                      {JEV_EXPERIMENTAL_SIGNAL_KEYS.map((signal) => <tr key={signal} className="border-b border-[var(--theme-border-subtle)]"><td className="py-1.5">{signal.replaceAll("_", " ")}</td><td className="py-1.5 text-right text-[var(--theme-text-muted)]">Not available</td><td className={`py-1.5 text-right tabular-nums ${(selectedExperimental?.scores[signal] ?? 0) >= CONTENT_SIGNAL_THRESHOLD ? "font-semibold text-[var(--theme-accent-primary)]" : ""}`}>{score(selectedExperimental?.scores[signal])}</td></tr>)}
                    </tbody>
                  </table>
                  <p className="text-[var(--theme-text-secondary)]">The first {CONTENT_SIGNAL_KEYS.length.toLocaleString()} signals {isJevNative ? "correspond to existing feed signals. These evaluation scores do not change filters." : "drive existing feed filters."} The {JEV_EXPERIMENTAL_SIGNAL_KEYS.length.toLocaleString()} preview signals stay in this tab and have no rule comparison yet.</p>
                </>}
              </div>
            </>
          )}
          </div>
          <div hidden={activeTab === "classification"} role="tabpanel" id="jev-tabpanel-opportunities" aria-labelledby={`jev-tab-${activeTab === "collaborate" ? "collaborate" : "help"}`}>
            <JevOpportunityPreview
              lens={activeTab === "collaborate" ? "collaborate" : "help"}
              visible={expanded && activeTab !== "classification"}
              items={items}
              configured={connection?.configured === true}
              disabled={job !== null}
              onBusyChange={setOpportunityBusy}
              onLoadSample={loadSample}
              onOpenItem={openInFreed}
            />
          </div>
          <p className="text-[var(--theme-text-secondary)]">{isJevNative ? "Text-only evaluation using your local Library. Images, audio, and video are not analyzed. Results remain local to this view." : "Freed Desktop browser preview with a sample library. API results use your own Jev key."}</p>
        </div>
    </aside>
  );
}
