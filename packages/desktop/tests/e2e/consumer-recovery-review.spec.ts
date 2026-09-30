import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const cursorModulePath = resolveViteFsModulePath("../../../shared/src/library-core/feed-page-contracts.ts", import.meta.url);
const settingsStorePath = resolveViteFsModulePath("../../../ui/src/lib/settings-store.ts", import.meta.url);

test("consumer archive review requires explicit duplicate-safe reapplication", async ({ app, ipc }, testInfo) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("normalized_desktop_installation_status", () => ({
    state: "editable_consumer", role: "follower", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64),
  }));
  await ipc.setHandler("read_normalized_library_consumer_recovery", () => ({
    recoveryId: "d".repeat(64), libraryId: "a".repeat(64), predecessorEpochId: "e".repeat(64), successorEpochId: "b".repeat(64),
    state: "following", archivedPendingEdits: 2, archivedPublishedEdits: 1,
  }));
  await app.page.evaluate(async (path) => {
    const { encodeLibraryCoreFeedPageCursorV1 } = await import(path);
    const handlers = (window as unknown as { __TAURI_MOCK_HANDLERS__: Record<string, (args: { request?: Record<string, unknown> }) => unknown> }).__TAURI_MOCK_HANDLERS__;
    const previous = handlers.query_normalized_library;
    handlers.query_normalized_library = (args) => {
      const request = args.request!;
      const source = { generationId: "f".repeat(64), projectionRevision: 7, transitionSequence: 7 };
      if (request.queryId === "recovery_archive_page_v1") return {
        queryId: request.queryId, schemaVersion: 1, handoffId: "9".repeat(64), source, nextCursor: null,
        rows: [{ recoveryId: "8".repeat(64), predecessorEpochId: "7".repeat(64), successorEpochId: "e".repeat(64), pendingEdits: 1, publishedEdits: 0, createdAt: 1 }],
      };
      if (request.queryId === "recovery_intent_page_v1") return {
        queryId: request.queryId, schemaVersion: 1, recoveryId: request.recoveryId, archiveDigest: "1".repeat(64), source, nextCursor: null,
        rows: ["accepted", "rejected", "unknown1"].map((suffix, ordinal) => ({ ordinal, transactionId: `tx:${suffix}` })),
      };
      if (request.queryId === "recovery_intent_review_v1") {
        const reviewSource = { ...source, transitionSequence: 9 };
        const memberCount = request.transactionId === "tx:unknown1" ? 9 : 1;
        const start = request.cursor === null ? 0 : 8;
        const end = Math.min(start + 8, memberCount);
        return {
        queryId: request.queryId, schemaVersion: 1, recoveryId: request.recoveryId, archiveDigest: "1".repeat(64), source: reviewSource,
        nextCursor: end < memberCount ? encodeLibraryCoreFeedPageCursorV1({ ...reviewSource, sortAt: end - 1,
          globalId: `recovery_intent_review_v1:${request.recoveryId}:${"1".repeat(64)}:${"2".repeat(64)}` }) : null,
        transactionId: request.transactionId, transactionDigest: "2".repeat(64), memberCount,
        replacement: request.transactionId === "tx:unknown1" ? (window as unknown as { __recoveryReplacement?: unknown }).__recoveryReplacement ?? null : null,
        outcome: request.transactionId === "tx:accepted" ? { state: "confirmed_accepted", committed_revision: 7 }
          : request.transactionId === "tx:rejected" ? { state: "reported_rejected", reason: "target_missing", result_digest: "3".repeat(64) }
          : { state: "unresolved" },
        rows: Array.from({ length: end - start }, (_, index) => ({ personState: null, rssFeedState: null, originalEnvelopeJson: null, authorName: "Reader", itemPresent: true, itemText: "A preserved article about libraries", assigned: true, assignedAt: 1000, readAt: null, createdAt: 1000, entityId: "rss:private-item-12345678", memberIndex: start + index, operationType: "feed_item_saved_assignment" })),
      };
      }
      return previous(args);
    };
  }, cursorModulePath);
  await app.page.evaluate(async (path) => {
    const { useSettingsStore } = await import(path);
    useSettingsStore.getState().openTo("sync");
  }, settingsStorePath);
  const before = (await ipc.invocations()).length;
  await app.page.getByRole("button", { name: "Review archived edits", exact: true }).click();
  await app.page.getByRole("button", { name: "Review edit ...accepted", exact: true }).click();
  const detail = app.page.getByTestId("consumer-recovery-detail");
  await expect(detail).toContainText("Acceptance confirmed in the Library.");
  await expect(detail).toContainText("Save item and remove it from Archive");
  await expect(detail).toContainText("Current item: Reader: A preserved article about libraries");
  await expect(detail).not.toContainText("rss:private-item");
  await app.page.getByRole("button", { name: "Review edit ...rejected", exact: true }).click();
  await expect(detail).toContainText("previous Primary reported a rejection");
  await app.page.getByRole("button", { name: "Review edit ...unknown1", exact: true }).click();
  await expect(detail).toContainText("original outcome has not been established");
  await expect(detail).not.toContainText("Acceptance confirmed");
  await expect(detail).toContainText("Reviewing does not resend or change an edit.");
  await expect(detail.getByRole("button", { name: "Apply again", exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: "Next changes", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Apply again", exact: true })).toBeVisible();
  const beforeApply = (await ipc.invocations()).slice(before);
  expect(beforeApply.filter(({ cmd }) => cmd === "reapply_normalized_library_archived_assignments")).toEqual([]);
  await ipc.setHandler("reapply_normalized_library_archived_assignments", ({ request }) => {
    const input = request as { recoveryId: string; transactionId: string; memberCount: number };
    const receipt = { schemaVersion: 1, recoveryId: input.recoveryId, originalTransactionId: input.transactionId,
      replacementTransactionId: input.transactionId === "tx:rejected" ? "recovery:87654321" : "recovery:12345678", replacementTransactionDigest: "4".repeat(64),
      replacementEpochId: "b".repeat(64), replacementActorId: "c".repeat(64), firstCounter: 1,
      lastCounter: input.memberCount, memberCount: input.memberCount, createdAt: 5000 };
    (window as unknown as { __recoveryReplacement?: unknown }).__recoveryReplacement = receipt;
    return receipt;
  });
  await app.page.getByRole("button", { name: "Apply again", exact: true }).click();
  await expect(detail).toContainText("Replacement ...12345678 was stored");
  await expect(detail).toContainText("Check sync status for Primary acceptance");
  expect((await ipc.invocations()).filter(({ cmd }) => cmd === "reapply_normalized_library_archived_assignments")).toHaveLength(1);
  await app.page.getByTestId("consumer-recovery-review").screenshot({ path: testInfo.outputPath("recovery-review.png") });
  const calls = (await ipc.invocations()).slice(before);
  expect(calls.filter(({ cmd }) => /sign_normalized_library|enqueue_normalized_library_follower_intent|record_normalized_library_follower_intent/.test(cmd))).toEqual([]);
  await app.page.getByRole("button", { name: "Close review", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await app.page.getByRole("button", { name: "Review archived edits", exact: true }).click();
  await app.page.getByRole("button", { name: "Review edit ...unknown1", exact: true }).click();
  await expect(detail).toContainText("Replacement ...12345678 was stored");
  await expect(detail.getByRole("button", { name: "Apply again", exact: true })).toHaveCount(0);
  expect((await ipc.invocations()).filter(({ cmd }) => cmd === "reapply_normalized_library_archived_assignments")).toHaveLength(1);
  await app.page.getByRole("button", { name: "Close review", exact: true }).click();
  await app.page.getByRole("button", { name: "Browse recovery archives", exact: true }).click();
  await expect(app.page.getByTestId("consumer-recovery-review")).toContainText("Epoch ...77777777 to ...eeeeeeee");
  await app.page.getByTestId("consumer-recovery-review").screenshot({ path: testInfo.outputPath("recovery-archives.png") });
  await app.page.getByRole("button", { name: "Review archive ...88888888", exact: true }).click();
  await app.page.getByRole("button", { name: "Review edit ...accepted", exact: true }).click();
  await expect(detail).toContainText("accepted");
  const historyCalls = await ipc.invocations();
  expect(historyCalls.some(({ cmd, args }) => cmd === "query_normalized_library" && (args as { request?: { recoveryId?: string } })?.request?.recoveryId === "8".repeat(64))).toBe(true);
  expect(historyCalls.filter(({ cmd }) => cmd === "reapply_normalized_library_archived_assignments")).toHaveLength(1);
  await app.page.getByRole("button", { name: "Close review", exact: true }).click();
  await app.page.getByRole("button", { name: "Review archived edits", exact: true }).click();
  await app.page.getByRole("button", { name: "Review edit ...rejected", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Apply again", exact: true })).toBeVisible();
  expect((await ipc.invocations()).filter(({ cmd }) => cmd === "reapply_normalized_library_archived_assignments")).toHaveLength(1);
  await detail.getByRole("button", { name: "Apply again", exact: true }).click();
  await expect(detail).toContainText("Replacement ...87654321 was stored");
  await expect(detail).toContainText("epoch ...bbbbbbbb");
  expect((await ipc.invocations()).filter(({ cmd }) => cmd === "reapply_normalized_library_archived_assignments")).toHaveLength(2);
  await detail.screenshot({ path: testInfo.outputPath("older-replacement.png") });
  await app.page.getByRole("button", { name: "Close review", exact: true }).click();
  // Keep a native read pending through Close, including its registration ack.
  await app.page.evaluate(() => {
    const handlers = (window as unknown as { __TAURI_MOCK_HANDLERS__: Record<string, (args: { request?: Record<string, unknown>; started?: { onmessage: (ticket: string) => void } }) => unknown> }).__TAURI_MOCK_HANDLERS__;
    const previous = handlers.query_normalized_library;
    let stop: () => void = () => {};
    handlers.query_normalized_library = (args) => {
      if (args.request?.queryId !== "recovery_intent_page_v1") return previous(args);
      return new Promise((_resolve, reject) => {
        stop = () => reject(new Error("QUERY_CANCELLED"));
        args.started!.onmessage("00000000000000000000000000000002");
      });
    };
    handlers.cancel_normalized_library_query = () => { stop(); return true; };
  });
  await app.page.getByRole("button", { name: "Review archived edits", exact: true }).click();
  await expect(app.page.getByTestId("consumer-recovery-review")).toContainText("Verifying archived edits");
  await app.page.getByRole("button", { name: "Close review", exact: true }).click();
  await expect.poll(async () => (await ipc.invocations()).filter(({ cmd }) => cmd === "cancel_normalized_library_query").length).toBe(1);
  await expect(app.page.getByTestId("consumer-recovery-review")).not.toContainText("could not be verified");

});

for (const mode of ["rss", "subscriptions", "annotations", "items", "accounts", "people", "person-records", "account-removal", "account-records", "reach-outs", "preferences"] as const) {
test(`${mode} recovery retries one signed replacement after response loss`, async ({ app, ipc }, testInfo) => {
  await app.goto(); await app.waitForReady();
  await ipc.setHandler("normalized_desktop_installation_status", () => ({ state: "editable_consumer", role: "follower", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) }));
  await ipc.setHandler("read_normalized_library_consumer_recovery", () => ({ recoveryId: "d".repeat(64), libraryId: "a".repeat(64), predecessorEpochId: "e".repeat(64), successorEpochId: "b".repeat(64), state: "following", archivedPendingEdits: 1, archivedPublishedEdits: 0 }));
  await app.page.evaluate((mode) => {
    const handlers = (window as unknown as { __TAURI_MOCK_HANDLERS__: Record<string, (args: any) => unknown> }).__TAURI_MOCK_HANDLERS__;
    const previous = handlers.query_normalized_library;
    handlers.query_normalized_library = (args) => {
      const r = args.request;
      const source = { generationId: "f".repeat(64), projectionRevision: 7, transitionSequence: 9 };
      if (mode === "preferences" && r.queryId === "preference_value_v1") return { queryId: r.queryId, schemaVersion: 1, path: r.path, kind: "absent", rows: [], source: { ...source, transitionSequence: 7 } };
      if (mode === "preferences" && r.queryId === "preferences_snapshot_v1") return { queryId: r.queryId, schemaVersion: 1, rows: [], source: { ...source, transitionSequence: 7 } };
      if (r.queryId === "recovery_intent_page_v1") return { queryId: r.queryId, schemaVersion: 1, recoveryId: r.recoveryId, archiveDigest: "1".repeat(64), source: { ...source, transitionSequence: 7 }, nextCursor: null, rows: [{ ordinal: 0, transactionId: "tx:rssnames" }] };
      if (r.queryId === "recovery_intent_review_v1") return { queryId: r.queryId, schemaVersion: 1, recoveryId: r.recoveryId, archiveDigest: "1".repeat(64), source, nextCursor: null, transactionId: r.transactionId, transactionDigest: "2".repeat(64), memberCount: 2, replacement: null, outcome: { state: "unresolved" }, rows: [0, 1].map((i) => ({
        personState: mode === "reach-outs" ? "present" : (mode === "people" || mode === "person-records") ? "absent" : null, rssFeedState: mode === "subscriptions" && i === 1 ? "absent" : mode === "rss" || mode === "subscriptions" ? "present" : null, originalEnvelopeJson: r.includeOriginal ? JSON.stringify({ blob_references: [], entity_id: mode === "preferences" ? "preferences" : `https://example.com/feed-${i}`, entity_type: mode === "preferences" ? "UserPreferences" : (mode === "reach-outs" || mode === "people" || mode === "person-records") ? "Person" : (mode === "accounts" || mode === "account-removal" || mode === "account-records") ? "Account" : mode === "rss" || mode === "subscriptions" ? "RssFeed" : "FeedItem", operation_id: `archived:event:${i}`, operation_type: mode === "preferences" ? "preferences_leaf_assignment" : mode === "reach-outs" ? "person_reach_out_append" : mode === "account-records" ? "account_upsert" : mode === "account-removal" ? "account_remove" : mode === "person-records" ? "person_upsert" : mode === "people" ? "person_remove_and_accounts" : mode === "accounts" ? "account_person_assignment" : mode === "rss" ? "rss_feed_title_assignment" : mode === "subscriptions" ? "rss_feed_upsert" : mode === "items" ? "feed_item_remove" : "feed_item_annotations_replace", payload: mode === "preferences" ? { updates: i === 0 ? { weights: { topics: { alpha: { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" } } } } : { display: { showEngagementCounts: false } } } : mode === "reach-outs" ? { channel: "email", logged_at_ms: 1000 + i, notes: `Archived event ${i}` } : mode === "account-records" ? { account: { createdAt: 1, discoveredFrom: "manual_entry", displayName: `Archived ${i}`, externalId: `external:${i}`, firstSeenAt: 1, id: `https://example.com/feed-${i}`, kind: "social", lastSeenAt: 2, provider: "x", updatedAt: 2 } } : mode === "person-records" ? { person: { careLevel: 3, createdAt: 1, id: `https://example.com/feed-${i}`, name: `Archived ${i}`, relationshipStatus: "friend", updatedAt: 2 } } : mode === "accounts" ? { assigned_at_ms: 1000, person_id: "person:missing" } : mode === "subscriptions" ? { feed: { enabled: false, lastFetched: 10, pollInterval: 5, title: `Archived ${i}`, trackUnread: false, url: `https://example.com/feed-${i}` } } : mode === "rss" ? { assigned_at_ms: 1000, title: `Archived ${i}` } : (mode === "items" || mode === "people" || mode === "account-removal") ? { removed_at_ms: 1000 } : { assigned_at_ms: 1000, highlights: [
          { createdAt: 1, note: "Archived note", text: "\u2063", textBlobDigest: null },
          { createdAt: 2, note: "Quotation note", text: "Keep this quotation", textBlobDigest: null },
          { createdAt: 3, note: null, text: null, textBlobDigest: "6".repeat(64) },
        ], tags: ["alpha", "zebra"] }, schema_version: 1, transaction_digest: "2".repeat(64), transaction_id: r.transactionId, transaction_member_count: 2, transaction_member_index: i }) : null,
        authorName: null, itemPresent: mode === "annotations" ? true : mode === "items" ? false : null, itemText: mode === "annotations" ? "An article with annotations" : null, assigned: null, assignedAt: null, readAt: null, createdAt: 1000, entityId: mode === "preferences" ? "preferences" : `https://example.com/feed-${i}`, memberIndex: i, operationType: mode === "preferences" ? "preferences_leaf_assignment" : mode === "reach-outs" ? "person_reach_out_append" : mode === "account-records" ? "account_upsert" : mode === "account-removal" ? "account_remove" : mode === "person-records" ? "person_upsert" : mode === "people" ? "person_remove_and_accounts" : mode === "accounts" ? "account_person_assignment" : mode === "rss" ? "rss_feed_title_assignment" : mode === "subscriptions" ? "rss_feed_upsert" : mode === "items" ? "feed_item_remove" : "feed_item_annotations_replace",
      })) };
      if (r.queryId === "rss_feed_detail_v1" && mode === "subscriptions" && r.url.endsWith("-1")) return { queryId: r.queryId, schemaVersion: 1, source: { ...source, transitionSequence: 7 }, feed: null };
      if (mode === "account-records" && r.queryId === "account_root_v1") return { queryId: r.queryId, schemaVersion: 1, accountId: r.accountId, source, account: null };
      if (mode === "account-removal" && r.queryId === "account_detail_v1") return { queryId: r.queryId, schemaVersion: 1, source, account: null };
      if (mode === "accounts" && r.queryId === "account_detail_v1") return { queryId: r.queryId, schemaVersion: 1, source, account: {
        id: r.accountId, personId: null, kind: "social", provider: "x", externalId: "original", displayName: "Original account", handle: null,
        address: null, avatarUrl: null, email: null, phone: null, profileUrl: null, importedAt: null,
        createdAt: 1, updatedAt: 1, firstSeenAt: 1, lastSeenAt: 1, discoveredFrom: "manual",
        followRosterActive: null, followRosterRoles: [], followRosterSyncedAt: null, sampleBatchId: null, sampleGeneratedAt: null, sampleGeneratorVersion: null,
      } };
      if (mode === "reach-outs" && r.queryId === "person_detail_v1") return { queryId: r.queryId, schemaVersion: 1, source, linkedAccounts: [], linkedAccountCount: 0, person: {
        id: r.personId, name: "Current person", avatarUrl: null, bio: null, careLevel: 3, createdAt: 1, updatedAt: 2, notes: null,
        reachOutIntervalDays: null, reachOuts: [{ reachOutId: "current:other", loggedAt: 2000, channel: "phone", notes: "Recent conversation" }], relationshipStatus: "friend", sampleBatchId: null, sampleGeneratedAt: null, sampleGeneratorVersion: null, tags: [],
      } };
      if (mode === "person-records" && r.queryId === "person_root_v1") return { queryId: r.queryId, schemaVersion: 1, personId: r.personId, source, person: null };
      if ((mode === "accounts" || mode === "people") && r.queryId === "person_detail_v1") return { queryId: r.queryId, schemaVersion: 1, source, person: null, linkedAccounts: [], linkedAccountCount: 0 };
      if (mode === "accounts" && r.queryId === "person_picker_page_v1") return { queryId: r.queryId, schemaVersion: 1, source, rows: [{ id: "person:chosen", name: "Chosen person", avatarUrl: null, careLevel: 3, relationshipStatus: "friend" }] };
      if (r.queryId === "rss_feed_detail_v1") return { queryId: r.queryId, schemaVersion: 1, source: { ...source, transitionSequence: 7 }, feed: { enabled: true, folder: null, imageUrl: null, lastFetched: 900, pollInterval: 60, sampleBatchId: null, sampleGeneratedAt: null, sampleGeneratorVersion: null, siteUrl: null, title: "Current name", trackUnread: true, updatedAt: 1000, url: r.url } };
      if (r.queryId === "item_annotations_v1") return { queryId: r.queryId, schemaVersion: 1, globalId: r.globalId, source: { ...source, transitionSequence: 7 }, tags: ["current"], highlights: [{ createdAt: 4, note: "Last-synced note", text: "\u2063", textBlobDigest: null }] };
      return previous(args);
    };
    let receipt: unknown = null;
    handlers.reapply_normalized_library_archived_editor_transaction = ({ request, canonicalEnvelopeJson }) => {
      if (receipt) return receipt;
      const first = JSON.parse(canonicalEnvelopeJson[0]);
      receipt = { schemaVersion: 1, recoveryId: request.recoveryId, originalTransactionId: request.transactionId, replacementTransactionId: first.transaction_id, replacementTransactionDigest: first.transaction_digest, replacementEpochId: "b".repeat(64), replacementActorId: "c".repeat(64), firstCounter: 1, lastCounter: 2, memberCount: 2, createdAt: 5000 };
      throw new Error("Simulated response loss after durable commit");
    };
  }, mode);
  await ipc.setHandler("normalized_library_follower_mutation_context", () => ({ libraryId: "a".repeat(64), epoch: 2, epochId: "b".repeat(64), actorId: "c".repeat(64), actorPublicKey: "23".repeat(32), nextCounter: 1, previousOperationId: null, previousChainDigest: "34".repeat(32), observedFrontier: [] }));
  await ipc.setHandler("sign_normalized_library_follower_operation", ({ request }) => ({ ...(request as { actorId: string; operationSigningBodyDigest: string }), signature: "45".repeat(64) }));
  await app.page.evaluate(async (path) => { const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync"); }, settingsStorePath);
  const before = (await ipc.invocations()).length;
  await app.page.getByRole("button", { name: "Review archived edits", exact: true }).click();
  await app.page.getByRole("button", { name: "Review edit ...rssnames", exact: true }).click();
  if (mode === "people") await expect(app.page.getByTestId("consumer-recovery-detail")).toContainText("Person is currently absent. This does not prove whether the original edit was accepted.");
  await app.page.getByRole("button", { name: mode === "preferences" ? "Review preferences" : mode === "reach-outs" ? "Review reach-out history" : mode === "account-records" ? "Review account details" : mode === "account-removal" ? "Review account deletion" : mode === "person-records" ? "Review people" : mode === "people" ? "Review people deletion" : mode === "accounts" ? "Review account links" : mode === "rss" ? "Review feed names" : mode === "subscriptions" ? "Review subscription settings" : mode === "items" ? "Review item deletion" : "Review notes, highlights and tags", exact: true }).click();
  const editor = app.page.getByTestId(mode === "preferences" ? "recovery-preference-editor" : mode === "reach-outs" ? "recovery-reach-out-editor" : mode === "account-records" ? "recovery-account-editor" : mode === "person-records" ? "recovery-person-editor" : mode === "accounts" ? "recovery-account-link-editor" : mode === "rss" ? "recovery-rss-editor" : mode === "subscriptions" ? "recovery-rss-upsert-editor" : (mode === "items" || mode === "people" || mode === "account-removal") ? "recovery-item-removal-editor" : "recovery-annotation-editor");
  if (mode === "rss") await expect(editor).toContainText("Last synced: Current name");
  else if (mode === "annotations") {
    await editor.getByText("Last-synced annotations", { exact: true }).click();
    await expect(editor).toContainText("Last-synced note");
  }
  await expect(editor.getByRole("alert")).toHaveCount(0);
  if (mode === "rss") await editor.getByLabel("Feed name 1", { exact: true }).fill("  Revised first  ");
  else if (mode === "annotations") {
    await editor.getByRole("textbox", { name: "Note", exact: true }).fill("Revised first note");
    await expect(editor.getByRole("button", { name: "Store revised annotations", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "Next item", exact: true }).click();
    await expect(editor).toContainText("Item 2 of 2");
    await expect(editor.getByRole("button", { name: "Store revised annotations", exact: true })).toBeEnabled();
  }
  if (mode === "subscriptions") {
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Current name");
    await editor.getByLabel("Name", { exact: true }).fill("Revised subscription");
    await expect(editor.getByRole("button", { name: "Store revised subscriptions", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "Next subscription", exact: true }).click();
    await expect(editor).toContainText("has not been created");
    await expect(editor.getByRole("checkbox", { name: "Enable polling", exact: true })).not.toBeChecked();
    await expect(editor.getByRole("button", { name: "Store revised subscriptions", exact: true })).toBeDisabled();
    await editor.getByRole("checkbox", { name: "Apply the reviewed settings to every subscription, including any polling changes.", exact: true }).check();
    await editor.getByLabel("Folder", { exact: true }).fill("Recovered");
    await expect(editor.getByRole("button", { name: "Store revised subscriptions", exact: true })).toBeDisabled();
    await editor.getByRole("checkbox", { name: "Apply the reviewed settings to every subscription, including any polling changes.", exact: true }).check();
  }
  if (mode === "preferences") {
    const submit = editor.getByRole("button", { name: "Store revised preferences", exact: true });
    await expect(submit).toBeDisabled();
    await editor.getByLabel("Value to apply", { exact: true }).fill("0.375");
    await app.page.screenshot({ path: testInfo.outputPath("preference-recovery-top.png") });
    await editor.getByRole("button", { name: "Next setting", exact: true }).click();
    await expect(editor).toContainText("Setting 2 of 2");
    const confirm = editor.getByLabel("Confirm preference recovery", { exact: true });
    await confirm.check();
    await editor.getByLabel("Value to apply", { exact: true }).check();
    await expect(confirm).not.toBeChecked();
    await confirm.check();
    await submit.scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("preference-recovery-bottom.png") });
  }
  if (mode === "reach-outs") {
    await expect(editor).toContainText("Recent conversation");
    await expect(editor.getByRole("button", { name: "Store revised history", exact: true })).toBeDisabled();
    await editor.getByLabel("Notes", { exact: true }).fill("Revised historical note");
    await editor.getByRole("button", { name: "Next event", exact: true }).click();
    await expect(editor).toContainText("Event 2 of 2");
    await editor.getByRole("checkbox").check();
    await editor.getByLabel("Channel", { exact: true }).selectOption("phone");
    await expect(editor.getByRole("checkbox")).not.toBeChecked();
    await editor.getByRole("checkbox").check();
  }
  if (mode === "account-records") {
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Archived 0");
    await expect(editor.getByLabel("Avatar URL", { exact: true })).toHaveValue("");
    await editor.getByLabel("Address", { exact: true }).fill("a".repeat(65536));
    await expect(editor.getByRole("alert")).toContainText("invalid or too large");
    await expect(editor.getByLabel("Address", { exact: true })).toHaveValue("");
    await editor.getByLabel("Name", { exact: true }).fill("Revised account");
    await editor.getByRole("checkbox").check();
    await expect(editor.getByRole("button", { name: "Store revised accounts", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "Next account", exact: true }).click();
    await editor.getByLabel("Email", { exact: true }).fill("recovered@example.com");
    await expect(editor.getByRole("checkbox")).not.toBeChecked();
    await editor.getByRole("checkbox").check();
  }
  if (mode === "person-records") {
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Archived 0");
    await expect(editor.getByLabel("Avatar URL", { exact: true })).toHaveValue("");
    await editor.getByLabel("Name", { exact: true }).fill("Revised person");
    await editor.getByRole("checkbox").check();
    await expect(editor.getByRole("button", { name: "Store revised people", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "Next person", exact: true }).click();
    await editor.getByLabel("Notes", { exact: true }).fill("Recovered notes");
    await expect(editor.getByRole("checkbox")).not.toBeChecked();
    await editor.getByRole("checkbox").check();
  }
  if (mode === "accounts") {
    await expect(editor).toContainText("(absent)");
    await editor.getByRole("button", { name: "Select Chosen person (...n:chosen)", exact: true }).click();
    await editor.getByRole("checkbox").check();
    await expect(editor.getByRole("button", { name: "Store account links", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "Next account", exact: true }).click();
    await editor.getByRole("button", { name: "Unlink account", exact: true }).click();
    await expect(editor.getByRole("checkbox")).not.toBeChecked();
    await editor.getByRole("checkbox").check();
  }
  if (mode === "items" || mode === "people" || mode === "account-removal") {
    if (mode === "people") await expect(editor).toContainText("including links added since this review");
    await expect(editor).toContainText("Currently absent. This target remains in the deletion.");
    await expect(editor.getByRole("button", { name: mode === "preferences" ? "Store revised preferences" : mode === "reach-outs" ? "Store revised history" : mode === "account-records" ? "Store revised accounts" : mode === "account-removal" ? "Store account deletion" : mode === "person-records" ? "Store revised people" : mode === "people" ? "Store people deletion" : "Store item deletion", exact: true })).toBeDisabled();
    await editor.getByRole("checkbox").check();
  }
  expect((await ipc.invocations()).slice(before).filter(({ cmd }) => cmd === "sign_normalized_library_follower_operation")).toHaveLength(0);
  if (mode === "annotations") {
    await editor.getByRole("textbox", { name: "Note", exact: true }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("annotations-recovery-top.png") });
    await editor.getByRole("button", { name: "Store revised annotations", exact: true }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("annotations-recovery-bottom.png") });
  } else if (mode === "reach-outs") {
    await editor.getByText("Review every historical reach-out", { exact: false }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("reach-out-recovery-top.png") });
    await editor.getByRole("button", { name: "Store revised history", exact: true }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("reach-out-recovery-bottom.png") });
  } else if (mode === "account-records") {
    await editor.getByText("Review every original account.", { exact: false }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("account-records-recovery-top.png") });
    await editor.getByRole("button", { name: "Store revised accounts", exact: true }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("account-records-recovery-bottom.png") });
  } else if (mode === "person-records") {
    await editor.getByText("Review every person and tag.", { exact: false }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("person-records-recovery-top.png") });
    await editor.getByRole("button", { name: "Store revised people", exact: true }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("person-records-recovery-bottom.png") });
  } else if (mode === "subscriptions") {
    await editor.getByText("Review every subscription.", { exact: false }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("subscriptions-recovery-top.png") });
    await editor.getByRole("button", { name: "Store revised subscriptions", exact: true }).scrollIntoViewIfNeeded();
    await app.page.screenshot({ path: testInfo.outputPath("subscriptions-recovery-bottom.png") });
  } else await editor.screenshot({ path: testInfo.outputPath(`${mode}-recovery-editor.png`) });
  await editor.getByRole("button", { name: mode === "preferences" ? "Store revised preferences" : mode === "reach-outs" ? "Store revised history" : mode === "account-records" ? "Store revised accounts" : mode === "account-removal" ? "Store account deletion" : mode === "person-records" ? "Store revised people" : mode === "people" ? "Store people deletion" : mode === "accounts" ? "Store account links" : mode === "rss" ? "Store revised names" : mode === "subscriptions" ? "Store revised subscriptions" : mode === "items" ? "Store item deletion" : "Store revised annotations", exact: true }).click();
  await expect(editor).toContainText("No replacement was confirmed");
  await editor.getByRole("button", { name: mode === "preferences" ? "Retry same preference edit" : mode === "reach-outs" ? "Retry same reach-out edit" : mode === "account-records" ? "Retry same Account edit" : mode === "account-removal" ? "Store account deletion" : mode === "person-records" ? "Store revised people" : mode === "people" ? "Store people deletion" : mode === "accounts" ? "Store account links" : mode === "rss" ? "Store revised names" : mode === "subscriptions" ? "Store revised subscriptions" : mode === "items" ? "Store item deletion" : "Store revised annotations", exact: true }).click();
  await expect(app.page.getByTestId("consumer-recovery-detail")).toContainText("was stored");
  const calls = (await ipc.invocations()).slice(before);
  const submissions = calls.filter(({ cmd }) => cmd === "reapply_normalized_library_archived_editor_transaction");
  expect(submissions).toHaveLength(2); expect(submissions[0].args).toEqual(submissions[1].args);
  const frames = (submissions[0].args as { canonicalEnvelopeJson: string[] }).canonicalEnvelopeJson;
  if (mode === "preferences") {
    const selectedReads = calls.filter(({ cmd, args }) => cmd === "query_normalized_library" && (args as { request?: { queryId?: string } }).request?.queryId === "preference_value_v1");
    expect(selectedReads.map(({ args }) => (args as { request: { path: string[] } }).request.path)).toEqual([["weights", "topics", "alpha"], ["display", "showEngagementCounts"]]);
    const values = frames.map(value => JSON.parse(value));
    expect(values.map(value => value.entity_id)).toEqual(["preferences", "preferences"]);
    expect(values[0].payload.updates.weights.topics.alpha).toEqual({ bits: "3fd8000000000000", codec: "ieee754_binary64_hex_v1" });
    expect(values[1].payload.updates.display.showEngagementCounts).toBe(true);
  } else if (mode === "reach-outs") {
    const values = frames.map(value => JSON.parse(value));
    expect(values.map(value => value.payload.logged_at_ms)).toEqual([1000, 1001]);
    expect(values.map(value => value.payload.notes)).toEqual(["Revised historical note", "Archived event 1"]);
    expect(values[1].payload.channel).toBe("phone");
  }

  else if (mode === "account-records") {
    const accounts = frames.map(value => JSON.parse(value).payload.account);
    expect(accounts.map(account => account.displayName)).toEqual(["Revised account", "Archived 1"]);
    expect(accounts[1].email).toBe("recovered@example.com");
    expect(accounts.every(account => account.createdAt === 1 && account.updatedAt > 2 && !Object.hasOwn(account, "avatarUrl"))).toBe(true);
  }
  else if (mode === "person-records") {
    const people = frames.map(value => JSON.parse(value).payload.person);
    expect(people.map(person => person.name)).toEqual(["Revised person", "Archived 1"]);
    expect(people[1].notes).toBe("Recovered notes");
    expect(people.every(person => person.createdAt === 1 && person.updatedAt > 2 && !Object.hasOwn(person, "avatarUrl"))).toBe(true);
  }
  else if (mode === "accounts") expect(frames.map(value => JSON.parse(value).payload.person_id)).toEqual(["person:chosen", null]);
  else if (mode === "rss") expect(frames.map((value) => JSON.parse(value).payload.title)).toEqual(["Revised first", "Archived 1"]);
  else if (mode === "subscriptions") {
    const feeds = frames.map((value) => JSON.parse(value).payload.feed);
    expect(feeds.map((feed) => feed.title)).toEqual(["Revised subscription", "Archived 1"]);
    expect(feeds[1].folder).toBe("Recovered");
    expect(feeds[0]).toMatchObject({ lastFetched: 900, pollInterval: 60, enabled: true });
    expect(feeds[1].enabled).toBe(false);
    expect(feeds[1]).not.toHaveProperty("lastFetched");
    expect(feeds[1]).not.toHaveProperty("pollInterval");
  } else if (mode === "items" || mode === "people" || mode === "account-removal") {
    const envelopes = frames.map((value) => JSON.parse(value));
    expect(envelopes.map((value) => value.entity_id)).toEqual(["https://example.com/feed-0", "https://example.com/feed-1"]);
    expect(envelopes.every((value) => value.operation_type === (mode === "account-removal" ? "account_remove" : mode === "people" ? "person_remove_and_accounts" : "feed_item_remove") && value.payload.removed_at_ms > 1000)).toBe(true);
  } else {
    const payloads = frames.map((value) => JSON.parse(value).payload);
    expect(payloads.map((p) => p.highlights[0].note)).toEqual(["Revised first note", "Archived note"]);
    expect(payloads.every((p) => p.highlights.length === 3 && p.highlights[1].text === "Keep this quotation" && p.highlights[1].note === "Quotation note" && p.highlights[2].textBlobDigest === "6".repeat(64))).toBe(true);
    expect(payloads.map((p) => p.tags)).toEqual([["alpha", "zebra"], ["alpha", "zebra"]]);
  }
  expect(calls.filter(({ cmd }) => cmd === "sign_normalized_library_follower_operation")).toHaveLength(2);
  expect(calls.filter(({ cmd }) => cmd === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
});

}

for (const demoted of [false, true]) {
test(`${demoted ? "demoted former" : "promoted"} Primary archive recovery follows its current role`, async ({ app, ipc }, testInfo) => {
  await app.goto(); await app.waitForReady();
  await ipc.setHandler("normalized_desktop_installation_status", () => ({
    state: "shared_primary", role: "primary", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64),
  }));
  await ipc.setHandler("read_normalized_library_handoff_status", () => ({
    handoffId: "9".repeat(64), libraryId: "a".repeat(64), installationRole: "target", phase: "active",
    predecessorEpochId: "e".repeat(64), successorEpochId: "b".repeat(64), canonicalReadiness: "{}",
    canonicalAuthorizationBody: "body", canonicalAuthorization: "grant", canonicalActivation: "activation",
    expectedControlRevision: "before", observedControlRevision: "after", updatedAtMs: 1,
  }));
  await app.page.evaluate(() => {
    const handlers = (window as any).__TAURI_MOCK_HANDLERS__;
    const previous = handlers.query_normalized_library;
    handlers.query_normalized_library = (args: any) => {
      const request = args.request;
      const source = { generationId: "f".repeat(64), projectionRevision: 7, transitionSequence: 7 };
      if (request.queryId === "recovery_archive_page_v1") return {
        queryId: request.queryId, schemaVersion: 1, handoffId: "9".repeat(64), source, nextCursor: null,
        rows: [{ recoveryId: "8".repeat(64), predecessorEpochId: "7".repeat(64), successorEpochId: "e".repeat(64), pendingEdits: 1, publishedEdits: 0, createdAt: 1 }],
      };
      if (request.queryId === "recovery_intent_page_v1") return {
        queryId: request.queryId, schemaVersion: 1, recoveryId: request.recoveryId, archiveDigest: "1".repeat(64), source, nextCursor: null,
        rows: [{ ordinal: 0, transactionId: "tx:unknown1" }],
      };
      if (request.queryId === "recovery_intent_review_v1") return {
        queryId: request.queryId, schemaVersion: 1, recoveryId: request.recoveryId, archiveDigest: "1".repeat(64), source, nextCursor: null,
        transactionId: request.transactionId, transactionDigest: "2".repeat(64), memberCount: 1, replacement: null, outcome: { state: "unresolved" },
        rows: [{ personState: null, rssFeedState: null, originalEnvelopeJson: null, authorName: "Reader", itemPresent: true, itemText: "Preserved through promotion", assigned: true, assignedAt: 1000, readAt: null, createdAt: 1000, entityId: "rss:private-item-12345678", memberIndex: 0, operationType: "feed_item_saved_assignment" }],
      };
      return previous(args);
    };
  });
  if (demoted) await app.page.evaluate(() => {
    const handlers = (window as any).__TAURI_MOCK_HANDLERS__;
    const originalStatus = handlers.read_normalized_library_handoff_status;
    handlers.read_normalized_library_handoff_status = () => ({ ...originalStatus(), installationRole: "source", phase: "demoted" });
    handlers.normalized_desktop_installation_status = () => ({ state: "editable_consumer", role: "follower", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) });
  });
  await app.page.evaluate(async path => {
    const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync");
  }, settingsStorePath);
  const panel = app.page.getByRole("region", { name: "Primary transfer" });
  await expect(panel).toContainText(demoted ? "Former Primary" : "Activation saved");
  const beforeReview = (await ipc.invocations()).length;
  await panel.getByRole("button", { name: "Browse recovery archives", exact: true }).click();
  await panel.getByRole("button", { name: "Review archive ...88888888", exact: true }).click();
  await panel.getByRole("button", { name: "Review edit ...unknown1", exact: true }).click();
  await expect(panel).toContainText("Preserved through promotion");
  await expect(panel).toContainText("The original outcome has not been established.");
  expect((await ipc.invocations()).slice(beforeReview).filter(({ cmd }) => /reapply_normalized_library|enqueue_normalized_library_follower_intent|sign_normalized_library/.test(cmd))).toEqual([]);
  if (demoted) {
    await ipc.setHandler("reapply_normalized_library_archived_assignments", ({ request }) => {
      const input = request as { recoveryId: string; transactionId: string; memberCount: number };
      return { schemaVersion: 1, recoveryId: input.recoveryId, originalTransactionId: input.transactionId,
        replacementTransactionId: "recovery:former-primary", replacementTransactionDigest: "4".repeat(64),
        replacementEpochId: "b".repeat(64), replacementActorId: "c".repeat(64), firstCounter: 1,
        lastCounter: input.memberCount, memberCount: input.memberCount, createdAt: 5000 };
    });
    await panel.getByRole("button", { name: "Apply again", exact: true }).click();
    await expect(panel).toContainText("Replacement ...-primary was stored");
    expect((await ipc.invocations()).slice(beforeReview).filter(({ cmd }) => cmd === "reapply_normalized_library_archived_assignments")).toHaveLength(1);
  } else {
    await expect(panel.getByRole("button", { name: "Apply again", exact: true })).toHaveCount(0);
  }
  await panel.getByTestId("consumer-recovery-review").screenshot({ path: testInfo.outputPath(demoted ? "demoted-archive-review.png" : "primary-archive-review.png") });
});

}

// Tier 1 workflow: Person confirmation must not sign, account review must be
// complete, and an ambiguous native commit must retry the identical envelope.
test("Friend recovery reviews both steps and retries one complete replacement", async ({ app, ipc }, testInfo) => {
  await app.goto(); await app.waitForReady();
  await ipc.setHandler("normalized_desktop_installation_status", () => ({ state: "editable_consumer", role: "follower", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) }));
  await ipc.setHandler("read_normalized_library_consumer_recovery", () => ({ recoveryId: "d".repeat(64), libraryId: "a".repeat(64), predecessorEpochId: "e".repeat(64), successorEpochId: "b".repeat(64), state: "following", archivedPendingEdits: 1, archivedPublishedEdits: 0 }));
  await app.page.evaluate(() => {
    const handlers = (window as unknown as { __TAURI_MOCK_HANDLERS__: Record<string, (args: any) => unknown> }).__TAURI_MOCK_HANDLERS__;
    const previous = handlers.query_normalized_library;
    const source = { generationId: "f".repeat(64), projectionRevision: 7, transitionSequence: 9 };
    const person = { careLevel: 3, createdAt: 1, id: "person:friend", name: "Archived Friend", relationshipStatus: "friend", updatedAt: 2 };
    const accounts = ["one", "two"].map(id => ({ createdAt: 1, discoveredFrom: "manual_entry", externalId: id, firstSeenAt: 1, id: `account:${id}`, kind: "social", lastSeenAt: 2, personId: person.id, provider: "instagram", updatedAt: 2 }));
    const originalEnvelopeJson = JSON.stringify({ blob_references: [], entity_id: person.id, entity_type: "Person", operation_type: "friend_replace", payload: { accounts, person }, schema_version: 1, transaction_digest: "2".repeat(64), transaction_id: "tx:friend01", transaction_member_count: 1, transaction_member_index: 0 });
    handlers.query_normalized_library = args => {
      const r = args.request;
      if (r.queryId === "recovery_intent_page_v1") return { queryId: r.queryId, schemaVersion: 1, recoveryId: r.recoveryId, archiveDigest: "1".repeat(64), source: { ...source, transitionSequence: 7 }, nextCursor: null, rows: [{ ordinal: 0, transactionId: "tx:friend01" }] };
      if (r.queryId === "recovery_intent_review_v1") return { queryId: r.queryId, schemaVersion: 1, recoveryId: r.recoveryId, archiveDigest: "1".repeat(64), source, nextCursor: null, transactionId: r.transactionId, transactionDigest: "2".repeat(64), memberCount: 1, replacement: null, outcome: { state: "unresolved" }, rows: [{ personState: "absent", rssFeedState: null, originalEnvelopeJson: r.includeOriginal ? originalEnvelopeJson : null, authorName: null, itemPresent: null, itemText: null, assigned: null, assignedAt: null, readAt: null, createdAt: 1000, entityId: person.id, memberIndex: 0, operationType: "friend_replace" }] };
      if (r.queryId === "person_root_v1") return { queryId: r.queryId, schemaVersion: 1, personId: r.personId, source, person: null };
      if (r.queryId === "person_account_page_v1") return { queryId: r.queryId, schemaVersion: 1, personId: r.personId, source: { ...source, transitionSequence: 7 }, rows: [], nextCursor: null };
      if (r.queryId === "account_root_v1") return { queryId: r.queryId, schemaVersion: 1, accountId: r.accountId, source, account: null };
      return previous(args);
    };
    let receipt: unknown = null;
    handlers.reapply_normalized_library_archived_editor_transaction = ({ request, canonicalEnvelopeJson }) => {
      if (receipt) return receipt;
      const first = JSON.parse(canonicalEnvelopeJson[0]);
      receipt = { schemaVersion: 1, recoveryId: request.recoveryId, originalTransactionId: request.transactionId, replacementTransactionId: first.transaction_id, replacementTransactionDigest: first.transaction_digest, replacementEpochId: "b".repeat(64), replacementActorId: "c".repeat(64), firstCounter: 1, lastCounter: 1, memberCount: 1, createdAt: 5000 };
      throw new Error("Simulated response loss after durable commit");
    };
  });
  await ipc.setHandler("normalized_library_follower_mutation_context", () => ({ libraryId: "a".repeat(64), epoch: 2, epochId: "b".repeat(64), actorId: "c".repeat(64), actorPublicKey: "23".repeat(32), nextCounter: 1, previousOperationId: null, previousChainDigest: "34".repeat(32), observedFrontier: [] }));
  await ipc.setHandler("sign_normalized_library_follower_operation", ({ request }) => ({ ...(request as { actorId: string; operationSigningBodyDigest: string }), signature: "45".repeat(64) }));
  await app.page.evaluate(async path => { const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync"); }, settingsStorePath);
  const before = (await ipc.invocations()).length;
  await app.page.getByRole("button", { name: "Review archived edits", exact: true }).click();
  await app.page.getByRole("button", { name: "Review edit ...friend01", exact: true }).click();
  await app.page.getByRole("button", { name: "Review Friend and accounts", exact: true }).click();
  const personEditor = app.page.getByTestId("recovery-person-editor");
  await personEditor.getByLabel("Name", { exact: true }).fill("Reviewed Friend");
  await personEditor.getByRole("checkbox").check();
  await personEditor.getByRole("button", { name: "Review account selection", exact: true }).click();
  const editor = app.page.getByTestId("recovery-friend-editor");
  await expect(editor).toContainText("omitted contact account is deleted");
  await expect(editor).toContainText("This account is currently absent");
  await expect(editor.getByLabel("Include this account", { exact: true })).not.toBeChecked();
  await editor.getByLabel("Include this account", { exact: true }).check();
  const confirm = editor.getByLabel("Apply this complete Friend replacement, including account moves, omissions and avatar URL changes.", { exact: true });
  await confirm.check();
  const submit = editor.getByRole("button", { name: "Store revised Friend", exact: true });
  await expect(submit).toBeDisabled();
  await editor.getByRole("button", { name: "Next account", exact: true }).click();
  await expect(editor).toContainText("Account 2 of 2");
  await expect(submit).toBeEnabled();
  await editor.getByLabel("Include this account", { exact: true }).check();
  await expect(confirm).not.toBeChecked();
  await editor.getByLabel("Include this account", { exact: true }).uncheck();
  await confirm.check();
  expect((await ipc.invocations()).slice(before).filter(({ cmd }) => /sign_normalized_library|reapply_normalized_library/.test(cmd))).toHaveLength(0);
  await expect(editor.locator("img")).toHaveCount(0);
  await editor.getByText("Choose the complete account set", { exact: false }).scrollIntoViewIfNeeded();
  await app.page.screenshot({ path: testInfo.outputPath("friend-recovery-top.png") });
  await submit.scrollIntoViewIfNeeded();
  await app.page.screenshot({ path: testInfo.outputPath("friend-recovery-bottom.png") });
  await submit.click();
  await expect(editor).toContainText("No replacement was confirmed");
  await expect(editor.getByLabel("Include this account", { exact: true })).toBeDisabled();
  await submit.click();
  await expect(app.page.getByTestId("consumer-recovery-detail")).toContainText("was stored");
  const calls = (await ipc.invocations()).slice(before);
  const submissions = calls.filter(({ cmd }) => cmd === "reapply_normalized_library_archived_editor_transaction");
  expect(submissions).toHaveLength(2);
  expect(submissions[0].args).toEqual(submissions[1].args);
  const frames = (submissions[0].args as { canonicalEnvelopeJson: string[] }).canonicalEnvelopeJson;
  expect(frames).toHaveLength(1);
  const envelope = JSON.parse(frames[0]);
  expect(envelope.operation_type).toBe("friend_replace");
  expect(envelope.payload.person.name).toBe("Reviewed Friend");
  expect(envelope.payload.accounts.map((account: { id: string }) => account.id)).toEqual(["account:one"]);
  expect(envelope.payload.person.updatedAt).toBeGreaterThan(2);
  expect(envelope.payload.accounts[0].updatedAt).toBeGreaterThan(2);
  expect(calls.filter(({ cmd }) => cmd === "sign_normalized_library_follower_operation")).toHaveLength(1);
  expect(calls.filter(({ cmd }) => cmd === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
});
