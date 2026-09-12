import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(resolve(website, path), "utf8"));
const checkOnly = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check")) {
  throw new Error("Use generate-social-preview.mjs [--check].");
}

// This is the homepage's active mapping. public/showcase/manifest.json is a
// historical capture manifest and must not determine the share card's source.
const showcase = await readJson("src/data/showcase.json");
const ember = showcase.themes.ember;
const frame = ember.captures.findIndex((capture) => capture.view === "stories" && capture.mobile);
if (frame < 0 || !/^\/showcase\/[a-z0-9-]+\.webp$/.test(ember.animation.url)) {
  throw new Error("The active Ember showcase must include a local mobile Stories frame.");
}
const animation = await readFile(resolve(website, "public", ember.animation.url.slice(1)));
if (hash(animation) !== ember.animation.sha256) {
  throw new Error("Ember showcase bytes do not match the active mapping's SHA-256.");
}
const framing = await readJson("scripts/social-preview/framing.json");
const metadata = await sharp(animation, { animated: true }).metadata();
if (metadata.width !== framing.sourceWidth || metadata.pageHeight !== framing.sourceHeight || metadata.pages !== ember.captures.length) {
  throw new Error("Showcase dimensions or frame count changed. Review the phone framing before regeneration.");
}
// Keep the approved device scale and position. Only remove the surrounding
// showcase canvas and shadow; do not synthesize or rearrange the captured UI.
const phone = await sharp(animation, { page: frame }).extract(framing.crop).png().toBuffer();
const template = await readFile(resolve(website, "scripts/social-preview/template.svg"), "utf8");
if (template.split("{{PHONE_IMAGE}}").length !== 2) {
  throw new Error("The social preview template must contain exactly one phone image slot.");
}
const source = {
  releaseTag: showcase.releaseTag ?? null,
  sourceCommit: showcase.sourceCommit,
  animationUrl: ember.animation.url,
  animationSha256: ember.animation.sha256,
  capture: ember.captures[frame].file,
  frame,
  crop: framing.crop,
  templateSha256: hash(template),
};
// Native rasterizers can differ by one channel level across CPU architectures.
// Preserve the reviewed PNG bytes while its verified source and design match.
// A new screenshot, crop, or template always invalidates this reuse.
let png;
try {
  const previous = await readJson("src/data/social-preview.json");
  if (JSON.stringify(previous.source) === JSON.stringify(source) &&
      /^\/social\/freed-[a-f0-9]{12}\.png$/.test(previous.url)) {
    const candidate = await readFile(resolve(website, "public", previous.url.slice(1)));
    if (hash(candidate) === previous.sha256) png = candidate;
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!png) {
  const svg = template.replace("{{PHONE_IMAGE}}", phone.toString("base64"));
  png = await sharp(Buffer.from(svg)).png().toBuffer();
}
const { width, height } = await sharp(png).metadata();
if (width !== 1200 || height !== 630) throw new Error("Social preview must be 1200 by 630.");
const digest = hash(png);
const url = `/social/freed-${digest.slice(0, 12)}.png`;
const record = {
  url, width, height,
  alt: "Freed: Take Back Your Feed. Social feeds in one local app. Open source and free forever. Ember phone preview.",
  sha256: digest,
  source,
};
const output = resolve(website, "public", url.slice(1));
const recordPath = resolve(website, "src/data/social-preview.json");
const recordJson = `${JSON.stringify(record, null, 2)}\n`;
if (checkOnly) {
  if ((await readFile(recordPath, "utf8")) !== recordJson || hash(await readFile(output)) !== digest) {
    throw new Error("Social preview is stale. Run npm run generate:social-preview and review the image.");
  }
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, png);
  await writeFile(recordPath, recordJson);
}
console.log(`${checkOnly ? "Verified" : "Generated"} social preview: ${url}`);
