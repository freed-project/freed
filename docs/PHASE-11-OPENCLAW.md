# Phase 11: Power User Integrations (OpenClaw + Omi)

> **Status:** Future  
> **Dependencies:** Phase 2 (Capture layers), Phase 4 (Sync)

---

## Overview

Two power-user integrations that extend Freed beyond its Desktop App:

1. **OpenClaw** — Run capture headlessly on a server or always-on machine. No GUI required.
2. **[Omi](https://www.omi.me/)** — Ingest voice conversations, meeting summaries, and spoken notes from the Omi wearable AI as first-class Freed feed items.

**Who this is for:**

- OpenClaw users who want server-side, scheduled capture without launching the Desktop App
- Self-hosters who prefer CLI over GUI
- Omi wearers who want their spoken notes and meeting recaps surfaced alongside their social and RSS feeds in a single unified timeline

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Instance                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Skills                               │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │capture-x │ │capture-  │ │capture-  │ │ archive  │   │   │
│  │  │          │ │   rss    │ │   save   │ │          │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Automerge Document                       │   │
│  │                   (filesystem storage)                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┴───────────────┐                  │
│              ▼                               ▼                  │
│       Local Relay                      Cloud Backup             │
│       (for PWA sync)                   (GDrive/iCloud)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Skill Wrappers

Each capture layer has an OpenClaw skill wrapper.

### capture-x

```yaml
# skills/capture-x/SKILL.md
---
name: capture-x
description: Capture X/Twitter timeline
user-invocable: true
metadata:
  requires:
    bins: ["bun"]
---

# X Capture

Capture your X timeline to Freed.

## Commands

- `capture-x sync` - Capture latest timeline
- `capture-x status` - Show capture status
- `capture-x config` - Configure capture mode
```

### capture-rss

```yaml
# skills/capture-rss/SKILL.md
---
name: capture-rss
description: Sync RSS feeds
user-invocable: true
---

# RSS Capture

## Commands

- `capture-rss sync` - Sync all subscribed feeds
- `capture-rss add <url>` - Subscribe to feed
- `capture-rss list` - List subscriptions
- `capture-rss import <opml>` - Import OPML
```

---

## Scheduled Capture

Run captures on a schedule via OpenClaw's cron system.

```typescript
// skills/capture-scheduler/src/index.ts
export interface ScheduleConfig {
  jobs: {
    skill: string;
    cron: string;
    args?: string[];
  }[];
}

export async function scheduleCaptures(config: ScheduleConfig): Promise<void> {
  const jobs = [
    { skill: "capture-x", cron: "*/15 * * * *" }, // Every 15 min
    { skill: "capture-rss", cron: "*/30 * * * *" }, // Every 30 min
    { skill: "capture-save", cron: "0 * * * *" }, // Every hour
  ];

  for (const job of jobs) {
    await registerCronJob(job);
  }
}
```

---

## Custom Ranking Rules

Power users can define ranking rules in YAML.

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

  - name: "Boost long-form"
    condition:
      content_type: "article"
      word_count_min: 500
    boost: 20
```

```typescript
// packages/shared/src/ranking-rules.ts
import { parse } from "yaml";
import { FeedItem } from "./types";

export interface RankingRule {
  name: string;
  condition: RuleCondition;
  boost?: number;
  penalty?: number;
}

export function applyCustomRules(item: FeedItem, rules: RankingRule[]): number {
  let adjustment = 0;

  for (const rule of rules) {
    if (matchesCondition(item, rule.condition)) {
      adjustment += rule.boost ?? 0;
      adjustment -= rule.penalty ?? 0;
    }
  }

  return adjustment;
}
```

---

## Feed Archival

Automatically archive old items to keep the main document lean.

```typescript
// skills/archive/src/index.ts
export interface ArchiveConfig {
  maxAgeDays: number;
  preserveSaved: boolean;
  archivePath: string;
}

export async function archiveOldItems(
  doc: FreedDoc,
  config: ArchiveConfig
): Promise<{ archived: number }> {
  const cutoff = Date.now() - config.maxAgeDays * 24 * 60 * 60 * 1000;
  let archived = 0;

  for (const [id, item] of Object.entries(doc.feedItems)) {
    if (item.publishedAt < cutoff) {
      if (config.preserveSaved && item.userState.saved) {
        continue;
      }

      await appendToArchive(item, config.archivePath);
      delete doc.feedItems[id];
      archived++;
    }
  }

  return { archived };
}
```

```yaml
# skills/archive/SKILL.md
---
name: archive
description: Archive old feed items
---

# Archive

## Commands

- `archive run` - Archive items older than configured threshold
- `archive search <query>` - Search archived items
- `archive restore <id>` - Restore item from archive
```

---

## Omi Integration

[Omi](https://www.omi.me/) is a wearable AI that continuously listens and builds a personal memory bank. The Freed ↔ Omi integration is **bidirectional and intentional** — not a bulk sync. Two flows:

1. **Omi → Freed ("Hey Freed" wake word):** When the user says *"Hey Freed"* while wearing Omi, that utterance (and any transcribed context) is sent to Freed as a deliberate voice capture — a saved note in the user's library. Freed does not ingest ambient Omi memories.
2. **Freed → Omi (reading context as a memory source):** Freed registers as a data source in Omi's app, pushing a digest of what the user has been reading into Omi's memory banks so Omi can reference it during future conversations.

### Flow 1: "Hey Freed" Wake Word → Saved Note

Omi supports custom wake words and app integrations via its plugin/webhook system. When Omi detects "Hey Freed", it POSTs the transcript segment to a Freed webhook endpoint, which saves the note into the user's Automerge document.

```typescript
// packages/desktop/src/omi/webhook.ts
import type { FreedDoc } from "@freed/shared";
import * as A from "@automerge/automerge";

export interface OmiWebhookPayload {
  session_id: string;
  segments: { text: string; speaker: string; start: number; end: number }[];
  created_at: number;
}

/** Receives a "Hey Freed" trigger from Omi and saves the transcript as a note. */
export function handleOmiWakeWord(
  doc: FreedDoc,
  payload: OmiWebhookPayload
): FreedDoc {
  const text = payload.segments.map((s) => s.text).join(" ").trim();
  if (!text) return doc;

  return A.change(doc, (d) => {
    d.savedItems.push({
      globalId: `omi:${payload.session_id}`,
      savedAt: payload.created_at,
      source: "omi-voice",
      content: { text },
    });
  });
}
```

### Flow 2: Freed → Omi Reading Context

Freed registers as an Omi external data source. On a configurable schedule, it pushes a digest of recently read and saved items to Omi's memory API so Omi can reference what the user has been reading during future conversations.

```typescript
// packages/desktop/src/omi/reading-context.ts
import type { FeedItem } from "@freed/shared";

export interface OmiMemoryPayload {
  content: string;
  /** ISO 8601 */
  happened_at: string;
  structured?: { title: string; overview: string };
}

/** Builds a memory payload from recently read Freed items. */
export function buildReadingContextMemory(
  recentItems: FeedItem[]
): OmiMemoryPayload {
  const titles = recentItems
    .map((i) => i.content.linkPreview?.title ?? i.content.text?.slice(0, 80))
    .filter(Boolean)
    .slice(0, 10);

  return {
    content: `The user recently read: ${titles.join("; ")}`,
    happened_at: new Date().toISOString(),
    structured: {
      title: "Freed reading digest",
      overview: titles.join(", "),
    },
  };
}

export async function pushReadingContextToOmi(
  apiKey: string,
  payload: OmiMemoryPayload
): Promise<void> {
  const res = await fetch("https://api.omi.me/v1/memories", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Omi memory push failed: ${res.status}`);
}
```

---

## Tasks

### OpenClaw

| Task  | Description                    | Complexity |
| ----- | ------------------------------ | ---------- |
| 11.1  | Skill wrapper for capture-x    | Low        |
| 11.2  | Skill wrapper for capture-rss  | Low        |
| 11.3  | Skill wrapper for capture-save | Low        |
| 11.4  | Capture scheduler skill        | Medium     |
| 11.5  | Custom ranking rules parser    | Medium     |
| 11.6  | Ranking rules integration      | Medium     |
| 11.7  | Archive skill                  | Medium     |
| 11.8  | Archive search                 | Medium     |
| 11.9  | Local relay for PWA sync       | Medium     |
| 11.10 | Documentation for self-hosters | Low        |

### Omi

| Task  | Description                                                        | Complexity |
| ----- | ------------------------------------------------------------------ | ---------- |
| 11.11 | Omi webhook endpoint ("Hey Freed" → saved note)                    | Medium     |
| 11.12 | Automerge write for voice-captured saved items                     | Low        |
| 11.13 | Freed → Omi reading context push (memory API)                      | Medium     |
| 11.14 | Scheduled reading digest (configurable interval)                   | Low        |
| 11.15 | Omi app plugin / data-source registration                          | Medium     |
| 11.16 | Omi API key + webhook secret config in `~/.freed/config.json`      | Low        |
| 11.17 | Voice note card styling in feed (`source: "omi-voice"`)            | Low        |
| 11.18 | Documentation for Omi setup (wake word, data source, permissions)  | Low        |

---

## Success Criteria

### OpenClaw

- [ ] All capture layers have OpenClaw skill wrappers
- [ ] Scheduled captures run on cron
- [ ] Custom ranking rules load from YAML
- [ ] Archive skill prunes old items
- [ ] Archived items searchable
- [ ] PWA can sync to OpenClaw instance
- [ ] Self-hosting documentation complete

### Omi

- [ ] Saying "Hey Freed" on Omi triggers a webhook that saves the transcript as a note in the user's Freed library
- [ ] Voice-captured notes appear in the saved items view with `source: "omi-voice"` styling
- [ ] Freed pushes a reading context digest to Omi's memory API on a configurable schedule
- [ ] Freed appears as a registered data source in the Omi app
- [ ] API key and webhook secret configured via `~/.freed/config.json`
- [ ] Setup documentation covers wake word configuration, data source registration, and required permissions

---

## Deliverable

Full Freed functionality via OpenClaw CLI—no Desktop App required—plus a bidirectional Omi integration: "Hey Freed" voice captures land in your Freed library, and your Freed reading activity enriches Omi's personal memory banks.
