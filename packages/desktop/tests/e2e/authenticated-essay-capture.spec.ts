import { test, expect } from "./fixtures/app";

async function openSettingsSection(
  page: import("@playwright/test").Page,
  sectionName: "Substack" | "Medium",
): Promise<void> {
  const closeButton = page.getByTestId("settings-close-button-sidebar");
  if (!(await closeButton.isVisible().catch(() => false))) {
    const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();
    await expect(closeButton).toBeVisible({ timeout: 5_000 });
  }
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const section = settingsDialog.locator("button").filter({
    has: page.getByText(sectionName, { exact: true }),
  }).last();
  await expect(section).toBeVisible({ timeout: 3_000 });
  await section.click();
  await expect(page.getByRole("heading", { name: sectionName }).last()).toBeVisible({ timeout: 3_000 });
}

async function setAuthenticated(
  page: import("@playwright/test").Page,
  provider: "substack" | "medium",
): Promise<void> {
  await page.evaluate((nextProvider) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      [`${nextProvider}Auth`]: {
        isAuthenticated: true,
        lastCheckedAt: Date.now(),
      },
    });
  }, provider);
}

async function acceptProviderRiskInStorage(
  page: import("@playwright/test").Page,
  provider: "substack" | "medium",
): Promise<void> {
  await page.evaluate((nextProvider) => {
    const version =
      nextProvider === "substack"
        ? "2026-05-30-substack"
        : "2026-05-30-medium";
    const surface =
      nextProvider === "substack"
        ? "desktop-provider-substack"
        : "desktop-provider-medium";
    const record = {
      version,
      acceptedAt: Date.now(),
      surface,
    };
    const key = `legal.provider.${nextProvider}`;
    const storeKey = "__TAURI_MOCK_STORE__:legal.json";
    const raw = window.localStorage.getItem(storeKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed[key] = record;
    window.localStorage.setItem(storeKey, JSON.stringify(parsed));
    window.localStorage.setItem(`freed.legal.${key}`, JSON.stringify(record));
  }, provider);
}

test("Substack and Medium appear as authenticated source settings", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await openSettingsSection(page, "Substack");
  await expect(page.getByTestId("provider-status-substack")).toBeVisible();
  await expect(page.getByTestId("provider-connect-substack")).toContainText("Log in with Substack");

  await openSettingsSection(page, "Medium");
  await expect(page.getByTestId("provider-status-medium")).toBeVisible();
  await expect(page.getByTestId("provider-connect-medium")).toContainText("Log in with Medium");
});

test("mocked Substack scrape imports connection accounts and source feed items", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await setAuthenticated(page, "substack");
  await acceptProviderRiskInStorage(page, "substack");
  await ipc.setHandler("substack_scrape_graph", () => {
    const emit = (eventName: string, payload: unknown) => {
      const listeners =
        (window as unknown as Record<string, Array<(event: { payload: unknown }) => void>>)
          .__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) {
        listener({ payload });
      }
      const tauriInternals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as
        | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      void tauriInternals?.invoke?.("plugin:event|emit", { event: eventName, payload });
    };
    setTimeout(() => {
      emit("substack-feed-data", {
        candidateCount: 1,
        profiles: [
          {
            id: "user-1",
            handle: "grace",
            displayName: "Grace Hopper",
            profileUrl: "https://substack.com/@grace",
            relation: "following",
          },
        ],
      });
    }, 0);
    return null;
  });
  await ipc.setHandler("substack_scrape_activity", () => {
    const emit = (eventName: string, payload: unknown) => {
      const listeners =
        (window as unknown as Record<string, Array<(event: { payload: unknown }) => void>>)
          .__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) {
        listener({ payload });
      }
      const tauriInternals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as
        | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      void tauriInternals?.invoke?.("plugin:event|emit", { event: eventName, payload });
    };
    setTimeout(() => {
      emit("substack-feed-data", {
        candidateCount: 1,
        entries: [
          {
            id: "note-1",
            kind: "note",
            title: "Substack note",
            text: "Visible Substack note from Grace",
            url: "https://substack.com/@grace/note/1",
            publishedAt: "2026-05-30T12:00:00.000Z",
            author: {
              externalId: "user-1",
              handle: "grace",
              displayName: "Grace Hopper",
              profileUrl: "https://substack.com/@grace",
            },
          },
        ],
      });
    }, 0);
    return null;
  });

  await openSettingsSection(page, "Substack");
  await page.getByTestId("provider-sync-action-substack").click();
  await expect
    .poll(async () => (await ipc.invocations()).map((call) => call.cmd), {
      timeout: 5_000,
    })
    .toContain("substack_scrape_graph");

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        accounts: Record<string, { discoveredFrom?: string; provider?: string }>;
        items: Array<{ globalId: string; platform: string }>;
        persons: Record<string, { name?: string; relationshipStatus?: string }>;
      };
    };
    const state = store.getState();
    return (
      state.accounts["social:substack:user-1"]?.discoveredFrom === "follow_roster" &&
      state.items.some((item) => item.globalId === "substack:note:note-1") &&
      Object.values(state.persons).some(
        (person) => person.name === "Grace Hopper" && person.relationshipStatus === "connection",
      )
    );
  }, { timeout: 10_000 });

  const imported = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        accounts: Record<string, { discoveredFrom?: string; provider?: string }>;
        persons: Record<string, { name?: string; relationshipStatus?: string }>;
      };
    };
    const state = store.getState();
    return {
      account: state.accounts["social:substack:user-1"],
      hasFriend: Object.values(state.persons).some(
        (person) => person.name === "Grace Hopper" && person.relationshipStatus === "friend",
      ),
    };
  });
  expect(imported.account).toMatchObject({
    provider: "substack",
    discoveredFrom: "follow_roster",
  });
  expect(imported.hasFriend).toBe(false);

  await page.getByTestId("settings-close-button-sidebar").click();
  await page.getByTestId("source-row-substack").click();
  await expect(page.getByText("Visible Substack note from Grace")).toBeVisible({
    timeout: 5_000,
  });
});

test("mocked Medium scrape imports article activity through the Medium source", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await setAuthenticated(page, "medium");
  await acceptProviderRiskInStorage(page, "medium");
  await ipc.setHandler("medium_scrape_graph", () => {
    const emit = (eventName: string, payload: unknown) => {
      const listeners =
        (window as unknown as Record<string, Array<(event: { payload: unknown }) => void>>)
          .__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) {
        listener({ payload });
      }
      const tauriInternals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as
        | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      void tauriInternals?.invoke?.("plugin:event|emit", { event: eventName, payload });
    };
    setTimeout(() => {
      emit("medium-feed-data", {
        candidateCount: 1,
        profiles: [
          {
            id: "user-2",
            handle: "ada",
            displayName: "Ada Lovelace",
            profileUrl: "https://medium.com/@ada",
            relation: "follower",
          },
        ],
      });
    }, 0);
    return null;
  });
  await ipc.setHandler("medium_scrape_essays", () => {
    const emit = (eventName: string, payload: unknown) => {
      const listeners =
        (window as unknown as Record<string, Array<(event: { payload: unknown }) => void>>)
          .__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) {
        listener({ payload });
      }
      const tauriInternals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as
        | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      void tauriInternals?.invoke?.("plugin:event|emit", { event: eventName, payload });
    };
    setTimeout(() => {
      emit("medium-feed-data", {
        candidateCount: 1,
        entries: [
          {
            id: "story-1",
            kind: "story",
            title: "Medium story",
            text: "Visible Medium story from Ada",
            url: "https://medium.com/@ada/story-1",
            publishedAt: "2026-05-30T12:05:00.000Z",
            author: {
              externalId: "user-2",
              handle: "ada",
              displayName: "Ada Lovelace",
              profileUrl: "https://medium.com/@ada",
            },
          },
        ],
      });
    }, 0);
    return null;
  });

  await openSettingsSection(page, "Medium");
  await page.getByTestId("provider-sync-action-medium").click();
  await expect
    .poll(async () => (await ipc.invocations()).map((call) => call.cmd), {
      timeout: 5_000,
    })
    .toContain("medium_scrape_graph");

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        accounts: Record<string, { discoveredFrom?: string }>;
        items: Array<{ globalId: string; platform: string; contentType: string }>;
      };
    };
    const state = store.getState();
    return (
      state.accounts["social:medium:user-2"]?.discoveredFrom === "follow_roster" &&
      state.items.some(
        (item) =>
          item.globalId === "medium:story:story-1" &&
          item.platform === "medium" &&
          item.contentType === "article",
      )
    );
  }, { timeout: 10_000 });

  await page.getByTestId("settings-close-button-sidebar").click();
  await page.getByTestId("source-row-medium").click();
  await expect(page.getByText("Visible Medium story from Ada")).toBeVisible({
    timeout: 5_000,
  });
});
