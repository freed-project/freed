import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { readShowcaseMediaCatalog } from "./lib/release-showcase-assets.mjs";

const baseUrl = process.env.FREED_SHOWCASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = path.resolve(
  process.env.FREED_SHOWCASE_OUTPUT ?? "release-showcase",
);
const releaseTag = process.env.GITHUB_REF_NAME ?? "local-preview";
const releaseSha = process.env.GITHUB_SHA ?? "local-preview";
const baseOrigin = new URL(baseUrl).origin;
// New catalog hosts and extensionless assets are admitted by exact URL, never
// by broadening the network host allowlist. This only audits existing loads.
const reviewedMediaUrls = await readShowcaseMediaCatalog(
  fileURLToPath(new URL("../packages/shared/src/", import.meta.url)),
);
const useMemorySqlite = process.env.FREED_SHOWCASE_SQLITE_MEMORY === "1";
const reviewedMediaHosts = new Set([
  "thumb.wikimedia.org",
  "upload.wikimedia.org",
  "oceanexplorer.noaa.gov",
  "archive.oceanexplorer.noaa.gov",
  "www.fisheries.noaa.gov",
  "media.fisheries.noaa.gov",
  "npgallery.nps.gov",
  "www.nps.gov",
  "www.fws.gov",
  "d9-wret.s3.us-west-2.amazonaws.com",
  "chandra.harvard.edu",
  "i.ytimg.com",
]);

const captures = [
  { file: "freed-showcase-unified-midas.png", theme: "midas", view: "unified" },
  { file: "freed-showcase-stories-ember.png", theme: "ember", view: "stories", mobile: true },
  { file: "freed-showcase-instagram-neon.png", theme: "neon", view: "instagram", mobile: true },
  { file: "freed-showcase-map-scriptorium.png", theme: "scriptorium", view: "map" },
  { file: "freed-showcase-friends-dark-star.png", theme: "dark-star", view: "friends" },
  { file: "freed-showcase-friend-detail-starship.png", theme: "starship", view: "friends", detail: true },
  { file: "freed-showcase-reader-scriptorium.png", theme: "scriptorium", view: "instagram", mobile: true, reader: true },
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

async function selectTheme(page, theme) {
  // Demo presentation storage is intentionally document-local. Select through
  // the real UI after loading instead of writing a preference before reload.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(`button:has([data-theme-preview="${theme}"])`).filter({ visible: true }).click();
  await page.mouse.move(0, 0);
  await page.waitForFunction((expected) =>
    document.documentElement.dataset.theme === expected, theme);
  await page.locator(".theme-settings-overlay").click({ position: { x: 5, y: 5 } });
  await page.locator(".theme-settings-overlay").waitFor({ state: "hidden" });
}

async function waitForVisibleImages(page) {
  try {
    await page.waitForFunction(() => [...document.images].every((image) => {
      const rect = image.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom <= 0 ||
          rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return true;
      return image.complete && image.naturalWidth > 0;
    }), undefined, { timeout: 60_000 });
  } catch (cause) {
    const media = await page.evaluate(() => ({
      pending: [...document.images].filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
          rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth &&
          (!image.complete || image.naturalWidth === 0);
      }).slice(0, 10).map((image) => ({
        url: (image.currentSrc || image.src).slice(0, 1_000),
        complete: image.complete,
        naturalWidth: image.naturalWidth,
      })),
      failures: (window.__freedShowcaseImageFailures ?? []).slice(0, 10),
      policyViolations: (window.__freedShowcasePolicyViolations ?? []).slice(0, 10),
    }));
    throw new Error(`Visible showcase media did not settle: ${JSON.stringify(media)}`, { cause });
  }
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter((image) => image.complete && image.naturalWidth > 0)
      .map((image) => image.decode()));
    await document.fonts.ready;
  });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "en-US",
  reducedMotion: "reduce",
  viewport: { width: 1440, height: 960 },
});
if (useMemorySqlite) {
  await context.addInitScript(() => {
    window.__FREED_PWA_SQLITE_MEMORY_E2E__ = true;
  });
}
const page = await context.newPage();
await page.addInitScript(() => {
  window.__freedShowcasePolicyViolations = [];
  window.__freedShowcaseImageFailures = [];
  // React can remove failed images and leave a decorative fallback. Record
  // failures before removal so a screenshot cannot silently accept that tile.
  addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const rect = image.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth) {
      window.__freedShowcaseImageFailures.push(image.currentSrc || image.src);
    }
  }, true);
  addEventListener("securitypolicyviolation", (event) => {
    window.__freedShowcasePolicyViolations.push({
      directive: event.effectiveDirective,
      blocked: event.blockedURI,
    });
  });
});
const checkpointDurationsMs = [];
const contentCounts = { total: null, regular: null, stories: null };
const remoteRequestUrls = new Set();
const unexpectedRequestUrls = new Set();
page.on("request", (request) => {
  const url = new URL(request.url());
  if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== baseOrigin) {
    remoteRequestUrls.add(url.href);
    // Observe the public media the demo already loads. This does not initiate
    // requests, retries, authenticated provider navigation, or video playback.
    const existingPublicMapAsset = url.protocol === "https:" && url.hostname === "tiles.openfreemap.org";
    const existingSelectedLocationLookup = url.protocol === "https:" &&
      url.hostname === "nominatim.openstreetmap.org" && url.pathname === "/search" &&
      request.method() === "GET" && request.resourceType() === "fetch" &&
      url.searchParams.get("format") === "json" && url.searchParams.get("limit") === "1";
    if (!existingPublicMapAsset && !existingSelectedLocationLookup && (url.protocol !== "https:" ||
        !["image", "fetch"].includes(request.resourceType()) ||
        (!reviewedMediaUrls.has(url.href) &&
          (!reviewedMediaHosts.has(url.hostname) || !/\.(?:jpe?g|png|webp|avif)(?:$|\/)/i.test(url.pathname))))) {
      unexpectedRequestUrls.add(url.href);
    }
  }
});

try {
  for (const [index, capture] of captures.entries()) {
    await page.setViewportSize({ width: 1440, height: 960 });
    // Exercise the real production demo policy even on a loopback build server.
    const captureUrl = new URL(baseUrl);
    captureUrl.searchParams.set("freed-demo", "1");
    await page.goto(captureUrl.href, { waitUntil: "domcontentloaded" });
    await waitForShowcase(page);
    if (index === 0) {
      await page.getByRole("button", { name: "Explore Freed Demo", exact: true }).click();
    } else {
      // The same visitor has already dismissed the welcome card. Reloads
      // preserve the banner state, so waiting for the original CTA would hang.
      await page.getByRole("button", { name: "Minimize demo banner", exact: true })
        .waitFor({ state: "visible" });
    }
    await selectTheme(page, capture.theme);
    checkpointDurationsMs.push(
      await page.evaluate(
        () => performance.getEntriesByName("freed-demo-checkpoint").at(-1)?.duration ?? null,
      ),
    );
    await selectView(page, capture.view);
    if (capture.view === "stories") {
      // The title changes before the bounded query publishes its count. Our
      // mixed sample corpus has both posts and Stories, so the previous full
      // count (and the transient zero) cannot describe the settled filter.
      await page.waitForFunction((total) => {
        const label = document.querySelector("header")?.textContent ?? "";
        const match = label.match(/Stories[^0-9]*([0-9][0-9,]*) items/);
        const count = match ? Number(match[1].replaceAll(",", "")) : 0;
        return count > 0 && count < total;
      }, contentCounts.total, { timeout: 30_000 });
    }
    if (capture.view === "unified" || capture.view === "stories") {
      const countLabel = page.locator("header").getByText(
        capture.view === "stories" ? /Stories.*[0-9,]+ items/ : /[0-9,]+ items/,
      );
      await countLabel.waitFor({ state: "visible" });
      const match = (await countLabel.innerText()).match(/([0-9][0-9,]*) items/);
      if (!match) throw new Error(`Missing ${capture.view} showcase item count`);
      const count = Number(match[1].replaceAll(",", ""));
      if (capture.view === "unified") contentCounts.total = count;
      else contentCounts.stories = count;
    }
    if (capture.view === "map") {
      await page.locator('[data-testid="map-surface"][data-map-ready="true"][data-map-tiles-ready="true"]').waitFor({ timeout: 30_000 });
    } else if (capture.view === "friends") {
      await page.locator('[data-testid="friend-graph-viewport"][data-graph-diagnostics="published"]').waitFor();
      await page.waitForFunction(() => Number(document.querySelector(
        '[data-testid="friend-graph-viewport"]',
      )?.getAttribute("data-ready-renderer-label-count")) > 0);
    }
    if (capture.detail) {
      // Search through the real directory so this located sample friend is
      // mounted regardless of the current activity ordering or virtualization.
      await page.getByRole("textbox", { name: "Search friends", exact: true }).fill("Sela Current");
      await page.locator('[data-testid="friend-overview-virtual-row"] > [role="button"]').filter({ hasText: "Sela Current" }).first().click();
      await page.locator('[data-testid="friends-sidebar"]').getByText("Recent activity", { exact: true }).waitFor();
      try {
        await page.locator('[data-testid="friends-sidebar"] [data-testid="map-surface"][data-map-ready="true"][data-map-tiles-ready="true"]').waitFor({ timeout: 30_000 });
      } catch (error) {
        const mapState = await page.locator('[data-testid="friends-sidebar"] [data-testid="map-surface"]').evaluateAll(elements => elements.map(element => ({
          attributes: Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])),
          text: element.textContent,
        })));
        throw new Error(`Selected friend map did not settle: ${JSON.stringify(mapState)}`, { cause: error });
      }
      // Allow the actual camera focus transition to finish before its still frame.
      await page.waitForTimeout(1_200);
    }
    await page.addStyleTag({ content: '[data-testid="demo-welcome-desktop"], [data-testid="demo-welcome-tab"], [data-testid="local-preview-badge"] { display: none !important; }' });
    if (capture.mobile) await page.setViewportSize({ width: 390, height: 844 });
    if (capture.reader) {
      await page.locator('[data-feed-item-id]').first().click();
      await page.locator("article").waitFor();
    }
    await waitForVisibleImages(page);
    const policyViolations = await page.evaluate(() => window.__freedShowcasePolicyViolations);
    if (policyViolations.length > 0) {
      throw new Error(`Showcase policy blocked ${capture.view}: ${JSON.stringify(policyViolations)}`);
    }
    const imageFailures = await page.evaluate(() => window.__freedShowcaseImageFailures);
    if (imageFailures.length > 0) {
      throw new Error(`Showcase images failed in ${capture.view}: ${JSON.stringify(imageFailures)}`);
    }
    if (capture.mobile) {
      const screen = await page.screenshot({ animations: "disabled", type: "png" });
      const frame = await context.newPage();
      await frame.setViewportSize({ width: 1440, height: 960 });
      await frame.setContent(`<html><body style="margin:0;width:1440px;height:960px;background:#d9dadc;display:grid;place-items:center"><div style="padding:12px;background:#202124;border:2px solid #737578;border-radius:48px;box-shadow:0 18px 42px #20212440"><img alt="Freed mobile screen" src="data:image/png;base64,${screen.toString("base64")}" style="display:block;width:390px;height:844px;border-radius:36px" /></div></body></html>`);
      await frame.locator("img").evaluate((img) => img.decode());
      await frame.screenshot({ path: path.join(outputDirectory, capture.file), type: "png" });
      await frame.close();
    } else {
      await page.screenshot({ animations: "disabled", path: path.join(outputDirectory, capture.file), type: "png" });
    }
  }
} finally {
  await browser.close();
}

if (unexpectedRequestUrls.size > 0) {
  throw new Error(
    `Showcase made unexpected remote requests:\n${[...unexpectedRequestUrls].join("\n")}`,
  );
}

const gifOrder = stableShuffle(captures, releaseSha).map(({ file }) => file);
contentCounts.regular = contentCounts.total - contentCounts.stories;
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
      contentCounts,
      remoteMediaUrls: [...remoteRequestUrls].sort(),
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `Captured ${captures.length.toLocaleString()} Freed showcase views in ${outputDirectory}.\n`,
);
