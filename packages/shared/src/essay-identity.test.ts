import { describe, expect, it } from "vitest";
import {
  canonicalEssayProviderProfileUrl,
  canonicalEssayProviderUrl,
  essayActivityGlobalId,
  essayProviderGlobalId,
} from "./essay-identity.js";

describe("essay provider identity", () => {
  it("removes tracking data and sorts meaningful query parameters", () => {
    expect(
      canonicalEssayProviderUrl(
        "https://medium.com/@ada/story/?z=2&utm_source=feed&a=1&sk=secret#part",
      ),
    ).toBe("https://medium.com/@ada/story?a=1&z=2");
  });

  it("builds provider IDs from the same canonical URL", () => {
    expect(
      essayProviderGlobalId(
        "substack",
        "https://ada.substack.com/p/one?ref=home",
      ),
    ).toBe("substack:essay:https%3A%2F%2Fada.substack.com%2Fp%2Fone");
  });

  it("rejects non-web and malformed URLs", () => {
    expect(canonicalEssayProviderUrl("javascript:alert(1)")).toBeUndefined();
    expect(canonicalEssayProviderUrl("not a URL")).toBeUndefined();
  });

  it("canonicalizes provider profile handles without changing publication paths", () => {
    expect(
      canonicalEssayProviderProfileUrl(
        "substack",
        "https://substack.com/@Ada/?utm_source=profile",
      ),
    ).toBe("https://substack.com/@ada");
    expect(
      canonicalEssayProviderProfileUrl("medium", "https://medium.com/@Grace?source=profile"),
    ).toBe("https://medium.com/@grace");
    expect(
      canonicalEssayProviderProfileUrl("medium", "https://medium.com/Better-Programming"),
    ).toBe("https://medium.com/Better-Programming");
  });

  it("distinguishes different people acting on the same essay", () => {
    const ada = essayActivityGlobalId("medium", "response", {
      targetUrl: "https://medium.com/@writer/essay-abcdef?source=home",
      authorId: "https://medium.com/@ada",
      publishedAt: "2026-07-13T12:00:00.000Z",
      text: "A thoughtful response",
    });
    const grace = essayActivityGlobalId("medium", "response", {
      targetUrl: "https://medium.com/@writer/essay-abcdef",
      authorId: "https://medium.com/@grace",
      publishedAt: "2026-07-13T12:00:00.000Z",
      text: "A thoughtful response",
    });

    expect(ada).toBe(essayActivityGlobalId("medium", "response", {
      targetUrl: "https://medium.com/@writer/essay-abcdef",
      authorId: "https://medium.com/@ada",
      publishedAt: "2026-07-13T12:00:00.000Z",
      text: "A thoughtful   response",
    }));
    expect(ada).not.toBe(grace);
    expect(ada).toMatch(/^medium:response:[a-z0-9]{14}$/);
  });
});
