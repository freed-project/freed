(function () {
  "use strict";

  const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const MAX_SCROLL_PASSES = 32;
  const REQUIRED_STABLE_PASSES = 3;
  const SCROLL_SETTLE_MS = 900;
  const READY_TIMEOUT_MS = 15000;
  const SCRIPT_DEADLINE_MS = 60000;
  const MAX_OBJECT_VISITS = 400000;
  const DEADLINE_CHECK_INTERVAL = 256;
  const captureId = "__YOUTUBE_CAPTURE_ID__";
  const stage = "__EXPECTED_YOUTUBE_CAPTURE_STAGE__";
  const expectedPath = "__EXPECTED_YOUTUBE_CAPTURE_PATH__";
  const startedAt = Date.now();
  const deadlineAt = startedAt + SCRIPT_DEADLINE_MS;

  const channels = new Map();
  const videos = new Map();
  const unresolved = new Set();
  const persistentVideoIssues = new Set();
  const candidateSources = new Set();
  const seenInitialObjects = new WeakSet();
  const renderedElementIds = new WeakMap();
  const objectRevisionIds = new WeakMap();
  const chargedObjectRevisions = new WeakMap();
  const selectedEmptyRendererObjects = new WeakSet();
  const selectedEmptyRendererFingerprints = new Set();
  const emittedChannels = new Map();
  const emittedVideos = new Map();
  const supportedRenderedCandidates = new Set();
  const unsupportedRenderedCandidates = new Set();
  let initialDataScanned = false;
  let nextRenderedElementId = 1;
  let nextObjectRevisionId = 1;
  let visitedObjectCount = 0;
  let workBudgetExceeded = false;
  let deadlineExceeded = false;
  let scrollPasses = 0;
  let stablePasses = 0;
  let stopReason = "starting";

  function normalizePath(path) {
    const normalized = typeof path === "string" ? path.replace(/\/+$/, "") : "";
    return normalized || "/";
  }

  function isYouTubeHost(hostname) {
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  }

  function elapsedMs() {
    return Math.max(0, Date.now() - startedAt);
  }

  function remainingMs() {
    return Math.max(0, deadlineAt - Date.now());
  }

  function checkDeadline() {
    if (Date.now() < deadlineAt) return false;
    deadlineExceeded = true;
    return true;
  }

  function workMustStop() {
    return workBudgetExceeded || deadlineExceeded || checkDeadline();
  }

  function assertExpectedPage() {
    const requiredPath = stage === "channels"
      ? "/feed/channels"
      : stage === "subscriptions"
        ? "/feed/subscriptions"
        : null;
    if (!captureId || captureId.startsWith("__YOUTUBE_")) {
      throw new Error("YouTube capture identity was not initialized.");
    }
    if (!requiredPath || normalizePath(expectedPath) !== requiredPath) {
      throw new Error("YouTube capture received an unsupported stage or path.");
    }
    if (!isYouTubeHost(location.hostname) || normalizePath(location.pathname) !== requiredPath) {
      throw new Error("YouTube opened an unexpected page for capture.");
    }
  }

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

  function markUnresolved(issueTarget, key, trackUnresolved) {
    if (trackUnresolved) issueTarget.add(key);
  }

  function clearUnresolved(issueTarget, key) {
    issueTarget.delete(key);
  }

  function clearPersistentVideoIssue(key) {
    persistentVideoIssues.delete(key);
    unresolved.delete(key);
  }

  function recordPersistentVideoIssue(key) {
    if (key.startsWith("video-owner:") || key.startsWith("video-title:")) {
      const videoId = key.slice(key.indexOf(":") + 1);
      if (videos.has(videoId)) return;
    }
    persistentVideoIssues.add(key);
    unresolved.add(key);
  }

  function addChannel(
    renderer,
    source,
    trackUnresolved = true,
    issueTarget = unresolved,
  ) {
    if (!renderer || typeof renderer !== "object") return false;
    const candidateKey = `channel:${source}`;
    candidateSources.add(candidateKey);
    const channelId = browseIdFrom(renderer)
      || browseIdFrom(renderer.title)
      || browseIdFrom(renderer.channelTitle)
      || browseIdFrom(renderer.ownerText)
      || browseIdFrom(renderer.shortBylineText)
      || browseIdFrom(renderer.longBylineText);
    if (!channelId) {
      markUnresolved(issueTarget, candidateKey, trackUnresolved);
      return false;
    }
    clearUnresolved(issueTarget, candidateKey);

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
    return true;
  }

  function videoIdFrom(renderer) {
    if (!renderer || typeof renderer !== "object") return undefined;
    if (typeof renderer.videoId === "string" && VIDEO_ID_PATTERN.test(renderer.videoId)) {
      return renderer.videoId;
    }
    const endpoint = endpointOf(renderer);
    const id = endpoint && (
      endpoint.watchEndpoint && endpoint.watchEndpoint.videoId
      || endpoint.reelWatchEndpoint && endpoint.reelWatchEndpoint.videoId
    );
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

  function addVideo(
    renderer,
    source,
    trackUnresolved = true,
    issueTarget = unresolved,
  ) {
    if (!renderer || typeof renderer !== "object") return false;
    const candidateKey = `video:${source}`;
    candidateSources.add(candidateKey);
    const videoId = videoIdFrom(renderer);
    if (!videoId) {
      markUnresolved(issueTarget, candidateKey, trackUnresolved);
      return false;
    }
    clearUnresolved(issueTarget, candidateKey);

    const path = endpointUrl(renderer)
      || endpointUrl(renderer.title)
      || (source.includes("reel") ? `/shorts/${videoId}` : `/watch?v=${videoId}`);
    const isShortCandidate = path.startsWith("/shorts/") || source.includes("reel");
    const styles = overlayStyles(renderer);
    const thumbnailUrl = bestThumbnail(renderer.thumbnail);

    const owner = renderer.ownerText
      || renderer.shortBylineText
      || renderer.longBylineText
      || renderer.channelName;
    const channelId = browseIdFrom(owner) || browseIdFrom(renderer);
    const channelTitle = textOf(owner) || textOf(renderer.channelName);
    const title = textOf(renderer.title) || textOf(renderer.headline);
    const existing = videos.get(videoId);
    const conflictKey = `video-channel-conflict:${videoId}`;
    if (existing?.channelId && channelId && existing.channelId !== channelId) {
      markUnresolved(issueTarget, conflictKey, trackUnresolved);
      return false;
    }

    if (isShortCandidate && (!channelId || !channelTitle || !title)) {
      clearUnresolved(issueTarget, `video-owner:${videoId}`);
      clearUnresolved(issueTarget, `video-title:${videoId}`);
      clearPersistentVideoIssue(`video-owner:${videoId}`);
      clearPersistentVideoIssue(`video-title:${videoId}`);
      if (channelId && channelTitle) {
        addChannel({
          channelId,
          title: owner,
          thumbnail: renderer.channelThumbnailSupportedRenderers
            && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer
            && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail,
        }, `video-owner:${videoId}`, trackUnresolved, issueTarget);
      }
      const channel = channelId ? channels.get(channelId) : undefined;
      videos.set(videoId, {
        ...existing,
        videoId,
        title: existing?.title && existing.title !== videoId
          ? existing.title
          : title || videoId,
        ...(existing?.channelId || channelId
          ? { channelId: existing?.channelId || channelId }
          : {}),
        ...(existing?.channelTitle || channelTitle
          ? { channelTitle: existing?.channelTitle || channelTitle }
          : {}),
        ...(existing?.channelHandle || channel?.handle
          ? { channelHandle: existing?.channelHandle || channel?.handle }
          : {}),
        ...(existing?.channelAvatarUrl || channel?.avatarUrl
          ? { channelAvatarUrl: existing?.channelAvatarUrl || channel?.avatarUrl }
          : {}),
        ...(existing?.channelUrl || channelId
          ? { channelUrl: existing?.channelUrl || `https://www.youtube.com/channel/${channelId}` }
          : {}),
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        ...(existing?.thumbnailUrl || thumbnailUrl
          ? { thumbnailUrl: existing?.thumbnailUrl || thumbnailUrl }
          : {}),
        isShort: true,
        isLive: Boolean(existing?.isLive)
          || styles.some((value) => value.includes("LIVE")),
        isUpcoming: Boolean(existing?.isUpcoming)
          || styles.some((value) => value.includes("UPCOMING")),
      });
      return true;
    }

    if (!channelId || !channelTitle) {
      markUnresolved(issueTarget, `video-owner:${videoId}`, trackUnresolved);
      return false;
    }
    clearUnresolved(issueTarget, `video-owner:${videoId}`);
    clearPersistentVideoIssue(`video-owner:${videoId}`);

    addChannel({
      channelId,
      title: owner,
      thumbnail: renderer.channelThumbnailSupportedRenderers
        && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer
        && renderer.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail,
    }, `video-owner:${videoId}`, trackUnresolved, issueTarget);

    if (!title) {
      markUnresolved(issueTarget, `video-title:${videoId}`, trackUnresolved);
      return false;
    }
    clearUnresolved(issueTarget, `video-title:${videoId}`);
    clearPersistentVideoIssue(`video-title:${videoId}`);

    const channel = channels.get(channelId);
    const channelHandle = existing?.channelHandle || channel?.handle;
    const channelAvatarUrl = existing?.channelAvatarUrl || channel?.avatarUrl;
    const description = existing?.description
      || textOf(renderer.descriptionSnippet)
      || undefined;
    const publishedText = existing?.publishedText
      || textOf(renderer.publishedTimeText)
      || undefined;
    const durationText = existing?.durationText
      || textOf(renderer.lengthText)
      || undefined;
    videos.set(videoId, {
      videoId,
      title: existing?.title && existing.title !== videoId ? existing.title : title,
      channelId,
      channelTitle: existing?.channelTitle || channelTitle,
      ...(channelHandle ? { channelHandle } : {}),
      ...(channelAvatarUrl ? { channelAvatarUrl } : {}),
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      ...(existing?.thumbnailUrl || thumbnailUrl
        ? { thumbnailUrl: existing?.thumbnailUrl || thumbnailUrl }
        : {}),
      ...(description ? { description } : {}),
      ...(publishedText ? { publishedText } : {}),
      ...(durationText ? { durationText } : {}),
      isShort: Boolean(existing?.isShort)
        || path.startsWith("/shorts/")
        || source.includes("reel"),
      isLive: Boolean(existing?.isLive)
        || styles.some((value) => value.includes("LIVE")),
      isUpcoming: Boolean(existing?.isUpcoming)
        || styles.some((value) => value.includes("UPCOMING")),
    });
    return true;
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

  function emptyCollectionStats() {
    return {
      channelCandidates: 0,
      videoCandidates: 0,
      channelResolved: 0,
      videoResolved: 0,
    };
  }

  function objectRevisionId(value) {
    const existing = objectRevisionIds.get(value);
    if (existing) return existing;
    const id = nextObjectRevisionId;
    nextObjectRevisionId += 1;
    objectRevisionIds.set(value, id);
    return id;
  }

  function mixRevision(hash, text) {
    let mixed = hash;
    for (let index = 0; index < text.length; index += 1) {
      mixed ^= text.charCodeAt(index);
      mixed = Math.imul(mixed, 16777619);
    }
    return mixed >>> 0;
  }

  function objectRevision(entries) {
    let hash = 2166136261;
    for (const [key, child] of entries) {
      hash = mixRevision(hash, key);
      if (child && typeof child === "object") {
        hash = mixRevision(hash, `object:${objectRevisionId(child)}`);
      } else {
        hash = mixRevision(hash, `${typeof child}:${String(child)}`);
      }
    }
    return `${entries.length}:${hash >>> 0}`;
  }

  function chargeObjectRevision(value, entries) {
    const revision = objectRevision(entries);
    if (chargedObjectRevisions.get(value) === revision) return true;
    if (visitedObjectCount >= MAX_OBJECT_VISITS) {
      workBudgetExceeded = true;
      return false;
    }
    chargedObjectRevisions.set(value, revision);
    visitedObjectCount += 1;
    return true;
  }

  function emptyRendererFingerprint(renderer) {
    if (!renderer || typeof renderer !== "object") return null;
    const title = textOf(renderer.title);
    const body = textOf(renderer.bodyText)
      || textOf(renderer.descriptionText)
      || textOf(renderer.subtitle);
    const icon = renderer.icon && typeof renderer.icon.iconType === "string"
      ? renderer.icon.iconType
      : "";
    if (!title && !body && !icon) return null;
    return JSON.stringify({ title, body, icon });
  }

  function rememberSelectedEmptyRenderer(renderer) {
    if (!renderer || typeof renderer !== "object") return;
    selectedEmptyRendererObjects.add(renderer);
    const fingerprint = emptyRendererFingerprint(renderer);
    if (fingerprint) selectedEmptyRendererFingerprints.add(fingerprint);
  }

  function collectTree(
    root,
    source,
    seen,
    stats = emptyCollectionStats(),
    trackUnresolved = true,
    issueTarget = unresolved,
    selectedInitialContent = false,
  ) {
    if (!root || typeof root !== "object") return stats;
    const pending = [{ value: root, path: source }];
    while (pending.length > 0) {
      const entry = pending.pop();
      const value = entry.value;
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      const entries = Object.entries(value);
      if (!chargeObjectRevision(value, entries)) return stats;
      if (visitedObjectCount % DEADLINE_CHECK_INTERVAL === 0 && checkDeadline()) return stats;
      for (const [key, child] of entries) {
        if (!child || typeof child !== "object") continue;
        const childSource = `${entry.path}.${key}`;
        if (selectedInitialContent && key === "backgroundPromoRenderer") {
          rememberSelectedEmptyRenderer(child);
        }
        if (CHANNEL_RENDERER_KEYS.has(key)) {
          stats.channelCandidates += 1;
          if (addChannel(child, childSource, trackUnresolved, issueTarget)) {
            stats.channelResolved += 1;
          }
        }
        if (stage === "subscriptions" && VIDEO_RENDERER_KEYS.has(key)) {
          stats.videoCandidates += 1;
          if (addVideo(child, childSource, trackUnresolved, issueTarget)) {
            stats.videoResolved += 1;
          }
        }
        pending.push({ value: child, path: childSource });
      }
    }
    return stats;
  }

  function renderedElementId(element) {
    const existing = renderedElementIds.get(element);
    if (existing) return existing;
    const id = nextRenderedElementId;
    nextRenderedElementId += 1;
    renderedElementIds.set(element, id);
    return id;
  }

  function elementDataRoots(element) {
    const roots = [];
    const data = element && element.data;
    if (data && typeof data === "object") roots.push({ root: data, suffix: "data" });
    const privateData = element && element.__data && element.__data.data;
    if (privateData && typeof privateData === "object" && privateData !== data) {
      roots.push({ root: privateData, suffix: "private-data" });
    }
    return roots;
  }

  function selectedFeedContentRoots(initialData) {
    if (!initialData || typeof initialData !== "object") return [];
    const contents = initialData.contents;
    if (!contents || typeof contents !== "object") return [];
    const browseRenderers = [
      contents.twoColumnBrowseResultsRenderer,
      contents.singleColumnBrowseResultsRenderer,
    ];
    const roots = [];
    for (const browseRenderer of browseRenderers) {
      if (!browseRenderer || !Array.isArray(browseRenderer.tabs)) continue;
      for (const tab of browseRenderer.tabs) {
        const tabRenderer = tab && tab.tabRenderer;
        if (!tabRenderer || tabRenderer.selected !== true) continue;
        if (tabRenderer.content && typeof tabRenderer.content === "object") {
          roots.push(tabRenderer.content);
        }
      }
    }
    return roots;
  }

  function matchesSelectedEmptyRenderer(renderer) {
    if (!renderer || typeof renderer !== "object") return false;
    if (selectedEmptyRendererObjects.has(renderer)) return true;
    const fingerprint = emptyRendererFingerprint(renderer);
    return Boolean(fingerprint && selectedEmptyRendererFingerprints.has(fingerprint));
  }

  function dataRootMatchesSelectedEmptyRenderer(root) {
    if (!root || typeof root !== "object") return false;
    const pending = [root];
    const seen = new WeakSet();
    let inspected = 0;
    while (pending.length > 0 && inspected < 64) {
      const value = pending.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      inspected += 1;
      if (matchesSelectedEmptyRenderer(value)) return true;
      for (const [key, child] of Object.entries(value)) {
        if (!child || typeof child !== "object") continue;
        if (key === "backgroundPromoRenderer" && matchesSelectedEmptyRenderer(child)) {
          return true;
        }
        pending.push(child);
      }
    }
    return false;
  }

  function hasExplicitEmptyEvidence() {
    const browse = document.querySelector("ytd-browse");
    if (!browse) return false;
    if (supportedRenderedCandidates.size > 0 || unsupportedRenderedCandidates.size > 0) {
      return false;
    }
    const promo = browse.querySelector("ytd-background-promo-renderer");
    if (!promo) return false;
    return elementDataRoots(promo).some(({ root }) => (
      dataRootMatchesSelectedEmptyRenderer(root)
    ));
  }

  function hasPositiveStagePageEvidence() {
    if (!window.ytInitialData || !document.querySelector("ytd-browse")) return false;
    if (document.querySelector("ytd-error-screen-renderer, ytd-unavailable-message-renderer")) {
      return false;
    }
    if (hasExplicitEmptyEvidence()) return true;
    if (supportedRenderedCandidates.size === 0) return false;
    return stage === "channels" ? channels.size > 0 : videos.size > 0;
  }

  function collectLiveElement(element, selector, rootKind) {
    const elementId = renderedElementId(element);
    const source = `${selector}:element-${elementId}`;
    const unsupportedKey = `${stage}:${source}`;
    const roots = elementDataRoots(element);
    if (roots.length === 0) {
      unsupportedRenderedCandidates.add(unsupportedKey);
      return;
    }
    const stats = emptyCollectionStats();
    const elementIssues = new Set();
    const elementSeen = new WeakSet();
    for (const { root, suffix } of roots) {
      const rootSource = `${source}.${suffix}`;
      const rootKeys = new Set(Object.keys(root));
      if (rootKind === "channel"
        && !Array.from(CHANNEL_RENDERER_KEYS).some((key) => rootKeys.has(key))) {
        stats.channelCandidates += 1;
        if (addChannel(root, `${rootSource}.root`, true, elementIssues)) {
          stats.channelResolved += 1;
        }
      } else if (rootKind === "video"
        && !Array.from(VIDEO_RENDERER_KEYS).some((key) => rootKeys.has(key))) {
        stats.videoCandidates += 1;
        if (addVideo(root, `${rootSource}.root`, true, elementIssues)) {
          stats.videoResolved += 1;
        }
      } else if (stage === "subscriptions" && videoIdFrom(root)) {
        stats.videoCandidates += 1;
        if (addVideo(root, `${rootSource}.root`, true, elementIssues)) {
          stats.videoResolved += 1;
        }
      }
      collectTree(root, rootSource, elementSeen, stats, true, elementIssues);
      if (workMustStop()) break;
    }

    const relevantCandidates = stage === "channels"
      ? stats.channelCandidates
      : stats.videoCandidates;
    const relevantResolved = stage === "channels"
      ? stats.channelResolved
      : stats.videoResolved;
    for (const issue of elementIssues) {
      if (issue.startsWith("video-channel-conflict:")) {
        recordPersistentVideoIssue(issue);
      }
    }
    if (relevantCandidates === 0) {
      unsupportedRenderedCandidates.add(unsupportedKey);
    } else {
      supportedRenderedCandidates.add(unsupportedKey);
      if (relevantResolved === 0) {
        for (const issue of elementIssues) {
          if (issue.startsWith("video-owner:") || issue.startsWith("video-title:")) {
            recordPersistentVideoIssue(issue);
          } else {
            unresolved.add(issue);
          }
        }
      }
    }
  }

  function collectBackingData() {
    if (!initialDataScanned && window.ytInitialData
      && typeof window.ytInitialData === "object") {
      initialDataScanned = true;
      const selectedRoots = selectedFeedContentRoots(window.ytInitialData);
      selectedRoots.forEach((root, index) => {
        collectTree(
          root,
          `ytInitialData.selected-${index}`,
          seenInitialObjects,
          emptyCollectionStats(),
          false,
          unresolved,
          true,
        );
      });
    }
    if (workMustStop()) return;

    supportedRenderedCandidates.clear();
    unsupportedRenderedCandidates.clear();
    unresolved.clear();
    for (const issue of persistentVideoIssues) unresolved.add(issue);

    const selectors = stage === "channels"
      ? [
          ["ytd-channel-renderer", "channel"],
          ["ytd-grid-channel-renderer", "channel"],
        ]
      : [
          ["ytd-rich-item-renderer", "container"],
          ["ytd-video-renderer", "video"],
          ["ytd-grid-video-renderer", "video"],
          ["ytd-reel-item-renderer", "video"],
        ];
    for (const [selector, rootKind] of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        collectLiveElement(element, selector, rootKind);
        if (workMustStop()) return;
      }
    }
  }

  function hasPendingContinuation() {
    const browse = document.querySelector("ytd-browse");
    if (!browse) return false;
    for (const element of browse.querySelectorAll("ytd-continuation-item-renderer")) {
      if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
        continue;
      }
      return true;
    }
    return false;
  }

  function pageReady() {
    if (!isYouTubeHost(location.hostname)) return false;
    if (normalizePath(location.pathname) !== normalizePath(expectedPath)) return false;
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
    const readyStartedAt = Date.now();
    while (!pageReady() && Date.now() - readyStartedAt < READY_TIMEOUT_MS && !checkDeadline()) {
      await sleep(Math.min(250, remainingMs()));
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

  function changedRecords(records, emittedFingerprints) {
    const changed = [];
    for (const [id, record] of records) {
      const fingerprint = JSON.stringify(record);
      if (emittedFingerprints.get(id) === fingerprint) continue;
      emittedFingerprints.set(id, fingerprint);
      changed.push(record);
    }
    return changed;
  }

  function progressFields() {
    return {
      captureId,
      stage,
      channelTotal: channels.size,
      videoTotal: stage === "subscriptions" ? videos.size : 0,
      candidateCount: candidateSources.size,
      unresolvedCount: unresolved.size,
      supportedCandidateCount: supportedRenderedCandidates.size,
      unsupportedCandidateCount: unsupportedRenderedCandidates.size,
      scrollPasses,
      stablePasses,
      elapsedMs: elapsedMs(),
      visitedObjectCount,
      visitBudget: MAX_OBJECT_VISITS,
      workBudgetExceeded,
      deadlineExceeded,
      pendingContinuation: hasPendingContinuation(),
      pageEvidence: hasPositiveStagePageEvidence(),
      explicitEmpty: hasExplicitEmptyEvidence(),
      stopReason,
      extractedAt: Date.now(),
    };
  }

  function dataPayload() {
    return {
      channels: changedRecords(channels, emittedChannels),
      videos: stage === "subscriptions"
        ? changedRecords(videos, emittedVideos)
        : [],
    };
  }

  function fullDataPayload() {
    return {
      channels: Array.from(channels.values()),
      videos: stage === "subscriptions" ? Array.from(videos.values()) : [],
    };
  }

  async function emitProgress() {
    await emit({
      ...dataPayload(),
      ...progressFields(),
      rosterComplete: false,
      complete: false,
      done: false,
    });
  }

  async function run() {
    assertExpectedPage();
    const ready = await waitUntilReady();
    if (!ready) {
      if (deadlineExceeded) throw new Error("YouTube capture reached its script deadline.");
      throw new Error("YouTube did not finish rendering the requested page.");
    }
    assertExpectedPage();
    if (!isLoggedIn()) throw new Error("The YouTube website session is not signed in.");

    let previousHeight = 0;
    let previousResultCount = 0;
    let previousCandidateCount = 0;
    let previousUnresolvedCount = 0;
    let previousUnsupportedCount = 0;
    let previousPendingContinuation = false;
    stopReason = "max-passes";

    for (let pass = 0; pass < MAX_SCROLL_PASSES; pass += 1) {
      assertExpectedPage();
      if (checkDeadline()) {
        stopReason = "deadline";
        break;
      }

      collectBackingData();
      scrollPasses = pass + 1;
      const height = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0,
      );
      const resultCount = channels.size + videos.size;
      const candidateCount = candidateSources.size;
      const unresolvedCount = unresolved.size;
      const unsupportedCount = unsupportedRenderedCandidates.size;
      const pendingContinuation = hasPendingContinuation();
      const atEnd = reachedDocumentEnd();

      if (height === previousHeight
        && resultCount === previousResultCount
        && candidateCount === previousCandidateCount
        && unresolvedCount === previousUnresolvedCount
        && unsupportedCount === previousUnsupportedCount
        && pendingContinuation === previousPendingContinuation) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }

      if (workBudgetExceeded) {
        stopReason = "work-budget";
        break;
      }
      if (deadlineExceeded) {
        stopReason = "deadline";
        break;
      }
      if (atEnd && !pendingContinuation && stablePasses >= REQUIRED_STABLE_PASSES) {
        stopReason = "end-stable";
        break;
      }
      if (pass === MAX_SCROLL_PASSES - 1) {
        stopReason = "max-passes";
        break;
      }

      previousHeight = height;
      previousResultCount = resultCount;
      previousCandidateCount = candidateCount;
      previousUnresolvedCount = unresolvedCount;
      previousUnsupportedCount = unsupportedCount;
      previousPendingContinuation = pendingContinuation;
      stopReason = "scrolling";
      await emitProgress();
      if (checkDeadline()) {
        stopReason = "deadline";
        break;
      }
      window.scrollTo({ top: height, behavior: "auto" });
      await sleep(Math.min(SCROLL_SETTLE_MS, remainingMs()));
    }

    const pageEvidence = hasPositiveStagePageEvidence();
    const pendingContinuation = hasPendingContinuation();
    if (stopReason === "end-stable" && unresolved.size > 0) {
      stopReason = "unresolved";
    } else if (stopReason === "end-stable" && unsupportedRenderedCandidates.size > 0) {
      stopReason = "unsupported-candidates";
    } else if (stopReason === "end-stable" && pendingContinuation) {
      stopReason = "pending-continuation";
    } else if (stopReason === "end-stable" && !pageEvidence) {
      stopReason = "page-evidence-missing";
    }
    const captureComplete = stopReason === "end-stable"
      && unresolved.size === 0
      && unsupportedRenderedCandidates.size === 0
      && !workBudgetExceeded
      && !deadlineExceeded
      && !pendingContinuation
      && pageEvidence;
    const rosterComplete = stage === "channels"
      && captureComplete
      && pageEvidence;
    await emit({
      ...fullDataPayload(),
      ...progressFields(),
      rosterComplete,
      complete: stage === "subscriptions" && captureComplete,
      done: true,
    });
  }

  void run().catch(async (error) => {
    stopReason = deadlineExceeded
      ? "deadline"
      : workBudgetExceeded
        ? "work-budget"
        : "error";
    try {
      await emit({
        ...fullDataPayload(),
        ...progressFields(),
        rosterComplete: false,
        complete: false,
        done: true,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // The event bridge itself is unavailable, so there is nowhere else to report.
    }
  });
})();
