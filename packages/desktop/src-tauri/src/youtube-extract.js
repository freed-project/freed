(function () {
  "use strict";

  const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const MAX_SCROLL_PASSES = 32;
  const REQUIRED_STABLE_PASSES = 3;
  const SCROLL_SETTLE_MS = 900;
  const READY_TIMEOUT_MS = 15000;
  const normalizedPath = location.pathname.replace(/\/$/, "");
  const stage = normalizedPath === "/feed/channels"
    ? "channels"
    : normalizedPath === "/feed/subscriptions"
      ? "subscriptions"
      : "unsupported";

  const channels = new Map();
  const videos = new Map();
  const unresolved = new Set();
  const candidateSources = new Set();

  function textOf(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value.simpleText === "string") return value.simpleText.trim();
    if (Array.isArray(value.runs)) {
      return value.runs
        .map((run) => typeof run.text === "string" ? run.text : "")
        .join("")
        .trim();
    }
    if (typeof value.label === "string") return value.label.trim();
    return "";
  }

  function thumbnailsOf(value) {
    const thumbnails = value && Array.isArray(value.thumbnails)
      ? value.thumbnails
      : [];
    return thumbnails
      .filter((thumbnail) => thumbnail && typeof thumbnail.url === "string")
      .sort((left, right) => {
        const leftSize = Number(left.width || 0) * Number(left.height || 0);
        const rightSize = Number(right.width || 0) * Number(right.height || 0);
        return leftSize - rightSize;
      });
  }

  function bestThumbnail(value) {
    const thumbnails = thumbnailsOf(value);
    return thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;
  }

  function endpointOf(value) {
    if (!value || typeof value !== "object") return undefined;
    return value.navigationEndpoint || value.endpoint || value.command;
  }

  function browseIdFrom(value) {
    if (!value || typeof value !== "object") return undefined;
    const direct = value.channelId;
    if (typeof direct === "string" && CHANNEL_ID_PATTERN.test(direct)) return direct;

    const endpoint = endpointOf(value);
    const browseId = endpoint && endpoint.browseEndpoint && endpoint.browseEndpoint.browseId;
    if (typeof browseId === "string" && CHANNEL_ID_PATTERN.test(browseId)) return browseId;

    const browseEndpoint = value.browseEndpoint;
    if (browseEndpoint && typeof browseEndpoint.browseId === "string"
      && CHANNEL_ID_PATTERN.test(browseEndpoint.browseId)) {
      return browseEndpoint.browseId;
    }

    const runs = value.runs;
    if (Array.isArray(runs)) {
      for (const run of runs) {
        const runId = browseIdFrom(run);
        if (runId) return runId;
      }
    }
    return undefined;
  }

  function canonicalBaseUrl(value) {
    const endpoint = endpointOf(value);
    const base = endpoint && endpoint.browseEndpoint
      && endpoint.browseEndpoint.canonicalBaseUrl;
    return typeof base === "string" ? base : undefined;
  }

  function handleFrom(value) {
    const base = canonicalBaseUrl(value);
    if (base && base.startsWith("/@")) return base.slice(1);
    const text = textOf(value);
    const match = text.match(/(^|\s)(@[A-Za-z0-9._-]{2,})/);
    return match ? match[2] : undefined;
  }

  function addChannel(renderer, source) {
    if (!renderer || typeof renderer !== "object") return;
    const candidateKey = `channel:${source}`;
    candidateSources.add(candidateKey);
    const channelId = browseIdFrom(renderer)
      || browseIdFrom(renderer.title)
      || browseIdFrom(renderer.channelTitle)
      || browseIdFrom(renderer.ownerText)
      || browseIdFrom(renderer.shortBylineText)
      || browseIdFrom(renderer.longBylineText);
    if (!channelId) {
      unresolved.add(candidateKey);
      return;
    }
    unresolved.delete(candidateKey);

    const title = textOf(renderer.title)
      || textOf(renderer.channelTitle)
      || textOf(renderer.ownerText)
      || textOf(renderer.shortBylineText)
      || textOf(renderer.longBylineText)
      || channelId;
    const handle = handleFrom(renderer.title)
      || handleFrom(renderer.channelTitle)
      || handleFrom(renderer.ownerText)
      || handleFrom(renderer.shortBylineText)
      || handleFrom(renderer);
    const description = textOf(renderer.descriptionSnippet)
      || textOf(renderer.descriptionText)
      || undefined;
    const thumbnailUrl = bestThumbnail(renderer.thumbnail)
      || bestThumbnail(renderer.avatar)
      || bestThumbnail(renderer.channelThumbnailSupportedRenderers
        && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer
        && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail);
    const existing = channels.get(channelId) || {};
    channels.set(channelId, {
      channelId,
      title: existing.title && existing.title !== channelId ? existing.title : title,
      displayName: existing.displayName && existing.displayName !== channelId
        ? existing.displayName
        : title,
      ...(existing.handle || handle ? { handle: existing.handle || handle } : {}),
      ...(existing.description || description
        ? { description: existing.description || description }
        : {}),
      ...(existing.thumbnailUrl || thumbnailUrl
        ? {
            thumbnailUrl: existing.thumbnailUrl || thumbnailUrl,
            avatarUrl: existing.avatarUrl || existing.thumbnailUrl || thumbnailUrl,
          }
        : {}),
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      profileUrl: `https://www.youtube.com/channel/${channelId}`,
    });
  }

  function videoIdFrom(renderer) {
    if (!renderer || typeof renderer !== "object") return undefined;
    if (typeof renderer.videoId === "string" && VIDEO_ID_PATTERN.test(renderer.videoId)) {
      return renderer.videoId;
    }
    const endpoint = endpointOf(renderer);
    const id = endpoint && endpoint.watchEndpoint && endpoint.watchEndpoint.videoId;
    return typeof id === "string" && VIDEO_ID_PATTERN.test(id) ? id : undefined;
  }

  function endpointUrl(value) {
    const endpoint = endpointOf(value);
    const commandMetadata = endpoint && endpoint.commandMetadata
      && endpoint.commandMetadata.webCommandMetadata;
    return commandMetadata && typeof commandMetadata.url === "string"
      ? commandMetadata.url
      : "";
  }

  function overlayStyles(renderer) {
    const overlays = Array.isArray(renderer.thumbnailOverlays)
      ? renderer.thumbnailOverlays
      : [];
    return overlays.flatMap((overlay) => {
      if (!overlay || typeof overlay !== "object") return [];
      return Object.values(overlay)
        .filter((value) => value && typeof value === "object")
        .flatMap((value) => [value.style, textOf(value.text)])
        .filter(Boolean)
        .map((value) => String(value).toUpperCase());
    });
  }

  function addVideo(renderer, source) {
    if (!renderer || typeof renderer !== "object") return;
    const candidateKey = `video:${source}`;
    candidateSources.add(candidateKey);
    const videoId = videoIdFrom(renderer);
    if (!videoId) {
      unresolved.add(candidateKey);
      return;
    }
    unresolved.delete(candidateKey);

    const owner = renderer.ownerText
      || renderer.shortBylineText
      || renderer.longBylineText
      || renderer.channelName;
    const channelId = browseIdFrom(owner) || browseIdFrom(renderer);
    const channelTitle = textOf(owner) || textOf(renderer.channelName);
    if (!channelId || !channelTitle) {
      unresolved.add(`video-owner:${videoId}`);
      return;
    }
    unresolved.delete(`video-owner:${videoId}`);

    addChannel({
      channelId,
      title: owner,
      thumbnail: renderer.channelThumbnailSupportedRenderers
        && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer
        && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail,
    }, `video-owner:${videoId}`);

    const title = textOf(renderer.title) || textOf(renderer.headline);
    if (!title) {
      unresolved.add(`video-title:${videoId}`);
      return;
    }
    unresolved.delete(`video-title:${videoId}`);

    const path = endpointUrl(renderer)
      || endpointUrl(renderer.title)
      || `/watch?v=${videoId}`;
    const styles = overlayStyles(renderer);
    const thumbnailUrl = bestThumbnail(renderer.thumbnail);
    const channel = channels.get(channelId);
    videos.set(videoId, {
      videoId,
      title,
      channelId,
      channelTitle,
      ...(channel && channel.handle ? { channelHandle: channel.handle } : {}),
      ...(channel && channel.avatarUrl
        ? { channelAvatarUrl: channel.avatarUrl }
        : {}),
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(textOf(renderer.descriptionSnippet)
        ? { description: textOf(renderer.descriptionSnippet) }
        : {}),
      ...(textOf(renderer.publishedTimeText)
        ? { publishedText: textOf(renderer.publishedTimeText) }
        : {}),
      ...(textOf(renderer.lengthText)
        ? { durationText: textOf(renderer.lengthText) }
        : {}),
      isShort: path.startsWith("/shorts/") || source.includes("reel"),
      isLive: styles.some((value) => value.includes("LIVE")),
      isUpcoming: styles.some((value) => value.includes("UPCOMING")),
    });
  }

  const CHANNEL_RENDERER_KEYS = new Set([
    "channelRenderer",
    "gridChannelRenderer",
    "compactChannelRenderer",
    "channelListSubMenuAvatarRenderer",
  ]);
  const VIDEO_RENDERER_KEYS = new Set([
    "videoRenderer",
    "gridVideoRenderer",
    "compactVideoRenderer",
    "reelItemRenderer",
  ]);

  function collectTree(root, source) {
    if (!root || typeof root !== "object") return;
    const pending = [{ value: root, path: source }];
    const seen = new WeakSet();
    let visited = 0;
    while (pending.length > 0 && visited < 200000) {
      const entry = pending.pop();
      const value = entry.value;
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      for (const [key, child] of Object.entries(value)) {
        if (!child || typeof child !== "object") continue;
        const childPath = `${entry.path}.${key}`;
        if (CHANNEL_RENDERER_KEYS.has(key)) addChannel(child, childPath);
        if (stage === "subscriptions" && VIDEO_RENDERER_KEYS.has(key)) {
          addVideo(child, childPath);
        }
        pending.push({ value: child, path: childPath });
      }
    }
  }

  function treeHasKey(root, expectedKey) {
    if (!root || typeof root !== "object") return false;
    const pending = [root];
    const seen = new WeakSet();
    let visited = 0;
    while (pending.length > 0 && visited < 200000) {
      const value = pending.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      for (const [key, child] of Object.entries(value)) {
        if (key === expectedKey) return true;
        if (child && typeof child === "object") pending.push(child);
      }
    }
    return false;
  }

  function hasPositiveChannelPageEvidence() {
    if (stage !== "channels" || !window.ytInitialData) return false;
    const browse = document.querySelector("ytd-browse");
    if (!browse) return false;
    if (channels.size > 0) return true;
    return Boolean(browse.querySelector("ytd-background-promo-renderer"))
      && treeHasKey(window.ytInitialData, "backgroundPromoRenderer");
  }

  function collectBackingData() {
    collectTree(window.ytInitialData, "ytInitialData");
    const selectors = stage === "channels"
      ? ["ytd-channel-renderer", "ytd-grid-channel-renderer", "ytd-item-section-renderer"]
      : [
          "ytd-rich-item-renderer",
          "ytd-video-renderer",
          "ytd-grid-video-renderer",
          "ytd-reel-item-renderer",
          "ytd-item-section-renderer",
        ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element, index) => {
        collectTree(element.data, `${selector}:${index}:data`);
        collectTree(element.__data && element.__data.data, `${selector}:${index}:private-data`);
      });
    }
  }

  function pageReady() {
    if (!location.hostname.endsWith("youtube.com")) return false;
    if (!document.querySelector("ytd-app")) return false;
    if (window.ytcfg && typeof window.ytcfg.get === "function"
      && window.ytcfg.get("LOGGED_IN") === false) {
      return true;
    }
    return Boolean(window.ytInitialData)
      || document.querySelector("ytd-browse, ytd-two-column-browse-results-renderer");
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function waitUntilReady() {
    const startedAt = Date.now();
    while (!pageReady() && Date.now() - startedAt < READY_TIMEOUT_MS) {
      await sleep(250);
    }
    return pageReady();
  }

  function isLoggedIn() {
    if (window.ytcfg && typeof window.ytcfg.get === "function") {
      const value = window.ytcfg.get("LOGGED_IN");
      if (typeof value === "boolean") return value;
    }
    const context = window.ytInitialData && window.ytInitialData.responseContext;
    const loggedOut = context && context.mainAppWebResponseContext
      && context.mainAppWebResponseContext.loggedOut;
    return loggedOut === false;
  }

  function reachedDocumentEnd() {
    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0,
    );
    return viewportBottom >= documentHeight - 8;
  }

  function emit(payload) {
    if (!window.__TAURI__ || !window.__TAURI__.event) {
      throw new Error("YouTube session event bridge is unavailable.");
    }
    return window.__TAURI__.event.emit("yt-capture-data", payload);
  }

  async function run() {
    if (stage === "unsupported") {
      throw new Error("YouTube opened an unexpected page for capture.");
    }
    const ready = await waitUntilReady();
    if (!ready) throw new Error("YouTube did not finish rendering the requested page.");
    if (!isLoggedIn()) throw new Error("The YouTube website session is not signed in.");

    let previousHeight = 0;
    let previousResultCount = 0;
    let stablePasses = 0;
    let scrollPasses = 0;
    let stopReason = "max-passes";

    for (let pass = 0; pass < MAX_SCROLL_PASSES; pass += 1) {
      collectBackingData();
      scrollPasses = pass + 1;
      const height = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0,
      );
      const resultCount = channels.size + videos.size;
      const atEnd = reachedDocumentEnd();

      if (height === previousHeight && resultCount === previousResultCount) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }

      if (atEnd && stablePasses >= REQUIRED_STABLE_PASSES) {
        stopReason = "end-stable";
        break;
      }

      previousHeight = height;
      previousResultCount = resultCount;
      window.scrollTo({ top: height, behavior: "auto" });
      await sleep(SCROLL_SETTLE_MS);
    }

    collectBackingData();
    const pageEvidence = hasPositiveChannelPageEvidence();
    const rosterComplete = stage === "channels"
      && stopReason === "end-stable"
      && unresolved.size === 0
      && pageEvidence;
    await emit({
      channels: Array.from(channels.values()),
      videos: stage === "subscriptions" ? Array.from(videos.values()) : [],
      rosterComplete,
      complete: stage === "subscriptions",
      unresolvedCount: unresolved.size,
      candidateCount: candidateSources.size,
      scrollPasses,
      stopReason,
      pageEvidence,
      extractedAt: Date.now(),
      done: stage === "subscriptions",
      stage,
    });
  }

  run().catch((error) => {
    void emit({
      channels: [],
      videos: [],
      rosterComplete: false,
      complete: stage === "subscriptions",
      unresolvedCount: unresolved.size,
      candidateCount: candidateSources.size,
      scrollPasses: 0,
      stopReason: "error",
      extractedAt: Date.now(),
      done: stage === "subscriptions",
      stage,
      error: error instanceof Error ? error.message : String(error),
    });
  });
})();
