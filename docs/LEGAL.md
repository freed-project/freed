# Freed Legal and Risk Posture

## Purpose

This document describes the product and operational posture we are actually shipping.

It is not a substitute for counsel. It is the working map for how Freed reduces risk through product design, distribution choices, consent, and scope control.

## Current Distribution Model

Freed ships through:

- Direct desktop downloads from `freed.wtf`
- The PWA at `app.freed.wtf`

Freed does not assume distribution through major mobile or desktop app stores. That is deliberate. The app store path creates a second battlefield around review policies, platform authorization demands, and compliance claims that are not required for the current product strategy.

## Core Product Claims

Freed should consistently describe itself as:

- Local-first software
- Experimental software
- User-controlled software
- A reading and organization tool that may also connect to third-party services at the user's direction

Freed should not describe itself as:

- Safe for any account
- Undetectable
- Guaranteed compliant with third-party terms
- Protected from bans, lockouts, or other enforcement
- A managed service acting on the user's behalf on Freed-operated servers

If the copy starts sounding like a stealth scraper brochure, rewrite it.

## Public Legal Surface

The public legal stack consists of:

- Terms of Use for the website and PWA
- Desktop EULA
- Privacy Policy
- Experimental Risk Addendum

These documents are versioned and linked from:

- The site footer
- The website download modal
- The PWA first-run gate
- The Freed Desktop first-run gate
- The Legal section in settings

## Clickwrap and Consent

Freed relies on conspicuous notice plus affirmative assent.

Current implementation:

- Website download modal requires unchecked-by-default clickwrap before opening the PWA or downloading Freed Desktop
- PWA first launch is blocked behind a full-screen legal gate
- Freed Desktop first launch is blocked behind a full-screen legal gate
- X, Facebook, Instagram, and LinkedIn flows require separate provider-specific risk consent before login or sync actions

Acceptance records are stored locally only.

We do not centralize assent logs. That is a values choice and a product constraint. The app stores:

- document or provider version
- acceptance timestamp
- local surface where assent happened

No legal acceptance state is synced through Automerge or cloud backup. One device accepting terms must not silently bless another device.

## Risk Allocation Strategy

Freed reduces founder and operator exposure by making the user cross a real, explicit boundary before risky behavior begins.

The product must make these facts plain:

- Freed is experimental
- third-party services may retaliate
- the user decides whether to connect any account
- the user is responsible for the accounts and services they choose to use
- high-risk features should not be used with employer, client, school, newsroom, government, activist, or regulated accounts unless the user accepts that fallout personally

This is not about theatrical warning copy. It is about reducing confusion, avoiding misrepresentation, and creating a hard-to-miss consent moment before harm can happen.

## Product Safeguards

The software should continue to enforce the following defaults:

- risky features start disabled
- first-run legal gate blocks startup side effects
- provider consent is separate from general product consent
- consent changes are versioned, so material risk changes force reacceptance
- consent stays local to the device or browser
- settings expose the current accepted versions and legal documents

This keeps the contract surface honest and avoids surprise activation of risky behavior.

## Privacy Posture

Freed remains local-first.

That means:

- no central backend for sync or capture
- no telemetry for legal acceptance
- no synced legal state
- no hidden remote flags that silently change legal or risk behavior

If a future feature requires server-side state, it must be reviewed against this document before shipping. Quietly adding backend behavior that changes the privacy or legal story would be an own goal of biblical proportions.

## Third-Party Platform Posture

Freed should assume that some providers will dislike or prohibit automated or semi-automated behavior. The product response is not to promise safety. The product response is to:

- make the risk explicit
- require provider-specific consent
- avoid public copy that brags about bypassing detection
- avoid documentation that reads like an evasion manual

Internal and public docs should describe capabilities in neutral terms. Do not celebrate stealth, evasion, or ban avoidance. Those phrases are how tomorrow's opposing counsel buys lunch.

## What This Document Does Not Claim

This document does not claim:

- that Freed is lawful in every jurisdiction or under every platform contract
- that local-only architecture eliminates all risk
- that user clickwrap is a magic shield
- that users cannot still blame the product when things go sideways

It does claim that Freed is better protected when:

- risk is clearly disclosed
- assent is unavoidable
- claims are restrained
- risky flows are separately gated
- sensitive state stays local

## Practical Rules for Future Changes

Before shipping a feature that changes risk, check these questions:

1. Does it add a new third-party provider or a materially different enforcement risk?
2. Does it need its own provider risk version?
3. Does the first-run or provider-specific consent copy need updating?
4. Does the Privacy Policy need to describe new local or cloud data handling?
5. Does any public copy now overclaim safety, compliance, or stealth?

If the answer to any of those is yes, update the legal docs and the gate copy in the same change set.
