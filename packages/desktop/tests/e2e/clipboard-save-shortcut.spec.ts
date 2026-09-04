import { test, expect } from "./fixtures/app";

async function waitForRegisteredShortcut(page: import("@playwright/test").Page): Promise<string> {
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __TAURI_MOCK_GLOBAL_SHORTCUTS__?: Record<string, unknown>;
    };
    return Object.keys(w.__TAURI_MOCK_GLOBAL_SHORTCUTS__ ?? {}).length > 0;
  });

  return page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_MOCK_GLOBAL_SHORTCUTS__?: Record<string, unknown>;
    };
    const [shortcut] = Object.keys(w.__TAURI_MOCK_GLOBAL_SHORTCUTS__ ?? {});
    if (!shortcut) throw new Error("No shortcut registered");
    return shortcut;
  });
}

async function triggerShortcut(page: import("@playwright/test").Page, shortcut: string): Promise<void> {
  await page.evaluate(async (value) => {
    const w = window as unknown as {
      __TAURI_MOCK_TRIGGER_GLOBAL_SHORTCUT__?: (shortcut: string) => Promise<void>;
    };
    if (!w.__TAURI_MOCK_TRIGGER_GLOBAL_SHORTCUT__) {
      throw new Error("Shortcut trigger mock missing");
    }
    await w.__TAURI_MOCK_TRIGGER_GLOBAL_SHORTCUT__(value);
  }, shortcut);
}

async function openSettingsDialog(app: { goto: () => Promise<void>; waitForReady: () => Promise<void> }, page: import("@playwright/test").Page) {
  await app.goto();
  await app.waitForReady();

  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  const iconBtn = page.locator('[aria-label*="settings" i]').first();
  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;
  await expect(btn).toBeVisible();
  await btn.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await expect(settingsDialog).toBeVisible();
  return settingsDialog;
}

async function expectKeycapsInSingleRow(recorder: import("@playwright/test").Locator): Promise<void> {
  const topValues = await recorder.locator("kbd").evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
  );
  expect(new Set(topValues).size).toBe(1);
}

async function expectRecorderOnRight(
  label: import("@playwright/test").Locator,
  recorder: import("@playwright/test").Locator,
): Promise<void> {
  const [labelBox, recorderBox] = await Promise.all([
    label.boundingBox(),
    recorder.boundingBox(),
  ]);
  expect(labelBox).not.toBeNull();
  expect(recorderBox).not.toBeNull();
  if (!labelBox || !recorderBox) return;

  expect(recorderBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
  expect(Math.abs(recorderBox.y - labelBox.y)).toBeLessThan(24);
}

test("global clipboard shortcut opens Save Content with a clipboard URL", async ({ app, page, ipc }) => {
  await app.goto();
  await app.waitForReady();

  const shortcut = await waitForRegisteredShortcut(page);
  expect(shortcut).toBe("Control+Option+Command+S");

  await page.evaluate(() => {
    (window as unknown as { __TAURI_MOCK_CLIPBOARD_TEXT__?: string })
      .__TAURI_MOCK_CLIPBOARD_TEXT__ = " https://example.com/from-clipboard ";
  });
  await triggerShortcut(page, shortcut);

  await expect(page.getByText("Save Content", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Article or page URL")).toHaveValue("https://example.com/from-clipboard");

  const invocations = await ipc.invocations();
  expect(invocations.some((call) => call.cmd === "show_window")).toBe(true);
});

test("global clipboard shortcut opens Save Content blank for non-URL clipboard text", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  const shortcut = await waitForRegisteredShortcut(page);
  await page.evaluate(() => {
    (window as unknown as { __TAURI_MOCK_CLIPBOARD_TEXT__?: string })
      .__TAURI_MOCK_CLIPBOARD_TEXT__ = "not a link";
  });
  await triggerShortcut(page, shortcut);

  await expect(page.getByText("Save Content", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Article or page URL")).toHaveValue("");
});

test("URL preview shows activity and fills untouched notes", async ({ app, page, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("fetch_url", async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return '<html><head><meta name="description" content="A useful preview note." /></head></html>';
  });

  const shortcut = await waitForRegisteredShortcut(page);
  await page.evaluate(() => {
    (window as unknown as { __TAURI_MOCK_CLIPBOARD_TEXT__?: string })
      .__TAURI_MOCK_CLIPBOARD_TEXT__ = "https://example.com/preview-note";
  });
  await triggerShortcut(page, shortcut);

  await expect(page.getByRole("status", { name: "Reading URL details" })).toBeVisible();
  await expect(page.getByLabel("Notes")).toHaveValue("A useful preview note.");
  await expect(page.getByPlaceholder("Notes will be auto-populated from the URL when available.")).toBeVisible();
});

test("URL preview never replaces notes after the user edits them", async ({ app, page, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("fetch_url", async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return '<html><head><meta name="description" content="Fetched note that must not win." /></head></html>';
  });

  const shortcut = await waitForRegisteredShortcut(page);
  await page.evaluate(() => {
    (window as unknown as { __TAURI_MOCK_CLIPBOARD_TEXT__?: string })
      .__TAURI_MOCK_CLIPBOARD_TEXT__ = "https://example.com/user-note-wins";
  });
  await triggerShortcut(page, shortcut);

  const notes = page.getByLabel("Notes");
  await notes.fill("My note");
  await expect(page.getByRole("status", { name: "Reading URL details" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Reading URL details" })).toBeHidden();
  await expect(notes).toHaveValue("My note");
});

test("saving and editing content persists preview details and searchable notes", async ({ app, page, ipc }) => {
  await app.goto();
  await app.waitForReady();

  await ipc.setHandler("fetch_url", () => `
    <!doctype html>
    <html>
      <head>
        <title>Saved Reader Transition</title>
        <meta name="description" content="A saved article should open immediately." />
      </head>
      <body>
        <article>
          <h1>Saved Reader Transition</h1>
          <p>This article proves the Save Content flow enters read mode after persistence.</p>
          <p>The reader should render this body from the saved content cache.</p>
        </article>
      </body>
    </html>
  `);

  const shortcut = await waitForRegisteredShortcut(page);
  await page.evaluate(() => {
    (window as unknown as { __TAURI_MOCK_CLIPBOARD_TEXT__?: string })
      .__TAURI_MOCK_CLIPBOARD_TEXT__ = "https://example.com/saved-reader-transition";
  });
  await triggerShortcut(page, shortcut);

  const notes = page.getByLabel("Notes");
  await expect(notes).toHaveValue("A saved article should open immediately.");
  await notes.fill("Updated comet note");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const state = (w.__FREED_STORE__ as { getState: () => {
      activeFilter: { savedOnly?: boolean };
      activeView: string;
      selectedItemId: string | null;
    } }).getState();
    return state.activeView === "feed"
      && state.activeFilter.savedOnly === true
      && typeof state.selectedItemId === "string"
      && state.selectedItemId.startsWith("saved:");
  });

  const savedState = await page.evaluate(() => {
    const root = window as Record<string, unknown>;
    const selectedItemId = (root.__FREED_STORE__ as {
      getState: () => { selectedItemId: string | null };
    }).getState().selectedItemId;
    const library = root.__TAURI_MOCK_SQLITE_LIBRARY__ as {
      items: Record<string, {
        content: { linkPreview: { title: string; url: string } };
        userState: { highlights?: Array<{ note?: string }> };
      }>;
    };
    return {
      item: selectedItemId ? library.items[selectedItemId] : null,
      selectedItemId,
    };
  });
  expect(savedState.item?.content.linkPreview.title).toBe("Saved Reader Transition");
  expect(savedState.item?.userState.highlights?.[0]?.note).toBe("Updated comet note");

  await page.evaluate((item) => {
    window.dispatchEvent(new CustomEvent("freed:edit-saved-content", { detail: { item } }));
  }, savedState.item);
  await expect(page.getByText("Edit Save", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Article or page URL")).toHaveValue(
    "https://example.com/saved-reader-transition",
  );
  await expect(page.getByLabel("Notes")).toHaveValue("Updated comet note");
  await page.getByLabel("Article or page URL").fill(
    "https://example.com/saved-reader-transition-edited",
  );
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Update save", exact: true }).click();
  await page.waitForFunction((previousId) => {
    const state = ((window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { selectedItemId: string | null };
    }).getState();
    return typeof state.selectedItemId === "string" && state.selectedItemId !== previousId;
  }, savedState.selectedItemId);

  const search = page.locator('[aria-label="Search or run"]:visible').first();
  await search.fill("Updated comet note");
  const searchAction = page.getByRole("option", {
    name: /Search current feed for "Updated comet note"/,
  });
  await expect(searchAction).toBeVisible();
  await searchAction.click();
  await expect(page.getByText("Saved Reader Transition").first()).toBeVisible();
});

test("Settings records, disables, and resets the Save Content shortcut", async ({ app, page }) => {
  await page.setViewportSize({ width: 1492, height: 700 });
  const settingsDialog = await openSettingsDialog(app, page);
  await settingsDialog.getByRole("button", { name: "Shortcuts", exact: true }).click();

  const recorder = settingsDialog.getByRole("button", { name: "Record Save Content shortcut" });
  const label = settingsDialog.getByText("Save Content", { exact: true });
  const card = settingsDialog.getByTestId("settings-shortcuts-save-content-card");
  await expect(card).toHaveClass(/theme-card-soft/);
  await expect(card).not.toHaveClass(/border-border|bg-bg-surface/);
  await expect(recorder).toContainText("⌃⌥⌘S");
  await expect(recorder.locator("kbd")).toHaveText(["⌃", "⌥", "⌘", "S"]);
  await expectKeycapsInSingleRow(recorder);
  await expectRecorderOnRight(label, recorder);

  await recorder.click();
  await expect(recorder).toBeFocused();
  await page.keyboard.press("Control+Alt+F");
  await expect(recorder).toContainText("⌃⌥F");
  await expect(recorder.locator("kbd")).toHaveText(["⌃", "⌥", "F"]);
  await expectKeycapsInSingleRow(recorder);

  await settingsDialog.getByRole("button", { name: "Disable" }).click();
  await expect(recorder).toContainText("Disabled");
  await expect(recorder.locator("kbd")).toHaveCount(0);

  await settingsDialog.getByRole("button", { name: "Reset to default" }).click();
  await expect(recorder).toContainText("⌃⌥⌘S");
  await expect(recorder.locator("kbd")).toHaveText(["⌃", "⌥", "⌘", "S"]);

  const calls = await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_MOCK_GLOBAL_SHORTCUT_CALLS__?: Array<{ action: string; shortcut?: string }>;
    };
    return w.__TAURI_MOCK_GLOBAL_SHORTCUT_CALLS__ ?? [];
  });
  expect(calls.some((call) => call.action === "register" && call.shortcut === "Control+Option+F")).toBe(true);
  expect(calls.some((call) => call.action === "unregister" && call.shortcut === "Control+Option+F")).toBe(true);
});

test("Settings hides shortcut controls on touch-only devices", async ({ app, page }) => {
  await page.addInitScript(() => {
    (window as Window & { __FREED_E2E_TOUCH_ONLY__?: boolean }).__FREED_E2E_TOUCH_ONLY__ = true;
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });

    window.matchMedia = (query: string) => {
      const matches = query === "(pointer: coarse)" || query === "(hover: none)";
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList;
    };
  });

  const settingsDialog = await openSettingsDialog(app, page);
  await expect(settingsDialog.getByRole("button", { name: "Shortcuts", exact: true })).toHaveCount(0);
  await expect(settingsDialog.getByRole("button", { name: /Record Save Content shortcut/ })).toHaveCount(0);
});
