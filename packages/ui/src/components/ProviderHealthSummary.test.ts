import { describe, expect, it } from "vitest";
import type { HealthProviderId } from "../lib/debug-store.js";
import { providerHealthLabel } from "./ProviderHealthSummary.js";

describe("providerHealthLabel", () => {
  it("labels every provider health source", () => {
    const providers: HealthProviderId[] = [
      "rss",
      "x",
      "facebook",
      "instagram",
      "linkedin",
      "substack",
      "medium",
      "youtube",
      "gdrive",
      "dropbox",
    ];

    expect(providers.map(providerHealthLabel)).toEqual([
      "RSS",
      "X",
      "Facebook",
      "Instagram",
      "LinkedIn",
      "Substack",
      "Medium",
      "YouTube",
      "Google Drive",
      "Dropbox",
    ]);
  });
});
