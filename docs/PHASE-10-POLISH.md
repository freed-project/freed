# Phase 10: Polish + OpenClaw Enhancements

> **Status:** Future  
> **Dependencies:** All previous phases

---

## Overview

Final polish, accessibility, and advanced features for power users.

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

## OpenClaw Enhancements

Advanced automation for power users who run OpenClaw.

### Scheduled Captures

```typescript
// skills/capture-scheduler/src/index.ts
export async function scheduleCaptures(config: ScheduleConfig): Promise<void> {
  const jobs = [
    { name: "X capture", cron: "*/15 * * * *", skill: "capture-x" },
    { name: "RSS sync", cron: "*/30 * * * *", skill: "capture-rss" },
  ];

  for (const job of jobs) {
    // Register with OpenClaw scheduler
  }
}
```

### Custom Ranking Rules

```yaml
# ~/.freed/ranking.yml
rules:
  - name: "Boost favorite authors"
    condition:
      author_handle:
        - "@favorite_author"
        - "@another_author"
    boost: 50

  - name: "Deprioritize promotional content"
    condition:
      content_contains:
        - "sponsored"
        - "ad"
        - "promo"
    penalty: 30
```

### Feed Archival

```typescript
// skills/archive/src/index.ts
export async function archiveOldItems(
  doc: FreedDoc,
  config: ArchiveConfig,
): Promise<void> {
  const cutoff = Date.now() - config.maxAgeDays * 24 * 60 * 60 * 1000;

  for (const [id, item] of Object.entries(doc.feedItems)) {
    if (item.publishedAt < cutoff && !item.userState.saved) {
      // Move to archive
      await archiveItem(item);
      delete doc.feedItems[id];
    }
  }
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

## Tasks

| Task  | Description                 | Complexity |
| ----- | --------------------------- | ---------- |
| 10.1  | Onboarding wizard           | Medium     |
| 10.2  | Statistics dashboard        | Medium     |
| 10.3  | Export to JSON              | Low        |
| 10.4  | Export to CSV               | Low        |
| 10.5  | Keyboard shortcuts          | Medium     |
| 10.6  | Screen reader support       | Medium     |
| 10.7  | Reduced motion support      | Low        |
| 10.8  | Color contrast audit        | Low        |
| 10.9  | OpenClaw scheduled captures | Medium     |
| 10.10 | Custom ranking rules        | High       |
| 10.11 | Feed archival automation    | Medium     |
| 10.12 | Native Liquid Glass buttons | High       |

---

## Success Criteria

- [ ] New users can set up via wizard
- [ ] Statistics show reading habits
- [ ] Export works to JSON and CSV
- [ ] Keyboard navigation complete
- [ ] Screen reader accessible
- [ ] Reduced motion respected
- [ ] OpenClaw power features work

---

## Deliverable

Polished, accessible app with power user features for OpenClaw users.
