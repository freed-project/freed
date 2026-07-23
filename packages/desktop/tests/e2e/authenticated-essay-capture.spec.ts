import { test, expect } from "./fixtures/app";

type EssayProvider = "substack" | "medium";

const PROVIDERS: Record<
  EssayProvider,
  {
    label: "Substack" | "Medium";
    event: "substack-feed-data" | "medium-feed-data";
    commands: [string, string, string];
  }
> = {
  substack: {
    label: "Substack",
    event: "substack-feed-data",
    commands: [
      "substack_scrape_graph",
      "substack_scrape_activity",
      "substack_scrape_essays",
    ],
  },
  medium: {
    label: "Medium",
    event: "medium-feed-data",
    commands: [
      "medium_scrape_graph",
      "medium_scrape_activity",
      "medium_scrape_essays",
    ],
  },
};

async function openSettingsSection(
  page: import("@playwright/test").Page,
  provider: EssayProvider,
): Promise<void> {
  const closeButton = page.getByTestId("settings-close-button-sidebar");
  if (!(await closeButton.isVisible().catch(() => false))) {
    const settingsButton = page
      .locator("button")
      .filter({ hasText: /settings/i })
      .first();
    await expect(settingsButton).toBeVisible({ timeout: 5_000 });
    await settingsButton.click();
    await expect(closeButton).toBeVisible({ timeout: 5_000 });
  }

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const section = settingsDialog.locator("button").filter({
    has: page.getByText(PROVIDERS[provider].label, { exact: true }),
  }).last();
  await expect(section).toBeVisible({ timeout: 5_000 });
  await expect(section).toContainText("Beta");
  await section.click();
  await expect(
    page.getByRole("heading", { name: PROVIDERS[provider].label }).last(),
  ).toBeVisible({ timeout: 5_000 });
}

async function setAuthenticated(
  page: import("@playwright/test").Page,
  provider: EssayProvider,
): Promise<void> {
  await page.evaluate((nextProvider) => {
    const auth = {
      isAuthenticated: true,
      lastCheckedAt: Date.now(),
    };
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      [`${nextProvider}Auth`]: auth,
    });
    window.localStorage.setItem(`${nextProvider}_auth_state`, JSON.stringify(auth));
  }, provider);
}

async function acceptProviderRiskInStorage(
  page: import("@playwright/test").Page,
  provider: EssayProvider,
): Promise<void> {
  await page.evaluate((nextProvider) => {
    const record = {
      version: `2026-07-13-${nextProvider}`,
      acceptedAt: Date.now(),
      surface: `desktop-provider-${nextProvider}`,
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

async function installCaptureSequence(
  page: import("@playwright/test").Page,
  ipc: {
    setHandler: (
      command: string,
      handler: (args: unknown) => unknown,
    ) => Promise<void>;
  },
  provider: EssayProvider,
  payloads: unknown[],
  firstCommandDelayMs = 0,
): Promise<void> {
  await page.evaluate(
    ({ eventName, sequence, delayMs }) => {
      (window as Record<string, unknown>).__ESSAY_CAPTURE_SEQUENCE__ = {
        eventName,
        payloads: sequence,
        delayMs,
      };
    },
    {
      eventName: PROVIDERS[provider].event,
      sequence: payloads,
      delayMs: firstCommandDelayMs,
    },
  );

  const handler = () => {
    const globals = window as unknown as Record<string, unknown>;
    const sequence = globals.__ESSAY_CAPTURE_SEQUENCE__ as {
      eventName: string;
      payloads: unknown[];
      delayMs: number;
    };
    const payload = sequence.payloads.shift() ?? {
      entries: [],
      profiles: [],
      candidateCount: 0,
      extractedAt: Date.now(),
    };
    const delayMs = sequence.delayMs;
    sequence.delayMs = 0;
    return new Promise((resolve) => {
      setTimeout(() => {
        const listeners = (
          window as unknown as Record<
            string,
            Record<string, Array<(event: { payload: unknown }) => void>>
          >
        ).__TAURI_EVENT_LISTENERS__ ?? {};
        const extractionPayload = { ...(payload as Record<string, unknown>) };
        delete extractionPayload.done;
        for (const listener of listeners[sequence.eventName] ?? []) {
          listener({ payload: extractionPayload });
          listener({
            payload: {
              done: true,
              candidateCount: 0,
              extractedAt: Date.now(),
            },
          });
        }
        resolve(null);
      }, delayMs);
    });
  };

  for (const command of PROVIDERS[provider].commands) {
    await ipc.setHandler(command, handler);
  }
}

async function assertImportedConnection(
  page: import("@playwright/test").Page,
  expected: {
    accountId: string;
    itemId: string;
    personName: string;
    provider: EssayProvider;
    contentType: "article" | "post";
  },
): Promise<void> {
  await page.waitForFunction(
    ({ accountId, itemId, personName, provider, contentType }) => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => {
          accounts: Record<
            string,
            { discoveredFrom?: string; provider?: string; externalId?: string }
          >;
          items: Array<{
            globalId: string;
            platform: string;
            contentType: string;
          }>;
          persons: Record<
            string,
            { name?: string; relationshipStatus?: string }
          >;
        };
      };
      const state = store.getState();
      return (
        state.accounts[accountId]?.discoveredFrom === "follow_roster" &&
        state.items.find((item) => item.globalId === itemId)?.platform === provider &&
        state.items.some(
          (item) =>
            item.globalId === itemId &&
            item.platform === provider &&
            item.contentType === contentType,
        ) &&
        Object.values(state.persons).some(
          (person) =>
            person.name === personName &&
            person.relationshipStatus === "connection",
        )
      );
    },
    expected,
    { timeout: 15_000 },
  );

  const hasFriend = await page.evaluate((personName) => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        persons: Record<
          string,
          { name?: string; relationshipStatus?: string }
        >;
      };
    };
    return Object.values(store.getState().persons).some(
      (person) =>
        person.name === personName && person.relationshipStatus === "friend",
    );
  }, expected.personName);
  expect(hasFriend).toBe(false);

  const identityCount = await page.evaluate(
    ({ accountId, itemId, provider }) => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => {
          accounts: Record<string, { provider?: string; externalId?: string }>;
          items: Array<{ globalId: string; author: { id: string } }>;
        };
      };
      const state = store.getState();
      const authorId = state.items.find((item) => item.globalId === itemId)?.author.id;
      return {
        matchingAccounts: Object.values(state.accounts).filter(
          (account) => account.provider === provider && account.externalId === authorId,
        ).length,
        rosterMatchesAuthor: state.accounts[accountId]?.externalId === authorId,
      };
    },
    expected,
  );
  expect(identityCount).toEqual({
    matchingAccounts: 1,
    rosterMatchesAuthor: true,
  });
}

test("Substack and Medium are beta sources with gated login", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await expect(page.getByTestId("source-row-substack")).toContainText("Beta");
  await expect(page.getByTestId("source-row-medium")).toContainText("Beta");

  for (const provider of ["substack", "medium"] as const) {
    await openSettingsSection(page, provider);
    await expect(page.getByTestId(`provider-status-${provider}`)).toBeVisible();
    await expect(page.getByTestId(`provider-connect-${provider}`)).toContainText(
      `Log in with ${PROVIDERS[provider].label}`,
    );
    await page.getByTestId(`provider-check-auth-${provider}`).last().click();
    const riskDialog = page.getByTestId(`provider-risk-dialog-${provider}`);
    await expect(riskDialog).toBeVisible({ timeout: 5_000 });
    expect(
      (await ipc.invocations()).some(
        (call) => call.cmd === `${provider}_check_auth`,
      ),
    ).toBe(false);
    await riskDialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByTestId(`provider-connect-${provider}`).click();
    await expect(
      page.getByTestId(`provider-risk-dialog-${provider}`),
    ).toBeVisible({ timeout: 5_000 });
    await app.acceptProviderRiskIfPresent(provider);
    await expect
      .poll(async () =>
        (await ipc.invocations()).some(
          (call) => call.cmd === `${provider}_show_login`,
        ),
      )
      .toBe(true);
  }
});

test("disconnect stays disconnected after restart", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  for (const provider of ["substack", "medium"] as const) {
    await setAuthenticated(page, provider);
    await openSettingsSection(page, provider);
    await expect(page.getByTestId(`provider-connect-${provider}`)).toContainText(
      `Reconnect ${PROVIDERS[provider].label}`,
    );

    await page.getByTestId(`provider-disconnect-${provider}`).click();
    await expect
      .poll(async () =>
        page.evaluate((nextProvider) => {
          const raw = window.localStorage.getItem(`${nextProvider}_auth_state`);
          return raw ? (JSON.parse(raw) as { isAuthenticated?: boolean }).isAuthenticated : null;
        }, provider),
      )
      .toBe(false);

    await page.reload();
    await app.waitForReady();
    await openSettingsSection(page, provider);
    await expect(page.getByTestId(`provider-connect-${provider}`)).toContainText(
      `Log in with ${PROVIDERS[provider].label}`,
    );
  }
});

test("provider RSS essays count under Feeds as well as their provider", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      feeds: {
        "https://letters.example/feed": {
          url: "https://letters.example/feed",
          title: "Letters",
          enabled: true,
          trackUnread: false,
        },
      },
      feedUnreadCounts: { "https://letters.example/feed": 1 },
      feedTotalCounts: { "https://letters.example/feed": 2 },
      unreadCountByPlatform: { substack: 1 },
      itemCountByPlatform: { substack: 2 },
      totalUnreadCount: 1,
      totalItemCount: 2,
    });
  });

  await expect(page.getByTestId("source-counts-rss")).toHaveText("1/2");
  await expect(page.getByTestId("source-counts-substack")).toHaveText("1/2");
});

test("Substack capture imports connections and visible activity", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await setAuthenticated(page, "substack");
  await acceptProviderRiskInStorage(page, "substack");
  await installCaptureSequence(
    page,
    ipc,
    "substack",
    [
      {
        profiles: [
          {
            id: "user-1",
            handle: "grace",
            displayName: "Grace Hopper",
            profileUrl: "https://substack.com/@grace",
            role: "following",
          },
        ],
        candidateCount: 1,
        extractedAt: Date.now(),
        done: true,
      },
      {
        entries: [
          {
            id: "note-1",
            kind: "note",
            text: "Visible Substack note from Grace",
            url: "https://substack.com/@grace/note/1",
            publishedAt: "2026-07-13T12:00:00.000Z",
            author: {
              id: "user-1",
              handle: "grace",
              displayName: "Grace Hopper",
              profileUrl: "https://substack.com/@grace",
              role: "author",
            },
          },
        ],
        candidateCount: 1,
        extractedAt: Date.now(),
        done: true,
      },
      {
        entries: [],
        profiles: [],
        candidateCount: 0,
        extractedAt: Date.now(),
        done: true,
      },
    ],
    200,
  );

  await openSettingsSection(page, "substack");
  await page.getByTestId("provider-sync-action-substack").click();
  await expect(
    page.getByTestId("provider-sync-action-substack-spinner"),
  ).toBeVisible({ timeout: 5_000 });
  await assertImportedConnection(page, {
    accountId: "social:substack:user-1",
    itemId: "substack:note:note-1",
    personName: "Grace Hopper",
    provider: "substack",
    contentType: "post",
  });
  await expect(
    page.getByTestId("provider-sync-action-substack-spinner"),
  ).toBeHidden({ timeout: 10_000 });
  const storedAuth = await page.evaluate(() => {
    const raw = window.localStorage.getItem("substack_auth_state");
    return {
      auth: raw ? (JSON.parse(raw) as { captureCooldownUntil?: number }) : {},
      safetyDeadline: Number(
        window.localStorage.getItem("freed.capture-cooldown.substack"),
      ),
    };
  });
  expect(storedAuth.auth.captureCooldownUntil).toBeGreaterThan(Date.now());
  expect(storedAuth.safetyDeadline).toBeGreaterThan(Date.now());

  await page.getByTestId("settings-close-button-sidebar").click();
  await page.getByTestId("source-row-substack").click();
  await expect(page.getByText("Visible Substack note from Grace")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("source-status-substack")).toBeVisible();
});

test("Medium capture imports connections and linked essays", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await setAuthenticated(page, "medium");
  await acceptProviderRiskInStorage(page, "medium");
  await installCaptureSequence(page, ipc, "medium", [
    {
      profiles: [
        {
          id: "user-2",
          handle: "ada",
          displayName: "Ada Lovelace",
          profileUrl: "https://medium.com/@ada",
          role: "follower",
        },
      ],
      candidateCount: 1,
      extractedAt: Date.now(),
      done: true,
    },
    {
      entries: [],
      profiles: [],
      candidateCount: 0,
      extractedAt: Date.now(),
      done: true,
    },
    {
      entries: [
        {
          id: "story-1",
          kind: "story",
          title: "Medium story",
          text: "Visible Medium story from Ada",
          url: "https://medium.com/@ada/story-1",
          publishedAt: "2026-07-13T12:05:00.000Z",
          author: {
            id: "user-2",
            handle: "ada",
            displayName: "Ada Lovelace",
            profileUrl: "https://medium.com/@ada",
            role: "author",
          },
        },
      ],
      candidateCount: 1,
      extractedAt: Date.now(),
      done: true,
    },
  ]);

  await openSettingsSection(page, "medium");
  await page.getByTestId("provider-sync-action-medium").click();
  await assertImportedConnection(page, {
    accountId: "social:medium:user-2",
    itemId:
      "medium:story:https%3A%2F%2Fmedium.com%2F%40ada%2Fstory-1",
    personName: "Ada Lovelace",
    provider: "medium",
    contentType: "article",
  });

  const commands = (await ipc.invocations()).map((call) => call.cmd);
  expect(commands).toEqual(
    expect.arrayContaining(PROVIDERS.medium.commands),
  );
  await page.getByTestId("settings-close-button-sidebar").click();
  await page.getByTestId("source-row-medium").click();
  await expect(page.getByText("Medium story")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Visible Medium story from Ada")).toHaveCount(0);
});

test("memory pressure blocks native essay capture commands", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await setAuthenticated(page, "substack");
  await acceptProviderRiskInStorage(page, "substack");
  await ipc.setHandler("prepare_social_scrape_memory", () => {
    const snapshot = {
      totalPhysicalMemoryBytes: 16 * 1024 * 1024 * 1024,
      processResidentBytes: 256 * 1024 * 1024,
      processVirtualBytes: 512 * 1024 * 1024,
      appResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitResidentBytes: 8 * 1024 * 1024 * 1024,
      webkitVirtualBytes: 12 * 1024 * 1024 * 1024,
      webkitProcessId: 91_111,
      webkitTotalResidentBytes: 8 * 1024 * 1024 * 1024,
      webkitProcessCount: 6,
      webkitLargestResidentBytes: 8 * 1024 * 1024 * 1024,
      webkitLargestProcessId: 91_111,
      webkitTelemetryAvailable: true,
      indexedDbBytes: 12 * 1024 * 1024,
      webkitCacheBytes: 64 * 1024 * 1024,
      memoryHighBytes: 6 * 1024 * 1024 * 1024,
      memoryCriticalBytes: 8 * 1024 * 1024 * 1024,
      relayDocBytes: 0,
      relayClientCount: 0,
    };
    return {
      before: snapshot,
      after: snapshot,
      recycledScraperWindows: true,
      cacheTrimmed: true,
      mayProceed: false,
    };
  });

  await openSettingsSection(page, "substack");
  await page.getByTestId("provider-sync-action-substack").click();
  await expect
    .poll(async () =>
      (await ipc.invocations()).some(
        (call) => call.cmd === "prepare_social_scrape_memory",
      ),
    )
    .toBe(true);
  await expect(page.getByText(/memory is high/i).first()).toBeVisible({
    timeout: 5_000,
  });

  const invoked = (await ipc.invocations()).map((call) => call.cmd);
  for (const command of PROVIDERS.substack.commands) {
    expect(invoked).not.toContain(command);
  }
});
