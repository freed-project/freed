# Freed Legal Framework

## Overview

Freed is open-source software that runs entirely in the user's browser. We have no servers, collect no data, and operate similarly to ad blockers and other browser customization tools.

---

## Legal Posture

### What Freed Does

- Runs as a browser extension in the user's own authenticated session
- Reads DOM content that the user already has access to
- Stores all captured data locally on the user's device
- Provides a unified view of the user's own social media content

### What Freed Does NOT Do

- Operate servers that scrape platforms
- Collect, aggregate, or sell user data
- Circumvent authentication or access controls
- Bypass technical protection measures (DMCA 1201)
- Access data the user isn't already authorized to see

---

## Relevant Legal Precedents

### Van Buren v. United States (2021)

The U.S. Supreme Court narrowed the Computer Fraud and Abuse Act (CFAA), ruling that violating a website's terms of service while having authorized access does not constitute a federal crime. This is significant because users of Freed have authorized access to their own social media accounts.

### hiQ Labs v. LinkedIn (2022)

The 9th Circuit Court of Appeals affirmed that scraping publicly available data does not violate the CFAA. Freed's position is even stronger because users are accessing their own private data from their own authenticated sessions.

---

## Terms of Service Considerations

Most social media platforms prohibit automated data collection in their Terms of Service. However:

1. **ToS violations are civil matters**, not criminal
2. **Van Buren** clarified that ToS violations with authorized access aren't CFAA violations
3. **Freed operates client-side**, similar to:
   - Ad blockers (uBlock Origin, AdBlock Plus)
   - Feed customizers (Social Fixer)
   - Browser developer tools
   - User scripts (Greasemonkey, Tampermonkey)

These tools have existed for years without legal extinction, despite modifying how users interact with platforms.

---

## Privacy Principles

### Local-First Architecture

All data captured by Freed stays on the user's device:

- Stored in browser's IndexedDB
- Never transmitted to any server we operate
- We have no servers to transmit to

### Zero Telemetry

Freed contains no analytics, tracking, or phone-home functionality:

- No usage statistics
- No error reporting to us
- No feature flags or remote configuration
- Fully air-gapped from any backend

### User-Controlled Sync

If users choose to back up their data:

- Backup goes to the user's own cloud storage (Google Drive, iCloud, Dropbox)
- Data is encrypted with a user-provided passphrase
- We never see, touch, or have access to the encrypted backup

### Open Source Transparency

Every line of Freed's code is public:

- MIT licensed
- Auditable by anyone
- No hidden functionality

---

## Risk Assessment

### Cease & Desist Letters

**Risk Level:** Low to Medium

Platforms may send C&D letters to open-source projects. However:

- Freed is a tool, not a service
- Individual developers are rarely worth legal pursuit
- No commercial activity to seek damages from
- Community and potential EFF interest as defense

### Actual Lawsuits

**Risk Level:** Very Low

Platforms focus legal resources on:

- Commercial data brokers
- Large-scale scraping operations
- Political manipulation campaigns
- AI training data companies

An open-source browser extension with no monetization is noise in their threat model.

### Criminal Prosecution

**Risk Level:** Essentially Zero

Post-Van Buren, accessing data from your own authenticated session is not a federal crime, regardless of ToS violations.

---

## Mitigations

### Technical

- All data stays local
- No server infrastructure
- No data aggregation
- Open source for transparency

### Legal

- Clear documentation of privacy-first design
- Terms of Use disclaiming responsibility for ToS compliance
- No commercial entity or monetization
- Individual hobby project status

### Communication

- Frame Freed as user empowerment, not platform attack
- Emphasize privacy and digital dignity
- Avoid antagonistic publicity
- Build community goodwill

---

## For Users

### Your Responsibility

By using Freed, you acknowledge:

- You may be violating platform Terms of Service
- Platforms could theoretically suspend your account
- Freed is provided "as is" without warranty
- You use Freed at your own discretion

### Our Commitment

We commit to:

- Never collecting your data
- Maintaining open-source transparency
- Respecting your privacy absolutely
- Building tools for user empowerment

---

## License

Freed is released under the MIT License:

```
MIT License

Copyright (c) 2026 Freed Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Contact

For legal inquiries, contact: [TBD]

For general questions, open an issue on GitHub.
