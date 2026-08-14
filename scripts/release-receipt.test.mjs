import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPublishedRelease,
  canonicalPreviousPublishedRelease,
  HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
  RELEASE_RANGE_START_MODES,
  historicalPublishedTagReceipt,
  publishedReleaseInspectionSource,
  releaseInspectionRange,
  releasePreparationReceipt,
} from "./release-receipt.mjs";

const PRODUCT_SHA = "1".repeat(40);
const PROMOTED_DEV_SHA = "2".repeat(40);
const TAG_SHA = "3".repeat(40);
const CURRENT_PRODUCT_SHA = "4".repeat(40);

test("current release preparation keeps the existing receipt shape", () => {
  assert.deepEqual(
    releasePreparationReceipt({
      channel: "production",
      productCommitSha: PRODUCT_SHA,
      promotedDevCommitSha: PROMOTED_DEV_SHA,
    }),
    {
      productCommitSha: PRODUCT_SHA,
      promotedDevCommitSha: PROMOTED_DEV_SHA,
    },
  );
});

test("historical backfill records only the immutable published tag commit", () => {
  assert.deepEqual(
    historicalPublishedTagReceipt({
      channel: "production",
      tagCommitSha: TAG_SHA,
    }),
    {
      receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
      productCommitSha: null,
      promotedDevCommitSha: null,
      publishedTagCommitSha: TAG_SHA,
    },
  );
});

test("historical backfill preserves a valid current receipt exactly", () => {
  const existingSource = {
    productCommitSha: PRODUCT_SHA,
    promotedDevCommitSha: PROMOTED_DEV_SHA,
  };
  assert.deepEqual(
    historicalPublishedTagReceipt({
      channel: "production",
      tagCommitSha: TAG_SHA,
      existingSource,
    }),
    existingSource,
  );
});

test("historical backfill refuses to rewrite an existing tag receipt", () => {
  assert.throws(
    () =>
      historicalPublishedTagReceipt({
        channel: "production",
        tagCommitSha: TAG_SHA,
        existingSource: {
          receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
          productCommitSha: null,
          promotedDevCommitSha: null,
          publishedTagCommitSha: "4".repeat(40),
        },
      }),
    /Historical published-tag receipt is immutable/,
  );
});

test("historical backfill preserves only exact receipt modes", () => {
  const historicalSource = {
    channel: "production",
    receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
    productCommitSha: null,
    promotedDevCommitSha: null,
    publishedTagCommitSha: TAG_SHA,
  };
  assert.deepEqual(
    historicalPublishedTagReceipt({
      channel: "production",
      tagCommitSha: TAG_SHA,
      existingSource: historicalSource,
    }),
    {
      receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
      productCommitSha: null,
      promotedDevCommitSha: null,
      publishedTagCommitSha: TAG_SHA,
    },
  );

  assert.throws(
    () =>
      historicalPublishedTagReceipt({
        channel: "dev",
        tagCommitSha: TAG_SHA,
        existingSource: {
          channel: "dev",
          productCommitSha: PRODUCT_SHA,
          promotedDevCommitSha: null,
          receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
          publishedTagCommitSha: TAG_SHA,
        },
      }),
    /unsupported or mixed receipt mode/,
  );
  assert.throws(
    () =>
      historicalPublishedTagReceipt({
        channel: "dev",
        tagCommitSha: TAG_SHA,
        existingSource: {
          channel: "production",
        },
      }),
    /source channel does not match/,
  );
});

test("receipt helpers reject abbreviated commit identities", () => {
  assert.throws(
    () =>
      releasePreparationReceipt({
        channel: "dev",
        productCommitSha: "abc123",
      }),
    /full Git commit SHA/,
  );
  assert.throws(
    () =>
      historicalPublishedTagReceipt({
        channel: "production",
        tagCommitSha: "abc123",
      }),
    /full Git commit SHA/,
  );
});

test("release inspection ranges select the exact modern, historical, or complete-history boundary", () => {
  const ancestryChecks = [];
  assert.deepEqual(
    releaseInspectionRange({
      channel: "dev",
      previousPublishedTag: "v26.7.2701-dev",
      previousSource: {
        channel: "dev",
        productCommitSha: PRODUCT_SHA,
        promotedDevCommitSha: null,
      },
      previousTagCommitSha: TAG_SHA,
      productCommitSha: CURRENT_PRODUCT_SHA,
      isAncestor(from, to) {
        ancestryChecks.push([from, to]);
        return true;
      },
    }),
    {
      channel: "dev",
      previousPublishedTag: "v26.7.2701-dev",
      startMode: RELEASE_RANGE_START_MODES.PREVIOUS_PRODUCT_COMMIT,
      fromExclusiveCommitSha: PRODUCT_SHA,
      toInclusiveProductCommitSha: CURRENT_PRODUCT_SHA,
    },
  );
  assert.deepEqual(ancestryChecks, [
    [PRODUCT_SHA, TAG_SHA],
    [PRODUCT_SHA, CURRENT_PRODUCT_SHA],
  ]);

  assert.deepEqual(
    releaseInspectionRange({
      channel: "production",
      previousPublishedTag: "v26.7.2300",
      previousSource: {
        channel: "production",
        receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
        productCommitSha: null,
        promotedDevCommitSha: null,
        publishedTagCommitSha: TAG_SHA,
      },
      previousTagCommitSha: TAG_SHA,
      productCommitSha: CURRENT_PRODUCT_SHA,
      isAncestor: () => true,
    }),
    {
      channel: "production",
      previousPublishedTag: "v26.7.2300",
      startMode: RELEASE_RANGE_START_MODES.HISTORICAL_TAG_COMMIT,
      fromExclusiveCommitSha: TAG_SHA,
      toInclusiveProductCommitSha: CURRENT_PRODUCT_SHA,
    },
  );

  assert.deepEqual(
    releaseInspectionRange({
      channel: "dev",
      productCommitSha: CURRENT_PRODUCT_SHA,
    }),
    {
      channel: "dev",
      previousPublishedTag: null,
      startMode: RELEASE_RANGE_START_MODES.COMPLETE_HISTORY,
      fromExclusiveCommitSha: null,
      toInclusiveProductCommitSha: CURRENT_PRODUCT_SHA,
    },
  );
});

test("canonical previous release selection ignores drafts, failed publications, wrong channels, and later tags", () => {
  const published = (overrides) => ({
    id: 1,
    tag_name: "v26.7.2700-dev",
    draft: false,
    prerelease: true,
    published_at: "2026-07-27T12:00:00Z",
    ...overrides,
  });

  assert.deepEqual(
    canonicalPreviousPublishedRelease({
      channel: "dev",
      currentTag: "v26.7.2800-dev",
      publicationFacts: [
        published({ id: 10 }),
        published({
          id: 11,
          tag_name: "v26.7.2701-dev",
          draft: true,
          published_at: null,
        }),
        published({
          id: 12,
          tag_name: "v26.7.2702-dev",
          status: "failed",
        }),
        published({
          id: 13,
          tag_name: "v26.7.2703-dev",
          publication_status: "published",
        }),
        published({
          id: 14,
          tag_name: "v26.7.2801-dev",
        }),
        published({
          id: 15,
          tag_name: "v26.7.2704",
          prerelease: false,
        }),
      ],
    }),
    {
      id: 13,
      tag: "v26.7.2703-dev",
      publishedAt: "2026-07-27T12:00:00Z",
    },
  );
});

test("canonical published release selection requires one successful exact tag", () => {
  const fact = {
    id: 17,
    tag_name: "v26.7.2700-dev",
    draft: false,
    prerelease: true,
    published_at: "2026-07-27T12:00:00Z",
  };
  assert.deepEqual(
    canonicalPublishedRelease({
      channel: "dev",
      tag: "v26.7.2700-dev",
      publicationFacts: [fact],
    }),
    {
      id: 17,
      tag: "v26.7.2700-dev",
      publishedAt: "2026-07-27T12:00:00Z",
    },
  );
  assert.equal(
    canonicalPublishedRelease({
      channel: "dev",
      tag: "v26.7.2700-dev",
      publicationFacts: [{ ...fact, draft: true }],
    }),
    null,
  );
  assert.throws(
    () =>
      canonicalPublishedRelease({
        channel: "dev",
        tag: "v26.7.2700-dev",
        publicationFacts: [fact, { ...fact, id: 18 }],
      }),
    /duplicate release facts/,
  );
});

test("modern release ranges reject a product commit from a fork outside the published tag", () => {
  assert.throws(
    () =>
      releaseInspectionRange({
        channel: "dev",
        previousPublishedTag: "v26.7.2701-dev",
        previousSource: {
          channel: "dev",
          productCommitSha: PRODUCT_SHA,
          promotedDevCommitSha: null,
        },
        previousTagCommitSha: TAG_SHA,
        productCommitSha: CURRENT_PRODUCT_SHA,
        isAncestor(from, to) {
          return !(from === PRODUCT_SHA && to === TAG_SHA);
        },
      }),
    /product commit .* is not an ancestor of its published tag commit/,
  );
});

test("modern release continuity follows the recorded product boundary, not its metadata tag", () => {
  const ancestryChecks = [];
  const range = releaseInspectionRange({
    channel: "dev",
    previousPublishedTag: "v26.7.2701-dev",
    previousSource: {
      channel: "dev",
      productCommitSha: PRODUCT_SHA,
      promotedDevCommitSha: null,
    },
    previousTagCommitSha: TAG_SHA,
    productCommitSha: CURRENT_PRODUCT_SHA,
    isAncestor(from, to) {
      ancestryChecks.push([from, to]);
      return (
        (from === PRODUCT_SHA && to === TAG_SHA) ||
        (from === PRODUCT_SHA && to === CURRENT_PRODUCT_SHA)
      );
    },
  });

  assert.equal(
    range.fromExclusiveCommitSha,
    PRODUCT_SHA,
  );
  assert.deepEqual(ancestryChecks, [
    [PRODUCT_SHA, TAG_SHA],
    [PRODUCT_SHA, CURRENT_PRODUCT_SHA],
  ]);
});

test("release inspection ranges fail closed on unsupported or unproven boundaries", () => {
  assert.throws(
    () =>
      releaseInspectionRange({
        channel: "dev",
        previousPublishedTag: "v26.7.2701-dev",
        previousSource: {
          channel: "dev",
          productCommitSha: null,
        },
        previousTagCommitSha: TAG_SHA,
        productCommitSha: CURRENT_PRODUCT_SHA,
        isAncestor: () => true,
      }),
    /no supported release receipt/,
  );

  assert.throws(
    () =>
      releaseInspectionRange({
        channel: "production",
        previousPublishedTag: "v26.7.2300",
        previousSource: {
          channel: "production",
          receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
          productCommitSha: null,
          promotedDevCommitSha: null,
          publishedTagCommitSha: TAG_SHA,
        },
        previousTagCommitSha: "5".repeat(40),
        productCommitSha: CURRENT_PRODUCT_SHA,
      }),
    /resolves to .* expected/,
  );

  assert.throws(
    () =>
      releaseInspectionRange({
        channel: "dev",
        previousPublishedTag: "v26.7.2701-dev",
        previousSource: {
          channel: "dev",
          productCommitSha: PRODUCT_SHA,
          promotedDevCommitSha: null,
        },
        previousTagCommitSha: TAG_SHA,
        productCommitSha: CURRENT_PRODUCT_SHA,
        isAncestor: () => false,
      }),
    /is not an ancestor/,
  );

  assert.throws(
    () =>
      releaseInspectionRange({
        channel: "dev",
        previousPublishedTag: "v26.7.2701-dev",
        previousSource: {
          channel: "dev",
          productCommitSha: PRODUCT_SHA,
          promotedDevCommitSha: null,
          receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
          publishedTagCommitSha: TAG_SHA,
        },
        previousTagCommitSha: TAG_SHA,
        productCommitSha: CURRENT_PRODUCT_SHA,
        isAncestor: () => true,
      }),
    /no supported release receipt/,
  );

  assert.throws(
    () =>
      releaseInspectionRange({
        channel: "dev",
        previousPublishedTag: "v26.7.2701-dev",
        previousSource: {
          channel: "dev",
          productCommitSha: PRODUCT_SHA,
          promotedDevCommitSha: null,
        },
        previousTagCommitSha: TAG_SHA,
        productCommitSha: CURRENT_PRODUCT_SHA,
      }),
    /requires an exact Git ancestry check/,
  );
});

test("published release inspection trusts a modern tagged receipt and synthesizes only a pre-receipt historical boundary", () => {
  const immutableModernSource = {
    channel: "dev",
    productCommitSha: PRODUCT_SHA,
    promotedDevCommitSha: null,
  };
  assert.equal(
    publishedReleaseInspectionSource({
      channel: "dev",
      immutableSource: immutableModernSource,
      tagCommitSha: TAG_SHA,
    }),
    immutableModernSource,
  );

  assert.deepEqual(
    publishedReleaseInspectionSource({
      channel: "production",
      immutableSource: {
        channel: "production",
        previousPublishedTag: null,
      },
      tagCommitSha: TAG_SHA,
    }),
    {
      channel: "production",
      receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
      productCommitSha: null,
      promotedDevCommitSha: null,
      publishedTagCommitSha: TAG_SHA,
    },
  );
});
