# Phase 10: Polish

> **Status:** Future  
> **Dependencies:** All previous phases

---

## Overview

Final polish, accessibility, UX refinements, AI-powered features, and community infrastructure.

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

### Keyboard Shortcuts

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

```css
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

| Severity | Reward |
|----------|--------|
| Critical (data exposure, RCE) | $500–$2000 |
| High (auth bypass, XSS) | $100–$500 |
| Medium (info disclosure) | $50–$100 |
| Low (minor issues) | Recognition |

### Release Cadence

- **Weekly** — Patch releases (bug fixes)
- **Monthly** — Minor releases (new features)
- **Quarterly** — Major releases (breaking changes, if any)

---

## Tasks

### UX Polish

| Task | Description | Complexity |
|------|-------------|------------|
| 10.1 | Onboarding wizard | Medium |
| 10.2 | Statistics dashboard | Medium |
| 10.3 | Export to JSON | Low |
| 10.4 | Export to CSV | Low |
| 10.5 | Keyboard shortcuts | Medium |
| 10.6 | Screen reader support | Medium |
| 10.7 | Reduced motion support | Low |
| 10.8 | Color contrast audit | Low |
| 10.9 | Native Liquid Glass buttons | High |

### AI Features

| Task | Description | Complexity |
|------|-------------|------------|
| 10.10 | Topic extraction (local) | High |
| 10.11 | Topic extraction (API) | Medium |
| 10.12 | Content summarization | High |
| 10.13 | Sentiment analysis | Medium |
| 10.14 | Smart notifications | High |
| 10.15 | AI settings UI | Medium |

### Extensibility

| Task | Description | Complexity |
|------|-------------|------------|
| 10.16 | Plugin API design | High |
| 10.17 | Plugin loader | High |
| 10.18 | Plugin documentation | Medium |

### Community

| Task | Description | Complexity |
|------|-------------|------------|
| 10.19 | Discord server setup | Low |
| 10.20 | Bug bounty program | Medium |
| 10.21 | Release automation | Medium |
| 10.22 | Documentation site | Medium |

---

## Success Criteria

### UX
- [ ] New users can set up via wizard
- [ ] Statistics show reading habits
- [ ] Export works to JSON and CSV
- [ ] Keyboard navigation complete
- [ ] Screen reader accessible
- [ ] Reduced motion respected

### AI
- [ ] Topic extraction works (at least one method)
- [ ] Summarization available for long content
- [ ] Smart notifications reduce noise

### Community
- [ ] Discord server active
- [ ] Bug bounty program published
- [ ] Regular release schedule established
- [ ] Documentation site live

---

## Deliverable

Polished, accessible app with AI-powered features and thriving community infrastructure.
