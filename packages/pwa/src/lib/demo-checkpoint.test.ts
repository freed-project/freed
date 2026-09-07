import { describe, expect, it } from "vitest";
import demoHtml from "../../index.html?raw";
import { SAMPLE_CHARACTER_ARCS, SAMPLE_CHARACTER_AVATAR_MEDIA, SAMPLE_CURATED_DEMO_MEDIA, sampleCorpusMediaUrl } from "@freed/shared";
import { libraryCoreNormalizedCheckpointSqlitePayloadV2 } from "@freed/shared/library-core";
import { createFreedDemoCheckpointRecords } from "./demo-checkpoint";

describe("demo checkpoint", () => {
  it("activates a host-bounded production policy that admits every reviewed demo image", () => {
    const script = demoHtml.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
    expect(script).toBeTruthy();
    const activate = (hostname: string, search: string) => {
      let policy = "";
      new Function("location", "document", script!)({ hostname, search }, {
        createElement: () => ({ httpEquiv: "", content: "" }),
        head: { append: (meta: { content: string }) => { policy = meta.content; } },
      });
      return policy;
    };
    const policy = activate("demo.freed.wtf", "");
    expect(activate("localhost", "?freed-demo=1")).toBe(policy);
    expect(activate("app.freed.wtf", "")).toBe("");
    const directives = new Map(policy.split(";").map((entry) => {
      const [name, ...sources] = entry.trim().split(/\s+/);
      return [name!, sources] as const;
    }));
    const imageSources = directives.get("img-src")!;
    const missingOrigins = [...new Set(
      [...SAMPLE_CURATED_DEMO_MEDIA, ...SAMPLE_CHARACTER_AVATAR_MEDIA.values()]
        .map((asset) => new URL(asset.baseUrl).origin)
        .filter((origin) => !imageSources.includes(origin)),
    )];
    expect(missingOrigins).toEqual([]);
    expect(imageSources).not.toContain("https:");
    expect(policy).not.toContain("*");
    expect(directives.get("frame-src")).toEqual([
      "https://challenges.cloudflare.com", "https://www.youtube-nocookie.com",
    ]);
    expect(directives.get("connect-src")).not.toContain("https://www.youtube.com");
  });

  const FIXED_PRESENTATION = {
    generatedAt: Date.UTC(2026, 8, 1, 12),
    presentationSeed: 42,
  } as const;

  it("builds the same curated local showcase for an explicit presentation", () => {
    const first = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const second = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);

    expect(second).toEqual(first);
    const replacementItems = first.filter((record) => record.registryKey === "10_feed_item");
    expect(replacementItems.length).toBeGreaterThan(0);
    for (const item of replacementItems) {
      expect(item.payload.readAt, String(item.primaryKey)).toBeNull();
      expect(item.payload.seenSyncedAt, String(item.primaryKey)).toBeNull();
    }
    // Intermediate rebuild snapshot, not the 1,000-entry release acceptance gate.
    const admitted = SAMPLE_CHARACTER_ARCS.filter((arc) => arc.episodes.some((episode) => episode.mediaSha1));
    expect(first.filter((record) => record.registryKey === "10_feed_item")).toHaveLength(
      admitted.reduce((total, arc) => total + arc.episodes.filter((episode) => episode.mediaSha1).length, 0),
    );
    expect(first.filter((record) => record.registryKey === "30_person")).toHaveLength(admitted.length);
    expect(first.filter((record) => record.registryKey === "40_account")).toHaveLength(
      admitted.reduce((total, arc) => total + new Set(arc.episodes.filter((episode) => episode.mediaSha1)
        .map((episode) => episode.platform ?? arc.platform)).size, 0),
    );
    const visualStories = first.filter((record) => record.registryKey === "10_feed_item" && record.payload.contentType === "story");
    expect(visualStories).toHaveLength(admitted.flatMap((arc) => arc.episodes)
      .filter((episode) => episode.mediaSha1 && episode.contentType === "story").length);
    expect(visualStories.every((record) => ["instagram", "facebook"].includes(String(record.payload.platform)))).toBe(true);
  });

  it("links every recurring character to one person and provider account", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const people = records.filter((record) => record.registryKey === "30_person");
    const accounts = records.filter((record) => record.registryKey === "40_account");
    const items = records.filter((record) => record.registryKey === "10_feed_item");
    const personIds = new Set(people.map((record) => String(record.primaryKey)));
    const accountIds = new Set(accounts.map((record) => String(record.payload.externalId)));

    expect(new Set(accounts.map((record) => record.payload.provider))).toEqual(
      new Set(["facebook", "instagram", "linkedin", "medium", "rss", "substack", "x", "youtube"]),
    );
    expect(accounts.every((record) => personIds.has(String(record.payload.personId)))).toBe(true);
    expect(items.every((record) => accountIds.has(String(record.payload.authorId)))).toBe(true);
  });

  it("assigns every recurring character an explicit one-to-five importance level", () => {
    const people = createFreedDemoCheckpointRecords(FIXED_PRESENTATION)
      .filter((record) => record.registryKey === "30_person");
    const importanceByName = Object.fromEntries(
      people.map((record) => [String(record.payload.name), record.payload.careLevel]),
    );

    const expectedImportance = {
      "Manny Tis": 5,
      "Cygnus Shy": 4,
      "Nudi Branch Manager": 3,
      "Frogbert Angler": 3,
      "Flora Mingo": 2,
      "Nova Remains": 1,
      "Alma Eight": 4,
      "Mora Grey": 2,
      "Colm Still": 1,
    };
    for (const [name, level] of Object.entries(expectedImportance)) {
      if (name in importanceByName) expect(importanceByName[name]).toBe(level);
    }
    expect(people.every((record) => Number.isInteger(record.payload.careLevel) &&
      Number(record.payload.careLevel) >= 1 && Number(record.payload.careLevel) <= 5)).toBe(true);
    for (const person of people) {
      expect(person.payload.relationshipStatus, String(person.payload.name)).toBe(
        Number(person.payload.careLevel) >= 3 ? "friend" : "connection",
      );
    }
    const reshuffled = createFreedDemoCheckpointRecords({ ...FIXED_PRESENTATION, presentationSeed: 99 })
      .filter((record) => record.registryKey === "30_person");
    expect(reshuffled.map((record) => [record.primaryKey, record.payload.careLevel]))
      .toEqual(people.map((record) => [record.primaryKey, record.payload.careLevel]));
    const friends = people.filter((record) => record.payload.relationshipStatus === "friend");
    expect(friends).toHaveLength(Math.round(people.length * 0.15));
    expect(people.filter((record) => record.payload.relationshipStatus === "connection"))
      .toHaveLength(people.length - friends.length);
    expect(reshuffled.filter((record) => record.payload.relationshipStatus === "friend")
      .map((record) => record.primaryKey)).toEqual(friends.map((record) => record.primaryKey));
  });

  it("keeps one identity when an episode uses a second provider", () => {
    const arc = SAMPLE_CHARACTER_ARCS[0]!;
    const original = arc.episodes;
    const template = original.find((episode) => episode.mediaSha1)!;
    const sequence = 1;
    // Keep two admitted synthetic episodes independent of editorial pruning.
    arc.episodes = [
      { ...template, platform: arc.platform, contentType: undefined, video: undefined },
      { ...template, platform: "rss", contentType: undefined, video: undefined },
    ];
    try {
      const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
      const people = records.filter((record) => record.registryKey === "30_person" && record.payload.name === arc.identityNameBase);
      const accounts = records.filter((record) => record.registryKey === "40_account" && record.payload.displayName === arc.identityNameBase);
      expect(people).toHaveLength(1);
      expect(new Set(accounts.map((record) => record.payload.provider))).toEqual(new Set([arc.platform, "rss"]));
      expect(accounts.every((record) => record.payload.personId === people[0]!.primaryKey)).toBe(true);
      const item = records.find((record) => record.registryKey === "10_feed_item" && String(record.primaryKey).endsWith(`:sample-character:${arc.characterId}:${sequence}`))!;
      expect(item.payload.platform).toBe("rss");
      expect(item.payload.contentType).toBe("article");
      expect(records.some((record) => record.registryKey === "20_rss_feed" && record.primaryKey === item.payload.rssFeedUrl)).toBe(true);
    } finally {
      arc.episodes = original;
    }
  });

  it("projects visual Stories explicitly and preserves article formats without inventing video", () => {
    const arc = SAMPLE_CHARACTER_ARCS[0]!;
    const sequence = arc.episodes.findIndex((episode) => episode.mediaSha1);
    const episode = arc.episodes[sequence]!;
    const original = { ...episode };
    const itemRecord = () => createFreedDemoCheckpointRecords(FIXED_PRESENTATION).find((record) =>
      record.registryKey === "10_feed_item" && String(record.primaryKey).endsWith(`:${arc.characterId}:${sequence}`))!;
    try {
      for (const platform of ["instagram", "facebook"] as const) {
        episode.platform = platform;
        episode.contentType = "story";
        expect(itemRecord().payload.contentType).toBe("story");
        delete episode.contentType;
        expect(itemRecord().payload.contentType).toBe("post");
      }
      for (const platform of ["rss", "medium", "substack"] as const) {
        episode.platform = platform;
        const item = itemRecord();
        expect(item.payload.contentType).toBe("article");
        expect(item.payload.preservedText).toBe(episode.body);
        expect(item.payload.rssFeedUrl !== null).toBe(platform === "rss");
      }
      episode.platform = "youtube";
      expect(itemRecord).toThrow("Verified demo video source required");
    } finally {
      Object.assign(episode, original);
      if (original.platform === undefined) delete episode.platform;
      if (original.contentType === undefined) delete episode.contentType;
    }
  });

  it("projects synthetic YouTube provenance without pretending the image is a video file", () => {
    const arc = SAMPLE_CHARACTER_ARCS[0]!;
    const sequence = arc.episodes.findIndex((episode) => episode.mediaSha1);
    const episode = arc.episodes[sequence]!;
    const original = { ...episode };
    const thumbnail = SAMPLE_CURATED_DEMO_MEDIA.find((asset) => asset.sha1 === episode.mediaSha1)!;
    const thumbnailUrl = sampleCorpusMediaUrl(thumbnail);
    try {
      episode.platform = "youtube";
      episode.contentType = "video";
      episode.video = {
        videoId: "TESTvideo01", title: "Synthetic video title", uploader: "Synthetic real uploader",
        channelUrl: "https://www.youtube.com/@synthetic-fixture",
        watchUrl: "https://www.youtube.com/watch?v=TESTvideo01&autoplay=1",
        primarySourceUrl: "https://example.org/source", thumbnailUrl,
      };
      const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
      const item = records.find((record) => record.registryKey === "10_feed_item" &&
        String(record.primaryKey).endsWith(`:${arc.characterId}:${sequence}`))!;
      expect(item.payload.contentType).toBe("video");
      expect(item.payload.sourceUrl).toBe("https://www.youtube.com/watch?v=TESTvideo01");
      expect(item.payload.linkUrl).toBe(item.payload.sourceUrl);
      expect(String(item.payload.contentText).startsWith(episode.body.trim())).toBe(true);
      expect(item.payload.contentText).toContain("Original video: Synthetic video title");
      expect(item.payload.contentText).toContain("Synthetic real uploader");
      expect(item.payload.contentText).toContain(`Thumbnail by ${thumbnail.creator}, ${thumbnail.license}. Source: ${thumbnail.sourceUrl}`);
      expect(item.payload.linkDescription).toContain("Synthetic video title");
      const media = records.find((record) => record.registryKey === "11_feed_item_media" &&
        Array.isArray(record.primaryKey) && record.primaryKey[0] === item.primaryKey)!;
      expect(media.payload.sourceUrl).toBe(thumbnailUrl);
      expect(media.payload.mediaType).toBe("image");
      episode.video.videoId = "mismatch";
      expect(() => createFreedDemoCheckpointRecords(FIXED_PRESENTATION)).toThrow("identity does not match");
    } finally {
      Object.assign(episode, original);
      if (original.platform === undefined) delete episode.platform;
      if (original.contentType === undefined) delete episode.contentType;
      if (original.video === undefined) delete episode.video;
    }
  });

  it("extends beyond the template pool without losing records or reversing time", () => {
    // Synthetic stress fixture only. These entries never enter the demo corpus.
    const arc = SAMPLE_CHARACTER_ARCS[0]!;
    const original = arc.episodes;
    const baselineCount = SAMPLE_CHARACTER_ARCS.reduce((total, entry) => total + entry.episodes.filter((episode) => episode.mediaSha1).length, 0);
    arc.episodes = original.concat(Array.from({ length: 1_000 }, (_, index) => ({
      ...original.find((episode) => episode.mediaSha1)!,
      title: `Synthetic capacity fixture ${index}`,
      body: "Synthetic capacity fixture, not editorial content.",
    })));
    try {
      const items = createFreedDemoCheckpointRecords(FIXED_PRESENTATION)
        .filter((record) => record.registryKey === "10_feed_item");
      expect(items).toHaveLength(baselineCount + 1_000);
      expect(new Set(items.map((record) => record.primaryKey)).size).toBe(items.length);
      const dates = items.map((record) => Number(record.payload.publishedAt));
      expect(dates.every(Number.isFinite)).toBe(true);
      expect(dates.every((date, index) => index === 0 || date <= dates[index - 1]!)).toBe(true);
    } finally {
      arc.episodes = original;
    }
  });

  it("preserves complete long stories and registers each RSS character's feed", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const feeds = new Set(records.filter((record) => record.registryKey === "20_rss_feed")
      .map((record) => record.primaryKey));
    const articles = records.filter((record) => record.registryKey === "10_feed_item" &&
      record.payload.contentType === "article");
    expect(articles.length).toBeGreaterThan(0);
    expect(articles.filter((record) => record.payload.platform === "rss")
      .every((record) => feeds.has(record.payload.rssFeedUrl as string))).toBe(true);
    for (const platform of ["medium", "substack"]) {
      const providerArticles = articles.filter((record) => record.payload.platform === platform);
      const expectedArticles = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes
        .filter((episode) => episode.mediaSha1 && (episode.platform ?? arc.platform) === platform));
      expect(expectedArticles.length).toBeGreaterThan(0);
      expect(providerArticles).toHaveLength(expectedArticles.length);
      for (const record of providerArticles) {
        expect(record.payload.rssFeedUrl).toBeFalsy();
        const arc = SAMPLE_CHARACTER_ARCS.find((candidate) => candidate.identityNameBase === record.payload.authorDisplayName)!;
        const episode = arc.episodes.find((candidate, sequence) =>
          (candidate.platform ?? arc.platform) === platform &&
          String(record.primaryKey).endsWith(`:${arc.characterId}:${sequence}`))!;
        expect(record.payload.contentText).toBe(episode.body);
      }
    }
    const arc = SAMPLE_CHARACTER_ARCS[0]!;
    const original = arc.episodes;
    const body = "Synthetic first paragraph.\n\n" + "Long-form preservation fixture. ".repeat(300);
    arc.episodes = [{ ...original.find((episode) => episode.mediaSha1)!,
      platform: "rss", contentType: "article", video: undefined, body }];
    try {
      const item = createFreedDemoCheckpointRecords(FIXED_PRESENTATION).find((record) =>
        record.registryKey === "10_feed_item" && record.payload.authorDisplayName === arc.identityNameBase)!;
      expect(item.payload.contentText).toBe(body);
      expect(item.payload.preservedText).toBe(body);
    } finally { arc.episodes = original; }
  });

  it("does not invent episode photographs or unreviewed avatars", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const items = records.filter((record) => record.registryKey === "10_feed_item");
    const media = records.filter((record) => record.registryKey === "11_feed_item_media");
    let textOnlyCount = 0;
    let charactersWithoutImages = 0;
    for (const arc of SAMPLE_CHARACTER_ARCS) {
      const hasPhoto = arc.episodes.some((episode) => episode.mediaSha1 !== null);
      const reviewedAvatar = SAMPLE_CHARACTER_AVATAR_MEDIA.get(arc.characterId);
      for (const [sequence, episode] of arc.episodes.entries()) {
        const item = items.find((record) => String(record.primaryKey).endsWith(`:sample-character:${arc.characterId}:${sequence}`));
        if (episode.mediaSha1 === null) {
          textOnlyCount += 1;
          expect(item).toBeUndefined();
          continue;
        }
        expect(item).toBeDefined();
        if (episode.video) {
          expect(item!.payload.contentText).toContain(episode.body);
          expect(item!.payload.contentText).toContain(`Original video: ${episode.video.title}`);
          expect(item!.payload.contentText).toContain(episode.video.uploader);
          expect(item!.payload.sourceUrl).toBe(episode.video.watchUrl);
          expect(item!.payload.contentType).toBe("video");
        } else {
          expect(item!.payload.contentText).toBe(episode.body);
        }
        expect(item!.payload.linkTitle).toBe(episode.title);
        expect(media.some((record) => Array.isArray(record.primaryKey) && record.primaryKey[0] === item!.primaryKey && record.payload.sourceUrl)).toBe(true);
        if (reviewedAvatar) expect(item!.payload.authorAvatarUrl).toBe(reviewedAvatar.baseUrl);
        else if (!hasPhoto) expect(item!.payload.authorAvatarUrl).toBeNull();
      }
      if (!hasPhoto) {
        charactersWithoutImages += 1;
        const person = records.find((record) => record.registryKey === "30_person" && record.payload.name === arc.identityNameBase);
        const account = records.find((record) => record.registryKey === "40_account" && record.payload.displayName === arc.identityNameBase);
        expect(person).toBeUndefined();
        expect(account).toBeUndefined();
      }
    }
    expect(textOnlyCount).toBe(SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes)
      .filter((episode) => episode.mediaSha1 === null).length);
    expect(charactersWithoutImages).toBe(SAMPLE_CHARACTER_ARCS
      .filter((arc) => arc.episodes.every((episode) => episode.mediaSha1 === null)).length);
    // Retain negative admission coverage even when every live episode has media.
    const arc = SAMPLE_CHARACTER_ARCS[0]!;
    const original = arc.episodes;
    arc.episodes = [{ ...original[0]!, mediaSha1: null }];
    try {
      const withoutPhoto = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
      expect(withoutPhoto.some((record) => record.registryKey === "30_person" &&
        record.payload.name === arc.identityNameBase)).toBe(false);
      expect(withoutPhoto.some((record) => record.registryKey === "10_feed_item" &&
        record.payload.authorDisplayName === arc.identityNameBase)).toBe(false);
    } finally { arc.episodes = original; }
  });

  it("places marine characters at their authored seabed homes, not missing photo coordinates", () => {
    const items = createFreedDemoCheckpointRecords(FIXED_PRESENTATION)
      .filter((record) => record.registryKey === "10_feed_item");
    for (const [name, lat, lng] of [
      ["Frogbert Angler", 1.46, 125.235],
      ["Alma Eight", 43.473, -3.753],
      ["Mora Grey", 13.758, 120.909],
    ] as const) {
      const episodes = items.filter((record) => record.payload.authorDisplayName === name);
      const arc = SAMPLE_CHARACTER_ARCS.find((candidate) => candidate.identityNameBase === name)!;
      expect(episodes).toHaveLength(arc.episodes.filter((episode) => episode.mediaSha1).length);
      expect(arc.location?.coordinates).toEqual({ lat, lng });
      expect(episodes.map(libraryCoreNormalizedCheckpointSqlitePayloadV2)
        .map((payload) => [payload.locationLat, payload.locationLng]))
        .toEqual(episodes.map(() => [lat, lng]));
    }
  });

  it("reshuffles characters while preserving every character's episode order", () => {
    const first = createFreedDemoCheckpointRecords(FIXED_PRESENTATION)
      .filter((record) => record.registryKey === "10_feed_item")
      .sort((left, right) => Number(right.payload.publishedAt) - Number(left.payload.publishedAt));
    const second = createFreedDemoCheckpointRecords({
      ...FIXED_PRESENTATION,
      presentationSeed: FIXED_PRESENTATION.presentationSeed + 1,
    })
      .filter((record) => record.registryKey === "10_feed_item")
      .sort((left, right) => Number(right.payload.publishedAt) - Number(left.payload.publishedAt));

    expect(second.map((record) => record.primaryKey)).not.toEqual(first.map((record) => record.primaryKey));
    expect(new Set(second.map((record) => record.primaryKey))).toEqual(
      new Set(first.map((record) => record.primaryKey)),
    );

    for (const records of [first, second]) {
      const episodeNumbersByAuthor = new Map<string, number[]>();
      for (const record of records) {
        const authorId = String(record.payload.authorId);
        const episode = Number(String(record.primaryKey).split(":").at(-1));
        episodeNumbersByAuthor.set(authorId, [...(episodeNumbersByAuthor.get(authorId) ?? []), episode]);
      }
      for (const episodeNumbers of episodeNumbersByAuthor.values()) {
        expect(episodeNumbers).toEqual([...episodeNumbers].sort((left, right) => right - left));
      }
    }
  });

  it("uses only reviewed image and video thumbnail hosts for remote display images", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const serialized = JSON.stringify(records);

    expect(serialized).not.toContain("picsum.photos");
    expect(serialized).toContain("thumb.wikimedia.org");
    const allowedHosts = new Set([
      "thumb.wikimedia.org", "upload.wikimedia.org", "oceanexplorer.noaa.gov",
      "archive.oceanexplorer.noaa.gov", "chandra.harvard.edu", "i.ytimg.com",
      "npgallery.nps.gov", "www.fisheries.noaa.gov", "media.fisheries.noaa.gov",
      "www.nps.gov", "www.fws.gov",
      "d9-wret.s3.us-west-2.amazonaws.com",
      "inaturalist-open-data.s3.amazonaws.com", "live.staticflickr.com",
      "assets.science.nasa.gov",
    ]);
    const imageUrls = records.flatMap((record) => [
      record.payload.authorAvatarUrl, record.payload.avatarUrl, record.payload.imageUrl,
      ...(record.registryKey === "11_feed_item_media" ? [record.payload.sourceUrl] : []),
    ]).filter((value): value is string => typeof value === "string" && /^https?:/.test(value));
    expect(imageUrls.length).toBeGreaterThan(0);
    expect([...new Set(imageUrls.map((url) => new URL(url).hostname))]
      .filter((host) => !allowedHosts.has(host))).toEqual([]);
    expect(serialized).not.toMatch(/private[_-]?key/i);
  });

  it("installs one manual editorial classification for every demo post", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const items = records.filter((record) => record.registryKey === "10_feed_item");
    const metadata = records.filter((record) => record.registryKey === "15_feed_item_signal");
    const scores = records.filter((record) => record.registryKey === "16_feed_item_signal_score");
    const expectedSignals = new Set(["essay", "event", "life_update", "discussion", "news"]);

    expect(items).toHaveLength(500);
    expect(metadata).toHaveLength(items.length);
    expect(scores).toHaveLength(items.length);
    expect(metadata.every((record) => record.payload.method === "manual")).toBe(true);
    expect(scores.every((record) =>
      record.payload.tagged === true && expectedSignals.has(String(record.payload.signal))
    )).toBe(true);
  });

  it("avoids repeating the previous first item without changing the corpus", () => {
    const first = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const firstItems = first.filter((record) =>
      record.registryKey === "10_feed_item" && record.payload.contentType !== "story"
    );
    const firstTop = [...firstItems].sort((left, right) =>
      Number(right.payload.publishedAt) - Number(left.payload.publishedAt) ||
      String(left.primaryKey).localeCompare(String(right.primaryKey))
    )[0]!;
    const next = createFreedDemoCheckpointRecords({
      ...FIXED_PRESENTATION,
      previousTopItemId: String(firstTop.primaryKey),
    });
    const nextItems = next.filter((record) =>
      record.registryKey === "10_feed_item" && record.payload.contentType !== "story"
    );
    const nextTop = [...nextItems].sort((left, right) =>
      Number(right.payload.publishedAt) - Number(left.payload.publishedAt) ||
      String(left.primaryKey).localeCompare(String(right.primaryKey))
    )[0]!;

    expect(nextTop.primaryKey).not.toBe(firstTop.primaryKey);
    expect(new Set(nextItems.map((record) => record.primaryKey))).toEqual(
      new Set(firstItems.map((record) => record.primaryKey)),
    );
  });
});
