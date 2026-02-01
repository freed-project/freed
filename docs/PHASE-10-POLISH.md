# Phase 10: Polish

> **Status:** Future  
> **Dependencies:** All previous phases

---

## Overview

Final polish, accessibility, and UX refinements.

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

## Tasks

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

---

## Success Criteria

- [ ] New users can set up via wizard
- [ ] Statistics show reading habits
- [ ] Export works to JSON and CSV
- [ ] Keyboard navigation complete
- [ ] Screen reader accessible
- [ ] Reduced motion respected

---

## Deliverable

Polished, accessible app.
