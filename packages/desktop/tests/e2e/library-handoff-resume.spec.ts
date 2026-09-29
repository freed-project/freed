import { test, expect, resolveViteFsModulePath } from "./fixtures/app";
const settingsModule = resolveViteFsModulePath("../../../ui/src/lib/settings-store.ts", import.meta.url);

test("source restart retries demotion and prepares a later return transfer", async ({ app, ipc }, testInfo) => {
  await app.goto(); await app.waitForReady();
  await app.page.addInitScript(() => {
    const handlers = (window as any).__TAURI_MOCK_HANDLERS__;
    const adopted = localStorage.getItem("test-source-demoted") === "yes";
    const id = "a".repeat(64);
    let status = { handoffId: id, libraryId: "b".repeat(64), installationRole: "source", phase: adopted ? "demoted" : "authorized",
      predecessorEpochId: "c".repeat(64), successorEpochId: "d".repeat(64), canonicalReadiness: "{}",
      canonicalAuthorizationBody: "body", canonicalAuthorization: "grant", expectedControlRevision: '"before"', observedControlRevision: '"after"', updatedAtMs: 1,
      canonicalActivation: JSON.stringify({ activation: { control: { generation: 7 }, handoff_id: id }, format: "freed_library_source_adoption_v1", stage_id: "staged" }) };
    const returned = localStorage.getItem("test-source-return") === "yes";
    const readiness = JSON.stringify({ body: { target_actor_id: "e".repeat(64) } });
    const prepareReturn = () => {
      status = { ...status, handoffId: "f".repeat(64), installationRole: "target", phase: "preparing",
        predecessorEpochId: "d".repeat(64), successorEpochId: null as any, canonicalReadiness: readiness,
        canonicalAuthorization: null as any, canonicalAuthorizationBody: null as any, canonicalActivation: null as any };
    };
    if (returned) prepareReturn();
    handlers.prepare_normalized_library_handoff_readiness = () => {
      localStorage.setItem("test-source-return", "yes"); prepareReturn(); return readiness;
    };
    handlers.normalized_desktop_installation_status = () => ({ state: status.installationRole === "target" ? "fenced" : adopted ? "editable_consumer" : "fenced", role: status.installationRole === "target" ? null : adopted ? "follower" : null,
      libraryId: status.libraryId, authorityEpochId: status.installationRole === "target" ? status.predecessorEpochId : status.successorEpochId, actorId: adopted ? "e".repeat(64) : null });
    handlers.read_normalized_library_handoff_status = () => status;
    handlers.adopt_normalized_library_source_handoff = (args: any) => {
      if (args.stageId !== "staged" || args.accessToken !== "") throw new Error("committed retry must reuse the original request");
      (window as any).__SOURCE_RETRIED__ = true; return status;
    };
  });
  await app.page.reload();
  const panel = app.page.getByRole("region", { name: "Primary transfer" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Move authorized");
  await expect(panel.getByRole("button", { name: "Reconnect Google Drive" })).toBeVisible();
  expect((await ipc.invocations()).filter(call => call.cmd === "start_oauth_server")).toHaveLength(0);
  await expect(panel.getByRole("button", { name: "Cancel unapproved transfer" })).toHaveCount(0);
  await expect(app.page.getByTestId("sqlite-writer-transfer-button")).toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath("source-resume.png") });
  // Native commit survived a lost renderer response; restart selects its consumer receipt.
  await app.page.evaluate(() => localStorage.setItem("test-source-demoted", "yes"));
  await app.page.reload(); await app.waitForReady();
  await app.page.evaluate(async path => {
    const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync");
  }, settingsModule);
  await expect(panel).toContainText("Consumer selected");
  await panel.getByRole("button", { name: "Verify successor and continue as consumer" }).click();
  await expect.poll(() => app.page.evaluate(() => (window as any).__SOURCE_RETRIED__)).toBe(true);
  await expect(panel).toContainText("Consumer selected");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel).toContainText("Former Primary");
  await panel.getByRole("button", { name: "Prepare this device as the new Primary" }).click();
  await expect(panel).toContainText("Preparation saved");
  await expect(panel.getByLabel("Readiness receipt for the current Primary")).toHaveValue(/target_actor_id/);
  await app.page.reload();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Preparation saved");
  await expect(panel.getByRole("button", { name: "Verify and accept authorization" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Publish and activate this Primary" })).toHaveCount(0);
  expect((await ipc.invocations()).filter(call => call.cmd === "start_oauth_server")).toHaveLength(0);
  await panel.screenshot({ path: testInfo.outputPath("former-primary-return.png") });
});

test("source restart retains a copyable cancellation proof", async ({ app, ipc }, testInfo) => {
  await app.goto(); await app.waitForReady();
  await app.page.addInitScript(() => {
    (window as any).__TAURI_MOCK_HANDLERS__.read_normalized_library_handoff_status = () => ({
      handoffId: "a".repeat(64), libraryId: "b".repeat(64), installationRole: "source", phase: "cancelled",
      predecessorEpochId: "c".repeat(64), successorEpochId: null, canonicalReadiness: "{}",
      canonicalAuthorizationBody: null, canonicalAuthorization: null, canonicalActivation: null,
      canonicalCancellation: '{"format":"mock cancellation receipt"}',
      expectedControlRevision: null, observedControlRevision: null, updatedAtMs: 1,
    });
  });
  await app.page.reload(); await app.waitForReady();
  await app.page.evaluate(async path => {
    const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync");
  }, settingsModule);
  const panel = app.page.getByRole("region", { name: "Primary transfer" });
  await expect(panel.getByLabel("Signed cancellation for the target device")).toHaveValue('{"format":"mock cancellation receipt"}');
  await expect(panel.getByRole("button", { name: "Copy receipt", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Publish final checkpoint and authorize move" })).toHaveCount(0);
  expect((await ipc.invocations()).filter(call => call.cmd === "start_oauth_server")).toHaveLength(0);
  await panel.screenshot({ path: testInfo.outputPath("source-cancellation.png") });
});

test("target verifies cancellation and remains a consumer after restart", async ({ app, ipc }, testInfo) => {
  await app.goto(); await app.waitForReady();
  await app.page.addInitScript(() => {
    const handlers = (window as any).__TAURI_MOCK_HANDLERS__;
    const canceled = () => localStorage.getItem("test-target-cancelled") === "yes";
    const status = () => ({ handoffId: "a".repeat(64), libraryId: "b".repeat(64), installationRole: "target",
      phase: canceled() ? "cancelled" : "preparing", predecessorEpochId: "c".repeat(64), successorEpochId: null,
      canonicalReadiness: JSON.stringify({ body: { target_actor_id: "f".repeat(64) } }),
      canonicalAuthorizationBody: null, canonicalAuthorization: null, canonicalActivation: null,
      canonicalCancellation: canceled() ? "signed cancellation fixture" : null,
      expectedControlRevision: null, observedControlRevision: null, updatedAtMs: 1 });
    handlers.normalized_desktop_installation_status = () => ({ state: canceled() ? "editable_consumer" : "fenced",
      role: canceled() ? "follower" : null, libraryId: "b".repeat(64), authorityEpochId: "c".repeat(64), actorId: "f".repeat(64) });
    handlers.read_normalized_library_handoff_status = status;
    handlers.accept_normalized_library_target_handoff_cancellation = (args: any) => {
      if (args.canonicalCancellation !== "signed cancellation fixture") throw new Error("wrong cancellation");
      localStorage.setItem("test-target-cancelled", "yes"); return "a".repeat(64);
    };
  });
  await app.page.reload();
  const panel = app.page.getByRole("region", { name: "Primary transfer" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Signed cancellation from the current Primary", { exact: true }).fill("signed cancellation fixture");
  await panel.getByRole("button", { name: "Verify cancellation and resume as consumer" }).click();
  await app.waitForReady();
  await app.page.reload(); await app.waitForReady();
  await app.page.evaluate(async path => {
    const { useSettingsStore } = await import(path); useSettingsStore.getState().openTo("sync");
  }, settingsModule);
  await expect(panel).toContainText("This device is a consumer again");
  await expect(panel.getByRole("button", { name: "Prepare this device as the new Primary" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Download final checkpoint and stage this Primary" })).toHaveCount(0);
  expect((await ipc.invocations()).filter(call => call.cmd === "start_oauth_server")).toHaveLength(0);
  await panel.screenshot({ path: testInfo.outputPath("target-cancellation.png") });
});
