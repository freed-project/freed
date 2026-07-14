import { describe, expect, it } from "vitest";
import * as A from "@automerge/automerge";
import {
  DOCUMENT_META_WRITE_POLICY,
  FACEBOOK_CAPTURE_PREFERENCES_WRITE_POLICY,
  sanitizeAccountWrite,
  sanitizeFeedItemWrite,
  sanitizePersonWrite,
  sanitizeRssFeedWrite,
  sanitizeUserPreferenceWrite,
} from "@freed/shared";
import type {
  Account,
  FeedItem,
  Person,
  RssFeed,
  UserPreferences,
} from "@freed/shared";
import {
  addAccount,
  addFeedItem,
  addPerson,
  addRssFeed,
  confirmLikedSynced,
  confirmSeenSynced,
  createEmptyDoc,
  getRegisteredDesktopClients,
  registerDesktopClient,
  updateAccount,
  updateFeedItem,
  updatePerson,
  updatePreferences,
  updateRssFeed,
} from "@freed/shared/schema";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "rss:item",
    platform: "rss",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: "Text", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person",
    name: "Person",
    relationshipStatus: "friend",
    careLevel: 4,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "account",
    personId: "person",
    kind: "social",
    provider: "rss",
    externalId: "external",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeFeed(overrides: Partial<RssFeed> = {}): RssFeed {
  return {
    url: "https://example.com/feed",
    title: "Example",
    enabled: true,
    trackUnread: false,
    ...overrides,
  };
}

describe("synchronized write policies", () => {
  it("drops every local and compatibility preference field and recursively admits known fields", () => {
    const result = sanitizeUserPreferenceWrite({
      weights: {
        recency: 65,
        platforms: { rss: 2 },
        topics: { testing: 3 },
        authors: { author: 4 },
        futureWeightField: "drop",
      },
      ulysses: {
        enabled: true,
        blockedPlatforms: ["x"],
        allowedPaths: { x: ["/messages"] },
        futureUlyssesField: "drop",
      },
      sync: {
        cloudProvider: "gdrive",
        autoBackup: true,
        backupFrequency: "daily",
      },
      display: {
        itemsPerPage: 25,
        compactMode: true,
        themeId: "ember",
        showEngagementCounts: true,
        animationIntensity: "light",
        reading: {
          focusMode: true,
          focusIntensity: "strong",
          markReadOnScroll: true,
          showReadInGrayscale: false,
          dualColumnMode: true,
          futureReadingField: "drop",
        },
        sidebarWidth: 300,
        sidebarMode: "compact",
        friendsSidebarWidth: 320,
        friendsSidebarOpen: true,
        friendsMode: "friends",
        friendAvatarTint: "legacy",
        debugPanelWidth: 400,
        mapMode: "all_content",
        mapTimeMode: "future",
        feedSignalMode: "news",
        feedSignalModes: ["news"],
        savedContentSortMode: "recommended",
        archivePruneDays: 45,
        futureDisplayField: "drop",
      },
      xCapture: {
        mode: "whitelist",
        whitelist: {
          author: {
            id: "author",
            handle: "author",
            displayName: "Author",
            addedAt: 1,
            futureAccountField: "drop",
          },
        },
        blacklist: {},
        includeRetweets: false,
        includeReplies: true,
        futureXField: "drop",
      },
      fbCapture: {
        knownGroups: {
          group: { id: "group", name: "Group", url: "https://group", futureGroupField: "drop" },
        },
        excludedGroupIds: { hidden: true },
        futureFacebookField: "drop",
      },
      friendSuggestions: {
        dismissedSuggestionIds: ["suggestion"],
        futureSuggestionField: "drop",
      },
      ai: {
        provider: "ollama",
        model: "local",
        ollamaUrl: "http://localhost",
        autoSummarize: true,
        extractTopics: false,
        futureAIField: "drop",
      },
      storyWall: {
        enabled: true,
        selectedYears: [2026],
        includedPlatforms: ["rss"],
        includedAccountIds: ["account"],
        visibilityDefault: "private_review",
        layoutPreset: "mosaic",
        style: {
          palette: "ember",
          typographyScale: 1,
          mediaDensity: 1,
          captionsEnabled: true,
          locationGroupingEnabled: false,
          dateGroupingEnabled: true,
          motionLevel: "light",
          futureStyleField: "drop",
        },
        embedModeEnabled: false,
        publishTarget: {
          provider: "github_pages",
          repoName: "wall",
          branch: "main",
          directory: "docs",
          status: "publishing",
          lastError: "local only",
          futurePublishField: "drop",
        },
        featuredItemIds: ["rss:item"],
        hiddenItemIds: [],
        futureStoryField: "drop",
      },
      futurePreferenceField: "drop",
    } as unknown as Partial<UserPreferences>);

    expect(result).toEqual({
      weights: {
        recency: 65,
        platforms: { rss: 2 },
        topics: { testing: 3 },
        authors: { author: 4 },
      },
      ulysses: {
        enabled: true,
        blockedPlatforms: ["x"],
        allowedPaths: { x: ["/messages"] },
      },
      display: {
        themeId: "ember",
        showEngagementCounts: true,
        animationIntensity: "light",
        reading: {
          focusMode: true,
          focusIntensity: "strong",
          markReadOnScroll: true,
          showReadInGrayscale: false,
        },
        archivePruneDays: 45,
      },
      xCapture: {
        mode: "whitelist",
        whitelist: {
          author: {
            id: "author",
            handle: "author",
            displayName: "Author",
            addedAt: 1,
          },
        },
        blacklist: {},
        includeRetweets: false,
        includeReplies: true,
      },
      fbCapture: {
        excludedGroupIds: { hidden: true },
      },
      friendSuggestions: { dismissedSuggestionIds: ["suggestion"] },
      ai: { autoSummarize: true, extractTopics: false },
      storyWall: {
        enabled: true,
        selectedYears: [2026],
        includedPlatforms: ["rss"],
        includedAccountIds: ["account"],
        visibilityDefault: "private_review",
        layoutPreset: "mosaic",
        style: {
          palette: "ember",
          typographyScale: 1,
          mediaDensity: 1,
          captionsEnabled: true,
          locationGroupingEnabled: false,
          dateGroupingEnabled: true,
          motionLevel: "light",
        },
        embedModeEnabled: false,
        publishTarget: {
          provider: "github_pages",
          repoName: "wall",
          branch: "main",
          directory: "docs",
        },
        featuredItemIds: ["rss:item"],
        hiddenItemIds: [],
      },
    });
  });

  it("keeps Facebook exclusions synchronized while dropping discovered groups", () => {
    expect(FACEBOOK_CAPTURE_PREFERENCES_WRITE_POLICY).toEqual({
      knownGroups: "device-local",
      excludedGroupIds: "nested",
    });

    expect(
      sanitizeUserPreferenceWrite({
        fbCapture: {
          knownGroups: {
            group: { id: "group", name: "Group", url: "https://group" },
          },
          excludedGroupIds: { group: true },
        },
      }),
    ).toEqual({
      fbCapture: {
        excludedGroupIds: { group: true },
      },
    });

    const updated = A.change(createEmptyDoc(), (draft) => {
      updatePreferences(draft, {
        fbCapture: {
          knownGroups: {
            group: { id: "group", name: "Group", url: "https://group" },
          },
          excludedGroupIds: { group: true },
        },
      });
    });
    expect(updated.preferences.fbCapture).toEqual({
      excludedGroupIds: { group: true },
    });
  });

  it("drops local identity, RSS, and metadata fields while sanitizing nested records", () => {
    expect(sanitizePersonWrite({
      name: "Current",
      graphX: 1,
      graphY: 2,
      graphPinned: true,
      graphUpdatedAt: 3,
      reachOutLog: [{ loggedAt: 4, notes: "Called", futureLogField: "drop" }],
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 5,
        generatorVersion: 1,
        futureFingerprintField: "drop",
      },
      futurePersonField: "drop",
    } as unknown as Partial<Person>)).toEqual({
      name: "Current",
      reachOutLog: [{ loggedAt: 4, notes: "Called" }],
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 5,
        generatorVersion: 1,
      },
    });

    expect(sanitizeAccountWrite({
      displayName: "Current",
      graphX: 1,
      graphY: 2,
      graphPinned: false,
      graphUpdatedAt: 3,
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 5,
        generatorVersion: 1,
        futureFingerprintField: "drop",
      },
      futureAccountField: "drop",
    } as unknown as Partial<Account>)).toEqual({
      displayName: "Current",
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 5,
        generatorVersion: 1,
      },
    });

    expect(sanitizeRssFeedWrite({
      title: "Current",
      lastFetched: 10,
      lastFetchAttemptedAt: 11,
      nextFetchAfter: 12,
      consecutiveFailures: 2,
      lastFetchError: "offline",
      etag: "legacy",
      lastModified: "legacy",
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 5,
        generatorVersion: 1,
        futureFingerprintField: "drop",
      },
      futureFeedField: "drop",
    } as unknown as Partial<RssFeed>)).toEqual({
      title: "Current",
      lastFetched: 10,
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 5,
        generatorVersion: 1,
      },
    });

    expect(DOCUMENT_META_WRITE_POLICY).toEqual({
      documentId: "sync",
      deviceId: "compatibility-only",
      lastSync: "compatibility-only",
      version: "sync",
    });
  });

  it("recursively sanitizes every object reachable from a feed item", () => {
    const result = sanitizeFeedItemWrite({
      globalId: "rss:item",
      author: { id: "author", handle: "author", displayName: "Author", futureAuthorField: "drop" },
      content: {
        text: "Text",
        mediaUrls: ["https://image"],
        mediaTypes: ["image"],
        linkPreview: { url: "https://article", title: "Article", futurePreviewField: "drop" },
        futureContentField: "drop",
      },
      engagement: { likes: 10, futureEngagementField: "drop" },
      location: {
        name: "Place",
        coordinates: { lat: 1, lng: 2, futureCoordinateField: "drop" },
        source: "geo_tag",
        futureLocationField: "drop",
      },
      timeRange: { startsAt: 1, kind: "event", futureTimeField: "drop" },
      rssSource: {
        feedUrl: "https://feed",
        feedTitle: "Feed",
        siteUrl: "https://site",
        futureRssSourceField: "drop",
      },
      fbGroup: { id: "group", name: "Group", url: "https://group", futureGroupField: "drop" },
      preservedContent: {
        html: "<p>local</p>",
        text: "Article",
        wordCount: 1,
        readingTime: 1,
        preservedAt: 2,
        futurePreservedField: "drop",
      },
      userState: {
        hidden: false,
        saved: true,
        archived: false,
        tags: ["tag"],
        highlights: [{ text: "quote", createdAt: 3, futureHighlightField: "drop" }],
        likedSyncedAt: -1,
        seenSyncedAt: 9,
        futureUserStateField: "drop",
      },
      topics: ["topic"],
      contentSignals: {
        version: 3,
        method: "rules",
        inferredAt: 4,
        scores: { event: 0.9, future_signal: 1 },
        tags: ["event", "future_signal"],
        futureSignalsField: "drop",
      },
      eventCandidate: {
        version: 1,
        method: "rules",
        detectedAt: 5,
        confidence: 0.8,
        title: "Event",
        futureEventField: "drop",
      },
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 6,
        generatorVersion: 1,
        futureFingerprintField: "drop",
      },
      sourceUrl: "https://article",
      futureItemField: "drop",
    } as unknown as Partial<FeedItem>);

    expect(result).toEqual({
      globalId: "rss:item",
      author: { id: "author", handle: "author", displayName: "Author" },
      content: {
        text: "Text",
        mediaUrls: ["https://image"],
        mediaTypes: ["image"],
        linkPreview: { url: "https://article", title: "Article" },
      },
      engagement: { likes: 10 },
      location: { name: "Place", coordinates: { lat: 1, lng: 2 }, source: "geo_tag" },
      timeRange: { startsAt: 1, kind: "event" },
      rssSource: { feedUrl: "https://feed", feedTitle: "Feed", siteUrl: "https://site" },
      fbGroup: { id: "group", name: "Group", url: "https://group" },
      preservedContent: {
        text: "Article",
        wordCount: 1,
        readingTime: 1,
        preservedAt: 2,
      },
      userState: {
        hidden: false,
        saved: true,
        archived: false,
        tags: ["tag"],
        highlights: [{ text: "quote", createdAt: 3 }],
        seenSyncedAt: 9,
      },
      topics: ["topic"],
      contentSignals: {
        version: 3,
        method: "rules",
        inferredAt: 4,
        scores: { event: 0.9 },
        tags: ["event"],
      },
      eventCandidate: {
        version: 1,
        method: "rules",
        detectedAt: 5,
        confidence: 0.8,
        title: "Event",
      },
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch",
        generatedAt: 6,
        generatorVersion: 1,
      },
      sourceUrl: "https://article",
    });
  });

  it("keeps the explicit desktop client root mutator fail closed", () => {
    const doc = registerDesktopClient(createEmptyDoc(), {
      id: "desktop-a",
      registeredAt: 10,
      futureRegistrationField: "drop",
    } as never);

    expect(getRegisteredDesktopClients(doc)).toEqual([
      { id: "desktop-a", registeredAt: 10 },
    ]);
    expect(Object.keys(doc).sort()).toEqual([
      "accounts",
      "desktopClient:desktop-a",
      "feedItems",
      "meta",
      "persons",
      "preferences",
      "rssFeeds",
    ]);
  });

  it("enforces the policies at every generic Automerge mutation boundary", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      addFeedItem(draft, {
        ...makeItem(),
        futureItemField: "drop",
        preservedContent: {
          html: "<p>local</p>",
          text: "Article",
          wordCount: 1,
          readingTime: 1,
          preservedAt: 1,
          futurePreservedField: "drop",
        },
      } as unknown as FeedItem);
      addRssFeed(draft, {
        ...makeFeed(),
        lastFetchAttemptedAt: 2,
        futureFeedField: "drop",
      } as unknown as RssFeed);
      addPerson(draft, {
        ...makePerson(),
        graphX: 3,
        futurePersonField: "drop",
      } as unknown as Person);
      addAccount(draft, {
        ...makeAccount(),
        graphPinned: true,
        futureAccountField: "drop",
      } as unknown as Account);
      updateFeedItem(draft, "rss:item", {
        sourceUrl: "https://current",
        userState: { likedSyncedAt: -1, futureUserStateField: "drop" },
        futureUpdateField: "drop",
      } as unknown as Partial<FeedItem>);
      updateRssFeed(draft, "https://example.com/feed", {
        title: "Current",
        nextFetchAfter: 4,
        futureUpdateField: "drop",
      } as unknown as Partial<RssFeed>);
      updatePerson(draft, "person", {
        name: "Current person",
        graphY: 5,
        futureUpdateField: "drop",
      } as unknown as Partial<Person>);
      updateAccount(draft, "account", {
        displayName: "Current account",
        graphUpdatedAt: 6,
        futureUpdateField: "drop",
      } as unknown as Partial<Account>);
      updatePreferences(draft, {
        display: { themeId: "ember", sidebarWidth: 333, futureDisplayField: "drop" },
        futurePreferenceField: "drop",
      } as unknown as Partial<UserPreferences>);
    });

    expect(doc.feedItems["rss:item"].sourceUrl).toBe("https://current");
    expect(doc.feedItems["rss:item"].userState.likedSyncedAt).toBeUndefined();
    expect(doc.feedItems["rss:item"].preservedContent?.html).toBeUndefined();
    expect(doc.rssFeeds["https://example.com/feed"].title).toBe("Current");
    expect(doc.persons.person.name).toBe("Current person");
    expect(doc.accounts.account.displayName).toBe("Current account");
    expect(doc.preferences.display.themeId).toBe("ember");

    const itemRecord = doc.feedItems["rss:item"] as unknown as Record<string, unknown>;
    const feedRecord = doc.rssFeeds["https://example.com/feed"] as unknown as Record<string, unknown>;
    const personRecord = doc.persons.person as unknown as Record<string, unknown>;
    const accountRecord = doc.accounts.account as unknown as Record<string, unknown>;
    const preferenceRecord = doc.preferences as unknown as Record<string, unknown>;
    expect(itemRecord.futureItemField).toBeUndefined();
    expect(itemRecord.futureUpdateField).toBeUndefined();
    expect(feedRecord.lastFetchAttemptedAt).toBeUndefined();
    expect(feedRecord.nextFetchAfter).toBeUndefined();
    expect(feedRecord.futureFeedField).toBeUndefined();
    expect(personRecord.graphX).toBeUndefined();
    expect(personRecord.graphY).toBeUndefined();
    expect(accountRecord.graphPinned).toBeUndefined();
    expect(accountRecord.graphUpdatedAt).toBeUndefined();
    expect(preferenceRecord.futurePreferenceField).toBeUndefined();
  });

  it("accepts only positive synchronized provider confirmations", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      addFeedItem(draft, makeItem({
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
          likedSyncedAt: -1,
          seenSyncedAt: -1,
        },
      }));
      confirmLikedSynced(draft, "rss:item", -1);
      confirmSeenSynced(draft, "rss:item", 0);
    });

    expect(doc.feedItems["rss:item"].userState.likedSyncedAt).toBeUndefined();
    expect(doc.feedItems["rss:item"].userState.seenSyncedAt).toBeUndefined();

    doc = A.change(doc, (draft) => {
      confirmLikedSynced(draft, "rss:item", 10);
      confirmSeenSynced(draft, "rss:item", 11);
    });
    expect(doc.feedItems["rss:item"].userState.likedSyncedAt).toBe(10);
    expect(doc.feedItems["rss:item"].userState.seenSyncedAt).toBe(11);
  });

  it("merges sanitized nested feed updates without replacing Automerge maps", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      addFeedItem(draft, makeItem({
        author: {
          id: "author",
          handle: "author",
          displayName: "Original author",
          avatarUrl: "https://old-avatar",
        },
        content: {
          text: "Original text",
          mediaUrls: ["https://image"],
          mediaTypes: ["image"],
          linkPreview: { url: "https://article", title: "Original title" },
        },
        engagement: { likes: 1, comments: 2 },
        location: {
          name: "Original place",
          coordinates: { lat: 1, lng: 2 },
          source: "geo_tag",
        },
        timeRange: { startsAt: 10, kind: "event" },
        rssSource: {
          feedUrl: "https://example.com/feed",
          feedTitle: "Original feed",
          siteUrl: "https://example.com",
        },
        fbGroup: { id: "group", name: "Original group", url: "https://group" },
        sampleDataFingerprint: {
          marker: "freed.sample-data.v1",
          batchId: "original",
          generatedAt: 1,
          generatorVersion: 1,
        },
      }));
    });

    doc = A.change(doc, (draft) => {
      updateFeedItem(draft, "rss:item", {
        author: { displayName: "Current author", futureAuthorField: "drop" },
        content: {
          linkPreview: { title: "Current title", futurePreviewField: "drop" },
          futureContentField: "drop",
        },
        engagement: { views: 3, futureEngagementField: "drop" },
        location: {
          coordinates: { lat: 4, futureCoordinateField: "drop" },
          futureLocationField: "drop",
        },
        timeRange: { endsAt: 20, futureTimeField: "drop" },
        rssSource: { feedTitle: "Current feed", futureRssSourceField: "drop" },
        fbGroup: { name: "Current group", futureGroupField: "drop" },
        sampleDataFingerprint: {
          batchId: "current",
          futureFingerprintField: "drop",
        },
      } as unknown as Partial<FeedItem>);
    });

    expect(doc.feedItems["rss:item"]).toMatchObject({
      author: {
        id: "author",
        handle: "author",
        displayName: "Current author",
        avatarUrl: "https://old-avatar",
      },
      content: {
        text: "Original text",
        mediaUrls: ["https://image"],
        mediaTypes: ["image"],
        linkPreview: { url: "https://article", title: "Current title" },
      },
      engagement: { likes: 1, comments: 2, views: 3 },
      location: {
        name: "Original place",
        coordinates: { lat: 4, lng: 2 },
        source: "geo_tag",
      },
      timeRange: { startsAt: 10, endsAt: 20, kind: "event" },
      rssSource: {
        feedUrl: "https://example.com/feed",
        feedTitle: "Current feed",
        siteUrl: "https://example.com",
      },
      fbGroup: { id: "group", name: "Current group", url: "https://group" },
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "current",
        generatedAt: 1,
        generatorVersion: 1,
      },
    });
  });
});
