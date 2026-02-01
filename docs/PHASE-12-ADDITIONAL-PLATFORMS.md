# Phase 12: Additional Platforms

> **Status:** Future  
> **Dependencies:** Phase 5 (Desktop App), Phase 7 (Facebook/Instagram patterns)

---

## Overview

Expand capture to more walled gardens. Each platform gets its own capture layer package, following the patterns established in Phase 7.

---

## Packages

### `@freed/capture-linkedin`

Professional network posts and articles.

```
packages/capture-linkedin/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Challenges:**
- LinkedIn aggressively blocks automation
- Session management more complex than other platforms
- May require browser profile approach rather than cookies

---

### `@freed/capture-tiktok`

Short-form video feed.

```
packages/capture-tiktok/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Challenges:**
- Heavy anti-bot measures
- Video-first content doesn't fit text-based FeedItem as well
- May need different capture strategy (API if available, or accept limitations)

---

### `@freed/capture-threads`

Meta's Twitter competitor.

```
packages/capture-threads/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Approach TBD:**
- May have RSS support by then
- Shares infrastructure with Instagram (same Meta ecosystem)
- Could potentially reuse Instagram session

---

## Tasks

| Task | Description | Complexity |
|------|-------------|------------|
| 11.1 | `@freed/capture-linkedin` package scaffold | Low |
| 11.2 | LinkedIn DOM selectors | High |
| 11.3 | LinkedIn session management | High |
| 11.4 | `@freed/capture-tiktok` package scaffold | Low |
| 11.5 | TikTok capture strategy research | High |
| 11.6 | `@freed/capture-threads` package scaffold | Low |
| 11.7 | Threads capture (likely similar to Instagram) | Medium |

---

## Success Criteria

- [ ] LinkedIn feed posts captured to FeedItem
- [ ] TikTok feed captured (video metadata at minimum)
- [ ] Threads posts captured to FeedItem
- [ ] Each platform handles its own rate limiting
- [ ] Selector maintenance strategy per platform

---

## Notes

- Feasibility varies by platform—some may prove impractical
- Each capture layer should fail gracefully without breaking others
- Consider community contributions for selector maintenance
