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

## Test runtime

The suite runs the Desktop React app in Chromium without launching a Tauri
binary. The Playwright web server sets `VITE_TEST_TAURI=1`, which aliases each
`@tauri-apps/*` import to the thin modules under
`packages/desktop/src/__mocks__/@tauri-apps/`.

Import `test` and `expect` from `./fixtures/app`, not directly from
`@playwright/test`:

```ts
import { test, expect } from "./fixtures/app";

test("renders the expected state", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("main")).toBeVisible();
});
```

The shared `app` fixture injects `tauriInitScript()` with
`page.addInitScript()` before application JavaScript runs. That script installs
`window.__TAURI_INTERNALS__`, default IPC handlers, and the mock state used at
startup. A test that creates its own page setup must inject `tauriInitScript()`
first and must do so before `page.goto()`.

## Running the suite

Run Desktop commands from `packages/desktop/`:

```bash
npm run test:e2e
```

The standard command starts and stops its Vite server automatically and runs
headless. `npm run test:e2e:ui` and `npm run test:e2e:debug` open external
browser surfaces, so use them only when the owner explicitly requests that
surface.

## Test-specific state and assertions

Override an IPC command after fixture injection with `ipc.setHandler()`. Use
`ipc.invocations()` to inspect recorded command calls and `ipc.openedUrls()` to
inspect URLs passed to the shell plugin.

State that must exist before application startup belongs in another init
script registered before navigation. For example, updater tests set
`window.__TAURI_MOCK_UPDATE__` before `app.goto()`:

```ts
await app.page.addInitScript(() => {
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
    version: "2.0.0",
  };
});
await app.goto();
```

The process plugin has its own module mock at
`src/__mocks__/@tauri-apps/plugin-process/index.ts`. Update that mock when a
test depends on changed relaunch or exit behavior instead of inventing an IPC
handler for a module-level plugin call.

## Keeping IPC mocks complete

When the app starts invoking a new Tauri command, add a safe default response
in both places:

1. `tests/e2e/fixtures/tauri-init.ts`, inside the object assigned to
   `window.__TAURI_MOCK_HANDLERS__`. This is the reliable pre-page path used by
   the Playwright fixture.
2. `src/__mocks__/@tauri-apps/api/core.ts`, inside its `handlers` map. This is
   the Vite module-alias path.

These paths are complementary. Keep their defaults semantically aligned so a
test does not pass or fail merely because it entered the mock boundary through
a different route.

## Permanent E2E Tests

Keep a Playwright test when it protects one of these surfaces:

- Startup, legal gate, crash recovery, updater, or renderer health.
- A complete user workflow across visible React state, bounded SQLite queries,
  and the Tauri mock boundary.
- Provider auth, sync, pause, reconnect, or diagnostics behavior that cannot be
  proved with a unit test.
- Reader hydration, navigation history, read state, social memory, Friends, Map,
  and graph behavior that crosses multiple components.
- A deterministic performance contract for bounded work, allocation, residency,
  rebuilds, or output that must block every dev build.

Raw elapsed time, animation-frame rate, LongTask entries, heap demand, and GPU
timing from virtualized browsers are telemetry. Browser and graphics backend
upgrades can change those readings without changing Freed. Collect them in the
nightly lane with exact browser, renderer, and hardware context. Never treat
unsupported instrumentation as zero work.

`npm run test:e2e:perf:friends` runs the blocking Friends work contract.
`npm run test:e2e:perf:friends:telemetry` runs the same interaction and records
nonblocking timing telemetry.

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
