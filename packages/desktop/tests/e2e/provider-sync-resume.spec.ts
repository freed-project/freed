import { test, expect } from "./fixtures/app";

test("desktop resume and a hidden native deadline each coalesce one due opportunity", async ({
  app,
  page,
  ipc,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:legal.json",
      JSON.stringify({
        "legal.bundle.desktop": {
          version: "2026-03-31.1",
          acceptedAt: 1775146800000,
          surface: "desktop-first-run",
        },
        "legal.provider.facebook": {
          version: "2026-03-31-facebook",
          acceptedAt: 1775146800000,
          surface: "desktop-provider-facebook",
        },
      }),
    );
  });
  await app.goto();
  await app.waitForReady();

  await expect
    .poll(async () =>
      (await ipc.invocations()).some(
        (call) => call.cmd === "get_background_runtime_active_operation",
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const globalKey = "freed-device-provider-sync-global-v1";
    window.localStorage.setItem(
      globalKey,
      JSON.stringify({ version: 1, config: { automaticEnabled: true } }),
    );

    const recordKey = "freed-device-provider-sync-state-v2:facebook";
    const raw = window.localStorage.getItem(recordKey);
    if (!raw) throw new Error("Facebook provider schedule was not initialized");
    const value = JSON.parse(raw) as {
      version: number;
      record: Record<string, unknown>;
    };
    value.record = {
      ...value.record,
      phase: "waiting",
      automaticPaused: false,
      activationAt: Date.now() - 2_000,
      nextDueAt: Date.now() - 1_000,
    };
    delete value.record.attempt;
    delete value.record.localEligibilityRetryAt;
    window.localStorage.setItem(recordKey, JSON.stringify(value));
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const listeners = (window as unknown as Record<string, unknown>)
          .__TAURI_EVENT_LISTENERS__ as
          | Record<string, Array<(event: { payload: unknown }) => void>>
          | undefined;
        return listeners?.["tauri://resume"]?.length ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  await page.evaluate(() => {
    const testWindow = window as unknown as Record<string, unknown>;
    const listeners = testWindow.__TAURI_EVENT_LISTENERS__ as Record<
      string,
      Array<(event: { payload: unknown }) => void>
    >;
    for (let opportunity = 0; opportunity < 2; opportunity += 1) {
      for (const listener of listeners["tauri://resume"] ?? []) {
        listener({ payload: null });
      }
    }
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem(
          "freed-device-provider-sync-state-v2:facebook",
        );
        if (!raw) return null;
        const value = JSON.parse(raw) as {
          record: {
            phase: string;
            lastOutcome?: string;
            lastAttemptStartedAt?: number;
            nextDueAt: number;
          };
        };
        return {
          phase: value.record.phase,
          lastOutcome: value.record.lastOutcome,
          hasAttemptTimestamp:
            typeof value.record.lastAttemptStartedAt === "number",
          nextDueIsFuture: value.record.nextDueAt > Date.now(),
        };
      }),
    )
    .toEqual({
      phase: "settled",
      lastOutcome: "ignored",
      hasAttemptTimestamp: true,
      nextDueIsFuture: true,
    });

  const firstAttemptStartedAt = await page.evaluate(() => {
    const raw = window.localStorage.getItem(
      "freed-device-provider-sync-state-v2:facebook",
    );
    if (!raw) throw new Error("Facebook provider schedule disappeared");
    return (JSON.parse(raw) as {
      record: { lastAttemptStartedAt: number };
    }).record.lastAttemptStartedAt;
  });

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const recordKey = "freed-device-provider-sync-state-v2:facebook";
    const raw = window.localStorage.getItem(recordKey);
    if (!raw) throw new Error("Facebook provider schedule disappeared");
    const value = JSON.parse(raw) as {
      record: Record<string, unknown>;
    };
    value.record = {
      ...value.record,
      phase: "waiting",
      activationAt: Date.now() - 2_000,
      nextDueAt: Date.now() - 1_000,
    };
    delete value.record.attempt;
    delete value.record.localEligibilityRetryAt;
    window.localStorage.setItem(recordKey, JSON.stringify(value));
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const listeners = (window as unknown as Record<string, unknown>)
          .__TAURI_EVENT_LISTENERS__ as
          | Record<string, Array<(event: { payload: unknown }) => void>>
          | undefined;
        return listeners?.["provider-schedule-native-wake"]?.length ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  await page.evaluate(() => {
    const listeners = (window as unknown as Record<string, unknown>)
      .__TAURI_EVENT_LISTENERS__ as Record<
      string,
      Array<(event: { payload: unknown }) => void>
    >;
    for (let opportunity = 0; opportunity < 2; opportunity += 1) {
      for (const listener of listeners["provider-schedule-native-wake"] ?? []) {
        listener({ payload: { provider: "facebook" } });
      }
    }
  });

  await expect
    .poll(() =>
      page.evaluate((previousAttempt) => {
        const raw = window.localStorage.getItem(
          "freed-device-provider-sync-state-v2:facebook",
        );
        if (!raw) return false;
        const value = JSON.parse(raw) as {
          record: {
            phase: string;
            lastAttemptStartedAt?: number;
            nextDueAt: number;
          };
        };
        return (
          value.record.phase === "settled" &&
          (value.record.lastAttemptStartedAt ?? 0) > previousAttempt &&
          value.record.nextDueAt > Date.now()
        );
      }, firstAttemptStartedAt),
    )
    .toBe(true);
});
