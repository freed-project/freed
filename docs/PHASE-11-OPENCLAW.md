# Phase 11: OpenClaw Integration

> **Status:** Future  
> **Dependencies:** Phase 2 (Capture layers), Phase 4 (Sync)

---

## Overview

Headless capture for power users. Run FREED without the Desktop App—just OpenClaw on a server or always-on machine.

**Who this is for:**
- Users who already run OpenClaw
- Self-hosters who want server-side capture
- Power users who prefer CLI over GUI

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

Capture your X timeline to FREED.

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
    { skill: "capture-x", cron: "*/15 * * * *" },      // Every 15 min
    { skill: "capture-rss", cron: "*/30 * * * *" },    // Every 30 min
    { skill: "capture-save", cron: "0 * * * *" },      // Every hour
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

export function applyCustomRules(
  item: FeedItem,
  rules: RankingRule[]
): number {
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

## Tasks

| Task | Description | Complexity |
|------|-------------|------------|
| 11.1 | Skill wrapper for capture-x | Low |
| 11.2 | Skill wrapper for capture-rss | Low |
| 11.3 | Skill wrapper for capture-save | Low |
| 11.4 | Capture scheduler skill | Medium |
| 11.5 | Custom ranking rules parser | Medium |
| 11.6 | Ranking rules integration | Medium |
| 11.7 | Archive skill | Medium |
| 11.8 | Archive search | Medium |
| 11.9 | Local relay for PWA sync | Medium |
| 11.10 | Documentation for self-hosters | Low |

---

## Success Criteria

- [ ] All capture layers have OpenClaw skill wrappers
- [ ] Scheduled captures run on cron
- [ ] Custom ranking rules load from YAML
- [ ] Archive skill prunes old items
- [ ] Archived items searchable
- [ ] PWA can sync to OpenClaw instance
- [ ] Self-hosting documentation complete

---

## Deliverable

Full FREED functionality via OpenClaw CLI—no Desktop App required.
