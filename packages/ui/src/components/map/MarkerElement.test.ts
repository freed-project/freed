/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { LocationMarkerSummary } from "@freed/shared";
import { createMarkerElement } from "./MarkerElement";
import type { FriendAvatarPalette } from "../../lib/friend-avatar-style";

const palette: FriendAvatarPalette = {
  borderStrong: "border-strong",
  borderSoft: "border-soft",
  glow: "glow",
  glowSoft: "glow-soft",
  ring: "ring",
  gradientStart: "gradient-start",
  gradientMid: "gradient-mid",
  gradientEnd: "gradient-end",
  imageOverlay: "image-overlay",
  imageShadow: "image-shadow",
  imageHighlight: "image-highlight",
  selectionStroke: "selection-stroke",
  selectionOuterStroke: "selection-outer-stroke",
  labelBorder: "label-border",
  initialsShadow: "initials-shadow",
  text: "text",
};

function marker(overrides: Partial<LocationMarkerSummary> = {}): LocationMarkerSummary {
  return {
    key: "marker-1",
    seenAt: Date.now(),
    groupCount: 1,
    friend: null,
    item: {
      globalId: "ig:1",
      platform: "instagram",
      contentType: "story",
      capturedAt: Date.now(),
      publishedAt: Date.now(),
      author: {
        id: "ig:lotus.alchemist",
        handle: "lotus.alchemist",
        displayName: "Lotus Alchemist",
        avatarUrl: "https://example.com/avatar.jpg",
      },
      content: { mediaUrls: [], mediaTypes: [] },
      topics: [],
      userState: { hidden: false, saved: false, archived: false, tags: [] },
    },
    ...overrides,
  } as LocationMarkerSummary;
}

describe("createMarkerElement", () => {
  it("falls back to the channel initial when a marker avatar fails", () => {
    const element = createMarkerElement(marker(), palette);
    const image = element.querySelector("img");

    expect(image).toBeInstanceOf(HTMLImageElement);

    image?.dispatchEvent(new Event("error"));

    expect(element.querySelector("img")).toBeNull();
    expect(element.querySelector("[data-avatar-fallback]")?.textContent).toBe("L");
  });

  it("uses person initials for linked person markers", () => {
    const element = createMarkerElement(
      marker({
        friend: {
          id: "person-1",
          name: "Lotus Alchemist",
          relationshipStatus: "friend",
          careLevel: 3,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        item: {
          ...marker().item,
          author: {
            ...marker().item.author,
            avatarUrl: undefined,
          },
        },
      }),
      palette,
    );

    expect(element.querySelector("[data-avatar-fallback]")?.textContent).toBe("LA");
  });

  it("formats grouped marker badges with locale-aware numbers", () => {
    const element = createMarkerElement(marker({ groupCount: 1234 }), palette);

    expect(element.textContent).toContain((1234).toLocaleString());
  });
});
