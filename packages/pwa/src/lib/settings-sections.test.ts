import { describe, expect, it } from "vitest";
import { buildSettingsSectionMetas } from "../../../ui/src/lib/settings-sections";

const BASE_AVAILABILITY = {
  hasFeedManagement: false,
  hasGoogleContacts: false,
  hasGoogleContactsManagement: false,
  hasAISettings: false,
  hasX: false,
  hasFacebook: false,
  hasInstagram: false,
  hasLinkedIn: false,
  hasUpdateChecks: false,
  hasFactoryReset: false,
};

describe("settings section availability", () => {
  it("omits AI when the platform has no AI settings capability", () => {
    const sections = buildSettingsSectionMetas(BASE_AVAILABILITY);

    expect(sections.map((section) => section.id)).not.toContain("ai");
  });

  it("keeps AI when the platform has AI settings capability", () => {
    const sections = buildSettingsSectionMetas({
      ...BASE_AVAILABILITY,
      hasAISettings: true,
    });

    expect(sections.map((section) => section.id)).toContain("ai");
  });

  it("keeps Google Contacts visible without management keywords", () => {
    const statusOnly = buildSettingsSectionMetas({
      ...BASE_AVAILABILITY,
      hasGoogleContacts: true,
    }).find((section) => section.id === "googleContacts");
    const managed = buildSettingsSectionMetas({
      ...BASE_AVAILABILITY,
      hasGoogleContacts: true,
      hasGoogleContactsManagement: true,
    }).find((section) => section.id === "googleContacts");

    expect(statusOnly?.keywords).toContain("status");
    expect(statusOnly?.keywords).not.toContain("connect");
    expect(managed?.keywords).toContain("connect");
  });

  it("keeps Feeds visible without subscription management keywords", () => {
    const statusOnly = buildSettingsSectionMetas(BASE_AVAILABILITY).find((section) => section.id === "feeds");
    const managed = buildSettingsSectionMetas({
      ...BASE_AVAILABILITY,
      hasFeedManagement: true,
    }).find((section) => section.id === "feeds");

    expect(statusOnly?.keywords).toContain("status");
    expect(statusOnly?.keywords).not.toContain("add feed");
    expect(statusOnly?.keywords).not.toContain("opml");
    expect(managed?.keywords).toContain("add feed");
    expect(managed?.keywords).toContain("opml");
  });
});
