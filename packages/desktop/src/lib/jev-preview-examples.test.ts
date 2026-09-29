import { describe, expect, it } from "vitest";
import { sanitizeFeedItemCaptureWrite } from "@freed/shared";
import {
  canonicalizeFeedItemAnalysisV1,
  FEED_ITEM_ANALYSIS_REPLACE_PAYLOAD_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA,
} from "@freed/shared/library-core";
import { generateJevPreviewExamples } from "./jev-preview-examples";

describe("Jev example import", () => {
  it("admits every generated item through the real capture and analysis payload contracts", () => {
    const generatedAt = 1_800_000_000_000;
    const { items } = generateJevPreviewExamples(generatedAt);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      // These are the same transforms used by ADD_SAMPLE_LIBRARY_DATA. One
      // malformed media pair rejects the entire capture transaction.
      const capture = FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate({
        item: sanitizeFeedItemCaptureWrite(item),
      });
      expect(capture, item.globalId).toMatchObject({ ok: true });
      const analysis = FEED_ITEM_ANALYSIS_REPLACE_PAYLOAD_SCHEMA.validate({
        ...canonicalizeFeedItemAnalysisV1(item.contentSignals, item.eventCandidate),
        assigned_at_ms: generatedAt,
      });
      expect(analysis, item.globalId).toMatchObject({ ok: true });
    }
  });
});
