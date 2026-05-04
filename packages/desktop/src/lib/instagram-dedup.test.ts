import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import type { FreedDoc } from "@freed/shared/schema";
import { createEmptyDoc, deduplicateDocFeedItems } from "@freed/shared/schema";

function makeDoc(): FreedDoc {
  return JSON.parse(JSON.stringify(createEmptyDoc())) as FreedDoc;
}

function makeItem(
  globalId: string,
  update: Partial<FeedItem> & Pick<FeedItem, "platform" | "contentType">,
): FeedItem {
  const now = Date.parse("2026-05-03T20:15:34.000Z");
  return {
    globalId,
    platform: update.platform,
    contentType: update.contentType,
    capturedAt: now,
    publishedAt: now,
    author: {
      id: update.author?.id ?? "ig:o2_treehouse",
      handle: update.author?.handle ?? "o2_treehouse",
      displayName: update.author?.displayName ?? "o2_treehouse",
    },
    content: {
      text: update.content?.text,
      mediaUrls: update.content?.mediaUrls ?? [],
      mediaTypes: update.content?.mediaTypes ?? ["image"],
    },
    sourceUrl: update.sourceUrl,
    location: update.location,
    topics: update.topics ?? [],
    userState: {
      hidden: update.userState?.hidden ?? false,
      saved: update.userState?.saved ?? false,
      archived: update.userState?.archived ?? false,
      tags: update.userState?.tags ?? [],
      readAt: update.userState?.readAt,
    },
  };
}

describe("Instagram feed item dedupe", () => {
  it("deduplicates stories with matching Instagram media keys across CDN hosts", () => {
    const doc = makeDoc();
    const mediaA =
      "https://scontent-sjc6-1.cdninstagram.com/v/t51.82787-15/685786136_18590219392021644_927956206531323318_n.jpg?ig_cache_key=Mzg4OTEyMDU3MDY1NTI2OTgxNg%3D%3D.3-ccb7-5&_nc_gid=a";
    const mediaB =
      "https://scontent-sea1-1.cdninstagram.com/v/t51.82787-15/685786136_18590219392021644_927956206531323318_n.jpg?ig_cache_key=Mzg4OTEyMDU3MDY1NTI2OTgxNg%3D%3D.3-ccb7-5&_nc_gid=b";

    doc.feedItems["ig:story_a"] = makeItem("ig:story_a", {
      platform: "instagram",
      contentType: "story",
      content: { mediaUrls: [mediaA], mediaTypes: ["image"] },
      location: { name: "Locations", url: "https://www.instagram.com/explore/locations/", source: "sticker" },
    });
    doc.feedItems["ig:story_b"] = makeItem("ig:story_b", {
      platform: "instagram",
      contentType: "story",
      content: { mediaUrls: [mediaB], mediaTypes: ["image"] },
      location: { name: "Locations", url: "https://www.instagram.com/explore/locations/", source: "sticker" },
      userState: { hidden: false, saved: false, archived: false, tags: ["seen"] },
    });

    expect(deduplicateDocFeedItems(doc)).toBe(1);
    const remaining = Object.values(doc.feedItems);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userState.tags).toContain("seen");
  });

  it("merges false feed-home stories into the matching Instagram post", () => {
    const doc = makeDoc();
    const media =
      "https://scontent-sjc6-1.cdninstagram.com/v/t51.82787-15/686160351_18590219362021644_2956174995573013549_n.jpg?ig_cache_key=Mzg4OTEyMDU2NjkzOTE0MjI5Ng%3D%3D.3-ccb7-5&_nc_gid=a";

    doc.feedItems["ig:DX47qX6ktQg"] = makeItem("ig:DX47qX6ktQg", {
      platform: "instagram",
      contentType: "video",
      content: {
        text: "POV: your backyard just became the favorite hangout.",
        mediaUrls: [media],
        mediaTypes: ["image"],
      },
      sourceUrl: "https://www.instagram.com/p/DX47qX6ktQg/",
    });
    doc.feedItems["ig:story_reels"] = makeItem("ig:story_reels", {
      platform: "instagram",
      contentType: "story",
      author: { id: "ig:reels", handle: "reels", displayName: "Reels" },
      content: { mediaUrls: [media.replace("scontent-sjc6-1", "scontent-sea1-1")], mediaTypes: ["image"] },
      location: { name: "Locations", url: "https://www.instagram.com/explore/locations/", source: "sticker" },
      sourceUrl: "https://www.instagram.com/?variant=following",
      userState: { hidden: false, saved: true, archived: false, tags: ["saved-story"] },
    });

    expect(deduplicateDocFeedItems(doc)).toBe(1);
    expect(doc.feedItems["ig:DX47qX6ktQg"]).toBeDefined();
    expect(doc.feedItems["ig:story_reels"]).toBeUndefined();
    expect(doc.feedItems["ig:DX47qX6ktQg"].contentType).toBe("video");
    expect(doc.feedItems["ig:DX47qX6ktQg"].userState.saved).toBe(true);
    expect(doc.feedItems["ig:DX47qX6ktQg"].userState.tags).toContain("saved-story");
  });

  it("keeps unrelated stories with different media keys separate", () => {
    const doc = makeDoc();

    doc.feedItems["ig:story_a"] = makeItem("ig:story_a", {
      platform: "instagram",
      contentType: "story",
      content: {
        mediaUrls: ["https://scontent.example/one.jpg?ig_cache_key=one"],
        mediaTypes: ["image"],
      },
      location: { name: "Locations", source: "sticker" },
    });
    doc.feedItems["ig:story_b"] = makeItem("ig:story_b", {
      platform: "instagram",
      contentType: "story",
      content: {
        mediaUrls: ["https://scontent.example/two.jpg?ig_cache_key=two"],
        mediaTypes: ["image"],
      },
      location: { name: "Locations", source: "sticker" },
    });

    expect(deduplicateDocFeedItems(doc)).toBe(0);
    expect(Object.keys(doc.feedItems)).toHaveLength(2);
  });
});
