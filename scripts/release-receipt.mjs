const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;

export const HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE = "historical-published-tag";

function normalizedCommitSha(value) {
  return String(value ?? "").trim();
}

function requireCommitSha(value, label) {
  const commitSha = normalizedCommitSha(value);
  if (!FULL_COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error(`${label} must be a full Git commit SHA.`);
  }
  return commitSha;
}

function receiptFieldsFromSource(source) {
  const receipt = {
    productCommitSha: source?.productCommitSha ?? null,
    promotedDevCommitSha: source?.promotedDevCommitSha ?? null,
  };
  if (Object.hasOwn(source ?? {}, "receiptMode")) {
    receipt.receiptMode = source.receiptMode;
  }
  if (Object.hasOwn(source ?? {}, "publishedTagCommitSha")) {
    receipt.publishedTagCommitSha = source.publishedTagCommitSha;
  }
  return receipt;
}

export function hasReleasePreparationReceipt(source, { channel }) {
  const productCommitSha = normalizedCommitSha(source?.productCommitSha);
  if (!FULL_COMMIT_SHA_PATTERN.test(productCommitSha)) {
    return false;
  }
  if (channel !== "production") {
    return true;
  }
  return FULL_COMMIT_SHA_PATTERN.test(
    normalizedCommitSha(source?.promotedDevCommitSha),
  );
}

export function releasePreparationReceipt({
  channel,
  productCommitSha,
  promotedDevCommitSha = null,
}) {
  const receipt = {
    productCommitSha: requireCommitSha(
      productCommitSha,
      "Release product commit",
    ),
    promotedDevCommitSha: null,
  };
  if (channel === "production") {
    receipt.promotedDevCommitSha = requireCommitSha(
      promotedDevCommitSha,
      "Promoted dev commit",
    );
  }
  return receipt;
}

export function historicalPublishedTagReceipt({
  channel,
  tagCommitSha,
  existingSource = null,
}) {
  const immutableTagCommitSha = requireCommitSha(
    tagCommitSha,
    "Published tag commit",
  );

  if (hasReleasePreparationReceipt(existingSource, { channel })) {
    return receiptFieldsFromSource(existingSource);
  }

  const existingTagCommitSha = normalizedCommitSha(
    existingSource?.publishedTagCommitSha,
  );
  if (existingTagCommitSha && existingTagCommitSha !== immutableTagCommitSha) {
    throw new Error(
      `Historical published-tag receipt is immutable: existing ${existingTagCommitSha}, resolved ${immutableTagCommitSha}.`,
    );
  }

  return {
    receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
    productCommitSha: null,
    promotedDevCommitSha: null,
    publishedTagCommitSha: immutableTagCommitSha,
  };
}
