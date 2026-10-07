import { onJevCredentialChange } from "../lib/jev-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLATFORM_LABELS, type FeedItem } from "@freed/shared";
import {
  createJevOpportunityDemo,
  parseJevCapabilities,
  runJevOpportunities,
  selectJevOpportunities,
  type JevOpportunityRelationship,
  type JevOpportunityResult,
} from "../lib/jev-opportunities";
import { loadJevPreviewRelationships } from "../lib/jev-library";
import { useAppStore } from "../lib/store";

interface JevOpportunityPreviewProps {
  lens: "help" | "collaborate";
  visible: boolean;
  items: readonly FeedItem[];
  configured: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onLoadSample: () => Promise<FeedItem[]>;
  onOpenItem: (item: FeedItem) => void;
}

const secondaryButton = "rounded-lg border border-[var(--theme-border-subtle)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--theme-bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = "theme-accent-button rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const percent = (value: number) => value.toLocaleString(undefined, {
  style: "percent", maximumFractionDigits: 1,
});
const money = (value: number) => value.toLocaleString(undefined, {
  style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4,
});

/** Personal relevance stays in this tab; it never overwrites a post's classification. */
export function JevOpportunityPreview({
  lens, visible, configured, disabled, onBusyChange, onLoadSample, onOpenItem,
}: JevOpportunityPreviewProps) {
  const [profileText, setProfileText] = useState("");
  const [results, setResults] = useState<readonly JevOpportunityResult[]>([]);
  const [relationships, setRelationships] = useState<Record<string, JevOpportunityRelationship>>({});
  const [example, setExample] = useState<ReturnType<typeof createJevOpportunityDemo> | null>(null);
  const [source, setSource] = useState<"live" | "example" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileChanged, setProfileChanged] = useState(false);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [age, setAge] = useState("30");
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(20);
  const [sessionUsage, setSessionUsage] = useState({ input: 0, output: 0, cost: 0 });
  const libraryItemVersion = useAppStore((state) => state.libraryItemVersion);
  const [snapshot, setSnapshot] = useState<{ items: FeedItem[]; version: number } | null>(null);
  const [checkingSource, setCheckingSource] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [focusRevision, setFocusRevision] = useState(0);
  const loadSample = useRef(onLoadSample);
  loadSample.current = onLoadSample;
  const sourceGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const blocked = busy || disabled;
  useEffect(() => onJevCredentialChange(() => {
    controller.current?.abort();
    setResults([]); setSource(null);
    sourceGeneration.current += 1;
  }), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sourceGeneration.current += 1;
      controller.current?.abort();
    };
  }, []);

  // Read current local evidence independently of the parent's last loaded sample.
  // Generations prevent an older relationship/source read from restoring stale cards.
  const refreshSource = useCallback(async () => {
    const generation = ++sourceGeneration.current;
    const version = useAppStore.getState().libraryItemVersion;
    setCheckingSource(true);
    setSnapshot(null);
    try {
      const sample = await loadSample.current();
      const knownRelationships = await loadJevPreviewRelationships(sample);
      if (!mounted.current || generation !== sourceGeneration.current ||
        version !== useAppStore.getState().libraryItemVersion) return null;
      setSnapshot({ items: sample, version });
      setRelationships(knownRelationships);
      setNow(Date.now());
      return sample;
    } catch (failure) {
      if (mounted.current && generation === sourceGeneration.current) throw failure;
      return null;
    } finally {
      if (mounted.current && generation === sourceGeneration.current) setCheckingSource(false);
    }
  }, []);

  useEffect(() => {
    function refreshOnFocus() {
      setNow(Date.now());
      setFocusRevision((current) => current + 1);
    }
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);

  useEffect(() => {
    if (visible) setNow(Date.now());
    // A running job reads immediately before and after its network work.
    if (source !== "live" || !visible || controller.current) return;
    void refreshSource().catch((failure) => {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not check current posts.");
    });
  }, [source, visible, libraryItemVersion, focusRevision, refreshSource]);

  const profile = useMemo(() => {
    try { return { capabilities: parseJevCapabilities(profileText), error: null }; }
    catch (failure) {
      return { capabilities: [], error: failure instanceof Error ? failure.message : "Check your skills list." };
    }
  }, [profileText]);

  function changeProfile(value: string) {
    sourceGeneration.current += 1;
    setSnapshot(null);
    setProfileChanged(results.length > 0 || profileChanged);
    setProfileText(value);
    setResults([]);
    setExample(null);
    setSource(null);
    setRelationships({});
    setDismissed(new Set());
    setVisibleCount(20);
    setError(null);
  }

  function useExampleProfile() {
    changeProfile(createJevOpportunityDemo().capabilities.join("\n"));
  }

  function showExampleMatches() {
    sourceGeneration.current += 1;
    setSnapshot(null);
    const demoTime = Date.now();
    const demo = createJevOpportunityDemo(demoTime);
    setNow(demoTime);
    setProfileText(demo.capabilities.join("\n"));
    setExample(demo);
    setResults(demo.results);
    setRelationships(demo.relationships);
    setSource("example");
    setProfileChanged(false);
    setDismissed(new Set());
    setVisibleCount(20);
    setError(null);
  }

  async function findMatches(reclassify: boolean) {
    if (profile.error) return;
    const activeController = new AbortController();
    controller.current = activeController;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setExample(null);
    setSource("live");
    setResults([]);
    setProfileChanged(false);
    setVisibleCount(20);
    try {
      const sample = await refreshSource();
      if (!sample) throw new Error("The library changed while loading. Find matches again using the current posts.");
      if (!sample.length) throw new Error("No eligible posts were loaded. Load posts and try again.");
      if (activeController.signal.aborted) return;
      const completed = await runJevOpportunities(sample, profile.capabilities, {
        signal: activeController.signal,
        reclassify,
        onUpdate: (next) => { if (mounted.current) setResults(next); },
      });
      if (mounted.current) {
        setSessionUsage((current) => completed.reduce((total, result) => ({
          input: total.input + (result.response?.cached ? 0 : result.response?.usage.input_tokens ?? 0),
          output: total.output + (result.response?.cached ? 0 : result.response?.usage.output_tokens ?? 0),
          cost: total.cost + (result.response?.estimatedCostUsd ?? 0),
        }), current));
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not find matches.");
    } finally {
      if (mounted.current) {
        try { await refreshSource(); }
        catch (failure) {
          if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not check current posts.");
        }
      }
      controller.current = null;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  const currentSourceAvailable = source !== "live" ||
    (!checkingSource && snapshot !== null && snapshot.version === libraryItemVersion);
  const matches = useMemo(() => selectJevOpportunities({
    items: source === "example" ? example?.items ?? [] : currentSourceAvailable ? snapshot?.items ?? [] : [],
    results,
    capabilities: profile.capabilities,
    relationships,
    lens,
    friendsOnly,
    maxAgeDays: age === "all" ? null : Number(age),
    dismissed,
    now,
  }), [source, example, currentSourceAvailable, snapshot, results, profile.capabilities, relationships, lens, friendsOnly, age, dismissed, now]);

  const counts = useMemo(() => {
    const total = { queued: 0, running: 0, success: 0, failed: 0, skipped: 0, cancelled: 0, cached: 0, input: 0, output: 0, cost: 0 };
    for (const result of results) {
      total[result.status] += 1;
      if (!result.response) continue;
      if (result.response.cached) total.cached += 1;
      else {
        total.input += result.response.usage.input_tokens;
        total.output += result.response.usage.output_tokens;
      }
      total.cost += result.response.estimatedCostUsd;
    }
    return total;
  }, [results]);
  const finished = counts.success + counts.failed + counts.skipped + counts.cancelled;
  const isHelp = lens === "help";
  const visibleMatches = matches.slice(0, visibleCount);

  return (
    <section aria-label={isHelp ? "People I can help" : "Make something together"} className="space-y-4" data-testid="jev-opportunity-preview">
      <p className="leading-relaxed text-[var(--theme-text-secondary)]">
        {isHelp
          ? "Find explicit requests that fit what you can offer. A difficult experience alone does not mean someone is asking for help."
          : "Find invitations to create or work together that fit what you can contribute. Sharing unfinished work alone is not an invitation."}
      </p>
      <div className="space-y-2">
        <label htmlFor="jev-help-capabilities" className="block font-semibold">What I can help with</label>
        <textarea id="jev-help-capabilities" value={profileText} disabled={blocked}
          onChange={(event) => changeProfile(event.target.value)} rows={4}
          placeholder={"One skill or resource per line, for example:\nReview a TypeScript prototype\nRepair a bicycle"}
          aria-describedby="jev-capabilities-help"
          className="theme-input w-full resize-y rounded-lg px-3 py-2 text-sm disabled:opacity-50" />
        <p id="jev-capabilities-help" className="text-[var(--theme-text-secondary)]">Up to {(8).toLocaleString()} skills or resources, {(120).toLocaleString()} characters each. This profile stays in this tab. The skills you enter and post text are sent to Jev when you find matches.</p>
        {profileText.trim() && profile.error && <p role="alert" className="text-red-400">{profile.error}</p>}
        {profileChanged && <p role="status" className="text-[var(--theme-text-secondary)]">Profile changed. Find matches again to use these skills.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={useExampleProfile} disabled={blocked} className={secondaryButton}>Try example profile</button>
          <button type="button" onClick={showExampleMatches} disabled={blocked} className={secondaryButton}>Preview example matches</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void findMatches(false)} disabled={blocked || !configured || !!profile.error} className={primaryButton}>Find matches with Jev</button>
        <button type="button" onClick={() => void findMatches(true)} disabled={blocked || !configured || !!profile.error || source !== "live" || !results.length} className={secondaryButton}>Recheck with Jev</button>
        {busy && <button type="button" onClick={() => controller.current?.abort()} className={secondaryButton}>Cancel matching</button>}
      </div>
      <p className="text-[var(--theme-text-secondary)]">One matching run evaluates both views across the loaded loaded posts. It does not require a classification run. Recheck requests fresh decisions.</p>
      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-red-400">{error}</p>}
      {source === "example" && <p role="status" className="rounded-lg border border-[var(--theme-border-strong)] p-3">Example results with fictional people and manually authored scores. No Jev request was made. These posts are not in your feed.</p>}
      {source === "live" && results.length > 0 && (
        <div className="space-y-2 rounded-xl border border-[var(--theme-border-subtle)] p-3">
          <p className="font-semibold">Jev matching run</p>
          <progress aria-label="Matching progress" max={results.length} value={finished} className="h-2 w-full accent-[var(--theme-accent-primary)]" />
          <p role="status">{finished.toLocaleString()}/{results.length.toLocaleString()} finished · {counts.success.toLocaleString()} evaluated · {counts.failed.toLocaleString()} failed · {counts.skipped.toLocaleString()} skipped · {counts.cancelled.toLocaleString()} cancelled</p>
          <p>{counts.running.toLocaleString()} active · {counts.queued.toLocaleString()} queued · {counts.cached.toLocaleString()} cached</p>
          <p>{counts.input.toLocaleString()} input / {counts.output.toLocaleString()} output tokens · Estimated {money(counts.cost)}</p>
          <p className="text-[var(--theme-text-secondary)]">Usage covers successful responses received by this tab. Failed or cancelled requests may still incur charges. Cache hits add no new token usage.</p>
          {counts.failed > 0 && <p role="alert" className="text-red-400">{results.find((result) => result.status === "failed")?.error}</p>}
        </div>
      )}
      {!busy && sessionUsage.input > 0 && <p className="text-[var(--theme-text-secondary)]">Matching tab total: {sessionUsage.input.toLocaleString()} input / {sessionUsage.output.toLocaleString()} output tokens · Estimated {money(sessionUsage.cost)}</p>}
      {source && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={friendsOnly} onChange={(event) => { setFriendsOnly(event.target.checked); setVisibleCount(20); }} />Confirmed friends only</label>
            <label className="flex items-center gap-2">Posted
              <select aria-label="Request age" value={age} onChange={(event) => { setAge(event.target.value); setVisibleCount(20); }} className="theme-input rounded-lg px-2 py-1.5">
                <option value="7">Past {(7).toLocaleString()} days</option>
                <option value="30">Past {(30).toLocaleString()} days</option>
                <option value="90">Past {(90).toLocaleString()} days</option>
                <option value="all">Any time</option>
              </select>
            </label>
          </div>
          <p className="text-[var(--theme-text-secondary)]">Intent and at least one declared skill must each reach an estimated {percent(0.7)}. These estimates have not been calibrated. Unknown relationships are included unless you choose confirmed friends only.</p>
          <p className="text-[var(--theme-text-secondary)]">Check the original post: a recent request may already be resolved or its deadline may have passed.</p>
          <p className="font-semibold" role="status">{currentSourceAvailable
            ? `${matches.length.toLocaleString()} ${isHelp ? "requests" : "invitations"}${busy ? " so far" : ""}`
            : checkingSource ? "Checking current posts and relationships..." : "Matches are hidden until current posts and relationships can be checked."}</p>
          {!matches.length && !busy && currentSourceAvailable && <p className="text-[var(--theme-text-secondary)]">{counts.success > 0
            ? `No ${isHelp ? "explicit requests" : "collaboration invitations"} among the evaluated items meet this profile and these filters.`
            : "No successful evaluations are available for this profile. Resolve the run error or preview the example matches."}</p>}
          <div className="space-y-3">
            {visibleMatches.map((match) => (
              <article key={match.item.globalId} data-jev-opportunity-id={match.item.globalId} className="space-y-3 rounded-xl border border-[var(--theme-border-subtle)] p-3">
                <div>
                  <p className="font-semibold text-sm">{match.relationship.name ?? match.item.author.displayName}</p>
                  <p className="text-[var(--theme-text-secondary)]">{PLATFORM_LABELS[match.item.platform]} · {match.item.contentType} · {new Date(match.item.publishedAt).toLocaleDateString()}</p>
                  <p className="mt-1 font-medium">{match.relationship.kind === "friend" ? "Confirmed friend" : match.relationship.kind === "connection" ? "Confirmed connection" : "Relationship unknown"}</p>
                </div>
                {match.item.content.linkPreview?.title && <p className="font-semibold">{match.item.content.linkPreview.title}</p>}
                <p className="whitespace-pre-wrap break-words leading-relaxed">{match.item.content.text || match.item.content.linkPreview?.description}</p>
                <div className="space-y-1 border-t border-[var(--theme-border-subtle)] pt-2">
                  <p>Estimated {isHelp ? "explicit help request" : "invitation to collaborate"}: <strong>{percent(match.intentProbability)}</strong></p>
                  <p className="font-medium">Matching skills you entered:</p>
                  <ul className="list-inside list-disc space-y-1">{match.matchingCapabilities.map((capability) => <li key={capability.capability}>{capability.capability} · {percent(capability.probability)} estimated fit</li>)}</ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  {source === "live" && <button type="button" onClick={() => onOpenItem(match.item)} className={secondaryButton}>Open in Freed</button>}
                  <button type="button" onClick={() => setDismissed((current) => new Set([...current, match.item.globalId]))} className={secondaryButton} aria-label={`Dismiss request from ${match.item.author.displayName}`}>Dismiss for this profile</button>
                </div>
              </article>
            ))}
          </div>
          {matches.length > visibleMatches.length && <button type="button" onClick={() => setVisibleCount((current) => current + 20)} className={secondaryButton}>Show more ({(matches.length - visibleMatches.length).toLocaleString()} remaining)</button>}
          {dismissed.size > 0 && <button type="button" onClick={() => setDismissed(new Set())} className={secondaryButton}>Restore {dismissed.size.toLocaleString()} dismissed items</button>}
          <p className="text-[var(--theme-text-secondary)]">Matches and dismissals stay in this tab. No message is sent to anyone.</p>
        </>
      )}
    </section>
  );
}
