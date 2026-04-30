import { describe, expect, it } from "vitest";
import {
  channelInitialForName,
  createAvatarImageFailureStore,
  personInitialsForName,
} from "./friend-avatar";

describe("avatar helpers", () => {
  it("uses a single channel initial for display names and handles", () => {
    expect(channelInitialForName("Lotus Alchemist")).toBe("L");
    expect(channelInitialForName("lotus.alchemist")).toBe("L");
    expect(channelInitialForName("@lotus.alchemist")).toBe("L");
  });

  it("keeps two-initial person fallbacks", () => {
    expect(personInitialsForName("Lotus Alchemist")).toBe("LA");
    expect(personInitialsForName("Lotus")).toBe("L");
  });

  it("tracks failed avatar URLs and resets them by URL", () => {
    const store = createAvatarImageFailureStore();
    store.mark("https://example.com/broken.jpg");

    expect(store.has("https://example.com/broken.jpg")).toBe(true);
    expect(store.has("https://example.com/next.jpg")).toBe(false);

    store.reset("https://example.com/broken.jpg");
    expect(store.has("https://example.com/broken.jpg")).toBe(false);
  });
});
