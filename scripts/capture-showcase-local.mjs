import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { readShowcaseMediaCatalog, SHOWCASE_THEME_IDS } from "./lib/release-showcase-assets.mjs";

const baseUrl = process.env.FREED_SHOWCASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = path.resolve(
  process.env.FREED_SHOWCASE_OUTPUT ?? "release-showcase",
);
const releaseTag = process.env.GITHUB_REF_NAME ?? "local-preview";
const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
const baseOrigin = new URL(baseUrl).origin;
// New catalog hosts and extensionless assets are admitted by exact URL, never
// by broadening the network host allowlist. This only audits existing loads.
const reviewedMediaUrls = await readShowcaseMediaCatalog(
  fileURLToPath(new URL("../packages/shared/src/", import.meta.url)),
);
const desktopOnly = process.env.FREED_SHOWCASE_DESKTOP_ONLY === "1";
const retainedManifest = desktopOnly ? JSON.parse(await readFile(path.join(outputDirectory, "freed-showcase-manifest.json"), "utf8")) : null;
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

const originalCaptures = [
  { file: "freed-showcase-unified-midas.png", theme: "midas", view: "unified" },
  { file: "freed-showcase-map-scriptorium.png", theme: "scriptorium", view: "map" },
  { file: "freed-showcase-friends-dark-star.png", theme: "dark-star", view: "friends" },
  { file: "freed-showcase-friend-detail-starship.png", theme: "starship", view: "friends", detail: true },
  { file: "freed-showcase-stories-ember.png", theme: "ember", view: "stories", mobile: true },
  { file: "freed-showcase-reader-scriptorium.png", theme: "scriptorium", view: "instagram", mobile: true, reader: true },
];

const selectedTheme = process.env.FREED_SHOWCASE_THEME;
const themeIds = SHOWCASE_THEME_IDS;
if (selectedTheme && !themeIds.includes(selectedTheme)) throw new Error("Unknown showcase theme");
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) throw new Error("Local capture requires a loopback URL");
const captures = originalCaptures.map((capture) => ({ ...capture,
  theme: selectedTheme ?? capture.theme,
  file: selectedTheme ? capture.file.replace(/-(midas|ember|neon|scriptorium|dark-star|starship)\.png$/, `-${selectedTheme}.png`) : capture.file,
}));

async function waitForShowcase(page) {
  await page.locator("header").getByText(/[1-9][0-9,]* items/).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function openNavigation(page) {
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  if (await menu.isVisible()) await menu.click();
}

async function selectView(page, view) {
  await openNavigation(page);
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
  await openNavigation(page);
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
// Use full Chromium's headless compositor. The separate Linux headless shell
// cannot back the shared WebGPU canvas image and loses the device on selection.
// Linux CI has no hardware adapter, so keep ANGLE and WebGPU on SwiftShader's
// Vulkan path. Every host must still pass the renderer and star-count proof.
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: [
    "--enable-unsafe-webgpu",
    ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    ...(process.platform === "linux" ? [
      "--enable-features=Vulkan", "--use-angle=vulkan", "--use-vulkan=swiftshader",
      "--use-webgpu-adapter=swiftshader", "--disable-vulkan-surface",
    ] : []),
  ],
});
const context = await browser.newContext({
  deviceScaleFactor: 2,
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
await context.tracing.start({ screenshots: true, snapshots: true });
const emulation = await context.newCDPSession(page);
const desktopUserAgent = await page.evaluate(() => navigator.userAgent);
const browserVersion = /(?:Headless)?Chrome\/([\d.]+)/.exec(desktopUserAgent)?.[1];
if (!browserVersion) throw new Error("Cannot identify capture browser version");
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
const contentCounts = retainedManifest ? { ...retainedManifest.contentCounts } : { total: null, regular: null, stories: null };
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
    if (desktopOnly && capture.mobile) {
      const retained = retainedManifest.captures.find(previous => previous.file === capture.file && previous.theme === capture.theme && previous.mobile);
      if (!retained || !retainedManifest.transparentCanvas) throw new Error("No matching verified mobile frame to retain");
      await readFile(path.join(outputDirectory, capture.file));
      capture.retainedFromCapture = retainedManifest.generatedAt;
      continue;
    }
    // Emulate device identity as well as width for the application's phone layout.
    await emulation.send("Emulation.setUserAgentOverride", {
      userAgent: capture.mobile ? `Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Mobile Safari/537.36` : desktopUserAgent,
      userAgentMetadata: { brands: [], fullVersion: browserVersion, platform: capture.mobile ? "Android" : "macOS", platformVersion: "", architecture: "", model: "", mobile: Boolean(capture.mobile) },
    });
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
    await page.evaluate((zoom) => {
      localStorage.setItem("freed-interface-zoom", String(zoom));
      document.documentElement.style.fontSize = zoom === 100 ? "" : `${zoom}%`;
      document.documentElement.dataset.interfaceZoom = String(zoom);
      dispatchEvent(new CustomEvent("freed-interface-zoom-change", { detail: zoom }));
    }, capture.mobile ? 100 : 120);
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
      // World-view markers overlap. Invoke the chosen marker's normal handler deterministically.
      await page.locator('.maplibregl-marker[aria-label="Sela Current"]').first().dispatchEvent('click');
      const details = page.getByTestId("map-floating-panel");
      await details.getByText("Sela Current", { exact: true }).waitFor();
      await page.waitForFunction(() => {
        const panel = document.querySelector('[data-testid="map-floating-panel"]');
        const rect = panel?.getBoundingClientRect();
        return rect && rect.width > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
      });
    } else if (capture.view === "friends") {
      await page.locator('[data-testid="friend-graph-viewport"][data-graph-diagnostics="published"]').waitFor();
      await page.waitForFunction(() => Number(document.querySelector(
        '[data-testid="friend-graph-viewport"]',
      )?.getAttribute("data-ready-renderer-label-count")) > 0);
    }
    if (capture.view === "friends") {
      const diagnostics = await page.getByTestId("friend-graph-viewport").evaluate(element => ({
        renderer: element.dataset.graphRenderer,
        decorativeStarCount: Number(element.dataset.graphDecorativeStarCount),
      }));
      if (diagnostics.renderer !== "raw-webgpu" || !(diagnostics.decorativeStarCount > 0)) {
        throw new Error(`Friends capture requires WebGPU background stars: ${JSON.stringify(diagnostics)}`);
      }
      capture.rendererDiagnostics = diagnostics;
    }
    if (capture.view === "friends" && !capture.detail) {
      const graph = page.getByTestId("friend-graph-viewport");
      await graph.hover();
      await page.mouse.wheel(0, -220);
      await page.waitForTimeout(1_200);
      capture.graphZoomWheelDelta = -220;
    }
    if (capture.detail) {
      // Search through the real directory so this located sample friend is
      // mounted regardless of the current activity ordering or virtualization.
      await page.getByRole("textbox", { name: "Search friends", exact: true }).fill("Sela Current");
      // The card center can land on its relationship slider at some font/layout
      // metrics. Select its title, which bubbles through the normal card handler.
      await page.locator('[data-testid="friend-overview-virtual-row"] > [role="button"]').getByText("Sela Current", { exact: true }).click();
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
      await page.getByTestId("reader-article").waitFor();
    }
    await waitForVisibleImages(page);
    if (capture.mobile) {
      capture.mobileLayout = await page.evaluate(() => ({
        deviceMobile: navigator.userAgentData?.mobile === true,
        storyColumns: [...document.querySelectorAll('[style*="grid-template-columns"]')]
          .filter(element => element.querySelector('[data-feed-item-id]'))
          .map(element => getComputedStyle(element).gridTemplateColumns.split(" ").length),
      }));
      if (!capture.mobileLayout.deviceMobile || (capture.view === "stories" &&
          (!capture.mobileLayout.storyColumns.length || capture.mobileLayout.storyColumns.some(columns => columns > 2)))) {
        throw new Error(`Incorrect mobile showcase layout: ${JSON.stringify(capture.mobileLayout)}`);
      }
    }
    process.stdout.write(`Captured ${capture.theme}: ${capture.file}\n`);
    const policyViolations = await page.evaluate(() => window.__freedShowcasePolicyViolations);
    if (policyViolations.length > 0) {
      throw new Error(`Showcase policy blocked ${capture.view}: ${JSON.stringify(policyViolations)}`);
    }
    const imageFailures = await page.evaluate(() => window.__freedShowcaseImageFailures);
    if (imageFailures.length > 0) {
      throw new Error(`Showcase images failed in ${capture.view}: ${JSON.stringify(imageFailures)}`);
    }
    // Resolve the active theme once so both frame types share the same tint.
    const framePalette = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const accent = styles.getPropertyValue("--theme-accent-primary").trim();
      if (!accent) throw new Error("Missing theme frame accent");
      const secondary = styles.getPropertyValue("--theme-accent-secondary").trim();
      const theme = document.documentElement.dataset.theme;
      if (!secondary) throw new Error("Missing secondary frame accent");
      if (theme === "midas") {
        return { accent: secondary, shell: `color-mix(in srgb, ${secondary} 50%, #33281b)`, edge: `color-mix(in srgb, ${secondary} 75%, #33281b)` };
      }
      if (theme === "scriptorium") {
        return { accent, shell: `color-mix(in srgb, ${accent} 60%, #ffffff)`, edge: `color-mix(in srgb, ${secondary} 70%, #f4ead7)` };
      }
      if (theme === "neon") {
        return { accent: secondary, shell: `color-mix(in srgb, ${secondary} 30%, #160d22)`, edge: `color-mix(in srgb, ${secondary} 55%, #21112f)` };
      }
      if (theme === "dark-star") {
        return { accent, shell: `color-mix(in srgb, ${accent} 20%, #080a0f)`, edge: `color-mix(in srgb, ${accent} 35%, #171b23)` };
      }
      return {
        accent,
        shell: `color-mix(in srgb, ${accent} 35%, #202124)`,
        edge: `color-mix(in srgb, ${accent} 70%, #737578)`,
      };
    });
    // Frame a completed screenshot on a separate transparent canvas. Decoration
    // never enters the app's layout or overlays its toolbar and controls.
    // Shared radii in capture-canvas CSS pixels, independent of theme.
    const outerRadius = capture.mobile ? 44 : 20;
    const screen = await page.screenshot({ animations: "disabled", omitBackground: true, type: "png" });
    const frame = await context.newPage();
    await frame.setViewportSize({ width: 1440, height: 960 });
    const thickness = 7;
    const edge = 1;
    // Uniformly fit the desktop screenshot inside its external frame. Mobile
    // retains its approved dimensions; neither screenshot is stretched/cropped.
    const height = capture.mobile ? 844 : 960 - thickness * 2;
    const width = capture.mobile ? 390 : height * 1440 / 960;
    const innerRadius = outerRadius - thickness;
    await frame.setContent(`<html><body style="margin:0;width:1440px;height:960px;background:transparent;display:grid;place-items:center"><div data-showcase-frame style="padding:${thickness - edge}px;background:${framePalette.shell};border:${edge}px solid ${framePalette.edge};border-radius:${outerRadius}px;${capture.mobile ? "box-shadow:0 18px 42px #20212440" : ""}"><img alt="Freed ${capture.mobile ? "mobile" : "desktop"} screen" src="data:image/png;base64,${screen.toString("base64")}" style="display:block;width:${width}px;height:${height}px;border-radius:${innerRadius}px" /></div></body></html>`);
    await frame.locator("img").evaluate((img) => img.decode());
    const geometry = await frame.evaluate(() => {
      const box = document.querySelector('[data-showcase-frame]').getBoundingClientRect();
      const content = document.querySelector('img').getBoundingClientRect();
      return {
        left: content.left - box.left, right: box.right - content.right,
        top: content.top - box.top, bottom: box.bottom - content.bottom,
        contentWidth: content.width, contentHeight: content.height,
      };
    });
    if ([geometry.left, geometry.right, geometry.top, geometry.bottom].some(value => Math.abs(value - thickness) > 0.05)) {
      throw new Error("Showcase frame must sit completely outside screenshot content");
    }
    const decoration = {
      ...framePalette, placement: "outside-content", geometry,
      captureBorderWidth: thickness, borderWidth: thickness * 1920 / 1440,
      captureRadius: outerRadius, frameWidthRatio: 1,
    };
    if (capture.mobile) capture.mobileDecoration = decoration;
    else capture.desktopDecoration = decoration;
    await frame.screenshot({ path: path.join(outputDirectory, capture.file), omitBackground: true, type: "png" });
    await frame.close();
  }
} catch (error) {
  // The demo contains synthetic data. Preserve the failed UI before closing
  // Chromium so CI selection and rendering failures remain diagnosable.
  await page.screenshot({ path: path.join(outputDirectory, "failure.png") }).catch(() => {});
  const state = await page.evaluate(() => ({
    url: location.href,
    theme: document.documentElement.dataset.theme,
    sidebar: document.querySelector('[data-testid="friends-sidebar"]')?.textContent?.slice(0, 20_000),
    focusedElement: document.activeElement?.outerHTML.slice(0, 2_000),
    rows: [...document.querySelectorAll('[data-testid="friend-overview-virtual-row"]')]
      .slice(0, 20).map(row => row.textContent?.slice(0, 1_000)),
  })).catch(() => null);
  await writeFile(path.join(outputDirectory, "failure.json"), JSON.stringify({
    releaseTag, releaseSha, sourceDirty,
    error: error instanceof Error ? error.message : String(error), state,
  }, null, 2) + "\n").catch(() => {});
  await context.tracing.stop({ path: path.join(outputDirectory, "failure-trace.zip") }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}

if (unexpectedRequestUrls.size > 0) {
  throw new Error(
    `Showcase made unexpected remote requests:\n${[...unexpectedRequestUrls].join("\n")}`,
  );
}

const gifOrder = captures.map(({ file }) => file);
contentCounts.regular = contentCounts.total - contentCounts.stories;
await writeFile(
  path.join(outputDirectory, "gif-order.txt"),
  `${gifOrder.map((file) => `file '${file}'\nduration 3`).join("\n")}\nfile '${gifOrder.at(-1)}'\n`,
);
await writeFile(
  path.join(outputDirectory, "freed-showcase-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      releaseTag,
      releaseSha,
      sourceDirty,
      baseUrl,
      generatedAt: new Date().toISOString(),
      transparentCanvas: true,
      sourcePixelWidth: 2880,
      sourcePixelHeight: 1920,
      deviceScaleFactor: 2,
      desktopZoom: 120,
      mobileZoom: 100,
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
