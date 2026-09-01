import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.FREED_SHOWCASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = path.resolve(
  process.env.FREED_SHOWCASE_OUTPUT ?? "release-showcase",
);
const releaseTag = process.env.GITHUB_REF_NAME ?? "local-preview";
const releaseSha = process.env.GITHUB_SHA ?? "local-preview";
const baseOrigin = new URL(baseUrl).origin;
const useMemorySqlite = process.env.FREED_SHOWCASE_SQLITE_MEMORY === "1";

const captures = [
  { file: "freed-showcase-unified-midas.png", theme: "midas", view: "unified" },
  { file: "freed-showcase-stories-ember.png", theme: "ember", view: "stories" },
  { file: "freed-showcase-instagram-neon.png", theme: "neon", view: "instagram" },
  { file: "freed-showcase-map-scriptorium.png", theme: "scriptorium", view: "map" },
  { file: "freed-showcase-friends-dark-star.png", theme: "dark-star", view: "friends" },
];

function stableShuffle(values, seed) {
  const bytes = createHash("sha256").update(seed).digest();
  return values
    .map((value, index) => ({ value, weight: bytes[index % bytes.length] }))
    .sort((left, right) => left.weight - right.weight)
    .map(({ value }) => value);
}

async function waitForShowcase(page) {
  await page.locator("header").getByText(/[1-9][0-9,]* items/).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function selectView(page, view) {
  if (view === "unified") {
    await page.getByRole("button", { name: "Unified Feed", exact: true }).click();
    return;
  }
  if (view === "stories") {
    await page.getByRole("button", { name: "Unified Feed", exact: true }).click();
    await page.getByRole("button", { name: "Stories", exact: true }).click();
    return;
  }
  if (view === "friends") {
    await page.locator('[data-testid="source-row-friends"]:visible').click();
    return;
  }
  const label = view === "instagram" ? "Instagram" : "Map";
  await page.getByRole("button", { name: label, exact: true }).click();
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  reducedMotion: "reduce",
  viewport: { width: 1440, height: 960 },
});
if (useMemorySqlite) {
  await context.addInitScript(() => {
    window.__FREED_PWA_SQLITE_MEMORY_E2E__ = true;
  });
}
const page = await context.newPage();
const checkpointDurationsMs = [];
const remoteRequestUrls = new Set();
page.on("request", (request) => {
  const url = new URL(request.url());
  if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== baseOrigin) {
    remoteRequestUrls.add(url.href);
  }
});

for (const [index, capture] of captures.entries()) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((theme) => localStorage.setItem("freed-theme", theme), capture.theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForShowcase(page);
  checkpointDurationsMs.push(
    await page.evaluate(
      () => performance.getEntriesByName("freed-demo-checkpoint").at(-1)?.duration ?? null,
    ),
  );
  await selectView(page, capture.view);
  await page.waitForTimeout(capture.view === "map" || capture.view === "friends" ? 1_000 : 250);
  if (index > 0) {
    await page.addStyleTag({
      content: '[data-testid="demo-welcome-desktop"] { display: none !important; }',
    });
  }
  await page.screenshot({
    animations: "disabled",
    path: path.join(outputDirectory, capture.file),
    type: "png",
  });
}

await browser.close();

if (remoteRequestUrls.size > 0) {
  throw new Error(
    `Showcase made unexpected remote requests:\n${[...remoteRequestUrls].join("\n")}`,
  );
}

const gifOrder = stableShuffle(captures, releaseSha).map(({ file }) => file);
await writeFile(
  path.join(outputDirectory, "gif-order.txt"),
  `${gifOrder.map((file) => `file '${file}'\nduration 1.8`).join("\n")}\nfile '${gifOrder.at(-1)}'\n`,
);
await writeFile(
  path.join(outputDirectory, "freed-showcase-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      releaseTag,
      releaseSha,
      generatedAt: new Date().toISOString(),
      captures,
      gifOrder,
      checkpointDurationsMs,
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `Captured ${captures.length.toLocaleString()} Freed showcase views in ${outputDirectory}.\n`,
);
