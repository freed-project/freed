# Desktop E2E Test Policy

Desktop E2E tests are for release risk, not for preserving every measurement an
agent used while tuning a layout.

## Audit Result

The May 2026 audit found that the desktop suite had `190` Playwright tests, with
`smoke.spec.ts` carrying `90` tests and more than `6,000` lines. Many of those
tests were duplicate startup assertions, fixture self-tests, provider-specific
copies of the same unauthenticated button check, or exact toolbar and sidebar
geometry probes.

The permanent suite was trimmed to keep functional flows and measured
performance budgets. Removed tests should stay removed unless the behavior is
converted into a durable user-flow assertion or an explicit visual snapshot.

## Permanent E2E Tests

Keep a Playwright test when it protects one of these surfaces:

- Startup, legal gate, crash recovery, updater, or renderer health.
- A complete user workflow across React state, Automerge state, and the Tauri
  mock boundary.
- Provider auth, sync, pause, reconnect, or diagnostics behavior that cannot be
  proved with a unit test.
- Reader hydration, navigation history, read state, social memory, Friends, Map,
  and graph behavior that crosses multiple components.
- A performance budget that must block every dev build.

## Temporary Agent Tests

Delete temporary tests before publishing the PR when they were only used to
guide one feature implementation. Common examples:

- Exact pixel offsets, widths, gaps, colors, shadows, or padding.
- One-off toolbar geometry probes.
- Fixture or mock self-tests that are already exercised by real workflows.
- Duplicate "button exists" checks for each provider when one provider flow plus
  unit coverage proves the contract.

If a visual layout risk is important enough to keep, turn it into either a
functional assertion or an explicit visual test. Do not hide layout archaeology
inside `smoke.spec.ts`.

## Required Build Lanes

Every dev build runs these desktop browser lanes:

- `test:e2e:smoke`: tiny startup and critical-path check.
- `test:e2e:regression`: broad functional user flows.
- `test:e2e:perf`: feed and graph performance budgets.
- `test:e2e:visual`: maintained visual snapshots and map theme rendering.

Production validation builds on the dev gate instead of re-running the same
browser tests under new names.
