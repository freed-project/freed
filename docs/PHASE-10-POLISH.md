# Phase 10: Polish

> **Status:** Future  
> **Dependencies:** All previous phases

---

## Overview

Final polish, accessibility, UX refinements, global animation controls, Integrated AI pack selection, local semantic enrichment for friend suggestions, governed release automation, and community infrastructure.

---

## Polish Tasks

### Onboarding Wizard

```tsx
// packages/pwa/src/components/onboarding/OnboardingWizard.tsx
export function OnboardingWizard() {
  const [step, setStep] = useState(0);

  const steps = [
    { title: "Welcome", component: WelcomeStep },
    { title: "Connect X", component: ConnectXStep },
    { title: "Add RSS", component: AddRssStep },
    { title: "Set Preferences", component: PreferencesStep },
    { title: "Sync Setup", component: SyncSetupStep },
  ];

  return (
    <div className="onboarding-wizard">
      <ProgressIndicator current={step} total={steps.length} />
      {steps[step].component({ onNext: () => setStep((s) => s + 1) })}
    </div>
  );
}
```

### Statistics Dashboard

```tsx
// packages/pwa/src/components/stats/StatsDashboard.tsx
export function StatsDashboard() {
  const stats = useStats();

  return (
    <div className="stats-grid">
      <StatCard
        title="Items Read"
        value={stats.itemsRead}
        trend={stats.readingTrend}
      />
      <StatCard
        title="Time Saved"
        value={formatDuration(stats.timeSaved)}
        description="vs algorithmic feeds"
      />
      <StatCard
        title="Sources"
        value={stats.sourceCount}
        breakdown={stats.sourcesByPlatform}
      />
      <PlatformBreakdown data={stats.platformUsage} />
      <ReadingTimeChart data={stats.dailyReadingTime} />
    </div>
  );
}
```

### Export Functionality

```typescript
// packages/pwa/src/lib/export.ts
export async function exportToJson(doc: FreedDoc): Promise<string> {
  const exportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    items: Object.values(doc.feedItems),
    feeds: Object.values(doc.rssFeeds),
    preferences: doc.preferences,
  };

  return JSON.stringify(exportData, null, 2);
}

export async function exportToCsv(items: FeedItem[]): Promise<string> {
  const headers = [
    "globalId",
    "platform",
    "author",
    "publishedAt",
    "title",
    "url",
  ];
  const rows = items.map((item) => [
    item.globalId,
    item.platform,
    item.author.displayName,
    new Date(item.publishedAt).toISOString(),
    item.content.linkPreview?.title ?? "",
    item.content.linkPreview?.url ?? "",
  ]);

  return [headers, ...rows].map((row) => row.join(",")).join("\n");
}
```

### Command Bar / Action Launcher

Freed now has a real global command palette, opened with `Cmd/Ctrl+K`, mounted from `AppShell`, and rendered as a centered desktop modal or a mobile `BottomSheet`. The old sidebar search field is feed search only again.

The command palette now covers:

- **Navigation**: Unified Feed, Saved, Archived, Friends, Map, every top source, typed RSS feed matches, followed social channel matches, top-level tag scopes, and every visible settings section
- **Create flows**: Add RSS Feed, Save URL, import Freed Markdown, export Freed Markdown
- **Current item actions**: Open original URL, close reader, save or unsave, archive or unarchive, like or unlike when supported
- **Current scope actions**: Mark current scope read, archive visible read items in one batch, unarchive saved items, sync RSS, sync the current provider, and check for updates when supported
- **Danger actions**: Delete all archived items plus local or cloud-backed factory reset, guarded by typed confirmation

Blank suggestions now stay compact. Individual RSS feeds and danger actions are hidden until the operator starts typing, and broad matches are capped so a large feed list cannot turn the command surface into a scroll chore.

The shared extension points now live in `packages/ui/src/lib/command-palette.ts`, `packages/ui/src/lib/command-palette-registry.ts`, and `packages/ui/src/lib/command-surface-store.ts`.

### Nightly Improvement Runner

Freed now has a local nightly improvement planner in `scripts/nightly-self-improve.mjs`. It folds the installed-build soak, daily bug scan memory, crash-watch state, roadmap fallback memory, peer worktrees, prior outcome history, and current git state into a ranked queue of work that can run overnight.

The runner can choose multiple targets in one night. Bug fixes are first-class targets through the existing daily bug scan memory, while peer worktree integration, duplicate-work detection, performance, stability, release readiness, and roadmap work compete by score and machine-time budget. The selector now aims for at least three machine hours of queued work by default, so when the night does not have one big evidence-backed target it keeps batching smaller safe tasks instead of calling it done after a quick patch. Stale dirty peer worktrees still stay visible as evidence, but they no longer outrank a fresh bug scan when they have no commits ahead of current `dev`. Peer worktrees whose branch name and exact head SHA already match a merged `dev` PR are now filtered out of the automatic queue unless the path was explicitly requested, which cuts duplicate-work noise from stale but already-shipped branches. Daily bug scan parsing now recognizes explicit "no new repo commits" outcomes and does not mistake an unmerged regression note for a shipped fix. Each run now writes a preflight risk snapshot plus an execution plan with stop gates, command hints, task prompts, unattended app-interaction rules, outcome templates, and ready-to-run ledger closeout commands so overnight automation has a clear path from clean evidence to validation, dev build shipping, installed-build soak, learned scoring, and morning closeout. Generated reports, task prompts, soak phases, and closeout notes tell unattended runs to use terminal diagnostics and shipped triggers first, ask with a 10 minute response window before disruptive app clicks, and build a repeatable trigger instead of waiting until morning when the same action will recur. When the active soak pointer has no samples, the runner falls back to the newest readable soak and records that fallback as preflight evidence. It can also repair the pointer to that readable soak when the remediation is unambiguous and local only. Performance targets require enough fresh soak samples before WebKit RSS or heartbeat evidence can win the queue. Missing root dependencies now stay visible as a bootstrap warning instead of outranking the bug scan, so validation prep happens when a chosen fix actually needs packages. Preflight actions now label each remediation as a safe local command, manual review, or automation-tool action. Provider-visible peer worktrees are surfaced by default and stay blocked unless a human explicitly approves the fingerprinting risk. The planner also blocks the default nightly path when it is launched from a non-dev checkout, because release lanes and product lanes are not interchangeable no matter how many shell prompts whisper otherwise.

The stability automation now has a checked-in control plane instead of relying on prompt memory. `automation/specs/` defines five actor identities and their authority. `scripts/automation-control.mjs` keeps one atomic task manifest, an append-only event ledger, canonical token-bound leases, conservative lifecycle transitions, and owner-only authority changes protected by a private one-time bootstrap. New tasks begin in `observed`. Stored task authority limits how far even a more powerful actor may move them. Closed task IDs reopen only from evidence newer than their close timestamp. Provider-visible work requires an owner-authorized packet digest bound to the exact committed diff and remains a draft PR until CODEOWNER review. Outcome records require a matching lease-authenticated control event and separate merge, full installed identity, and evidence-derived effect. A pending outcome reservation keeps the one global behavior slot closed until the canonical ledger entry and both matching control events are durably verified. Raw soak output becomes a lifecycle decision only through the task-bound outcome verdict converter with an exact, different-build baseline and matched workload, host, provider cohort, document-size bucket, channel, and duration. Runtime-health counters stamp build and app-session identity. Soak verdicts bind ordered runtime records, raw collector bytes, denominators, optional artifact digest, and immutable comparison context. Canary records preserve and verify runtime-health, collector-metrics, and collector-events sidecars before historical comparison or triage. The soak collector uses process-start identity and command digest in its atomic session lock so overlap and PID reuse cannot overwrite the active evidence pointer. Empty, sparse, mixed, malformed, unavailable, or denominator-free evidence stays inconclusive. Duplicate physical events retain their multiplicity while rotation overlap is removed by occurrence count. Triage generations carry stable task identity, provider state, authority, source health, and soak exclusivity. The nightly selector admits only runnable canonical tasks, sanitizes task details from JSON plans, and runs strict machine preflight before any mutation. Missing behavior classification, unhealthy control history, an inconclusive installed behavior, or a terminal task revision without its matching authenticated outcome keeps the one global product-behavior slot closed. Versioned stability artifact manifests give evidence capture, memory profiling, sync replay, provider review, and controller decisions one validated background-agent interchange format. Those manifests require immutable source digests and typed, kind-specific payloads, and embedded digests are recomputed during validation. The provider lane names YouTube explicitly, runs YouTube unit, package, and workflow coverage, preserves Rust checks for native provider changes, and treats shared provider-consent logic as provider-visible. Ruleset application requires the exact CODEOWNERS policy on the target branch. Dev release prep returns to `dev`, production release prep returns to `main` as a release-only PR after any required promotion, and tags bind only to the exact merged remote commit.

Every general automation actor now requires lease acquisition through a trusted host launcher and a private machine-local credential record. The owner-run bootstrap helper builds deterministic native binaries with linker-generated ad hoc signatures and requires no developer signing identity. It installs an actor-specific root-owned launcher plus a content-addressed root-owned copy of the pinned Node and control runtime, generates the persistent credential inside a native Swift provisioner, limits its Keychain ACL to the exact launcher, and leaves the orchestration layer, shell, logs, and agent state with only the short-lived lease result. Verification validates the public binding and private digest, then asks that exact installed launcher for a nonmutating readiness attestation instead of reading the secret through a disposable helper. Verify, acquire, and owner-run host acceptance disable Keychain user interaction, bound child runtime and output, and fail closed instead of displaying a password dialog. Host acceptance proves acquire, heartbeat, and release for every actor before activation. Rotation remains an explicit owner-interactive recovery action with one-time Keychain approval only. The pinned control child is the only JavaScript process that receives the persistent credential, and receives it only long enough to acquire the canonical lease. General actor leases have a 30 minute absolute lifetime. Saved actor reconciliation validates the schedule, current callable model and supported reasoning effort, canonical Freed target, exact working-directory scope, execution environment, credential record, launcher and runtime digests, and Keychain-to-lease handoff metadata. Missing actors remain paused. Active actors fail closed until real-host verification and lifecycle acceptance prove the complete handoff. The ad hoc signed launchers pin the selected role and protect its persistent credential, but they cannot authenticate which process under the same macOS user invoked that role. Cross-role isolation remains cooperative. Stored task authority, provider approvals, the global behavior slot, owner governance, publisher isolation, and GitHub review remain enforced. This bootstrap excludes the owner and PR publisher identities and grants no provider authority. Normal pull request publication remains available through the governed helper and the caller's existing GitHub authentication. Hosts that need stronger unattended publication hardening may optionally install the separate native signed broker. It clears inherited process state, validates its root-owned trust configuration and pinned tools, and uses an Ed25519 Keychain key to issue one short-lived target-scoped capability and publisher lease. The repository does not install that host profile. Missing broker provisioning does not block normal publication, and a partial broker handoff fails closed. This optional profile is cooperative hardening, not an operating-system sandbox against arbitrary same-user code. The owner governance identity remains protected by its separate expiring one-time bootstrap.

Current-task owner confirmation is now a supported cooperative fallback for one exact lifecycle operation when the owner explicitly approves it in the active task. The private confirmation binds the owner name, current-task reference, task ID, canonical operation intent, approval time, and expiry to a short `freed-owner` lease. Every different operation needs a different intent record. The audit event preserves the confirmation digest and reference. This path does not authenticate the owner, contact a provider, or replace provider-risk approval and CODEOWNER review. Unknown metric IDs in stability artifacts now fail validation before a release handoff can depend on them.

### Keyboard Shortcuts

Freed Desktop now includes a device-local OS-wide shortcut for Save Content. It opens the existing Save Content dialog, reads the clipboard only when the shortcut fires, pre-fills the URL field when the clipboard contains an HTTP or HTTPS link, and opens the saved item in reader mode after persistence. Users can change, disable, or reset the shortcut from Settings > Shortcuts.

```typescript
// packages/pwa/src/hooks/useKeyboardShortcuts.ts
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      j: () => navigateToNextItem(),
      k: () => navigateToPrevItem(),
      o: () => openCurrentItem(),
      s: () => saveCurrentItem(),
      h: () => hideCurrentItem(),
      "/": () => focusSearch(),
      "?": () => showShortcutsHelp(),
      Escape: () => closeCurrentPanel(),
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      const handler = handlers[e.key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
```

---

## Accessibility

### Screen Reader Support

```tsx
// Ensure all interactive elements have proper labels
<button
  aria-label="Save item to library"
  aria-pressed={item.userState.saved}
  onClick={handleSave}
>
  <SaveIcon aria-hidden="true" />
</button>

// Announce feed updates
<div role="log" aria-live="polite" aria-label="Feed updates">
  {newItemCount > 0 && `${newItemCount} new items`}
</div>
```

### Reduced Motion

Appearance now exposes a synced `Animations` preference with `None`, `Light`, and `Detailed` options. `Detailed` keeps the full interface motion, `Light` keeps short layout and state feedback while cutting decorative loops, and `None` disables app-controlled fades, slides, layout morphs, shimmers, spinners, and theme transition blur.

```css
html[data-animation="none"] *,
html[data-animation="none"] *::before,
html[data-animation="none"] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Color Contrast

```css
/* Ensure WCAG AA compliance */
:root {
  --text-primary: rgba(255, 255, 255, 0.92); /* 14:1 on dark bg */
  --text-secondary: rgba(255, 255, 255, 0.7); /* 7:1 on dark bg */
  --accent: #ff6b35; /* 4.5:1 minimum */
}
```

---

## Native Liquid Glass (macOS)

SwiftUI buttons for true Liquid Glass aesthetic:

```swift
// packages/desktop/src-tauri/swift/LiquidGlassButton.swift
import SwiftUI

struct LiquidGlassButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
        }
        .buttonStyle(.glass)
        .glassBackgroundEffect()
    }
}
```

---

---

## AI-Powered Features

### Topic Extraction

Automatically tag feed items with relevant topics using local LLM or API.

```typescript
// packages/pwa/src/lib/ai/topics.ts
export interface TopicExtractor {
  extract(text: string): Promise<string[]>;
}

// Local option: use WebLLM or similar
export class LocalTopicExtractor implements TopicExtractor {
  async extract(text: string): Promise<string[]> {
    // Run inference locally in WebWorker
    const model = await loadModel("topic-classifier");
    return model.classify(text);
  }
}

// API option: OpenAI, Anthropic, etc.
export class ApiTopicExtractor implements TopicExtractor {
  async extract(text: string): Promise<string[]> {
    // User provides their own API key
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ text, task: "topic_extraction" }),
    });
    return response.json();
  }
}
```

### Content Summarization

Generate summaries for long-form content.

```typescript
// packages/pwa/src/lib/ai/summarize.ts
export async function summarizeContent(
  content: string,
  maxLength: number = 200,
): Promise<string> {
  // Runs locally or via user-provided API
  const summarizer = await getSummarizer();
  return summarizer.summarize(content, { maxLength });
}
```

### Sentiment Analysis

Optional sentiment tagging for feed items.

```typescript
// packages/pwa/src/lib/ai/sentiment.ts
export type Sentiment = "positive" | "negative" | "neutral" | "mixed";

export async function analyzeSentiment(text: string): Promise<Sentiment> {
  const analyzer = await getSentimentAnalyzer();
  return analyzer.analyze(text);
}
```

### Smart Notifications

AI-powered notification filtering—only alert for truly important items.

```typescript
// packages/pwa/src/lib/ai/notifications.ts
export interface NotificationFilter {
  shouldNotify(item: FeedItem, context: UserContext): Promise<boolean>;
}

export class SmartNotificationFilter implements NotificationFilter {
  async shouldNotify(item: FeedItem, context: UserContext): Promise<boolean> {
    // Consider: author importance, topic relevance, recency, engagement patterns
    const score = await this.computeImportanceScore(item, context);
    return score > context.preferences.notificationThreshold;
  }
}
```

---

## Plugin/Extension API

Allow community extensions to add custom capture layers, ranking rules, and UI components.

```typescript
// packages/shared/src/plugin-api.ts
export interface FreedPlugin {
  name: string;
  version: string;

  // Optional hooks
  onItemCaptured?(item: FeedItem): FeedItem | null;
  onRankingComputed?(item: FeedItem, score: number): number;
  registerCommands?(): Command[];
  registerComponents?(): ComponentRegistration[];
}

export function registerPlugin(plugin: FreedPlugin): void {
  // Plugin registration logic
}
```

---

## Community Infrastructure

### Discord Server

Central hub for community discussion, support, and development coordination.

- **#general** — Community chat
- **#support** — Help and troubleshooting
- **#development** — Contributor discussion
- **#platform-updates** — Alerts when platforms change DOM/APIs
- **#feature-requests** — Community-driven roadmap input

### Bug Bounty Program

Reward security researchers for responsible disclosure.

| Severity                      | Reward      |
| ----------------------------- | ----------- |
| Critical (data exposure, RCE) | $500–$2000  |
| High (auth bypass, XSS)       | $100–$500   |
| Medium (info disclosure)      | $50–$100    |
| Low (minor issues)            | Recognition |

### Release Cadence

- **Weekly** — Patch releases (bug fixes)
- **Monthly** — Minor releases (new features)
- **Quarterly** — Major releases (breaking changes, if any)

---

## Tasks

### UX Polish

| Task  | Description                        | Complexity |
| ----- | ---------------------------------- | ---------- |
| 10.1  | Onboarding wizard                  | Medium     |
| 10.2  | Statistics dashboard               | Medium     |
| 10.3  | Export to JSON                     | Low        |
| 10.4  | Export to CSV                      | Low        |
| 10.5  | Keyboard shortcuts                 | Medium     | ✓ Complete (PWA reader keys, command palette, navigation history keys, and Freed Desktop Save Content shortcut) |
| 10.6  | Screen reader support              | Medium     |
| 10.7  | Reduced motion support             | Low        | ✓ Complete (Appearance animation intensity controls plus global app motion gating)                              |
| 10.8  | Color contrast audit               | Low        |
| 10.9  | Native Liquid Glass buttons        | High       |
| 10.24 | Command bar: full action launcher | High       | ✓ Complete (Global `Cmd/Ctrl+K` palette with navigation, creation, current-item, sync, and danger actions)      |

### AI Features

| Task  | Description               | Complexity |
| ----- | ------------------------- | ---------- |
| 10.10 | Topic extraction (local)  | High       | ✓ Complete (Ollama via ai-summarizer.ts)                                                                                                                                                                                                                        |
| 10.11 | Topic extraction (API)    | Medium     | ✓ Complete (OpenAI/Anthropic/Gemini adapters)                                                                                                                                                                                                                   |
| 10.12 | Content summarization     | High       | ✓ Complete (summarize() in content-fetcher.ts)                                                                                                                                                                                                                  |
| 10.13 | Sentiment analysis        | Medium     | ✓ Complete (AISummary.sentiment field)                                                                                                                                                                                                                          |
| 10.14 | Smart notifications       | High       |
| 10.15 | AI settings UI            | Medium     | ✓ Complete (Freed Desktop provider selector for Integrated AI, Ollama, OpenAI, Anthropic, and Gemini with provider-scoped sharing tags, optimistic selection, default workflows when AI is enabled, and no PWA controls for AI paths the browser cannot run)    |
| 10.25 | Local content signals     | Medium     | ✓ Complete (rule-based contentSignals metadata, automatic ingestion inference, resumable desktop and PWA semantic backfill, inclusive saved toolbar filter presets, saved sort controls, expanded signal taxonomy, and compact event candidate extraction)      |
| 10.26 | Optional local AI packs   | High       | ✓ Complete (disabled-by-default Light, Balanced, and Pro Integrated AI packs, hardware-based recommendations, pinned download manifests, semantic scan health, source links, resumable desktop downloads, raw-file checksum verification, and removal controls) |
| 10.27 | Local AI signal consumers | Medium     | ✓ Complete (Friends suggestions improve from Integrated AI `Topics and ranking` contentSignals while still working deterministically when AI is off)                                                                                                            |

### Extensibility

| Task  | Description          | Complexity |
| ----- | -------------------- | ---------- |
| 10.16 | Plugin API design    | High       |
| 10.17 | Plugin loader        | High       |
| 10.18 | Plugin documentation | Medium     |

### Community

| Task  | Description          | Complexity |
| ----- | -------------------- | ---------- |
| 10.19 | Discord server setup | Low        |
| 10.20 | Bug bounty program   | Medium     |
| 10.21 | Release automation   | Medium     | ✓ Complete (reviewed release prep, protected branch promotion, dedicated release App provisioning, root-owned native tag publication, split tag rulesets, and fail-closed release identity checks) |
| 10.22 | Documentation site   | Medium     |

### Resilience

| Task  | Description                                                         | Complexity |
| ----- | ------------------------------------------------------------------- | ---------- |
| 10.23 | Crash / stale-bundle recovery dialog with in-place updater fallback | Medium     |
| 10.24 | Public-safe bundles and private GitHub vulnerability reports        | Medium     |

---

## Success Criteria

### UX

- [ ] New users can set up via wizard
- [ ] Statistics show reading habits
- [ ] Export works to JSON and CSV
- [ ] Keyboard navigation complete
- [ ] Screen reader accessible
- [x] Reduced motion respected through `Animations: None`, OS reduced motion, and reduced View Transition behavior
- [x] Command bar can trigger every major app action without a mouse

### AI

- [ ] Topic extraction works (at least one method)
- [ ] Summarization available for long content
- [x] AI settings in Freed Desktop start with a single provider choice that determines whether content stays local, goes to Ollama, or goes to a selected API provider, without selection flicker while preferences persist. The PWA hides AI controls because it cannot run those providers, downloads, or key storage paths.
- [x] Local content signals classify existing and newly ingested items without cloud AI on Desktop and PWA, with inclusive saved feed filter presets, saved sort controls, expanded semantic signals, and compact event metadata for high-confidence upcoming items
- [x] Optional local AI stays out of the installer, remains off by default, recommends Light, Balanced, or Pro from local hardware, stores pack selection plus model files in device-local state, and refreshes semantic scan health while settings is open
- [x] Friend suggestions consume local `contentSignals` and optional Integrated AI enrichment without adding a cloud prompt path or automatic friend promotion
- [ ] Smart notifications reduce noise

### Community

- [ ] Discord server active
- [ ] Bug bounty program published
- [ ] Regular release schedule established
- [x] Release automation permits only one dedicated selected-repository GitHub App to create the exact approved annotated tag through a root-owned native publisher, keeps tag updates and deletion without bypass, and fails closed on any identity, branch, receipt, installation, or digest mismatch
- [x] Local nightly improvement runner ranks preflight risks, duplicate peer work, peer worktree, bug fix, performance, stability, release, and roadmap targets before autonomous work begins, with strict machine preflight, runnable canonical task gating, an atomic task and target-scoped lease control plane, checked-in actor authority, owner-run general actor provisioning with deterministic ad hoc signed launchers, pinned root-owned runtimes, installed-launcher verification, zero-dialog unattended access, bounded acquire, heartbeat, and release acceptance, and short-lived handoff, plus pending outcome transactions, evidence-derived comparisons, full installed identity, process-identity collector locks, portable dual-source canary bundles, verified historical cohorts, versioned stability artifacts, a separate signed publisher handoff scaffold with fail-closed host readiness, provider-visible draft review gates, local soak pointer repair, typed preflight actions, dev-branch context checks, and unattended app-interaction continuation rules
- [ ] Documentation site live

### Resilience

- [x] On hard crash or unreachable JSON update bundle, a friendly recovery dialog is shown outside the React tree, auto-checks for updates immediately, offers in-place install and restart when available, and keeps a channel-aware browser download fallback for the latest installer
- [x] Desktop and PWA expose a shared bug report flow with public-safe bundles by default and private diagnostics as an explicit opt-in path
- [x] Shared bug report actions now reflect the selected bundle privacy tier, bulk-toggle private diagnostics, and disable public GitHub issue drafts while private artifacts are selected
- [x] Shared bug reports can submit redacted text and selected stack traces to the private GitHub vulnerability inbox after an explicit click, while keeping the diagnostic zip on the user's device and avoiding automatic retries
- [x] Settings keeps Support out of the primary section list and opens the existing report composer from a dedicated Support modal launched at the top of Danger Zone

---

## Deliverable

Polished, accessible app with AI-powered features and thriving community infrastructure.
