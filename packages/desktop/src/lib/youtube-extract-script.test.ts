import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const extractorTemplate = readFileSync(
  resolve(process.cwd(), "src-tauri/src/youtube-extract.js"),
  "utf8",
);

const CHANNEL_A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const CHANNEL_B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const VIDEO_A = "videoaaaaaa";
const VIDEO_B = "videobbbbbb";

interface CapturePayload {
  captureId: string;
  stage: "channels" | "subscriptions";
  channels: Array<Record<string, unknown>>;
  videos: Array<Record<string, unknown>>;
  rosterComplete: boolean;
  complete: boolean;
  done: boolean;
  pageEvidence: boolean;
  explicitEmpty: boolean;
  unsupportedCandidateCount: number;
  supportedCandidateCount: number;
  unresolvedCount: number;
  scrollPasses: number;
  visitedObjectCount: number;
  stopReason: string;
  workBudgetExceeded: boolean;
  deadlineExceeded: boolean;
  pendingContinuation: boolean;
}

interface ExtractorContext {
  dom: JSDOM;
  setHeight: (height: number) => void;
}

interface ExtractorOptions {
  stage?: "channels" | "subscriptions";
  html?: string;
  initialData?: Record<string, unknown>;
  configure?: (dom: JSDOM) => void;
  onScroll?: (scrollCount: number, context: ExtractorContext) => void;
}

function injectedExtractor(stage: "channels" | "subscriptions") {
  const captureId = "capture-fixture";
  const expectedPath = stage === "channels" ? "/feed/channels" : "/feed/subscriptions";
  return extractorTemplate
    .replace('"__YOUTUBE_CAPTURE_ID__"', JSON.stringify(captureId))
    .replace('"__EXPECTED_YOUTUBE_CAPTURE_STAGE__"', JSON.stringify(stage))
    .replace('"__EXPECTED_YOUTUBE_CAPTURE_PATH__"', JSON.stringify(expectedPath));
}

function setElementData(element: Element | null, data: Record<string, unknown>) {
  if (!element) throw new Error("Fixture element was not found.");
  Object.defineProperty(element, "data", {
    configurable: true,
    writable: true,
    value: data,
  });
}

function setElementPrivateData(element: Element | null, data: Record<string, unknown>) {
  if (!element) throw new Error("Fixture element was not found.");
  Object.defineProperty(element, "__data", {
    configurable: true,
    writable: true,
    value: { data },
  });
}

function ownerText(channelId = CHANNEL_A, title = "Channel A") {
  return {
    runs: [{
      text: title,
      navigationEndpoint: {
        browseEndpoint: {
          browseId: channelId,
          canonicalBaseUrl: `/@${title.toLowerCase().replace(/\s+/g, "")}`,
        },
      },
    }],
  };
}

function videoRenderer(options: {
  videoId?: string;
  channelId?: string;
  channelTitle?: string;
  includeOwner?: boolean;
  includeTitle?: boolean;
  path?: string;
  rich?: boolean;
  live?: boolean;
} = {}) {
  const videoId = options.videoId ?? VIDEO_A;
  const channelId = options.channelId ?? CHANNEL_A;
  const channelTitle = options.channelTitle ?? "Channel A";
  const renderer: Record<string, unknown> = {
    navigationEndpoint: {
      watchEndpoint: { videoId },
      commandMetadata: {
        webCommandMetadata: { url: options.path ?? `/watch?v=${videoId}` },
      },
    },
    ...(options.includeTitle === false ? {} : { title: { simpleText: `Title ${videoId}` } }),
    ...(options.includeOwner === false ? {} : { ownerText: ownerText(channelId, channelTitle) }),
    ...(options.rich
      ? {
          thumbnail: {
            thumbnails: [{
              url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              width: 480,
              height: 360,
            }],
          },
          descriptionSnippet: { simpleText: "A useful description" },
          publishedTimeText: { simpleText: "2 hours ago" },
          lengthText: { simpleText: "12:34" },
        }
      : {}),
    ...(options.live
      ? {
          thumbnailOverlays: [{
            thumbnailOverlayTimeStatusRenderer: { style: "LIVE" },
          }],
        }
      : {}),
  };
  if (options.videoId !== "") renderer.videoId = videoId;
  return renderer;
}

function selectedFeedInitialData(
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    ...extra,
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            selected: true,
            content,
          },
        }],
      },
    },
  };
}

async function runExtractor(options: ExtractorOptions = {}) {
  const stage = options.stage ?? "subscriptions";
  const path = stage === "channels" ? "/feed/channels" : "/feed/subscriptions";
  const dom = new JSDOM(
    options.html ?? "<ytd-app><ytd-browse></ytd-browse></ytd-app>",
    {
      url: `https://www.youtube.com${path}`,
      runScripts: "outside-only",
    },
  );
  let documentHeight = 1_000;
  let scrollY = 0;
  let scrollCount = 0;
  const payloads: CapturePayload[] = [];
  let resolveFinal: ((payload: CapturePayload) => void) | undefined;
  const finalPayload = new Promise<CapturePayload>((resolve) => {
    resolveFinal = resolve;
  });
  const context: ExtractorContext = {
    dom,
    setHeight(height) {
      documentHeight = height;
    },
  };

  Object.defineProperty(dom.window.document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => documentHeight,
  });
  Object.defineProperty(dom.window.document.body, "scrollHeight", {
    configurable: true,
    get: () => documentHeight,
  });
  Object.defineProperty(dom.window, "innerHeight", {
    configurable: true,
    value: 1_000,
  });
  Object.defineProperty(dom.window, "scrollY", {
    configurable: true,
    get: () => scrollY,
  });
  Object.defineProperty(dom.window, "scrollTo", {
    configurable: true,
    value: ({ top }: { top: number }) => {
      scrollY = top;
      scrollCount += 1;
      options.onScroll?.(scrollCount, context);
    },
  });
  Object.defineProperty(dom.window, "setTimeout", {
    configurable: true,
    value: (callback: () => void) => {
      queueMicrotask(callback);
      return 1;
    },
  });
  Object.defineProperty(dom.window, "ytcfg", {
    configurable: true,
    value: { get: (key: string) => key === "LOGGED_IN" ? true : undefined },
  });
  Object.defineProperty(dom.window, "ytInitialData", {
    configurable: true,
    value: {
      responseContext: {
        mainAppWebResponseContext: { loggedOut: false },
      },
      ...options.initialData,
    },
  });
  Object.defineProperty(dom.window, "__TAURI__", {
    configurable: true,
    value: {
      event: {
        emit: async (_name: string, payload: CapturePayload) => {
          payloads.push(payload);
          if (payload.done) resolveFinal?.(payload);
        },
      },
    },
  });

  options.configure?.(dom);
  dom.window.eval(injectedExtractor(stage));
  const final = await Promise.race([
    finalPayload,
    delay(2_000).then(() => {
      throw new Error("YouTube extractor fixture did not emit a final payload.");
    }),
  ]);
  dom.window.close();
  return { final, payloads };
}

describe("youtube-extract.js", () => {
  it("revisits a live data object after its owner hydrates in place", async () => {
    const renderer = videoRenderer({ includeOwner: false });
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), {
          content: { videoRenderer: renderer },
        });
      },
      onScroll(scrollCount) {
        if (scrollCount === 1) renderer.ownerText = ownerText();
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.unresolvedCount).toBe(0);
    expect(result.final.videos).toEqual([
      expect.objectContaining({ videoId: VIDEO_A, channelId: CHANNEL_A }),
    ]);
  });

  it("uses the same candidate identity when an element replaces its data object", async () => {
    let item: Element | null = null;
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        item = dom.window.document.querySelector("#item");
        setElementData(item, {
          content: {
            videoRenderer: videoRenderer({ videoId: "", includeOwner: false }),
          },
        });
      },
      onScroll(scrollCount) {
        if (scrollCount === 1) {
          setElementData(item, { content: { videoRenderer: videoRenderer() } });
        }
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.unresolvedCount).toBe(0);
    expect(result.final.videos).toHaveLength(1);
  });

  it("discovers a renderer appended to an existing live root and keeps the final payload full", async () => {
    const root: Record<string, unknown> = {
      content: { videoRenderer: videoRenderer() },
    };
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), root);
      },
      onScroll(scrollCount) {
        if (scrollCount === 1) {
          root.continuation = {
            videoRenderer: videoRenderer({ videoId: VIDEO_B }),
          };
        }
      },
    });

    const progress = result.payloads.filter((payload) => !payload.done);
    expect(progress.some((payload) => payload.videos.some(
      (video) => video.videoId === VIDEO_A,
    ))).toBe(true);
    expect(progress.some((payload) => payload.videos.some(
      (video) => video.videoId === VIDEO_B,
    ))).toBe(true);
    expect(progress.every((payload) => payload.videos.length <= 1)).toBe(true);
    expect(result.final.videos.map((video) => video.videoId).sort()).toEqual([
      VIDEO_A,
      VIDEO_B,
    ]);
    expect(result.final.complete).toBe(true);
  });

  it("lets a valid private Polymer root resolve an incomplete public root", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        const item = dom.window.document.querySelector("#item");
        setElementData(item, {
          content: {
            videoRenderer: videoRenderer({ includeOwner: false, includeTitle: false }),
          },
        });
        setElementPrivateData(item, {
          content: { videoRenderer: videoRenderer() },
        });
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.videos).toEqual([
      expect.objectContaining({ videoId: VIDEO_A }),
    ]);
  });

  it("accepts a valid public data root when a stale private copy is incomplete", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        const item = dom.window.document.querySelector("#item");
        setElementData(item, {
          content: { videoRenderer: videoRenderer() },
        });
        setElementPrivateData(item, {
          content: {
            videoRenderer: videoRenderer({ includeOwner: false, includeTitle: false }),
          },
        });
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.unresolvedCount).toBe(0);
    expect(result.final.videos).toEqual([
      expect.objectContaining({ videoId: VIDEO_A, channelId: CHANNEL_A }),
    ]);
  });

  it("does not call a signed-in subscriptions shell complete without feed evidence", async () => {
    const result = await runExtractor();

    expect(result.final.done).toBe(true);
    expect(result.final.complete).toBe(false);
    expect(result.final.pageEvidence).toBe(false);
    expect(result.final.stopReason).toBe("page-evidence-missing");
  });

  it("does not use stale initial data as evidence on a rendered error page", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-error-screen-renderer></ytd-error-screen-renderer></ytd-browse></ytd-app>",
      initialData: {
        staleSidebar: { videoRenderer: videoRenderer() },
      },
    });

    expect(result.final.videos).toHaveLength(0);
    expect(result.final.supportedCandidateCount).toBe(0);
    expect(result.final.pageEvidence).toBe(false);
    expect(result.final.complete).toBe(false);
    expect(result.final.stopReason).toBe("page-evidence-missing");
  });

  it("only reads initial data from the selected feed tab", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      initialData: selectedFeedInitialData(
        {
          richGridRenderer: {
            contents: [{
              richItemRenderer: {
                content: { videoRenderer: videoRenderer({ videoId: VIDEO_B }) },
              },
            }],
          },
        },
        {
          sidebar: { videoRenderer: videoRenderer({ videoId: VIDEO_A }) },
        },
      ),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), {
          content: { videoRenderer: videoRenderer({ videoId: VIDEO_B }) },
        });
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.videos.map((video) => video.videoId)).toEqual([VIDEO_B]);
  });

  it("revokes earlier feed evidence when the page becomes an error screen", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), {
          content: { videoRenderer: videoRenderer() },
        });
      },
      onScroll(scrollCount, context) {
        if (scrollCount === 1) {
          const browse = context.dom.window.document.querySelector("ytd-browse");
          if (browse) browse.innerHTML = "<ytd-error-screen-renderer></ytd-error-screen-renderer>";
        }
      },
    });

    expect(result.final.videos).toHaveLength(1);
    expect(result.final.pageEvidence).toBe(false);
    expect(result.final.complete).toBe(false);
    expect(result.final.stopReason).toBe("page-evidence-missing");
  });

  it("accepts an explicit empty-feed renderer as complete evidence", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-background-promo-renderer id='empty'></ytd-background-promo-renderer></ytd-browse></ytd-app>",
      initialData: selectedFeedInitialData({
        sectionListRenderer: {
          contents: [{
            itemSectionRenderer: {
              contents: [{
                backgroundPromoRenderer: { title: { simpleText: "No videos" } },
              }],
            },
          }],
        },
      }),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#empty"), {
          title: { simpleText: "No videos" },
        });
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.explicitEmpty).toBe(true);
    expect(result.final.pageEvidence).toBe(true);
    expect(result.final.videos).toEqual([]);
  });

  it("rejects a rendered promo that only matches unrelated initial data", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-background-promo-renderer id='promo'></ytd-background-promo-renderer></ytd-browse></ytd-app>",
      initialData: selectedFeedInitialData(
        { sectionListRenderer: { contents: [] } },
        {
          sidebar: {
            backgroundPromoRenderer: { title: { simpleText: "No videos" } },
          },
        },
      ),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#promo"), {
          title: { simpleText: "No videos" },
        });
      },
    });

    expect(result.final.complete).toBe(false);
    expect(result.final.explicitEmpty).toBe(false);
    expect(result.final.pageEvidence).toBe(false);
    expect(result.final.stopReason).toBe("page-evidence-missing");
  });

  it("requires positive channel-page evidence before completing the roster", async () => {
    const result = await runExtractor({
      stage: "channels",
      html: "<ytd-app><ytd-browse><ytd-channel-renderer id='channel'></ytd-channel-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#channel"), {
          channelId: CHANNEL_A,
          title: { simpleText: "Channel A" },
        });
      },
    });

    expect(result.final.rosterComplete).toBe(true);
    expect(result.final.pageEvidence).toBe(true);
    expect(result.final.channels).toEqual([
      expect.objectContaining({ channelId: CHANNEL_A, title: "Channel A" }),
    ]);
  });

  it("represents an ownerless and titleless Short for downstream filtering", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-reel-item-renderer id='short'></ytd-reel-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#short"), {
          navigationEndpoint: {
            reelWatchEndpoint: { videoId: VIDEO_A },
            commandMetadata: {
              webCommandMetadata: { url: `/shorts/${VIDEO_A}` },
            },
          },
        });
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.unresolvedCount).toBe(0);
    expect(result.final.videos).toEqual([
      expect.objectContaining({
        videoId: VIDEO_A,
        title: VIDEO_A,
        isShort: true,
      }),
    ]);
    expect(result.final.videos[0]).not.toHaveProperty("channelId");
  });

  it("blocks completion when a rendered feed item uses an unsupported renderer", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), {
          content: { futureLockupViewModel: { contentId: VIDEO_A } },
        });
      },
    });

    expect(result.final.done).toBe(true);
    expect(result.final.complete).toBe(false);
    expect(result.final.unsupportedCandidateCount).toBe(1);
    expect(result.final.stopReason).toBe("unsupported-candidates");
  });

  it("drops live candidate failures after their elements leave the feed", async () => {
    const result = await runExtractor({
      html: [
        "<ytd-app><ytd-browse>",
        "<ytd-rich-item-renderer id='unsupported'></ytd-rich-item-renderer>",
        "<ytd-video-renderer id='partial'></ytd-video-renderer>",
        "<ytd-rich-item-renderer id='valid'></ytd-rich-item-renderer>",
        "</ytd-browse></ytd-app>",
      ].join(""),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#unsupported"), {
          content: { futureLockupViewModel: { contentId: "future-video" } },
        });
        setElementData(dom.window.document.querySelector("#partial"), {});
        setElementData(dom.window.document.querySelector("#valid"), {
          content: { videoRenderer: videoRenderer() },
        });
      },
      onScroll(scrollCount, context) {
        if (scrollCount === 1) {
          context.dom.window.document.querySelector("#unsupported")?.remove();
          context.dom.window.document.querySelector("#partial")?.remove();
        }
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.unsupportedCandidateCount).toBe(0);
    expect(result.final.unresolvedCount).toBe(0);
    expect(result.final.videos).toHaveLength(1);
  });

  it("keeps an identified video incomplete after its unresolved card is virtualized away", async () => {
    const result = await runExtractor({
      html: [
        "<ytd-app><ytd-browse>",
        "<ytd-video-renderer id='unresolved'></ytd-video-renderer>",
        "<ytd-rich-item-renderer id='valid'></ytd-rich-item-renderer>",
        "</ytd-browse></ytd-app>",
      ].join(""),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#unresolved"), {
          ...videoRenderer({ includeOwner: false }),
        });
        setElementData(dom.window.document.querySelector("#valid"), {
          content: { videoRenderer: videoRenderer({ videoId: VIDEO_B }) },
        });
      },
      onScroll(scrollCount, context) {
        if (scrollCount === 1) {
          context.dom.window.document.querySelector("#unresolved")?.remove();
        }
      },
    });

    expect(result.final.complete).toBe(false);
    expect(result.final.unresolvedCount).toBeGreaterThan(0);
    expect(result.final.stopReason).toBe("unresolved");
    expect(result.final.videos.map((video) => video.videoId)).toEqual([VIDEO_B]);
  });

  it("merges sparse duplicates without losing rich metadata or true flags", async () => {
    const result = await runExtractor({
      html: [
        "<ytd-app><ytd-browse>",
        "<ytd-rich-item-renderer id='rich'></ytd-rich-item-renderer>",
        "<ytd-rich-item-renderer id='sparse'></ytd-rich-item-renderer>",
        "</ytd-browse></ytd-app>",
      ].join(""),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#rich"), {
          content: {
            reelItemRenderer: videoRenderer({
              path: `/shorts/${VIDEO_A}`,
              rich: true,
              live: true,
            }),
          },
        });
        setElementData(dom.window.document.querySelector("#sparse"), {
          content: { compactVideoRenderer: videoRenderer() },
        });
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.videos).toEqual([
      expect.objectContaining({
        videoId: VIDEO_A,
        description: "A useful description",
        publishedText: "2 hours ago",
        durationText: "12:34",
        thumbnailUrl: `https://i.ytimg.com/vi/${VIDEO_A}/hqdefault.jpg`,
        isShort: true,
        isLive: true,
      }),
    ]);
  });

  it("fails closed when duplicate renderers disagree about the channel", async () => {
    const result = await runExtractor({
      html: [
        "<ytd-app><ytd-browse>",
        "<ytd-rich-item-renderer id='first'></ytd-rich-item-renderer>",
        "<ytd-rich-item-renderer id='second'></ytd-rich-item-renderer>",
        "</ytd-browse></ytd-app>",
      ].join(""),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#first"), {
          content: { videoRenderer: videoRenderer() },
        });
        setElementData(dom.window.document.querySelector("#second"), {
          content: {
            videoRenderer: videoRenderer({
              channelId: CHANNEL_B,
              channelTitle: "Channel B",
            }),
          },
        });
      },
    });

    expect(result.final.complete).toBe(false);
    expect(result.final.unresolvedCount).toBeGreaterThan(0);
    expect(result.final.stopReason).toBe("unresolved");
  });

  it("does not complete while a continuation item is still pending", async () => {
    const result = await runExtractor({
      html: [
        "<ytd-app><ytd-browse>",
        "<ytd-rich-item-renderer id='item'></ytd-rich-item-renderer>",
        "<ytd-continuation-item-renderer id='continuation'></ytd-continuation-item-renderer>",
        "</ytd-browse></ytd-app>",
      ].join(""),
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), {
          content: { videoRenderer: videoRenderer() },
        });
        setElementData(dom.window.document.querySelector("#continuation"), {
          continuationEndpoint: {
            continuationCommand: { token: "next-page" },
          },
        });
      },
    });

    expect(result.final.done).toBe(true);
    expect(result.final.complete).toBe(false);
    expect(result.final.pendingContinuation).toBe(true);
    expect(result.final.stopReason).toBe("max-passes");
    expect(result.final.scrollPasses).toBe(32);
  });

  it("charges unchanged live object identities only once across stable passes", async () => {
    const nestedRoot: Record<string, unknown> = {};
    let cursor = nestedRoot;
    for (let index = 0; index < 120; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), {
          nestedRoot,
          content: { videoRenderer: videoRenderer() },
        });
      },
    });

    expect(result.final.complete).toBe(true);
    expect(result.final.scrollPasses).toBeGreaterThanOrEqual(4);
    expect(result.final.visitedObjectCount).toBeGreaterThan(120);
    expect(result.final.visitedObjectCount).toBeLessThan(250);
  });

  it("emits a terminal but incomplete result after the maximum scroll passes", async () => {
    const result = await runExtractor({
      html: "<ytd-app><ytd-browse><ytd-rich-item-renderer id='item'></ytd-rich-item-renderer></ytd-browse></ytd-app>",
      configure(dom) {
        setElementData(dom.window.document.querySelector("#item"), {
          content: { videoRenderer: videoRenderer() },
        });
      },
      onScroll(_scrollCount, context) {
        const current = context.dom.window.document.documentElement.scrollHeight;
        context.setHeight(current + 2_000);
      },
    });

    expect(result.final.done).toBe(true);
    expect(result.final.complete).toBe(false);
    expect(result.final.stopReason).toBe("max-passes");
    expect(result.final.scrollPasses).toBe(32);
    expect(result.final.workBudgetExceeded).toBe(false);
    expect(result.final.deadlineExceeded).toBe(false);
  });
});
