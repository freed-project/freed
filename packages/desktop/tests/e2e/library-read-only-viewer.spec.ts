import { test, expect, resolveViteFsModulePath } from "./fixtures/app";
import { blockExternalRequests } from "./fixtures/transfer-acceptance";

const settingsModule = resolveViteFsModulePath("../../../ui/src/lib/settings-store.ts", import.meta.url);

test.beforeEach(async ({ app }) => {
  await blockExternalRequests(app.page);
});

for (const actorId of [null, "6".repeat(64)]) {
test(`viewer browses ${actorId === null ? "before" : "after"} enrollment without automatic edits or synchronized preference writes`, async ({ app, ipc }) => {
  await app.goto(); await app.waitForReady();
  await app.injectRssItems(4);
  await app.page.addInitScript((actorId) => {
    const handlers = (window as any).__TAURI_MOCK_HANDLERS__;
    handlers.normalized_desktop_installation_status = () => ({
      state: "read_only_consumer", role: "follower", libraryId: "a".repeat(64),
      authorityEpochId: "b".repeat(64), actorId,
    });
    handlers.normalized_library_follower_runtime_status = () => ({
      state: actorId === null ? "awaiting_enrollment" : "active", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64),
      actorId, checkpointGeneration: 1, sourceRevision: 1,
      pendingIntentCount: 0, publishedIntentCount: 0, importedResultCount: 0,
      awaitingCanonicalChanges: false,
    });
  }, actorId);
  await app.page.reload(); await app.waitForReady();
  const before = (await ipc.invocations()).length;
  await app.page.locator("[data-feed-item-id]").first().click();
  await expect(app.page.getByRole("article")).toBeVisible();
  for (const name of ["Save", "Archive"]) {
    await expect(app.page.getByRole("button", { name, exact: true }).and(app.page.locator(":enabled"))).toHaveCount(0);
  }
  await app.page.evaluate(async path => {
    const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("appearance");
  }, settingsModule);
  for (const name of ["Mark read on scroll", "Show read in grayscale", "Show engagement counts", "Focus mode"]) {
    await expect(app.page.getByRole("switch", { name, exact: true })).toBeDisabled();
  }
  await app.page.evaluate(async path => {
    const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync");
  }, settingsModule);
  await expect(app.page.getByText("Read-only viewer", { exact: true })).toBeVisible();
  expect((await ipc.invocations()).slice(before).filter(({ cmd }) =>
    /^(sign_normalized_library_|enqueue_normalized_library_follower_intent|commit_normalized_library_)/.test(cmd),
  )).toEqual([]);
});
}
