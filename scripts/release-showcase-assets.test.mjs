import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SHOWCASE_ASSET_FILENAMES,
  SHOWCASE_MANIFEST_FILENAME,
  finalizeShowcaseManifest,
  resolveShowcaseReleaseIdentity,
  verifyPublishedShowcaseAssets,
} from "./lib/release-showcase-assets.mjs";

const repository = "freed-project/freed";
const tag = "v26.9.0500";
const checkoutSha = "a".repeat(40);

async function fixture(t, manifestOverrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "freed-showcase-assets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, SHOWCASE_MANIFEST_FILENAME),
    `${JSON.stringify({ schemaVersion: 1, captures: [], releaseTag: tag, releaseSha: checkoutSha, contentCounts: { total: 1_000, regular: 900, stories: 100 }, ...manifestOverrides })}\n`,
  );
  for (const [index, filename] of SHOWCASE_ASSET_FILENAMES.entries()) {
    await writeFile(path.join(directory, filename), `${filename}:${index}`);
  }
  return directory;
}

function streamResponse(bytes, { status = 200, contentLength = bytes.byteLength, onCancel } = {}) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
      cancel() {
        onCancel?.();
      },
    }),
    { status, headers: { "content-length": String(contentLength) } },
  );
}

test("finalizes only the exact regular showcase assets with release and latest URLs", async (t) => {
  const directory = await fixture(t);
  const finalized = await finalizeShowcaseManifest({
    outputDirectory: directory,
    repository,
    tag,
    ref: `refs/tags/${tag}`,
    checkoutSha,
  });

  assert.equal(finalized.assets.length, 6);
  assert.equal(finalized.corpusStage, "complete");
  assert.deepEqual(finalized.assets.map((asset) => asset.filename), SHOWCASE_ASSET_FILENAMES);
  for (const asset of finalized.assets) {
    const bytes = await readFile(path.join(directory, asset.filename));
    assert.equal(asset.byteSize, bytes.byteLength);
    assert.equal(asset.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(asset.urls.release, `https://github.com/${repository}/releases/download/${tag}/${asset.filename}`);
    assert.equal(asset.urls.latest, `https://github.com/${repository}/releases/latest/download/${asset.filename}`);
  }
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, SHOWCASE_MANIFEST_FILENAME), "utf8")),
    finalized,
  );
});

test("finalization rejects symlinked assets and mismatched capture identity", async (t) => {
  for (const contentCounts of [undefined, { total: 241, regular: 203, stories: 39 },
    { total: 1_000, regular: 1_000, stories: 0 },
    { total: 1_100, regular: 1_000, stories: 100 },
    { total: "1000", regular: "900", stories: "100" }]) {
    const incomplete = await fixture(t, { contentCounts });
    await assert.rejects(
      finalizeShowcaseManifest({ outputDirectory: incomplete, repository, tag, ref: `refs/tags/${tag}`, checkoutSha }),
      /consistent positive integers/,
    );
  }
  const directory = await fixture(t);
  const asset = path.join(directory, SHOWCASE_ASSET_FILENAMES[0]);
  const target = path.join(directory, "actual-asset.png");
  await writeFile(target, "asset");
  await rm(asset);
  await symlink(target, asset);

  await assert.rejects(
    finalizeShowcaseManifest({ outputDirectory: directory, repository, tag, ref: `refs/tags/${tag}`, checkoutSha }),
    /regular non-symlink/,
  );
  assert.throws(
    () => resolveShowcaseReleaseIdentity({ repository, tag, ref: "refs/heads/dev" }),
    /refs\/tags/,
  );
  await assert.rejects(
    finalizeShowcaseManifest({ outputDirectory: directory, repository, tag, ref: "refs/tags/v26.9.0501", checkoutSha }),
    /GITHUB_REF/,
  );
  assert.throws(
    () => resolveShowcaseReleaseIdentity({ repository: "freed-project/freed/extra", tag }),
    /owner\/repository/,
  );
  const tagMismatch = await fixture(t, { releaseTag: "v26.9.0499" });
  await assert.rejects(
    finalizeShowcaseManifest({ outputDirectory: tagMismatch, repository, tag, ref: `refs/tags/${tag}`, checkoutSha }),
    /releaseTag/,
  );
  const shaMismatch = await fixture(t, { releaseSha: "b".repeat(40) });
  await assert.rejects(
    finalizeShowcaseManifest({ outputDirectory: shaMismatch, repository, tag, ref: `refs/tags/${tag}`, checkoutSha }),
    /releaseSha must match the checkout SHA/,
  );
});

test("functional releases retain truthful interim counts and cannot claim corpus completion", async (t) => {
  const contentCounts = { total: 241, regular: 202, stories: 39 };
  const directory = await fixture(t, { contentCounts });
  const options = { outputDirectory: directory, repository, tag, ref: `refs/tags/${tag}`, checkoutSha };
  const manifest = await finalizeShowcaseManifest(options);
  assert.equal(manifest.corpusStage, "interim");
  assert.deepEqual(manifest.contentCounts, contentCounts);
  const falseCompletion = await fixture(t, { contentCounts, corpusStage: "complete" });
  await assert.rejects(finalizeShowcaseManifest({ ...options, outputDirectory: falseCompletion }), /corpusStage/);
});

test("public verifier checks both URL variants and rejects bounded or mismatched downloads", async (t) => {
  const directory = await fixture(t);
  const manifest = await finalizeShowcaseManifest({
    outputDirectory: directory,
    repository,
    tag,
    ref: `refs/tags/${tag}`,
    checkoutSha,
  });
  const bytesByUrl = new Map();
  for (const asset of manifest.assets) {
    const bytes = await readFile(path.join(directory, asset.filename));
    bytesByUrl.set(asset.urls.release, bytes);
    bytesByUrl.set(asset.urls.latest, bytes);
  }
  const requested = [];
  const result = await verifyPublishedShowcaseAssets({
    manifest,
    fetchImpl: async (url) => {
      requested.push(url);
      return streamResponse(bytesByUrl.get(url));
    },
  });
  assert.equal(result.assetsVerified, 6);
  assert.equal(result.downloadsVerified, 12);
  assert.equal(requested.length, 12);
  let incompleteFetches = 0;
  await assert.rejects(verifyPublishedShowcaseAssets({
    manifest: { ...manifest, contentCounts: { total: 1_000, regular: 1_000, stories: 0 } },
    fetchImpl: async () => { incompleteFetches += 1; return streamResponse(new Uint8Array()); },
  }), /consistent positive integers/);
  assert.equal(incompleteFetches, 0);

  const interim = { ...manifest, corpusStage: "interim", contentCounts: { total: 241, regular: 202, stories: 39 } };
  const interimResult = await verifyPublishedShowcaseAssets({
    manifest: interim,
    fetchImpl: async url => streamResponse(bytesByUrl.get(url)),
  });
  assert.equal(interimResult.downloadsVerified, 12);
  await assert.rejects(verifyPublishedShowcaseAssets({
    manifest: { ...interim, corpusStage: "complete" },
    fetchImpl: async () => { throw new Error("Invalid stage must fail before any download"); },
  }), /corpusStage/);

  const manifestWithInjectedUrl = structuredClone(manifest);
  manifestWithInjectedUrl.assets[0].urls.unexpected = "https://example.invalid/asset";
  let injectedFetches = 0;
  await assert.rejects(
    verifyPublishedShowcaseAssets({
      manifest: manifestWithInjectedUrl,
      fetchImpl: async () => {
        injectedFetches += 1;
        return streamResponse(new Uint8Array());
      },
    }),
    /URL mismatch/,
  );
  assert.equal(injectedFetches, 0);

  let cancelled = false;
  await assert.rejects(
    verifyPublishedShowcaseAssets({
      manifest,
      maxBytes: 4,
      fetchImpl: async () => streamResponse(new Uint8Array(5), { onCancel: () => { cancelled = true; } }),
    }),
    /declared content length exceeds the download bound/,
  );
  assert.equal(cancelled, true);

  await assert.rejects(
    verifyPublishedShowcaseAssets({
      manifest,
      fetchImpl: async () => streamResponse(new TextEncoder().encode("wrong")),
    }),
    /integrity mismatch/,
  );
});
