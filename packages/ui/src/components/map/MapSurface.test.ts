import { describe, expect, it } from "vitest";
import type { LocationMarkerSummary } from "@freed/shared";
import { areLocationMarkerListsRenderEquivalent } from "./MapSurface";

const NOW = Date.UTC(2026, 4, 9, 18, 0, 0);

function marker(overrides: Partial<LocationMarkerSummary> = {}): LocationMarkerSummary {
  return {
    key: "friend:ada",
    authorKey: "author:instagram:ada",
    friend: {
      id: "ada",
      name: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.jpg",
      relationshipStatus: "friend",
      careLevel: 5,
      createdAt: NOW,
      updatedAt: NOW,
    },
    item: {
      globalId: "instagram:1",
      platform: "instagram",
      contentType: "post",
      capturedAt: NOW,
      publishedAt: NOW - 60_000,
      author: {
        id: "ada-ig",
        handle: "ada",
        displayName: "Ada Lovelace",
        avatarUrl: "https://example.com/ada-source.jpg",
      },
      content: {
        text: "At the observatory.",
        mediaUrls: [],
        mediaTypes: [],
      },
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: [],
    },
    lat: 48.8566,
    lng: 2.3522,
    label: "Paris",
    groupCount: 1,
    seenAt: NOW - 60_000,
    ...overrides,
  };
}

describe("areLocationMarkerListsRenderEquivalent", () => {
  it("keeps equivalent marker snapshots stable across timer recomputes", () => {
    const current = [marker()];
    const next = [marker()];

    expect(areLocationMarkerListsRenderEquivalent(current, next)).toBe(true);
  });

  it("detects marker changes that affect rendered map content", () => {
    const current = [marker()];
    const next = [marker({ label: "Berlin" })];

    expect(areLocationMarkerListsRenderEquivalent(current, next)).toBe(false);
  });

  it("detects source content changes used by popups and marker avatars", () => {
    const current = [marker()];
    const next = [
      marker({
        item: {
          ...marker().item,
          content: {
            text: "A new location note.",
            mediaUrls: [],
            mediaTypes: [],
          },
        },
      }),
    ];

    expect(areLocationMarkerListsRenderEquivalent(current, next)).toBe(false);
  });
});
