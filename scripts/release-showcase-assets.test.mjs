import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SHOWCASE_ASSET_FILENAMES,
  SHOWCASE_THEME_IDS,
  SHOWCASE_FRAME_IDS,
  SHOWCASE_MANIFEST_FILENAME,
  MAX_SHOWCASE_ASSET_BYTES,
  finalizeShowcaseManifest,
  resolveShowcaseReleaseIdentity,
  verifyPublishedShowcaseAssets,
  readShowcaseMediaCatalog,
} from "./lib/release-showcase-assets.mjs";

const repository = "freed-project/freed";
const tag = "v26.9.0500";
const checkoutSha = "a".repeat(40);
const captureContract = {
  sourceDirty: false, transparentCanvas: true, desktopZoom: 120, mobileZoom: 100,
  deviceScaleFactor: 2,
  encoding: { format: "webp", quality: 90, width: 1920, height: 1280, loop: 0, durationMs: 3000 },
  captures: SHOWCASE_THEME_IDS.flatMap(theme => SHOWCASE_FRAME_IDS.map(frame => ({
    theme, file: `freed-showcase-${frame}-${theme}.png`,
    mobile: frame === "stories" || frame === "reader",
    desktopDecoration: { placement: "outside-content", captureBorderWidth: 7, captureRadius: 20 },
    mobileDecoration: { placement: "outside-content", captureBorderWidth: 7, captureRadius: 44 },
    rendererDiagnostics: { renderer: "raw-webgpu", decorativeStarCount: 100 },
  }))),
};

test("showcase media admission follows exact reviewed catalog URLs", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "freed-showcase-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const known = "https://images.example/photos/approved";
  await writeFile(path.join(directory, "sample-corpus-reviewed-media.json"), JSON.stringify([
    { imageUrl: known, sourceUrl: "https://images.example/unreviewed-page" },
    { imageUrl: "http://images.example/insecure.jpg" },
  ]));
  await writeFile(path.join(directory, "unrelated.json"), JSON.stringify([{ imageUrl: "https://images.example/other.jpg" }]));
  assert.deepEqual([...await readShowcaseMediaCatalog(directory)], [known]);
});

async function fixture(t, manifestOverrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "freed-showcase-assets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, SHOWCASE_MANIFEST_FILENAME),
    `${JSON.stringify({ schemaVersion: 1, ...captureContract, releaseTag: tag, releaseSha: checkoutSha, contentCounts: { total: 500, regular: 397, stories: 103 }, ...manifestOverrides })}\n`,
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

  assert.equal(finalized.assets.length, SHOWCASE_THEME_IDS.length);
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
    { total: 500, regular: 396, stories: 104 },
    { total: 500, regular: 398, stories: 102 },
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
  const oversized = await fixture(t);
  await truncate(path.join(oversized, SHOWCASE_ASSET_FILENAMES[0]), MAX_SHOWCASE_ASSET_BYTES + 1);
  await assert.rejects(
    finalizeShowcaseManifest({ outputDirectory: oversized, repository, tag, ref: `refs/tags/${tag}`, checkoutSha }),
    /exceeds/,
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

test("release manifests reject missing themes, reordered frames and stale capture settings", async (t) => {
  for (const override of [
    { sourceDirty: true }, { transparentCanvas: false }, { desktopZoom: 100 },
    { encoding: { ...captureContract.encoding, quality: 80 } },
    { captures: captureContract.captures.slice(6) },
    { captures: [...captureContract.captures].reverse() },
    { captures: captureContract.captures.map((capture, index) => index === 0 ? { ...capture, retainedFromCapture: "earlier" } : capture) },
  ]) {
    const directory = await fixture(t, override);
    await assert.rejects(finalizeShowcaseManifest({ outputDirectory: directory, repository, tag, ref: `refs/tags/${tag}`, checkoutSha }), /Showcase/);
  }
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
  assert.equal(result.assetsVerified, SHOWCASE_ASSET_FILENAMES.length);
  assert.equal(result.downloadsVerified, SHOWCASE_ASSET_FILENAMES.length * 2);
  assert.equal(requested.length, SHOWCASE_ASSET_FILENAMES.length * 2);
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
  assert.equal(interimResult.downloadsVerified, SHOWCASE_ASSET_FILENAMES.length * 2);
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

// Tier 1 tooling: a failed local export must never replace the reviewed animation.
test("local showcase rejects invalid themes and preserves the last animation on encoder failure", async (t) => {
  const directory = await fixture(t);
  const invalid = spawnSync(process.execPath, ["scripts/build-showcase-local.mjs", "--theme", "unknown", "--output", directory], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown theme/);
  const themeDirectory = path.join(directory, "midas");
  await mkdir(themeDirectory);
  const captures = Array.from({ length: 6 }, (_, index) => ({ theme: "midas", file: `frame-${index}.png` }));
  for (const capture of captures) await writeFile(path.join(themeDirectory, capture.file), "fixture frame");
  await writeFile(path.join(themeDirectory, "freed-showcase-manifest.json"), JSON.stringify({ transparentCanvas: true, sourcePixelWidth: 2880, captures, gifOrder: captures.map(c => c.file) }));
  await writeFile(path.join(themeDirectory, "freed-showcase-midas.webp"), "reviewed WebP");
  await writeFile(path.join(themeDirectory, "latest.json"), "reviewed manifest");
  const failed = spawnSync(process.execPath, ["scripts/build-showcase-local.mjs", "--theme", "midas", "--encode-only", "--output", directory], {
    encoding: "utf8", env: { ...process.env, FFMPEG_PATH: path.join(directory, "missing-encoder") },
  });
  assert.notEqual(failed.status, 0);
  assert.equal(await readFile(path.join(themeDirectory, "freed-showcase-midas.webp"), "utf8"), "reviewed WebP");
  assert.equal(await readFile(path.join(themeDirectory, "latest.json"), "utf8"), "reviewed manifest");
});

// Tier 1: the local capture command must reject remote destinations before
// opening a browser or creating artifacts. No network fixture is needed.
test("local capture rejects non-loopback destinations before capture", async (t) => {
  const directory = await fixture(t);
  const output = path.join(directory, "uncreated");
  const result = spawnSync(process.execPath, ["scripts/capture-showcase-local.mjs"], {
    encoding: "utf8",
    env: { ...process.env, FREED_SHOWCASE_URL: "https://example.invalid", FREED_SHOWCASE_OUTPUT: output, FREED_SHOWCASE_DESKTOP_ONLY: "0" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Local capture requires a loopback URL/);
  await assert.rejects(readFile(path.join(output, "freed-showcase-manifest.json")), { code: "ENOENT" });
});

// Tier 1: publication must bind the review page to immutable frame copies.
// Encoding quality is covered by decoded-image review; this stub isolates the
// file publication contract from the host's FFmpeg installation.
test("local export publishes a usable review index and immutable source frames", async (t) => {
  const directory = await fixture(t);
  const themeDirectory = path.join(directory, "midas");
  await mkdir(themeDirectory);
  const captures = Array.from({ length: 6 }, (_, index) => ({ theme: "midas", file: `frame-${index}.png` }));
  for (const capture of captures) await writeFile(path.join(themeDirectory, capture.file), "reviewed frame");
  await writeFile(path.join(themeDirectory, "freed-showcase-manifest.json"), JSON.stringify({ transparentCanvas: true, sourcePixelWidth: 2880, captures, gifOrder: captures.map(c => c.file) }));
  const encoder = path.join(directory, "encoder");
  await writeFile(encoder, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.argv.at(-1), 'encoded fixture');\n`);
  await chmod(encoder, 0o755);
  const result = spawnSync(process.execPath, ["scripts/build-showcase-local.mjs", "--theme", "midas", "--encode-only", "--output", directory], {
    encoding: "utf8", env: { ...process.env, FFMPEG_PATH: encoder },
  });
  assert.equal(result.status, 0, result.stderr);
  const [published] = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8"));
  assert.equal(published.format, "webp");
  assert.equal(published.quality, 90);
  assert.equal(published.width, 1920);
  assert.equal(published.height, 1280);
  assert.equal(published.variants[0].url, published.animation);
  assert.equal(await readFile(path.join(directory, published.animation), "utf8"), "encoded fixture");
  assert.equal(await readFile(path.join(directory, "index.html"), "utf8"), await readFile("scripts/showcase-local-preview.html", "utf8"));
  await writeFile(path.join(themeDirectory, captures[0].file), "later capture");
  assert.equal(await readFile(path.join(themeDirectory, "revisions", published.revision, captures[0].file), "utf8"), "reviewed frame");
});
