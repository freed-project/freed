import { test, expect } from "./fixtures/app";
import type { Locator } from "@playwright/test";

async function measureButtonTextPosition(button: Locator, buttonText: string) {
  return button.evaluate((buttonElement, text) => {
    const textNode = Array.from(buttonElement.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(text),
    );
    const range = document.createRange();
    if (textNode) {
      range.selectNodeContents(textNode);
    } else {
      range.selectNodeContents(buttonElement);
    }
    const textRect = range.getBoundingClientRect();
    const buttonStyle = getComputedStyle(buttonElement);

    return {
      x: textRect.x,
      y: textRect.y,
      transform: buttonStyle.transform,
      matchesHover: buttonElement.matches(":hover"),
    };
  }, buttonText);
}

async function waitForButtonScrollSettle(button: Locator) {
  await button.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      }),
  );
}

test("launch-time auto-check runs once after legal acceptance", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await expect.poll(async () => {
    return page.evaluate(() => {
      return (
        (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_CHECK_CALLS__ as Array<
          { target?: string } | null
        >
      )?.map((call) => call?.target ?? null) ?? [];
    });
  }).toEqual(["production-darwin-aarch64"]);
});

test("switching release channels clears stale update state and rechecks the new channel", async ({
  app,
  page,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const updatesNavButton = settingsDialog.getByRole("button", { name: /^Updates$/ });
  await expect(updatesNavButton).toBeVisible({ timeout: 3_000 });
  await updatesNavButton.click();

  await expect(page.getByRole("heading", { name: "Updates" }).last()).toBeVisible({
    timeout: 5_000,
  });
  const installedVersionLabel = page.getByText(/^Installed version:/).last();
  await expect(installedVersionLabel).toBeVisible();
  const initialInstalledVersion = (await installedVersionLabel.textContent())
    ?.replace(/\s+/g, " ")
    .trim();
  expect(initialInstalledVersion).toBeTruthy();

  const releaseChannelSelect = page.getByTestId("settings-release-channel-select");
  await expect(releaseChannelSelect).toHaveValue("production");

  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByText("You're up to date")).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_BY_TARGET__ = {
      "production-darwin-aarch64": {
        version: "26.4.1800",
        body: "Production build available",
      },
    };
  });

  await releaseChannelSelect.selectOption("dev");
  await expect(releaseChannelSelect).toHaveValue("dev");
  await expect(installedVersionLabel).toHaveText(initialInstalledVersion ?? "");

  await expect(page.getByText("You're up to date")).toHaveCount(0);
  await expect(
    settingsDialog.getByText("Update available on Production", { exact: true }),
  ).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => {
    return page.evaluate(() => {
      const calls = (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_CHECK_CALLS__ as
        | Array<{ target?: string } | null>
        | undefined;
      return (calls ?? [])
        .slice(-2)
        .map((call) => call?.target ?? null);
    });
  }).toEqual(["dev-darwin-aarch64", "production-darwin-aarch64"]);

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as
      | { setState: (next: { error: string; isInitialized: boolean }) => void }
      | undefined;
    store?.setState({
      error: "Synthetic fatal crash",
      isInitialized: false,
    });
  });

  await expect(page.getByText("Freed Desktop hit a fatal error")).toBeVisible();
  await page.getByRole("button", { name: "Download latest Freed Desktop" }).click();
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toBe(
    "https://dev.freed.wtf/api/downloads/mac-arm",
  );
});

test("updates settings shows recent changelog entries and opens the full changelog", async ({
  app,
  page,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await settingsDialog.getByRole("button", { name: /^Updates$/ }).click();

  const preview = settingsDialog.getByTestId("settings-changelog-preview");
  await expect(preview).toBeVisible({ timeout: 5_000 });
  await expect(settingsDialog.getByText(/Installed version:\s*v\d+\.\d+\.\d+(?:-dev)?/)).toBeVisible();
  await expect(preview.getByRole("article")).toHaveCount(5);
  await expect(preview.getByText("v26.5.702")).toBeVisible();
  await expect(preview.getByText(/-dev/)).toHaveCount(0);

  await preview.getByRole("button", { name: "Show full changelog" }).click();
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toBe(
    "https://freed.wtf/changelog",
  );

  await page.getByTestId("settings-release-channel-select").selectOption("dev");
  await expect(preview.getByRole("article")).toHaveCount(5);
  await expect(preview.getByText(/v\d+\.\d+\.\d+-dev/).first()).toBeVisible();
  await page.evaluate(() => {
    const store = window as unknown as Record<string, unknown>;
    delete store.__FREED_E2E_FORCE_MAP_FALLBACK__;
    store.__FREED_TEST_WINDOW_OPEN_CALLS__ = [];
    window.open = ((url: string | URL | undefined, target?: string, features?: string) => {
      (store.__FREED_TEST_WINDOW_OPEN_CALLS__ as Array<{
        url: string;
        target?: string;
        features?: string;
      }>).push({
        url: String(url),
        target,
        features,
      });
      return null;
    }) as typeof window.open;
  });
  await preview.getByRole("button", { name: "Show full changelog" }).click();
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toBe(
    "https://freed.wtf/changelog/all",
  );
  await expect.poll(async () => {
    return page.evaluate(() => {
      return (window as unknown as Record<string, unknown>)
        .__FREED_TEST_WINDOW_OPEN_CALLS__ as Array<{ url: string }> | undefined;
    });
  }).toEqual([
    {
      url: "https://freed.wtf/changelog/all",
      target: "_blank",
      features: "noopener,noreferrer",
    },
  ]);
});

test("updates settings buttons do not move text on hover", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const nav = settingsDialog.locator("nav").first();
  await nav.getByRole("button", { name: "Updates", exact: true }).click();
  await expect.poll(async () => {
    return page.evaluate(() => {
      const container = document.querySelector<HTMLElement>(
        '[data-testid="settings-scroll-container"]',
      );
      const section = document.querySelector<HTMLElement>('[data-section="updates"]');
      const heading = section?.querySelector<HTMLElement>("h3");
      if (!container || !heading) {
        return null;
      }

      return Math.round(
        heading.getBoundingClientRect().top - container.getBoundingClientRect().top,
      );
    });
  }).toBeLessThanOrEqual(32);
  await expect(settingsDialog.getByTestId("settings-changelog-preview")).toBeVisible({
    timeout: 5_000,
  });

  const buttons = ["Check for updates", "Show full changelog"];

  for (const buttonName of buttons) {
    const button = settingsDialog.getByRole("button", { name: buttonName });
    await expect(button).toBeVisible({ timeout: 5_000 });
    await button.scrollIntoViewIfNeeded();
    await waitForButtonScrollSettle(button);

    const before = await measureButtonTextPosition(button, buttonName);
    expect(before).not.toBeNull();

    await button.hover();
    await expect.poll(async () => {
      return (await measureButtonTextPosition(button, buttonName))?.matchesHover ?? false;
    }).toBe(true);

    const hover = await measureButtonTextPosition(button, buttonName);
    expect(hover).not.toBeNull();
    expect(hover?.transform).toBe("none");
    expect(Math.abs((hover?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(0.01);
    expect(Math.abs((hover?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(0.01);
  }
});

test("settings nav clicks keep destination headings visible", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const nav = settingsDialog.locator("nav").first();
  await expect(nav).toBeVisible({ timeout: 5_000 });

  const destinations = [
    { label: "Updates", sectionId: "updates" },
    { label: "Legal", sectionId: "legal" },
    { label: "Appearance", sectionId: "appearance" },
    { label: "Sync", sectionId: "sync" },
  ] as const;

  for (const destination of destinations) {
    await nav.getByRole("button", { name: destination.label, exact: true }).click();

    await expect.poll(async () => {
      return page.evaluate((sectionId) => {
        const container = document.querySelector<HTMLElement>(
          '[data-testid="settings-scroll-container"]',
        );
        const section = document.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
        const heading = section?.querySelector<HTMLElement>("h3");
        if (!container || !heading) {
          return null;
        }

        return Math.round(
          heading.getBoundingClientRect().top - container.getBoundingClientRect().top,
        );
      }, destination.sectionId);
    }, {
      message: `${destination.label} heading should settle near the top of the settings pane`,
    }).toBeGreaterThanOrEqual(0);

    await expect.poll(async () => {
      return page.evaluate((sectionId) => {
        const container = document.querySelector<HTMLElement>(
          '[data-testid="settings-scroll-container"]',
        );
        const section = document.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
        const heading = section?.querySelector<HTMLElement>("h3");
        if (!container || !heading) {
          return null;
        }

        return Math.round(
          heading.getBoundingClientRect().top - container.getBoundingClientRect().top,
        );
      }, destination.sectionId);
    }, {
      message: `${destination.label} heading should not scroll past the top of the settings pane`,
    }).toBeLessThanOrEqual(32);
  }
});

test("selected release channel survives when browser storage is missing after relaunch", async ({
  app,
  page,
}) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await settingsDialog.getByRole("button", { name: /^Updates$/ }).click();

  const releaseChannelSelect = page.getByTestId("settings-release-channel-select");
  await expect(releaseChannelSelect).toHaveValue("production");
  await releaseChannelSelect.selectOption("dev");
  await expect(releaseChannelSelect).toHaveValue("dev");

  await page.evaluate(() => {
    const mockStoreKey = "__TAURI_MOCK_STORE__:release-channel.json";
    const existing = JSON.parse(window.localStorage.getItem(mockStoreKey) ?? "{}") as Record<
      string,
      unknown
    >;
    window.localStorage.setItem(
      mockStoreKey,
      JSON.stringify({
        ...existing,
        channel: "dev",
        installedChannel: "dev",
      }),
    );
    window.localStorage.removeItem("freed-release-channel");
  });

  await page.reload();
  await app.waitForReady();

  await page.locator("button").filter({ hasText: /settings/i }).first().click();
  const reopenedSettingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await reopenedSettingsDialog.getByRole("button", { name: /^Updates$/ }).click();

  const installedDevVersionPattern = /Installed version:\s*v\d+\.\d+\.\d+-dev/;
  await expect(page.getByTestId("settings-release-channel-select")).toHaveValue("dev");
  await expect(reopenedSettingsDialog.getByText(installedDevVersionPattern)).toBeVisible();

  await page.getByTestId("settings-release-channel-select").selectOption("production");
  await expect(page.getByTestId("settings-release-channel-select")).toHaveValue("production");
  await expect(reopenedSettingsDialog.getByText(installedDevVersionPattern)).toBeVisible();
});
