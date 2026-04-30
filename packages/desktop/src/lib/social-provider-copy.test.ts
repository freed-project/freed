import { describe, expect, it } from "vitest";
import { SOCIAL_PROVIDER_COPY, type SocialProviderId } from "./social-provider-copy";

const allCopyText = (provider: SocialProviderId) => Object.values(SOCIAL_PROVIDER_COPY[provider]).join(" ");

describe("social provider copy", () => {
  it("keeps provider labels, domains, and feed terms scoped to the right provider", () => {
    const forbidden: Record<SocialProviderId, string[]> = {
      x: ["Facebook", "Instagram", "LinkedIn", "facebook.com", "instagram.com", "linkedin.com"],
      facebook: ["Instagram", "LinkedIn", "x.com", "twitter.com", "home timeline", "Manual cookie"],
      instagram: ["Facebook", "LinkedIn", "x.com", "twitter.com", "home timeline", "Manual cookie", "groups"],
      linkedin: ["Facebook", "Instagram", "x.com", "twitter.com", "home timeline", "Manual cookie", "groups"],
    };

    for (const provider of Object.keys(SOCIAL_PROVIDER_COPY) as SocialProviderId[]) {
      const text = allCopyText(provider);
      for (const phrase of forbidden[provider]) {
        expect(text, `${provider} copy must not contain ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it("uses memory pressure copy that describes a skipped start, not a paused provider", () => {
    for (const provider of Object.keys(SOCIAL_PROVIDER_COPY) as SocialProviderId[]) {
      expect(SOCIAL_PROVIDER_COPY[provider].memoryPressure).toContain("sync did not start");
      expect(SOCIAL_PROVIDER_COPY[provider].memoryPressure).not.toContain("sync paused");
    }
  });
});
