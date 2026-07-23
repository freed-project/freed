import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import type { Account, FeedItem } from "@freed/shared";
import {
  createEmptyDoc,
  reconcileYouTubeCapture,
} from "@freed/shared/schema";

function channelAccount(channelId: string, capturedAt: number): Account {
  return {
    id: `social:youtube:${channelId}`,
    kind: "social",
    provider: "youtube",
    externalId: channelId,
    displayName: channelId,
    profileUrl: `https://www.youtube.com/channel/${channelId}`,
    firstSeenAt: capturedAt,
    lastSeenAt: capturedAt,
    discoveredFrom: "follow_roster",
    followRosterActive: true,
    followRosterSyncedAt: capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

function videoItem(videoId: string, capturedAt: number): FeedItem {
  return {
    globalId: `youtube:yt:video:${videoId}`,
    platform: "youtube",
    contentType: "video",
    capturedAt,
    publishedAt: capturedAt,
    author: {
      id: "youtube:channel",
      handle: "channel",
      displayName: "Channel",
    },
    content: {
      text: "Captured title",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: "Captured title",
      },
    },
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
  };
}

describe("reconcileYouTubeCapture", () => {
  it("preserves missing roster accounts when the page capture is incomplete", () => {
    const firstCaptureAt = 1_000;
    const secondCaptureAt = 2_000;
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      reconcileYouTubeCapture(
        draft,
        [
          channelAccount("UC1111111111111111111111", firstCaptureAt),
          channelAccount("UC2222222222222222222222", firstCaptureAt),
        ],
        [],
        { rosterComplete: true, capturedAt: firstCaptureAt },
      );
    });

    doc = A.change(doc, (draft) => {
      reconcileYouTubeCapture(
        draft,
        [channelAccount("UC1111111111111111111111", secondCaptureAt)],
        [],
        { rosterComplete: false, capturedAt: secondCaptureAt },
      );
    });

    expect(doc.accounts["social:youtube:UC2222222222222222222222"].followRosterActive)
      .toBe(true);
  });

  it("deactivates absent accounts only after a complete roster and preserves item state", () => {
    const firstCaptureAt = 1_000;
    const secondCaptureAt = 2_000;
    const videoId = "dQw4w9WgXcQ";
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      reconcileYouTubeCapture(
        draft,
        [
          channelAccount("UC1111111111111111111111", firstCaptureAt),
          channelAccount("UC2222222222222222222222", firstCaptureAt),
        ],
        [videoItem(videoId, firstCaptureAt)],
        { rosterComplete: true, capturedAt: firstCaptureAt },
      );
      draft.feedItems[`youtube:yt:video:${videoId}`].userState.saved = true;
    });

    doc = A.change(doc, (draft) => {
      reconcileYouTubeCapture(
        draft,
        [channelAccount("UC1111111111111111111111", secondCaptureAt)],
        [
          {
            ...videoItem(videoId, secondCaptureAt),
            content: {
              ...videoItem(videoId, secondCaptureAt).content,
              text: "A longer captured title",
            },
          },
        ],
        { rosterComplete: true, capturedAt: secondCaptureAt },
      );
    });

    const removed = doc.accounts["social:youtube:UC2222222222222222222222"];
    expect(removed.followRosterActive).toBe(false);
    expect(removed.followRosterSyncedAt).toBe(secondCaptureAt);
    expect(doc.feedItems[`youtube:yt:video:${videoId}`].userState.saved).toBe(true);
    expect(doc.feedItems[`youtube:yt:video:${videoId}`].content.text)
      .toBe("A longer captured title");
  });
});
