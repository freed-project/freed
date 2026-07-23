import { describe, expect, it } from "vitest";
import { buildSettingsSectionMetas } from "../../../ui/src/lib/settings-sections";

const BASE_AVAILABILITY = {
  hasFeedManagement: false,
  hasGoogleContacts: false,
  hasGoogleContactsManagement: false,
  hasAISettings: false,
  hasShortcuts: false,
  hasX: false,
  hasFacebook: false,
  hasInstagram: false,
  hasLinkedIn: false,
  hasSubstack: false,
  hasMedium: false,
  hasYouTube: false,
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

  it("keeps Shortcuts after Appearance when the platform has shortcut controls", () => {
    const sections = buildSettingsSectionMetas({
      ...BASE_AVAILABILITY,
      hasShortcuts: true,
    });

    expect(sections.map((section) => section.id).slice(0, 2)).toEqual(["appearance", "shortcuts"]);
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

  it("shows YouTube only when the platform provides its integration settings", () => {
    expect(buildSettingsSectionMetas(BASE_AVAILABILITY).map((section) => section.id))
      .not.toContain("youtube");
    expect(buildSettingsSectionMetas({
      ...BASE_AVAILABILITY,
      hasYouTube: true,
    }).map((section) => section.id)).toContain("youtube");
  });

  it("marks authenticated essay providers as beta when available", () => {
    const sections = buildSettingsSectionMetas({
      ...BASE_AVAILABILITY,
      hasSubstack: true,
      hasMedium: true,
    });

    expect(sections.find((section) => section.id === "substack")?.stage).toBe("beta");
    expect(sections.find((section) => section.id === "medium")?.stage).toBe("beta");
  });
});
