import { compareTags } from "./release-notes-shared.mjs";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-dev)?$/;

export const HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE = "historical-published-tag";
export const RELEASE_RANGE_START_MODES = Object.freeze({
  COMPLETE_HISTORY: "complete_history",
  PREVIOUS_PRODUCT_COMMIT: "previous_product_commit",
  HISTORICAL_TAG_COMMIT: "historical_tag_commit",
});

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

function requireChannel(value) {
  if (value !== "dev" && value !== "production") {
    throw new Error("Release channel must be dev or production.");
  }
  return value;
}

function requirePublishedTag(value, { channel }) {
  const tag = String(value ?? "").trim();
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error("Previous published release tag is invalid.");
  }
  if ((channel === "dev") !== tag.endsWith("-dev")) {
    throw new Error(
      `Previous published release tag ${tag} does not belong to the ${channel} channel.`,
    );
  }
  return tag;
}

function publicationFactTag(fact) {
  return String(fact?.tag_name ?? fact?.tag ?? "").trim();
}

function publicationFactStatus(fact) {
  return String(
    fact?.publication_status ??
      fact?.publicationStatus ??
      fact?.conclusion ??
      fact?.status ??
      fact?.state ??
      "",
  )
    .trim()
    .toLowerCase();
}

function hasValidPublishedAt(fact) {
  const publishedAt = String(
    fact?.published_at ?? fact?.publishedAt ?? "",
  ).trim();
  return publishedAt !== "" && Number.isFinite(Date.parse(publishedAt));
}

function isSuccessfulPublishedReleaseFact(fact, { channel }) {
  if (!fact || typeof fact !== "object" || fact.draft !== false) {
    return false;
  }
  if (!hasValidPublishedAt(fact)) {
    return false;
  }

  const status = publicationFactStatus(fact);
  if (status !== "" && status !== "published" && status !== "success") {
    return false;
  }

  const tag = publicationFactTag(fact);
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    return false;
  }
  if (channel === "dev") {
    return fact.prerelease === true && tag.endsWith("-dev");
  }
  return fact.prerelease === false && !tag.endsWith("-dev");
}

export function canonicalPreviousPublishedRelease({
  channel,
  currentTag,
  publicationFacts,
}) {
  const normalizedChannel = requireChannel(channel);
  const normalizedCurrentTag = requirePublishedTag(currentTag, {
    channel: normalizedChannel,
  });
  if (!Array.isArray(publicationFacts)) {
    throw new Error(
      "Canonical previous release selection requires publication facts.",
    );
  }

  const candidates = publicationFacts
    .filter((fact) =>
      isSuccessfulPublishedReleaseFact(fact, {
        channel: normalizedChannel,
      }),
    )
    .map((fact) => ({
      id: fact.id ?? null,
      tag: publicationFactTag(fact),
      publishedAt: String(fact.published_at ?? fact.publishedAt ?? "").trim(),
    }))
    .filter(({ tag }) => compareTags(tag, normalizedCurrentTag) < 0)
    .sort((left, right) => compareTags(left.tag, right.tag));

  return candidates.at(-1) ?? null;
}

export function canonicalPublishedRelease({
  channel,
  tag,
  publicationFacts,
}) {
  const normalizedChannel = requireChannel(channel);
  const normalizedTag = requirePublishedTag(tag, {
    channel: normalizedChannel,
  });
  if (!Array.isArray(publicationFacts)) {
    throw new Error(
      "Canonical published release selection requires publication facts.",
    );
  }

  const matches = publicationFacts
    .filter((fact) =>
      isSuccessfulPublishedReleaseFact(fact, {
        channel: normalizedChannel,
      }),
    )
    .filter((fact) => publicationFactTag(fact) === normalizedTag)
    .map((fact) => ({
      id: fact.id ?? null,
      tag: publicationFactTag(fact),
      publishedAt: String(
        fact.published_at ?? fact.publishedAt ?? "",
      ).trim(),
    }));
  if (matches.length > 1) {
    throw new Error(
      `Canonical publication history contains duplicate release facts for ${normalizedTag}.`,
    );
  }
  return matches[0] ?? null;
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

function hasExactReleasePreparationReceipt(source, { channel }) {
  if (
    !hasReleasePreparationReceipt(source, { channel }) ||
    Object.hasOwn(source ?? {}, "receiptMode") ||
    Object.hasOwn(source ?? {}, "publishedTagCommitSha")
  ) {
    return false;
  }
  if (channel === "dev") {
    return source.promotedDevCommitSha === null;
  }
  return true;
}

function hasExactHistoricalPublishedTagReceipt(source) {
  return (
    source?.receiptMode === HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE &&
    source?.productCommitSha === null &&
    source?.promotedDevCommitSha === null &&
    FULL_COMMIT_SHA_PATTERN.test(
      normalizedCommitSha(source?.publishedTagCommitSha),
    )
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
  const normalizedChannel = requireChannel(channel);
  const immutableTagCommitSha = requireCommitSha(
    tagCommitSha,
    "Published tag commit",
  );

  if (
    existingSource !== null &&
    existingSource !== undefined &&
    Object.hasOwn(existingSource, "channel") &&
    existingSource.channel !== normalizedChannel
  ) {
    throw new Error("Historical release source channel does not match.");
  }

  if (
    hasExactReleasePreparationReceipt(existingSource, {
      channel: normalizedChannel,
    })
  ) {
    return receiptFieldsFromSource(existingSource);
  }

  const existingTagCommitSha = normalizedCommitSha(
    existingSource?.publishedTagCommitSha,
  );
  if (
    hasExactHistoricalPublishedTagReceipt(existingSource) &&
    existingTagCommitSha === immutableTagCommitSha
  ) {
    return receiptFieldsFromSource(existingSource);
  }
  if (existingTagCommitSha && existingTagCommitSha !== immutableTagCommitSha) {
    throw new Error(
      `Historical published-tag receipt is immutable: existing ${existingTagCommitSha}, resolved ${immutableTagCommitSha}.`,
    );
  }
  const claimsReceipt =
    (existingSource?.productCommitSha !== null &&
      existingSource?.productCommitSha !== undefined) ||
    (existingSource?.promotedDevCommitSha !== null &&
      existingSource?.promotedDevCommitSha !== undefined) ||
    Object.hasOwn(existingSource ?? {}, "receiptMode") ||
    Object.hasOwn(existingSource ?? {}, "publishedTagCommitSha");
  if (claimsReceipt) {
    throw new Error(
      "Historical release source has an unsupported or mixed receipt mode.",
    );
  }

  return {
    receiptMode: HISTORICAL_PUBLISHED_TAG_RECEIPT_MODE,
    productCommitSha: null,
    promotedDevCommitSha: null,
    publishedTagCommitSha: immutableTagCommitSha,
  };
}

export function publishedReleaseInspectionSource({
  channel,
  immutableSource = null,
  tagCommitSha,
}) {
  const normalizedChannel = requireChannel(channel);
  const immutableTagCommitSha = requireCommitSha(
    tagCommitSha,
    "Published tag commit",
  );
  if (
    hasExactReleasePreparationReceipt(immutableSource, {
      channel: normalizedChannel,
    }) ||
    hasExactHistoricalPublishedTagReceipt(immutableSource)
  ) {
    return immutableSource;
  }

  const claimsReceipt =
    (immutableSource?.productCommitSha !== null &&
      immutableSource?.productCommitSha !== undefined) ||
    (immutableSource?.promotedDevCommitSha !== null &&
      immutableSource?.promotedDevCommitSha !== undefined) ||
    Object.hasOwn(immutableSource ?? {}, "receiptMode") ||
    Object.hasOwn(immutableSource ?? {}, "publishedTagCommitSha");
  if (claimsReceipt) {
    return immutableSource;
  }

  return {
    channel: normalizedChannel,
    ...historicalPublishedTagReceipt({
      channel: normalizedChannel,
      tagCommitSha: immutableTagCommitSha,
    }),
  };
}

export function releaseInspectionRange({
  channel,
  previousPublishedTag = null,
  previousSource = null,
  previousTagCommitSha = null,
  productCommitSha,
  isAncestor = null,
}) {
  const normalizedChannel = requireChannel(channel);
  const toInclusiveProductCommitSha = requireCommitSha(
    productCommitSha,
    "Current release product commit",
  );

  if (previousPublishedTag === null) {
    return {
      channel: normalizedChannel,
      previousPublishedTag: null,
      startMode: RELEASE_RANGE_START_MODES.COMPLETE_HISTORY,
      fromExclusiveCommitSha: null,
      toInclusiveProductCommitSha,
    };
  }

  const normalizedPreviousTag = requirePublishedTag(previousPublishedTag, {
    channel: normalizedChannel,
  });
  const resolvedTagCommitSha = requireCommitSha(
    previousTagCommitSha,
    "Resolved previous release tag commit",
  );
  if (!previousSource || typeof previousSource !== "object") {
    throw new Error(
      `Previous published release ${normalizedPreviousTag} is missing its source receipt.`,
    );
  }
  if (previousSource.channel !== normalizedChannel) {
    throw new Error(
      `Previous published release ${normalizedPreviousTag} has the wrong source channel.`,
    );
  }

  let startMode;
  let fromExclusiveCommitSha;
  if (
    hasExactReleasePreparationReceipt(previousSource, {
      channel: normalizedChannel,
    })
  ) {
    startMode = RELEASE_RANGE_START_MODES.PREVIOUS_PRODUCT_COMMIT;
    fromExclusiveCommitSha = requireCommitSha(
      previousSource.productCommitSha,
      "Previous release product commit",
    );
  } else if (hasExactHistoricalPublishedTagReceipt(previousSource)) {
    startMode = RELEASE_RANGE_START_MODES.HISTORICAL_TAG_COMMIT;
    fromExclusiveCommitSha = requireCommitSha(
      previousSource.publishedTagCommitSha,
      "Previous historical release tag commit",
    );
    if (resolvedTagCommitSha !== fromExclusiveCommitSha) {
      throw new Error(
        `Previous historical release ${normalizedPreviousTag} resolves to ${resolvedTagCommitSha}, expected ${fromExclusiveCommitSha}.`,
      );
    }
  } else {
    throw new Error(
      `Previous published release ${normalizedPreviousTag} has no supported release receipt.`,
    );
  }

  if (typeof isAncestor !== "function") {
    throw new Error(
      "Release inspection range requires an exact Git ancestry check.",
    );
  }
  if (
    startMode === RELEASE_RANGE_START_MODES.PREVIOUS_PRODUCT_COMMIT &&
    !isAncestor(fromExclusiveCommitSha, resolvedTagCommitSha)
  ) {
    throw new Error(
      `Previous release product commit ${fromExclusiveCommitSha} is not an ancestor of its published tag commit ${resolvedTagCommitSha}.`,
    );
  }
  for (const ancestorStart of new Set([
    resolvedTagCommitSha,
    fromExclusiveCommitSha,
  ])) {
    if (!isAncestor(ancestorStart, toInclusiveProductCommitSha)) {
      throw new Error(
        `Previous release range boundary ${ancestorStart} is not an ancestor of current product commit ${toInclusiveProductCommitSha}.`,
      );
    }
  }

  return {
    channel: normalizedChannel,
    previousPublishedTag: normalizedPreviousTag,
    startMode,
    fromExclusiveCommitSha,
    toInclusiveProductCommitSha,
  };
}
