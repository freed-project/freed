import { describe, expect, it } from "vitest";
import * as A from "@automerge/automerge";
import type { FreedDoc } from "@freed/shared/schema";
import { createEmptyDoc, addFeedItem } from "@freed/shared/schema";
import type { FeedItem } from "@freed/shared";
import { createPersistenceState, persistDoc } from "./automerge-persistence";

function makeLargeText(seed: string): string {
  return `${seed} `.repeat(3_000);
}

function makeItem(globalId: string, url: string, text: string): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    sourceUrl: url,
    author: { id: "ars", handle: "@ars", displayName: "Ars" },
    content: {
      text,
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url },
    },
    userState: {
      saved: false,
      archived: false,
      hidden: false,
      tags: [],
    },
    topics: [],
  };
}

describe("automerge persistence", () => {
  it("appends a small incremental chunk to the last snapshot", () => {
    let doc = createEmptyDoc();
    let state = createPersistenceState(null);

    doc = A.change(doc, "seed snapshot", (draft) => {
      addFeedItem(draft, makeItem("rss:seed", "https://example.com/seed", makeLargeText("seed")));
    });

    const first = persistDoc(doc, state);
    state = first.persistence;
    expect(first.binary.byteLength).toBeGreaterThan(1_024);

    doc = A.change(doc, "mark saved", (draft) => {
      draft.feedItems["rss:seed"].userState.saved = true;
    });

    const second = persistDoc(doc, state);
    expect(second.usedIncremental).toBe(true);
    const loaded = A.load<FreedDoc>(second.binary);
    expect(loaded.feedItems["rss:seed"].userState.saved).toBe(true);
  });

  it("compacts back to a fresh snapshot when incremental growth exceeds the base snapshot", () => {
    let doc = createEmptyDoc();
    let state = createPersistenceState(null);
    const initial = persistDoc(doc, state);
    state = initial.persistence;

    let sawSnapshot = false;
    for (let i = 0; i < 40; i++) {
      doc = A.change(doc, `add ${i}`, (draft) => {
        addFeedItem(
          draft,
          makeItem(`rss:item-${i}`, `https://example.com/${i}`, makeLargeText(`item ${i}`)),
        );
      });

      const persisted = persistDoc(doc, state);
      state = persisted.persistence;
      if (!persisted.usedIncremental && i > 0) {
        sawSnapshot = true;
        break;
      }
    }

    expect(sawSnapshot).toBe(true);
    const loaded = A.load<FreedDoc>(state.binary!);
    expect(Object.keys((loaded as typeof doc).feedItems).length).toBeGreaterThan(0);
  });
});
