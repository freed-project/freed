# FREED Development Roadmap

## Vision

FREED exists to restore mental sovereignty in the attention economy. We're building tools that put humans back in control of their digital lives—starting with social media feeds, expanding to wherever algorithmic manipulation threatens human autonomy.

---

## Phase 0: Marketing Site ✓

**Status:** In Progress

**Deliverables:**
- [x] freed.wtf landing page
- [x] Manifesto page
- [x] Glowmorphic design system
- [x] GitHub Pages deployment
- [ ] OG images for social sharing
- [ ] Final copy polish

**Tech:** Vite + React + Tailwind + Framer Motion

---

## Phase 1: Foundation

**Status:** Pending

**Deliverables:**
- [ ] Bun monorepo setup with workspaces
- [ ] Shared types package (`@freed/shared`)
- [ ] Automerge document schema
- [ ] Basic Chrome extension scaffold
- [ ] Basic PWA scaffold
- [ ] CI/CD pipeline

**Tech:** Bun workspaces, Vite, CRXJS, Automerge

---

## Phase 2: X Capture

**Status:** Pending

**Deliverables:**
- [ ] X content script with MutationObserver
- [ ] Tweet extraction and normalization
- [ ] Deduplication logic
- [ ] Store to Automerge document
- [ ] Display captured tweets in PWA
- [ ] Basic recency-based ranking

---

## Phase 3: Facebook + Instagram + Stories

**Status:** Pending

**Deliverables:**
- [ ] Facebook content script (posts)
- [ ] Facebook stories capture
- [ ] Instagram content script (posts)
- [ ] Instagram stories capture
- [ ] Unified multi-platform feed display
- [ ] Content type filtering (posts vs stories)

---

## Phase 4: Location Extraction + Friend Map

**Status:** Pending

**Deliverables:**
- [ ] Location extraction from geo-tags
- [ ] Location extraction from stickers
- [ ] Text-based location extraction
- [ ] Nominatim geocoding integration
- [ ] Geocoding cache layer
- [ ] Friend Map UI with react-maplibre
- [ ] Recency indicators (color-coded pins)
- [ ] Location popup with source post
- [ ] Time range filtering

---

## Phase 5: Sync Layer

**Status:** Pending

**Deliverables:**
- [ ] Automerge integration in extension + PWA
- [ ] WebRTC peer discovery
- [ ] P2P sync protocol
- [ ] Sync status UI
- [ ] Google Drive backup integration
- [ ] Encrypted backup with user passphrase
- [ ] Backup restore flow

---

## Phase 6: Safari iOS + Firefox Android

**Status:** Pending

**Deliverables:**
- [ ] Safari Web Extension packaging
- [ ] Apple Developer account setup
- [ ] Safari App Store submission
- [ ] Firefox Android extension
- [ ] Firefox Add-ons submission
- [ ] Mobile browser capture testing

---

## Phase 7: Ulysses Mode

**Status:** Pending

**Deliverables:**
- [ ] Feed detection by URL patterns
- [ ] Block overlay UI
- [ ] Redirect to FREED PWA
- [ ] Allowed paths configuration
- [ ] Per-platform settings
- [ ] Ulysses Mode toggle in settings

---

## Phase 8: Polish

**Status:** Pending

**Deliverables:**
- [ ] Onboarding wizard
- [ ] Settings UI
- [ ] Statistics dashboard
- [ ] Export functionality (JSON, CSV)
- [ ] Keyboard shortcuts
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] Documentation site

---

## Phase 9: Native Mobile (Tauri)

**Status:** Future

**Deliverables:**
- [ ] Tauri 2.0 project setup
- [ ] iOS build configuration
- [ ] Android build configuration
- [ ] Shared React components
- [ ] Native sync integration
- [ ] App Store submission
- [ ] Play Store submission

---

## Phase 10: POSSE Integration

**Status:** Future

POSSE = "Publish (on your) Own Site, Syndicate Everywhere"

FREED handles consumption. [POSSE Party](https://posseparty.com/) handles publishing. Together, they complete the digital sovereignty loop.

**Integration Approach:**
- [ ] Research POSSE Party API/protocol
- [ ] Build "Compose" feature in FREED PWA
- [ ] Connect to user's POSSE instance for cross-posting
- [ ] Reply-to-post flows that route through POSSE
- [ ] Optional: Bundle lightweight POSSE functionality

**User Flow:**
1. Read unified feed in FREED
2. Want to reply/post? Compose in FREED
3. FREED sends to your POSSE instance
4. POSSE publishes to your site + syndicates to platforms
5. Your content lives on YOUR domain first

**Why This Matters:**
- Complete the sovereignty loop (read AND write on your terms)
- Your content exists on your domain, not just platform servers
- If platforms die/ban you, your content survives
- Aligns with IndieWeb principles

---

## Future Considerations

### Platform Expansion
- Reddit
- LinkedIn
- YouTube
- TikTok (if browser-accessible)
- Threads
- Bluesky
- Mastodon

### Features
- AI-powered topic extraction
- Sentiment analysis
- Content summarization
- Smart notifications
- Collaborative filtering (opt-in)
- Plugin/extension API
- POSSE Party deep integration

### Community
- Discord server
- Contributor documentation
- Bug bounty program
- Regular release cadence

---

## Success Metrics

### Adoption
- Browser extension installs
- GitHub stars
- Active users (self-reported, no telemetry)

### Community Health
- GitHub contributors
- Issues resolved
- Feature requests addressed

### Impact
- User testimonials
- Media coverage
- Platform responses (if any)

---

## Contributing

FREED is open source under MIT license. We welcome contributions of all kinds:

- **Code:** Bug fixes, features, optimizations
- **Design:** UI improvements, illustrations
- **Documentation:** Guides, translations
- **Testing:** Bug reports, platform-specific testing
- **Advocacy:** Spreading the word, community building

See CONTRIBUTING.md for guidelines.
