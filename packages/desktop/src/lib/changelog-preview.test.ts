import { describe, expect, it } from "vitest";
import { buildChangelogPreviewFromNotes } from "./changelog-preview";

describe("buildChangelogPreviewFromNotes", () => {
  it("keeps individual same-day releases and their complete notes", () => {
    const preview = buildChangelogPreviewFromNotes([
      {
        version: "26.5.608-dev",
        channel: "dev",
        dayKey: "26.5.6",
        generatedAt: "2026-05-06T14:21:34.924Z",
        release: { deck: "Older same-day dev note" },
      },
      {
        version: "26.5.610-dev",
        channel: "dev",
        dayKey: "26.5.6",
        generatedAt: "2026-05-06T15:27:03.499Z",
        release: {
          deck: "Newest same-day dev note",
          fixes: [
            "Renderer payloads stay compact",
            "Scraper stores stay isolated",
            "Third release detail",
          ],
        },
      },
      {
        version: "26.5.309",
        channel: "production",
        dayKey: "26.5.3",
        generatedAt: "2026-05-03T18:20:00.000Z",
        release: { deck: "Production day note" },
      },
      {
        version: "26.5.308-dev",
        channel: "dev",
        dayKey: "26.5.3",
        generatedAt: "2026-05-03T17:20:00.000Z",
        release: { deck: "Dev day note" },
      },
    ]);

    expect(preview).toHaveLength(4);
    expect(preview.map((release) => release.version)).toEqual([
      "26.5.610-dev",
      "26.5.608-dev",
      "26.5.309",
      "26.5.308-dev",
    ]);
    expect(preview[0]?.items).toEqual([
      "Renderer payloads stay compact",
      "Scraper stores stay isolated",
      "Third release detail",
    ]);
  });

  it("skips unapproved notes and limits the list", () => {
    const preview = buildChangelogPreviewFromNotes(
      [
        {
          version: "26.5.610-dev",
          channel: "dev",
          dayKey: "26.5.6",
          approved: false,
          release: { deck: "Draft note" },
        },
        {
          version: "26.5.517-dev",
          channel: "dev",
          dayKey: "26.5.5",
          release: { deck: "First visible note" },
        },
        {
          version: "26.5.406-dev",
          channel: "dev",
          dayKey: "26.5.4",
          release: { deck: "Second visible note" },
        },
      ],
      1,
    );

    expect(preview).toEqual([
      {
        version: "26.5.517-dev",
        channel: "dev",
        date: null,
        summary: "First visible note",
        items: [],
      },
    ]);
  });

  it("retains builds 400 through 403 and limits to the ten newest releases", () => {
    const notes = [305, 400, 401, 402, 403, 500, 300, 301, 302, 303, 304].map((patch) => ({
      version: `26.10.${patch}-dev`,
      channel: "dev" as const,
      dayKey: `26.10.${Math.floor(patch / 100)}`,
      approved: true,
      release: { deck: `Notes for build ${patch}` },
    }));
    const preview = buildChangelogPreviewFromNotes(notes);
    expect(preview.map((release) => release.version)).toEqual([
      "26.10.500-dev", "26.10.403-dev", "26.10.402-dev", "26.10.401-dev",
      "26.10.400-dev", "26.10.305-dev", "26.10.304-dev", "26.10.303-dev",
      "26.10.302-dev", "26.10.301-dev",
    ]);
    expect(preview[2]?.summary).toBe("Notes for build 402");
  });

  it("deduplicates a repeated version using the latest approved artifact", () => {
    const note = { version: "26.10.400-dev", channel: "dev" as const, approved: true };
    const preview = buildChangelogPreviewFromNotes([
      { ...note, generatedAt: "2026-10-04T10:00:00Z", release: { deck: "Older notes" } },
      { ...note, generatedAt: "2026-10-04T12:00:00Z", release: { deck: "Reviewed notes" } },
      { ...note, approved: false, generatedAt: "2026-10-04T13:00:00Z", release: { deck: "Draft" } },
    ]);
    expect(preview).toHaveLength(1);
    expect(preview[0]?.summary).toBe("Reviewed notes");
  });
});
