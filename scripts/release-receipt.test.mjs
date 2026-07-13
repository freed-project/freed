import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
  historicalPublishedTagReceipt,
  releasePreparationReceipt,
} from "./release-receipt.mjs";

const PRODUCT_SHA = "1".repeat(40);
const PROMOTED_DEV_SHA = "2".repeat(40);
const TAG_SHA = "3".repeat(40);

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
