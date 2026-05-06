import { describe, expect, it } from "vitest";
import { buildChangelogPreviewFromNotes } from "./changelog-preview";

describe("buildChangelogPreviewFromNotes", () => {
  it("keeps the newest release for each changelog day and channel", () => {
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
          fixes: ["Renderer payloads stay compact", "Scraper stores stay isolated"],
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

    expect(preview).toHaveLength(3);
    expect(preview.map((release) => release.version)).toEqual([
      "26.5.610-dev",
      "26.5.309",
      "26.5.308-dev",
    ]);
    expect(preview[0]?.items).toEqual([
      "Renderer payloads stay compact",
      "Scraper stores stay isolated",
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
});
