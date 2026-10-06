import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { UpdateSavedContentInput } from "../../ui/src/context/PlatformContext";
import {
  LibraryCoreSha256,
  LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
  constructLibraryCoreActorEnrollmentBodyV1,
  constructLibraryCoreActorCapabilityRequestV2,
  constructLibraryCoreActorCapabilityCertificateV2,
  encodeLibraryCoreCanonicalValue, encodeLibraryCoreDigestInput, encodeLibraryCoreSignatureInput,
  FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  assembleLibraryCoreTransactionV1, finalizeLibraryCoreTransactionV1,
  hydrateLibraryCoreAnnotations, retainRenderedAnnotationSnapshot, replaceHydratedSavedNote,
  parseLibraryCoreFollowerResultEnvelopeV1, libraryCoreFollowerResultBodyV1,
  type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain,
  type LibraryCoreNormalizedQueryExecutor,
  type LibraryCoreSqliteQueryRequest,

  createLibraryCoreContentRangeStorageKeyV1,
  digestLibraryCoreMediaBlobBytesV1,
} from "@freed/shared/library-core";

interface AnnotationFixtureWindow extends Window {
  fixtureClient: import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient;
  annotationUi: ReturnType<typeof import("./fixtures/annotation-ui").mount>;
  $RefreshReg$: () => void;
  $RefreshSig$: () => (type: unknown) => unknown;
  __vite_plugin_react_preamble_installed__: boolean;
}

test.beforeAll(async () => {
  await mkdir(resolve("../../.cache"), { recursive: true });
});

const quote = "\ufeffExact\r\ne\u0301\0🦉";
const bytes = new TextEncoder().encode(quote);
const digest = digestLibraryCoreMediaBlobBytesV1(bytes);
const key = createLibraryCoreContentRangeStorageKeyV1(digest, 0, digest);
const generation = "a".repeat(64);
const source = { generationId: generation, projectionRevision: 0, transitionSequence: 0 };
const vaultDirectory = "freed-library-content-vault-v1";
const map = new LibraryCoreSha256();
map.update(new TextEncoder().encode("freed.library-core.v1/digest-records/content-range-map\0"));
map.update(new TextEncoder().encode(digest));
for (const number of [bytes.length, 1, 0, 0, bytes.length]) {
  const encoded = new Uint8Array(8);
  new DataView(encoded.buffer).setBigUint64(0, BigInt(number));
  map.update(encoded);
}
map.update(new TextEncoder().encode(digest));
const rootDigest = map.digestLowerHex();

async function openClient(context: BrowserContext): Promise<Page> {
  // Serve a blank same-origin document so production app startup cannot run.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:1435") return route.abort();
    if (url.pathname === "/annotation-test") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Annotation fixture</title>" });
    return route.fallback();
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("http://127.0.0.1:1435/annotation-test");
  await page.evaluate(async () => {
    const modulePath = "/src/lib/library-core-sqlite-client.ts";
    const { PwaLibraryCoreSqliteClient } = await import(modulePath);
    const client = new PwaLibraryCoreSqliteClient();
    (window as unknown as { fixtureClient: typeof client }).fixtureClient = client;
    await client.open();
  });
  return page;
}
async function read(page: Page, limitBytes = 65_536) {
  return page.evaluate(async ({ source, limitBytes }) => {
    const client = (window as unknown as { fixtureClient: import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient }).fixtureClient;
    const original = await client.query({ queryId: "item_annotations_v1", schemaVersion: 1, globalId: "item" });
    const result = await client.query({ queryId: "item_annotation_text_range_v1", schemaVersion: 1, globalId: "item", annotationIndex: 0, expectedSource: source as typeof original.source, offsetBytes: 0, limitBytes });
    return { original, result };
  }, { source, limitBytes });
}

// Explicit persistent contexts do not inherit Playwright's use.launchOptions.
const offlineBrowser = { headless: true, channel: "chromium", serviceWorkers: "block" as const,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--disable-background-networking", "--disable-sync"],
};
async function seedWorker(context: BrowserContext, extraSql = "") {
  await context.route("**/src/lib/library-core-sqlite-worker.ts*", async route => {
    const response = await route.fetch();
    const body = await response.text();
    const marker = "await nextContentVault.reconcile();";
    expect(body).toContain(marker);
    const sql = `INSERT INTO library_meta(singleton_id,library_id,schema_version,authority_epoch,source_revision,updated_at) VALUES(1,'${generation}',1,'epoch',0,0);
      INSERT INTO library_materialization_generation VALUES(1,'${generation}');
      INSERT INTO library_feed_items(global_id,platform,content_type,captured_at,published_at,author_id,author_handle,author_display_name,hidden,saved,archived,updated_at) VALUES('item','saved','article',0,0,'a','a','a',0,1,0,0);
      INSERT INTO library_blobs(content_digest,byte_length,storage_layout,chunk_bytes,chunk_count,range_count,range_granularity,range_index_root_digest,rendition_id,cloud_availability_commitment,media_type) VALUES('${digest}',${bytes.length},'authenticated_ranges',0,0,1,${bytes.length},'${rootDigest}','text','${digest}','text/plain');
      INSERT INTO library_content_ranges VALUES('${digest}',0,0,${bytes.length},'${digest}');
      INSERT INTO library_device_content_ranges VALUES('${digest}',0,${bytes.length},'${digest}','opfs','${key}',1);
      INSERT INTO library_feed_item_highlights VALUES('item',7,NULL,'${digest}','keep',1);`;
    const seed = `
      database.exec(${JSON.stringify(sql + extraSql)});
      const fixtureRoot = await navigator.storage.getDirectory();
      const fixtureDirectory = await fixtureRoot.getDirectoryHandle(${JSON.stringify(vaultDirectory)}, {create:true});
      const fixtureFile = await fixtureDirectory.getFileHandle(${JSON.stringify(key)}, {create:true});
      const fixtureHandle = await fixtureFile.createSyncAccessHandle();
      fixtureHandle.write(new Uint8Array(${JSON.stringify([...bytes])})); fixtureHandle.flush(); fixtureHandle.close();
    `;
    await route.fulfill({ response, body: body.replace(marker, marker + seed) });
  });
}

test("shipping worker authenticates OPFS quotes after browser restart and refuses corrupt suffixes", async () => {
  const profile = await mkdtemp(resolve("../../.cache/annotation-browser-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, offlineBrowser);
    // Inject only fixture creation into the worker after its normal vault reconciliation.
    // The second browser opens the untouched shipping worker and the same OPFS files.
    await seedWorker(context);
    // Add the local-only route before the more specific fixture injection.
    // Playwright evaluates routes newest first; fall back keeps the injection active.
    const page = await openClient(context);
    const initial = await read(page);
    expect(initial.result.state).toBe("ready");
    expect(Buffer.from(initial.result.text!.bytesBase64, "base64")).toEqual(Buffer.from(bytes));
    await context.close();
    context = await chromium.launchPersistentContext(profile, offlineBrowser);
    const restarted = await openClient(context);
    expect(await read(restarted)).toEqual(initial);
    await restarted.evaluate(async ({ key, vaultDirectory, bytes }) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(vaultDirectory);
      const file = await directory.getFileHandle(key);
      const writer = await file.createWritable();
      const corrupt = new Uint8Array(bytes); corrupt[corrupt.length - 1] ^= 1;
      await writer.write(corrupt); await writer.close();
    }, { key, vaultDirectory, bytes: [...bytes] });
    const corrupt = await read(restarted, 1);
    expect(corrupt.result.state).toBe("corrupt");
    expect(corrupt.result.text).toBeNull();
    expect(corrupt.original).toEqual(initial.original);
    await restarted.evaluate(async ({ key, vaultDirectory }) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(vaultDirectory);
      await directory.removeEntry(key);
    }, { key, vaultDirectory });
    const absent = await read(restarted);
    expect(absent.result.state).toBe("unavailable");
    expect(absent.result.text).toBeNull();
    expect(absent.original).toEqual(initial.original);

  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

for (const resident of [true, false]) {
  test(`annotation UI preserves original provenance through ${resident ? "resident" : "cold"} selection`, async ({ page }) => {
    const external: string[] = [];
    page.on("pageerror", error => console.error("Annotation fixture page error:", error.message));
    page.on("console", message => { if(message.type() === "error") console.error("Annotation fixture console:",message.text()); });
    page.on("crash", () => console.error("Annotation fixture renderer crashed"));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:1435") { external.push(url.href); return route.abort(); }
      if (url.pathname === "/annotation-ui") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Annotation UI fixture</title>" });
      return route.fallback();
    });
    await page.goto("/annotation-ui");
    await page.evaluate(async resident => {
      const refreshPath = "/@react-refresh";
      const refresh = (await import(refreshPath)).default;
      refresh.injectIntoGlobalHook(window);
      (window as AnnotationFixtureWindow).$RefreshReg$ = () => {};
      (window as AnnotationFixtureWindow).$RefreshSig$ = () => (type: unknown) => type;
      (window as AnnotationFixtureWindow).__vite_plugin_react_preamble_installed__ = true;
      const path = "/tests/fixtures/annotation-ui.tsx";
      (window as AnnotationFixtureWindow).annotationUi = (await import(path)).mount(resident);
    }, resident);
    if (resident) await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeDisabled();
    else await expect(page.getByText("Loading item...", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.ready());
    await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Edit save", exact: true }).click();
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Original note");
    await page.getByLabel("Notes", { exact: true }).fill("Edited note");
    await page.getByRole("button", { name: "Update save", exact: true }).click();
    await expect(page.getByText("LOCAL_ADMISSION_SOURCE_STALE: reopen the item", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => ((window as AnnotationFixtureWindow).annotationUi.submissions[0] as UpdateSavedContentInput).annotationSnapshot!.originals.source.projectionRevision)).toBe(2);
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.close());
    await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.pending(true));
    await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeDisabled();
    await expect(page.getByText("A saved annotation edit is still pending. Wait for it to settle before editing again.", { exact: true }).first()).toBeVisible();
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.event(true));
    await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.openSnapshot());
    await page.getByRole("button", { name: "Update save", exact: true }).click();
    expect(await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.submissions.length)).toBe(1);
    await page.evaluate(() => { (window as AnnotationFixtureWindow).annotationUi.close(); (window as AnnotationFixtureWindow).annotationUi.pending(false); });
    await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeEnabled();
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.event(false));
    await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.event(true));
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Original note");
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.close());
    await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.openWithoutSnapshot());
    await page.getByRole("button", { name: "Update save", exact: true }).click();
    await expect(page.getByText("Annotations are not ready for editing; reopen the item", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as AnnotationFixtureWindow).annotationUi.submissions.length)).toBe(1);
    await page.evaluate(() => { (window as AnnotationFixtureWindow).annotationUi.close(); (window as AnnotationFixtureWindow).annotationUi.fail("corrupt"); });
    await expect(page.getByText("Saved annotation text is corrupt. Saved annotations have not changed.", { exact: true }).first()).toBeVisible();
    if (resident) await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeDisabled();
    expect(external).toEqual([]);
  });
}


test("signed note survives shipping worker OPFS restart with canonical quotes and exact retry", async () => {
  const profile = await mkdtemp(resolve("../../.cache/annotation-signed-browser-"));
  const actor = generateKeyPairSync("ed25519");
  const authority = generateKeyPairSync("ed25519");
  const actorPublic = actor.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const authorityPublic = authority.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const hash = (domain: string, value: unknown) => createHash("sha256").update(encodeLibraryCoreDigestInput(domain as LibraryCoreDigestDomain, value as LibraryCoreCanonicalValue)).digest("hex");
  const canonical = (value: unknown) => encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue);
  const authorityId = hash("authority-key", { authority_public_key: authorityPublic, signature_algorithm: "ed25519" });
  const epochId = "22".repeat(32);
  const enrollment = constructLibraryCoreActorEnrollmentBodyV1({
    actor_incarnation_nonce: "66".repeat(32), actor_public_key: actorPublic,
    authority_key_id: authorityId, created_at_ms: 1000, epoch: 1, epoch_id: epochId,
    installation_incarnation: "77".repeat(32), library_id: generation,
    observed_frontier: [], operation_id: "actor-enrolled:annotation",
  }, { digest: hash });
  const capability = { actor_class: "editor" as const, allowed_operation_types: LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
    allowed_query_ids: [], scope: { mode: "library_wide" as const } };
  const signActorProof = async (message: Uint8Array) => sign(null, message, actor.privateKey).toString("hex");
  const enrollmentRequest = await constructLibraryCoreActorCapabilityRequestV2(enrollment, capability, { digest: hash, signActorProof });
  const certificate = await constructLibraryCoreActorCapabilityCertificateV2(enrollment, capability, {
    digest: hash, signActorProof,
    signAuthorityCertificate: async message => sign(null, message, authority.privateKey).toString("hex"),
  });
  const exactTag = "\ufefftag\0e\u0301🦉";
  const note = "\ufeffExact note\r\ne\u0301\0🦉";
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, offlineBrowser);
    await seedWorker(context, `
      UPDATE library_meta SET authority_epoch='${epochId}';
      INSERT INTO library_authority_epochs VALUES('${epochId}','${generation}',1,'${authorityId}','${authorityPublic}','${"33".repeat(32)}','{}',1,'${"44".repeat(32)}','${"55".repeat(32)}',1);
      INSERT INTO library_active_authority VALUES('active','${generation}','${epochId}','${"fe".repeat(32)}',1,1);
      INSERT INTO library_actors(actor_id,authority_epoch_id,actor_kind,public_key,enrollment_operation_id,enrollment_certificate_digest,canonical_enrollment_certificate,chain_genesis_digest,accepted_counter,accepted_operation_id,accepted_chain_digest,created_at,updated_at)
      VALUES('${"fe".repeat(32)}','${epochId}','desktop','${authorityPublic}','fixture-primary','${"fc".repeat(32)}','{}','${"fc".repeat(32)}',0,NULL,'${"fc".repeat(32)}',1,1);
      INSERT INTO library_feed_item_tags VALUES('item','alpha'),('item',CAST(X'${Buffer.from(exactTag).toString("hex")}' AS TEXT));
      INSERT INTO library_feed_item_highlights VALUES('item',8,CAST(X'${Buffer.from(quote).toString("hex")}' AS TEXT),NULL,'second',2);
      INSERT INTO library_feed_item_highlights VALUES('item',9,'⁣',NULL,'old note',3);
    `);
    let page = await openClient(context);
    await page.evaluate(async ({ request, certificate }) => {
      const client = (window as AnnotationFixtureWindow).fixtureClient as import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient;
      await client.storeFollowerActorRequest({ canonicalRequestBytes: new Uint8Array(request), createdAt: 1000 });
      await client.installFollowerActorEnrollment({ canonicalCertificateBytes: new Uint8Array(certificate), enrolledAt: 1100 });
    }, { request: [...canonical(enrollmentRequest.request)], certificate: [...canonical(certificate.certificate)] });
    const query = (async (request: LibraryCoreSqliteQueryRequest) => page.evaluate(request => (window as AnnotationFixtureWindow).fixtureClient.query(request), request)) as LibraryCoreNormalizedQueryExecutor;
    const originalRequest = { queryId: "item_annotations_v1", schemaVersion: 1, globalId: "item" } as const;
    const snapshot = retainRenderedAnnotationSnapshot(await hydrateLibraryCoreAnnotations(query, await query(originalRequest)), "item");
    expect(snapshot.highlights![0]!.text).toBe(quote);
    expect(snapshot.highlights![1]!.text).toBe(quote);
    expect(snapshot.originals.tags).toEqual(["alpha", exactTag]);
    const payload = replaceHydratedSavedNote(snapshot, note, 3000);
    const prepare = async (transactionId: string, original: typeof snapshot) => {
      const tip = await page.evaluate(() => (window as AnnotationFixtureWindow).fixtureClient.followerMutationContext());
      const member = FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct({
        actor_id: tip.actor_id, actor_sequence: tip.next_actor_sequence, causal_frontier: tip.observed_frontier,
        created_at_ms: 3000, entity_id: "item", epoch: tip.epoch, epoch_id: tip.epoch_id,
        hlc_counter: 0, hlc_wall_ms: 3000, library_id: tip.library_id, operation_id: transactionId + ":0",
        payload: replaceHydratedSavedNote(original, note, 3000), previous_actor_operation_id: tip.previous_actor_operation_id,
        transaction_id: transactionId, transaction_member_count: 1, transaction_member_index: 0,
      }, { digest: hash });
      return finalizeLibraryCoreTransactionV1(assembleLibraryCoreTransactionV1([member], tip.previous_actor_chain_digest, { digest: hash }),
        { digest: hash, signOperation: signActorProof });
    };
    const signed = await prepare("tx:annotation:restart", snapshot);
    const packet = { envelopeBytes: signed.members.map(member => [...canonical(member.envelope)]), expectedSource: snapshot.originals.source };
    const commit = (value: typeof packet) => page.evaluate(value => (window as AnnotationFixtureWindow).fixtureClient.commitFollowerIntent({
      ...value, envelopeBytes: value.envelopeBytes.map(bytes => new Uint8Array(bytes)),
    }), value);
    const receipt = await commit(packet);
    const pendingSecond=await prepare("tx:annotation:pending-second",snapshot);
    const pendingPacket={ envelopeBytes:pendingSecond.members.map(member=>[...canonical(member.envelope)]),expectedSource:snapshot.originals.source };
    const pendingTip=await page.evaluate(()=>(window as AnnotationFixtureWindow).fixtureClient.followerMutationContext());
    await expect(commit(pendingPacket)).rejects.toThrow(/LOCAL_ANNOTATION_PENDING/);
    expect(await page.evaluate(()=>(window as AnnotationFixtureWindow).fixtureClient.followerMutationContext())).toEqual(pendingTip);
    expect((await query(originalRequest)).highlights).toEqual(snapshot.originals.highlights);
    const reopenWithSourceAdvance = async () => {
      await context!.close();
      context = await chromium.launchPersistentContext(profile, offlineBrowser);
      await context.route("**/src/lib/library-core-sqlite-worker.ts*", async route => {
        const response = await route.fetch();
        const body = await response.text();
        const marker = "await nextContentVault.reconcile();";
        expect(body).toContain(marker);
        // Synthetic remote advancement, before the shipping worker accepts commands.
        const advance = `database.exec("BEGIN IMMEDIATE; UPDATE library_meta SET source_revision=source_revision+1; UPDATE library_change_state SET revision=revision+1; COMMIT;");`;
        await route.fulfill({ response, body: body.replace(marker, marker + advance) });
      });
      page = await openClient(context);
    };
    await reopenWithSourceAdvance();
    expect(await commit(packet)).toEqual(receipt);
    // Settle with a real synthetic authority signature through the shipping worker.
    // No installed Library or cloud transport is exercised.
    const unsigned = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: enrollment.body.actor_id, authoritative_source_revision: 2, authority_key_id: authorityId,
      canonical_operation_ids: signed.members.map(member => member.envelope.operation_id), epoch: 1, epoch_id: epochId,
      format: "freed_follower_result_v1", intent_epoch: 1, intent_epoch_id: epochId, library_id: generation,
      original_result_digest: null, previous_result_digest: null,
      receipt_ids: signed.members.map(member => member.envelope_digest), rejection_reason: null, replacement_fields: [],
      resolved_at_ms: 3100, result_body_digest: "0".repeat(64), result_sequence: 1, schema_version: 1,
      signature: "0".repeat(128), signature_algorithm: "ed25519", status: "accepted",
      transaction_digest: signed.transaction_digest, transaction_id: "tx:annotation:restart",
    });
    const resultDigest = hash("follower-result-body", libraryCoreFollowerResultBodyV1(unsigned));
    const result = canonical({ ...unsigned, result_body_digest: resultDigest,
      signature: sign(null, encodeLibraryCoreSignatureInput("follower-result-envelope", { result_body_digest: resultDigest }), authority.privateKey).toString("hex"),
    });
    const settle = () => page.evaluate(bytes => (window as AnnotationFixtureWindow).fixtureClient.applyFollowerResult({ canonicalResultBytes: new Uint8Array(bytes) }), [...result]);
    const settledReceipt = await settle();
    await context.close();
    context = await chromium.launchPersistentContext(profile, offlineBrowser);
    page = await openClient(context);
    const persisted = await query(originalRequest);
    expect(persisted.highlights).toEqual(payload.highlights);
    expect(persisted.tags).toEqual(snapshot.originals.tags);
    expect(persisted.highlights[0]!.textBlobDigest).toBe(digest);
    expect((await hydrateLibraryCoreAnnotations(query, persisted)).highlights![0]!.text).toBe(quote);
    const nextSnapshot = retainRenderedAnnotationSnapshot(await hydrateLibraryCoreAnnotations(query, persisted), "item");
    const stale = await prepare("tx:annotation:stale", nextSnapshot);
    const stalePacket = { envelopeBytes: stale.members.map(member => [...canonical(member.envelope)]), expectedSource: nextSnapshot.originals.source };
    await reopenWithSourceAdvance();
    const before = await page.evaluate(() => (window as AnnotationFixtureWindow).fixtureClient.followerMutationContext());
    await expect(commit(stalePacket)).rejects.toThrow(/LOCAL_ADMISSION_SOURCE_STALE/);
    expect(await page.evaluate(() => (window as AnnotationFixtureWindow).fixtureClient.followerMutationContext())).toEqual(before);
    expect((await query(originalRequest)).highlights).toEqual(payload.highlights);
    expect((await query(originalRequest)).tags).toEqual(snapshot.originals.tags);
    // Result replay preserves signed receipt identity; this API reports current source revision.
    expect(await settle()).toEqual({ ...settledReceipt, sourceRevision: (await query(originalRequest)).source.projectionRevision });
    // Annotation retries preserve the original durable receipt after settlement.
    expect(await commit(packet)).toEqual(receipt);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});


test("owner continuation reaches a covered OPFS suffix and resumes safely after close", async () => {
  test.setTimeout(90_000);
  const profile=await mkdtemp(resolve("../../.cache/annotation-maintenance-browser-"));
  let context:BrowserContext|undefined;
  try {
    context=await chromium.launchPersistentContext(profile,offlineBrowser);
    const fixture=await readFile(resolve("../shared/src/library-core/annotation-backfill-fixture-v1.sql"),"utf8");
    const seed=fixture+`INSERT INTO library_local_annotation_unresolved(entity_id,transaction_id,member_index)
      SELECT entity_id,transaction_id,member_index FROM library_intent_members WHERE mutation_id='feed_item_annotations_replace';
      INSERT INTO library_intent_results
      SELECT transaction_id,actor_id,'epoch','epoch',first_counter,printf('%064d',first_counter-1),
        transaction_digest,'rejected',0,CAST(json_object(
          'transaction_id',transaction_id,'transaction_digest',transaction_digest,
          'library_id','library','actor_id',actor_id,'intent_epoch_id','epoch','epoch_id','epoch',
          'status','rejected','result_body_digest',transaction_digest,'authoritative_source_revision',0) AS BLOB),0
      FROM library_intent_transactions WHERE first_counter=1025;`;
    // Inject relational fixture rows only. The unchanged shipping owner runs
    // every subsequent maintenance turn; this is not signed-result admission proof.
    await context.route("**/src/lib/library-core-sqlite-worker.ts*",async route=>{
      const response=await route.fetch();
      const body=await response.text();
      const marker="await nextContentVault.reconcile();";
      expect(body).toContain(marker);
      await route.fulfill({response,body:body.replace(marker,marker+`database.exec(${JSON.stringify(seed)});`)});
    });
    let page=await openClient(context);
    const eligibility=(item:string)=>page.evaluate(async globalId=>{
      const client=(window as unknown as {fixtureClient:import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient}).fixtureClient;
      return client.query({queryId:"item_annotation_edit_state_v1",schemaVersion:1,globalId});
    },item);
    await expect.poll(async()=>(await eligibility("item:1025")).pending,{timeout:60_000}).toBe(false);
    expect((await eligibility("item:258")).pending).toBe(true);
    const stable=await eligibility("item:1025");
    expect(stable.localSequence).toBeGreaterThan(0);
    await context.close();
    context=await chromium.launchPersistentContext(profile,offlineBrowser);
    page=await openClient(context);
    expect(await eligibility("item:1025")).toEqual(stable);
    expect((await eligibility("item:258")).pending).toBe(true);
    // Read commands observe committed state; they do not advance maintenance's
    // local sequence or invent coverage for the unresolved prefix.
    for (let index=0;index<3;index++) expect(await eligibility("item:1025")).toEqual(stable);
  } finally {
    await context?.close();
    await rm(profile,{recursive:true,force:true});
  }
});


for (const interrupt of [false,true]) test(`owned startup resumes bounded OPFS migration${interrupt ? " after cancellation" : " in one open"}`, async () => {
  test.setTimeout(60_000);
  const profile=await mkdtemp(resolve("../../.cache/annotation-startup-browser-"));
  let context:BrowserContext|undefined;
  try {
    context=await chromium.launchPersistentContext(profile,offlineBrowser);
    const fixture=await readFile(resolve("../shared/src/library-core/annotation-backfill-fixture-v1.sql"),"utf8");
    await context.route("**/src/lib/library-core-sqlite-worker.ts*",async route=>{
      const response=await route.fetch();
      let body=await response.text();
      const seed='openingStage = "resume the local annotation upgrade";';
      expect(body).toContain(seed);
      body=body.replace(seed,`database.exec(${JSON.stringify(fixture)});`+seed);
      const progress='scannedMembers = scanned;';
      expect(body).toContain(progress);
      body=body.replace(progress,progress+`
        let refused=false; try { next.status(); } catch(error) { refused=String(error).includes("BUILDING"); }
        if (!refused) throw new Error("fixture: ordinary startup access escaped BUILDING");
      `);
      if (interrupt) {
        const yieldPoint='await new Promise((resolve) => setTimeout(resolve, 25));';
        expect(body).toContain(yieldPoint);
        body=body.replace(yieldPoint,'await new Promise((resolve) => setTimeout(resolve, 100000));');
      }
      await route.fulfill({response,body});
    });
    if (interrupt) {
      await context.route("**/annotation-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html>"}));
      const page=context.pages()[0]!;
      await page.goto("http://127.0.0.1:1435/annotation-test");
      await page.evaluate(async()=>{
        const state=window as unknown as {startupProgress?:number; startupClient?:import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient; startupError?:string};
        const OriginalWorker=window.Worker;
        window.Worker=class extends OriginalWorker {
          constructor(url:URL|string,options?:WorkerOptions) {
            super(url,options);
            this.addEventListener("message",event=>{if(event.data.kind==="annotation_upgrade_progress") state.startupProgress=event.data.scannedMembers;});
          }
        };
        const modulePath="/src/lib/library-core-sqlite-client.ts";
        const {PwaLibraryCoreSqliteClient}=await import(modulePath);
        state.startupClient=new PwaLibraryCoreSqliteClient();
        void state.startupClient.open().catch((error:Error)=>{state.startupError=error.message;});
      });
      await expect.poll(()=>page.evaluate(()=>(window as unknown as {startupProgress?:number}).startupProgress),{timeout:15_000}).toBeGreaterThan(0);
      expect(await page.evaluate(async()=>{
        try { await (window as unknown as {startupClient:import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient}).startupClient.close(); return "unexpected"; }
        catch(error) { return String(error); }
      })).toContain("startup was cancelled");
      await context.close();
      context=await chromium.launchPersistentContext(profile,offlineBrowser);
    }
    const page=await openClient(context);
    const state=await page.evaluate(async()=>{
      const client=(window as unknown as {fixtureClient:import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient}).fixtureClient;
      return {status:await client.status(),pending:await client.query({queryId:"item_annotation_edit_state_v1",schemaVersion:1,globalId:"item:1025"})};
    });
    expect(state.status.schemaVersion).toBe(4);
    expect(state.pending.pending).toBe(true);
  } finally {
    await context?.close();
    await rm(profile,{recursive:true,force:true});
  }
});
