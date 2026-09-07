import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SHOWCASE_ASSET_FILENAMES = Object.freeze([
  "freed-showcase-unified-midas.png",
  "freed-showcase-stories-ember.png",
  "freed-showcase-instagram-neon.png",
  "freed-showcase-map-scriptorium.png",
  "freed-showcase-friends-dark-star.png",
  "freed-showcase-friend-detail-starship.png",
  "freed-showcase-reader-scriptorium.png",
  "freed-showcase.gif",
]);
export const SHOWCASE_MANIFEST_FILENAME = "freed-showcase-manifest.json";
export const MAX_SHOWCASE_ASSET_BYTES = 64 * 1024 * 1024;
export const DEFAULT_SHOWCASE_DOWNLOAD_TIMEOUT_MS = 15_000;

/** Exact checked-in media URLs, including extensionless NPS and new image hosts. */
export async function readShowcaseMediaCatalog(directory) {
  const urls = new Set();
  for (const filename of await readdir(directory)) {
    if (!/^sample-corpus-[a-z0-9-]+-media\.json$/.test(filename)) continue;
    const entries = JSON.parse(await readFile(path.join(directory, filename), "utf8"));
    if (!Array.isArray(entries)) throw new Error(`Invalid showcase media catalog: ${filename}`);
    for (const entry of entries) {
      if (typeof entry.imageUrl === "string" && entry.imageUrl.startsWith("https://")) {
        urls.add(entry.imageUrl);
      }
    }
  }
  return urls;
}

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;

function requireSafeDirectory(directory) {
  const resolved = path.resolve(directory);
  return lstat(resolved).then((entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Showcase directory must be a real directory: ${resolved}.`);
    }
    return resolved;
  });
}

function validateRepository(repository) {
  const value = String(repository ?? "").trim();
  if (!REPOSITORY_PATTERN.test(value)) {
    throw new Error("GitHub repository must be an owner/repository value.");
  }
  return value;
}

function validateTag(tag) {
  const value = String(tag ?? "").trim();
  if (!TAG_PATTERN.test(value) || value.includes("..") || value.endsWith("/")) {
    throw new Error("Release tag must be a safe Git tag name.");
  }
  return value;
}

function validateCommitSha(sha, label) {
  const value = String(sha ?? "").trim();
  if (!COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a 40-hex commit SHA.`);
  }
  return value;
}

export function resolveShowcaseReleaseIdentity({
  repository = process.env.GITHUB_REPOSITORY,
  ref = process.env.GITHUB_REF,
  tag = process.env.GITHUB_REF_NAME,
} = {}) {
  const validatedRepository = validateRepository(repository);
  const validatedTag = validateTag(tag);
  const normalizedRef = String(ref ?? "").trim();
  if (normalizedRef && normalizedRef !== `refs/tags/${validatedTag}`) {
    throw new Error("Showcase assets require GITHUB_REF to match refs/tags/GITHUB_REF_NAME.");
  }
  return { repository: validatedRepository, tag: validatedTag };
}

export function showcaseAssetUrls({ repository, tag, filename }) {
  const identity = resolveShowcaseReleaseIdentity({ repository, tag, ref: "" });
  if (!SHOWCASE_ASSET_FILENAMES.includes(filename)) {
    throw new Error(`Unexpected showcase asset filename: ${filename}.`);
  }
  const encodedTag = encodeURIComponent(identity.tag);
  const encodedFilename = encodeURIComponent(filename);
  return {
    release: `https://github.com/${identity.repository}/releases/download/${encodedTag}/${encodedFilename}`,
    latest: `https://github.com/${identity.repository}/releases/latest/download/${encodedFilename}`,
  };
}

async function readRegularFile(filePath, { maxBytes = MAX_SHOWCASE_ASSET_BYTES } = {}) {
  // Validate and read the same descriptor; a path swap must not redirect the read.
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch((error) => {
      if (error.code === "ELOOP") {
        throw new Error(`Showcase asset must be a regular non-symlink file: ${filePath}.`);
      }
      throw error;
    });
  try {
    const entry = await file.stat();
    if (!entry.isFile()) {
      throw new Error(`Showcase asset must be a regular non-symlink file: ${filePath}.`);
    }
    if (entry.size > maxBytes) {
      throw new Error(`Showcase asset exceeds ${maxBytes.toLocaleString()} bytes: ${filePath}.`);
    }
    // One extra byte detects growth without allowing an unbounded readFile allocation.
    const contents = Buffer.alloc(entry.size + 1);
    let offset = 0;
    while (offset < contents.length) {
      const { bytesRead } = await file.read(contents, offset, contents.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (offset !== entry.size || after.size !== entry.size || after.mtimeMs !== entry.mtimeMs) {
      throw new Error(`Showcase asset changed while reading: ${filePath}.`);
    }
    return contents.subarray(0, offset);
  } finally {
    await file.close();
  }
}

async function readManifest(directory) {
  const manifestPath = path.join(directory, SHOWCASE_MANIFEST_FILENAME);
  const contents = await readRegularFile(manifestPath);
  try {
    return { manifestPath, manifest: JSON.parse(contents.toString("utf8")) };
  } catch {
    throw new Error(`Showcase manifest is invalid JSON: ${manifestPath}.`);
  }
}

function showcaseCorpusStage(manifest) {
  const counts = manifest?.contentCounts;
  if (!counts || ![counts.total, counts.regular, counts.stories].every(Number.isSafeInteger) ||
      counts.regular < 1 || counts.regular > 397 || counts.stories < 1 || counts.stories > 103 ||
      counts.total !== counts.regular + counts.stories) {
    throw new Error("Showcase counts must be consistent positive integers within the 397 regular entries and 103 visual Stories target.");
  }
  // Functional releases may precede editorial completion. Never label those
  // snapshots complete, and never infer completion from the total alone.
  return counts.regular === 397 && counts.stories === 103 ? "complete" : "interim";
}

export async function finalizeShowcaseManifest({
  outputDirectory,
  repository,
  tag,
  ref = process.env.GITHUB_REF,
  checkoutSha = process.env.GITHUB_SHA,
} = {}) {
  const directory = await requireSafeDirectory(outputDirectory);
  const identity = resolveShowcaseReleaseIdentity({ repository, tag, ref });
  const expectedCheckoutSha = validateCommitSha(checkoutSha, "Checkout SHA");
  const { manifestPath, manifest } = await readManifest(directory);
  if (manifest?.schemaVersion !== 1) {
    throw new Error("Showcase manifest must have schemaVersion 1 before finalization.");
  }
  if (manifest.releaseTag !== identity.tag) {
    throw new Error("Showcase manifest releaseTag must match the finalized release tag.");
  }
  if (validateCommitSha(manifest.releaseSha, "Showcase manifest releaseSha") !== expectedCheckoutSha) {
    throw new Error("Showcase manifest releaseSha must match the checkout SHA.");
  }
  const corpusStage = showcaseCorpusStage(manifest);
  if (manifest.corpusStage !== undefined && manifest.corpusStage !== corpusStage) {
    throw new Error("Showcase corpusStage does not match its content counts.");
  }

  const assets = [];
  for (const filename of SHOWCASE_ASSET_FILENAMES) {
    const assetPath = path.join(directory, filename);
    if (path.dirname(assetPath) !== directory) {
      throw new Error(`Unsafe showcase asset path: ${filename}.`);
    }
    const bytes = await readRegularFile(assetPath);
    assets.push({
      filename,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      urls: showcaseAssetUrls({ ...identity, filename }),
    });
  }

  const finalized = {
    ...manifest,
    corpusStage,
    release: identity,
    assets,
  };
  await writeFile(manifestPath, `${JSON.stringify(finalized, null, 2)}\n`, { flag: "w" });
  return finalized;
}

function validatedManifestAssets(manifest) {
  if (manifest?.corpusStage !== showcaseCorpusStage(manifest)) {
    throw new Error("Showcase corpusStage does not match its content counts.");
  }
  const identity = resolveShowcaseReleaseIdentity({
    repository: manifest?.release?.repository,
    tag: manifest?.release?.tag,
    ref: "",
  });
  if (manifest?.releaseTag !== identity.tag) {
    throw new Error("Showcase manifest releaseTag must match its release identity.");
  }
  validateCommitSha(manifest?.releaseSha, "Showcase manifest releaseSha");
  if (!Array.isArray(manifest?.assets) || manifest.assets.length !== SHOWCASE_ASSET_FILENAMES.length) {
    throw new Error("Showcase manifest must contain each expected asset exactly once.");
  }
  const seen = new Set();
  return manifest.assets.map((asset) => {
    const filename = String(asset?.filename ?? "");
    if (!SHOWCASE_ASSET_FILENAMES.includes(filename) || seen.has(filename)) {
      throw new Error("Showcase manifest asset names are invalid or duplicated.");
    }
    seen.add(filename);
    if (!SHA256_PATTERN.test(String(asset?.sha256 ?? "")) || !Number.isSafeInteger(asset?.byteSize) || asset.byteSize < 0 || asset.byteSize > MAX_SHOWCASE_ASSET_BYTES) {
      throw new Error(`Showcase manifest has invalid integrity metadata for ${filename}.`);
    }
    const expectedUrls = showcaseAssetUrls({ ...identity, filename });
    const urlKeys = Object.keys(asset?.urls ?? {}).sort();
    if (
      urlKeys.length !== 2 ||
      urlKeys[0] !== "latest" ||
      urlKeys[1] !== "release" ||
      asset?.urls?.release !== expectedUrls.release ||
      asset?.urls?.latest !== expectedUrls.latest
    ) {
      throw new Error(`Showcase manifest URL mismatch for ${filename}.`);
    }
    return { filename, byteSize: asset.byteSize, sha256: asset.sha256, urls: expectedUrls };
  });
}

async function downloadBounded(url, { fetchImpl, timeoutMs, maxBytes }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("declared content length exceeds the download bound");
    }
    if (!response.body?.getReader) throw new Error("response body is not a readable stream");
    const reader = response.body.getReader();
    const chunks = [];
    let byteSize = 0;
    let completed = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          break;
        }
        byteSize += value.byteLength;
        if (byteSize > maxBytes) throw new Error("download exceeds the byte bound");
        chunks.push(value);
      }
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteSize);
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyPublishedShowcaseAssets({
  manifest,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_SHOWCASE_DOWNLOAD_TIMEOUT_MS,
  maxBytes = MAX_SHOWCASE_ASSET_BYTES,
} = {}) {
  if (typeof fetchImpl !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Showcase verifier requires a fetch function and positive timeout and byte bounds.");
  }
  const assets = validatedManifestAssets(manifest);
  for (const asset of assets) {
    for (const [kind, url] of Object.entries(asset.urls)) {
      const bytes = await downloadBounded(url, { fetchImpl, timeoutMs, maxBytes });
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== asset.byteSize || digest !== asset.sha256) {
        throw new Error(`Published ${kind} showcase asset integrity mismatch: ${asset.filename}.`);
      }
    }
  }
  return { assetsVerified: assets.length, downloadsVerified: assets.length * 2 };
}

function parseCliArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined || Object.hasOwn(options, flag)) {
      throw new Error("Usage: release-showcase-assets.mjs <finalize|verify-public> --directory <path> [--repository owner/repo] [--tag tag].");
    }
    options[flag.slice(2)] = value;
  }
  if (command !== "finalize" && command !== "verify-public" || !options.directory) {
    throw new Error("Usage: release-showcase-assets.mjs <finalize|verify-public> --directory <path> [--repository owner/repo] [--tag tag].");
  }
  return { command, options };
}

async function runCli() {
  const { command, options } = parseCliArguments(process.argv.slice(2));
  if (command === "finalize") {
    const manifest = await finalizeShowcaseManifest({
      outputDirectory: options.directory,
      repository: options.repository ?? process.env.GITHUB_REPOSITORY,
      tag: options.tag ?? process.env.GITHUB_REF_NAME,
    });
    process.stdout.write(`Finalized ${manifest.assets.length.toLocaleString()} showcase assets.\n`);
    return;
  }
  const directory = await requireSafeDirectory(options.directory);
  const { manifest } = await readManifest(directory);
  const result = await verifyPublishedShowcaseAssets({ manifest });
  process.stdout.write(`Verified ${result.downloadsVerified.toLocaleString()} public showcase downloads.\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
