import { test, expect, resolveViteFsModulePath } from "./fixtures/app";
import { blockExternalRequests } from "./fixtures/transfer-acceptance";

// Match App's Vite module URLs so these imports share its stateful singletons.
// A second /@fs/ URL would observe a separate, unpaused guard instance.
const capabilityModule = "/src/lib/library-transfer-capability.ts";
const handoffModule = "/src/lib/library-core-handoff.ts";
const guardModule = "/src/lib/factory-reset-guard.ts";
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

test("ordinary build refuses transfer actions and retains the authorized restart fence", async ({ app, ipc }) => {
  await app.goto(); await app.waitForReady();
  await app.page.addInitScript(() => {
    const handlers = (window as any).__TAURI_MOCK_HANDLERS__;
    handlers.read_normalized_library_handoff_status = () => ({
      handoffId: "a".repeat(64), libraryId: "b".repeat(64), installationRole: "source", phase: "authorized",
      predecessorEpochId: "c".repeat(64), successorEpochId: "d".repeat(64), canonicalReadiness: "{}",
      canonicalAuthorizationBody: "fixture body", canonicalAuthorization: "fixture grant", canonicalActivation: null,
      expectedControlRevision: null, observedControlRevision: null, updatedAtMs: 1,
    });
    handlers.normalized_desktop_installation_status = () => ({ state: "fenced", role: null,
      libraryId: "b".repeat(64), authorityEpochId: "c".repeat(64), actorId: null });
  });
  await app.page.reload();
  const panel = app.page.getByRole("region", { name: "Primary transfer" });
  await expect(panel).toContainText("unavailable in this build pending installed convergence acceptance");
  await expect(panel.getByRole("button")).toHaveText(["Browse recovery archives"]);
  // Role publication can render the setup panel before the persisted handoff
  // read finishes. Await the actual startup fence, rather than setting it here.
  await expect.poll(() => app.page.evaluate(async path =>
    (await import(path)).isDesktopHandoffPaused(), guardModule)).toBe(true);
  const before = (await ipc.invocations()).length;
  const result = await app.page.evaluate(async ({ capabilityModule, handoffModule, guardModule }) => {
    const capability = await import(capabilityModule);
    const api = await import(handoffModule);
    const guard = await import(guardModule);
    const fenceBefore = guard.isDesktopHandoffPaused();
    const calls = [
      () => api.prepareDesktopLibraryTargetReadiness(),
      () => api.prepareDesktopLibrarySourceHandoff({ canonicalReadiness: "fixture", selectedTargetActorId: "e".repeat(64) }),
      () => api.cancelDesktopLibrarySourceHandoff("a".repeat(64)),
      () => api.acceptDesktopLibraryTargetHandoffAuthorization("fixture grant"),
      () => api.acceptDesktopLibraryTargetHandoffCancellation("fixture cancellation"),
      () => api.stageDesktopLibraryTargetHandoff("a".repeat(64)),
      () => api.prepareDesktopLibraryConsumerRecovery(),
      () => api.commitDesktopLibraryConsumerRecovery("a".repeat(64)),
    ];
    const failures: Array<string | null> = [];
    for (const call of calls) {
      try { await call(); failures.push(null); }
      catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    return { enabled: capability.LIBRARY_TRANSFER_ENABLED, unavailable: capability.LIBRARY_TRANSFER_UNAVAILABLE,
      failures, fenceBefore, fenceAfter: guard.isDesktopHandoffPaused() };
  }, { capabilityModule, handoffModule, guardModule });
  expect(result.enabled).toBe(false);
  expect(result.failures).toEqual(Array(8).fill(result.unavailable));
  expect(result.fenceBefore).toBe(true);
  expect(result.fenceAfter).toBe(true);
  expect((await ipc.invocations()).slice(before)).toEqual([]);
});

test("ordinary build keeps archived edits reviewable without recovery or reapplication", async ({ app, ipc }) => {
  await app.goto(); await app.waitForReady();
  await ipc.setHandler("normalized_desktop_installation_status", () => ({ state: "editable_consumer", role: "follower",
    libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) }));
  await ipc.setHandler("read_normalized_library_consumer_recovery", () => ({ recoveryId: "d".repeat(64), libraryId: "a".repeat(64),
    predecessorEpochId: "e".repeat(64), successorEpochId: "b".repeat(64), state: "prepared", archivedPendingEdits: 1, archivedPublishedEdits: 0 }));
  await app.page.evaluate(() => {
    const handlers = (window as any).__TAURI_MOCK_HANDLERS__;
    const previous = handlers.query_normalized_library;
    handlers.query_normalized_library = (args: any) => {
      const request = args.request;
      const source = { generationId: "f".repeat(64), projectionRevision: 7, transitionSequence: 7 };
      if (request.queryId === "recovery_intent_page_v1") return { queryId: request.queryId, schemaVersion: 1,
        recoveryId: request.recoveryId, archiveDigest: "1".repeat(64), source, nextCursor: null,
        rows: [{ ordinal: 0, transactionId: "tx:archived" }] };
      if (request.queryId === "recovery_intent_review_v1") return { queryId: request.queryId, schemaVersion: 1,
        recoveryId: request.recoveryId, archiveDigest: "1".repeat(64), source: { ...source, transitionSequence: 9 }, nextCursor: null,
        transactionId: request.transactionId, transactionDigest: "2".repeat(64), memberCount: 1, replacement: null,
        outcome: { state: "unresolved" }, rows: [{ personState: null, rssFeedState: null, originalEnvelopeJson: null,
          authorName: "Reader", itemPresent: true, itemState: "present", itemText: "Preserved archived item",
          assigned: true, assignedAt: 1000, readAt: null, createdAt: 1000, entityId: "rss:preserved-12345678",
          memberIndex: 0, operationType: "feed_item_saved_assignment" }] };
      return previous(args);
    };
  });
  await app.page.evaluate(async path => {
    const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync");
  }, settingsModule);
  const recovery = app.page.getByTestId("consumer-recovery");
  await expect(recovery.getByTestId("consumer-recovery-action")).toBeDisabled();
  await recovery.getByRole("button", { name: "Review archived edits", exact: true }).click();
  await recovery.getByRole("button", { name: "Review edit ...archived", exact: true }).click();
  const detail = recovery.getByTestId("consumer-recovery-detail");
  await expect(detail).toContainText("Preserved archived item");
  await expect(detail).toContainText("original outcome has not been established");
  await expect(recovery).toContainText("Applying them again is unavailable");
  await expect(detail.getByRole("button", { name: "Apply again", exact: true })).toHaveCount(0);
  expect(await app.page.evaluate(async path => (await import(path)).LIBRARY_TRANSFER_ENABLED, capabilityModule)).toBe(false);
  expect((await ipc.invocations()).filter(({ cmd }) => /^(reapply_normalized_library_|prepare_normalized_library_consumer_recovery|commit_normalized_library_consumer_recovery|start_oauth_server)/.test(cmd))).toEqual([]);
});
