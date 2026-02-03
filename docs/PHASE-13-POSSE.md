# Phase 13: POSSE Integration

> **Status:** Future  
> **Dependencies:** Phase 6 (PWA Reader), Phase 11 (OpenClaw)

---

## Overview

POSSE = "Publish (on your) Own Site, Syndicate Everywhere"

Freed handles consumption. [POSSE Party](https://posseparty.com/) handles publishing. Together, they complete the digital sovereignty loop—read AND write on your terms.

---

## Why This Matters

- **Complete sovereignty** — Control both consumption (Freed) and publishing (POSSE)
- **Your content, your domain** — Posts live on your site first, then syndicate to platforms
- **Platform resilience** — If platforms die or ban you, your content survives
- **IndieWeb alignment** — Participates in the open web ecosystem

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Freed + POSSE                             │
│                                                                 │
│  1. Read unified feed in Freed                                  │
│                    │                                            │
│                    ▼                                            │
│  2. Want to reply/post? Compose in Freed                        │
│                    │                                            │
│                    ▼                                            │
│  3. Freed sends to your POSSE instance                          │
│                    │                                            │
│                    ▼                                            │
│  4. POSSE publishes to your site + syndicates to platforms      │
│                    │                                            │
│                    ▼                                            │
│  5. Your content lives on YOUR domain first                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Freed PWA                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Compose Modal                         │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ What's on your mind?                            │    │   │
│  │  │                                                 │    │   │
│  │  │ [Text input with markdown support]              │    │   │
│  │  │                                                 │    │   │
│  │  │ Reply to: @user's post about...                 │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  │                                                          │   │
│  │  Syndicate to: [x] X  [x] Mastodon  [ ] Threads         │   │
│  │                                                          │   │
│  │  [Post to your site]                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│                    ┌──────────────┐                             │
│                    │  POSSE API   │                             │
│                    └──────────────┘                             │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│         Your Site           X           Mastodon                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Implementation

### Compose Feature

```tsx
// packages/pwa/src/components/compose/ComposeModal.tsx
import { useState } from "react";
import { usePosseConnection } from "../../hooks/usePosseConnection";

interface ComposeProps {
  replyTo?: FeedItem;
  onClose: () => void;
}

export function ComposeModal({ replyTo, onClose }: ComposeProps) {
  const [content, setContent] = useState("");
  const [syndicateTo, setSyndicateTo] = useState<Platform[]>(["x"]);
  const { publish, isConnected } = usePosseConnection();

  const handlePublish = async () => {
    await publish({
      content,
      replyTo: replyTo?.globalId,
      syndicateTo,
    });
    onClose();
  };

  return (
    <div className="compose-modal">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What's on your mind?"
      />

      {replyTo && (
        <div className="reply-context">
          Replying to {replyTo.author.displayName}
        </div>
      )}

      <SyndicationOptions selected={syndicateTo} onChange={setSyndicateTo} />

      <button onClick={handlePublish} disabled={!isConnected}>
        Post to your site
      </button>
    </div>
  );
}
```

### POSSE Connection

```typescript
// packages/pwa/src/lib/posse.ts
export interface PosseConfig {
  endpoint: string; // User's POSSE instance URL
  apiKey: string; // Authentication token
}

export interface PublishRequest {
  content: string;
  replyTo?: string;
  syndicateTo: Platform[];
}

export async function publishToPosse(
  config: PosseConfig,
  request: PublishRequest
): Promise<PublishResult> {
  const response = await fetch(`${config.endpoint}/api/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  return response.json();
}
```

### Reply Threading

```typescript
// packages/pwa/src/lib/posse-replies.ts
export function buildReplyContext(item: FeedItem): ReplyContext {
  // Extract platform-specific reply metadata
  switch (item.platform) {
    case "x":
      return {
        platform: "x",
        inReplyTo: item.globalId.replace("x:", ""),
        originalUrl: `https://x.com/i/status/${item.globalId.replace(
          "x:",
          ""
        )}`,
      };
    case "mastodon":
      return {
        platform: "mastodon",
        inReplyTo: item.rssSource?.originalId,
        originalUrl: item.content.linkPreview?.url,
      };
    default:
      return { platform: item.platform };
  }
}
```

---

## Settings

```tsx
// packages/pwa/src/components/settings/PosseSettings.tsx
export function PosseSettings() {
  const [config, setConfig] = usePreference("posse");

  return (
    <div className="settings-section">
      <h3>POSSE Integration</h3>
      <p>Connect to your POSSE Party instance for publishing.</p>

      <label>
        POSSE Endpoint
        <input
          type="url"
          value={config.endpoint}
          onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
          placeholder="https://your-site.com/posse"
        />
      </label>

      <label>
        API Key
        <input
          type="password"
          value={config.apiKey}
          onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
        />
      </label>

      <button onClick={testConnection}>Test Connection</button>
    </div>
  );
}
```

---

## Tasks

| Task  | Description                             | Complexity |
| ----- | --------------------------------------- | ---------- |
| 13.1  | Research POSSE Party API/protocol       | Medium     |
| 13.2  | POSSE connection settings UI            | Low        |
| 13.3  | Compose modal component                 | Medium     |
| 13.4  | Markdown support in compose             | Low        |
| 13.5  | Syndication target selection            | Low        |
| 13.6  | Reply-to-post context extraction        | Medium     |
| 13.7  | POSSE API integration                   | Medium     |
| 13.8  | Error handling and retry logic          | Medium     |
| 13.9  | Inline reply action on feed items       | Low        |
| 13.10 | Posted indicator (synced back to Freed) | Medium     |

---

## Success Criteria

- [ ] POSSE connection configurable in settings
- [ ] Compose modal accessible from PWA
- [ ] Posts publish to user's POSSE instance
- [ ] Syndication targets selectable per post
- [ ] Reply context passed correctly to POSSE
- [ ] Posted content appears in user's Freed feed (via RSS)
- [ ] Error states handled gracefully

---

## Future Enhancements

- **Lightweight bundled POSSE** — For users without existing POSSE setup
- **Webmention support** — Receive replies from the IndieWeb
- **Micropub compatibility** — Standard protocol for posting
- **Draft sync** — Save drafts to Automerge document

---

## Dependencies

```json
{
  "dependencies": {
    "@freed/shared": "*",
    "@freed/pwa": "*"
  }
}
```

---

## Deliverable

Compose and publish feature in Freed PWA that routes through user's POSSE instance for true digital sovereignty.
