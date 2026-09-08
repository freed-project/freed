import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SHOWCASE_THEME_IDS, SHOWCASE_FRAME_IDS, resolveShowcaseReleaseIdentity } from "./lib/release-showcase-assets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(process.env.FREED_SHOWCASE_OUTPUT ?? "release-showcase");
const identity = resolveShowcaseReleaseIdentity();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (sha !== process.env.GITHUB_SHA || execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) {
  throw new Error("Release showcase requires the exact clean release checkout.");
}
// Stage outside the checkout so every theme independently proves clean source.
// Keep failed captures for diagnosis, but never upload a partial set.
const staging = await mkdtemp(path.join(os.tmpdir(), "freed-release-showcase-"));
async function run(command, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${signal ?? code}`)));
  });
}

const manifests = [];
for (const theme of SHOWCASE_THEME_IDS) {
  const directory = path.join(staging, theme);
  await run(process.execPath, ["scripts/capture-showcase-local.mjs"], {
    FREED_SHOWCASE_THEME: theme, FREED_SHOWCASE_OUTPUT: directory, FREED_SHOWCASE_DESKTOP_ONLY: "0",
  });
  const manifest = JSON.parse(await readFile(path.join(directory, "freed-showcase-manifest.json"), "utf8"));
  const order = SHOWCASE_FRAME_IDS.map(frame => `freed-showcase-${frame}-${theme}.png`);
  if (manifest.releaseSha !== sha || manifest.sourceDirty || JSON.stringify(manifest.gifOrder) !== JSON.stringify(order)) {
    throw new Error(`Capture source or frame order mismatch: ${theme}`);
  }
  await run(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", path.join(directory, "gif-order.txt"), "-vf", "scale=1920:1280:flags=lanczos,format=bgra",
    "-fps_mode", "passthrough", "-frames:v", "6", "-c:v", "libwebp_anim",
    "-lossless", "0", "-quality", "90", "-compression_level", "6", "-loop", "0",
    path.join(directory, `freed-showcase-${theme}.webp`),
  ]);
  manifests.push(manifest);
}

// Decode all frames and verify alpha clearing, not just a successful encoder exit.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.FREED_SHOWCASE_URL ?? "http://127.0.0.1:4173", { waitUntil: "domcontentloaded" });
  for (const theme of SHOWCASE_THEME_IDS) {
    const bytes = await readFile(path.join(staging, theme, `freed-showcase-${theme}.webp`));
    await page.evaluate(async (base64) => {
      const decoder = new ImageDecoder({ data: Uint8Array.from(atob(base64), char => char.charCodeAt(0)), type: "image/webp" });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (track.frameCount !== 6 || track.repetitionCount !== Infinity) throw new Error("Showcase frame count or looping is invalid");
      for (let index = 0; index < 6; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        try {
          if (image.displayWidth !== 1920 || image.displayHeight !== 1280 || image.duration !== 3_000_000) throw new Error("Showcase dimensions or timing changed");
          const canvas = new OffscreenCanvas(1920, 1280);
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          if (context.getImageData(0, 0, 1, 1).data[3] !== 0) throw new Error("Showcase corner lost transparency");
          if (index >= 4 && context.getImageData(100, 640, 1, 1).data[3] !== 0) throw new Error("Desktop frame leaked into mobile canvas");
          if (context.getImageData(960, 640, 1, 1).data[3] === 0) throw new Error("Showcase frame is empty");
        } finally { image.close(); }
      }
      decoder.close();
    }, bytes.toString("base64"));
  }
} finally { await browser.close(); }

const first = manifests[0];
if (execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() !== sha ||
    execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) {
  throw new Error("Release checkout changed during capture.");
}
if (manifests.some(manifest => JSON.stringify(manifest.contentCounts) !== JSON.stringify(first.contentCounts))) {
  throw new Error("Showcase themes disagree on corpus counts");
}
await mkdir(output, { recursive: true });
for (const theme of SHOWCASE_THEME_IDS) {
  for (const filename of [...SHOWCASE_FRAME_IDS.map(frame => `freed-showcase-${frame}-${theme}.png`), `freed-showcase-${theme}.webp`]) {
    await copyFile(path.join(staging, theme, filename), path.join(output, filename));
  }
}
await writeFile(path.join(output, "freed-showcase-manifest.json"), JSON.stringify({
  ...first, releaseTag: identity.tag,
  captures: manifests.flatMap(manifest => manifest.captures), gifOrder: undefined,
  encoding: { format: "webp", quality: 90, width: 1920, height: 1280, loop: 0, durationMs: 3000 },
  remoteMediaUrls: [...new Set(manifests.flatMap(manifest => manifest.remoteMediaUrls))].sort(),
}, null, 2) + "\n");
console.log(`Captured and decoded ${SHOWCASE_THEME_IDS.length} theme animations. Source PNGs: ${staging}`);
