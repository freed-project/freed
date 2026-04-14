import { beforeEach, describe, expect, it } from "vitest";
import { inferReleaseChannelFromHostname } from "@freed/shared";
import {
  RELEASE_CHANNEL_STORAGE_KEY,
  bootstrapReleaseChannel,
  buildPwaReleaseChannelUrl,
} from "@freed/ui/lib/release-channel";

describe("release channel helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("recognizes the dev PWA hostname", () => {
    expect(inferReleaseChannelFromHostname("dev-app.freed.wtf")).toBe("dev");
  });

  it("adopts the release channel handoff param and strips it from the URL", () => {
    window.history.replaceState(
      {},
      "",
      "/feed?releaseChannel=dev&filter=unread#reader",
    );

    expect(bootstrapReleaseChannel()).toBe("dev");
    expect(window.localStorage.getItem(RELEASE_CHANNEL_STORAGE_KEY)).toBe("dev");
    expect(window.location.href).toContain("/feed?filter=unread#reader");
  });

  it("builds a dev PWA URL that preserves path, query, and hash", () => {
    expect(
      buildPwaReleaseChannelUrl(
        "https://app.freed.wtf/feed?filter=unread#reader",
        "dev",
      ),
    ).toBe("https://dev-app.freed.wtf/feed?filter=unread&releaseChannel=dev#reader");
  });
});
