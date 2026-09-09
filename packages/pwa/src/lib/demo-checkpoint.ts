import {
  generateDemoLibraryData,
  type Account,
  type FeedItem,
  type Person,
  type RssFeed,
} from "@freed/shared";
import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreCheckpointRegistryKey,
  type LibraryCoreDeviceGraphLayoutMutationV1,
  type LibraryCoreDeviceGraphPositionSetV1,
  type LibraryCorePersonGraphPageResponseV1,
  type LibraryCoreAccountGraphPageResponseV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreNormalizedCheckpointPrimaryKeyV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
} from "@freed/shared/library-core";
import {
  activatePwaNormalizedCheckpointStage,
  appendPwaNormalizedCheckpointStagePage,
  beginPwaNormalizedCheckpointStage,
  queryPwaNormalizedLibrary,
  mutatePwaDeviceGraphLayout,
} from "./library-core-sqlite-runtime";
import { isFreedDemoMode } from "./demo-mode";

const DEMO_CREATED_AT = Date.UTC(2026, 7, 31, 12);
const DEMO_BATCH_ID = "freed-demo-showcase-v11";
const DEMO_LIBRARY_ID = "freed-demo-library-v11";
const DEMO_EPOCH_ID = "1".repeat(64);
const DEMO_WRITER_ID = "2".repeat(64);
const DEMO_CAPABILITY_ID = "3".repeat(64);
const DEMO_PUBLIC_KEY = "4".repeat(64);
const DEMO_CHAIN_DIGEST = "5".repeat(64);
const DEMO_PAGE_RECORDS = 512;
export type FreedDemoCheckpointProgressListener = (percent: number) => void;

interface FreedDemoCheckpointOptions {
  generatedAt?: number;
  presentationSeed?: number;
  previousTopItemId?: string | null;
  careLevels?: ReadonlyMap<string, Person["careLevel"]>;
}

function demoPresentationSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0]!;
}


function record(
  registryKey: LibraryCoreCheckpointRegistryKey,
  primaryKey: LibraryCoreNormalizedCheckpointPrimaryKeyV2,
  payload: Record<string, LibraryCoreCanonicalValue>,
): LibraryCoreNormalizedCheckpointRecordV2 {
  return createLibraryCoreNormalizedCheckpointRecordV2({
    registryKey,
    primaryKey,
    payload,
  });
}

function sampleFields(value: FeedItem | RssFeed | Person | Account) {
  const fingerprint = value.sampleDataFingerprint;
  return {
    sampleBatchId: fingerprint?.batchId ?? null,
    sampleGeneratedAt: fingerprint?.generatedAt ?? null,
    sampleGeneratorVersion: fingerprint?.generatorVersion ?? null,
  } as const;
}

function displayImageUrl(sourceUrl: string | undefined): string | null {
  return sourceUrl ?? null;
}

function feedItemRecords(item: FeedItem) {
  const content = item.content;
  const state = item.userState;
  const location = item.location;
  const timeRange = item.timeRange;
  const rss = item.rssSource;
  const group = item.fbGroup;
  const preserved = item.preservedContent;
  const records: LibraryCoreNormalizedCheckpointRecordV2[] = [
    record("10_feed_item", item.globalId, {
      archived: state.archived,
      archivedAt: state.archivedAt ?? null,
      authorAvatarUrl: displayImageUrl(item.author.avatarUrl),
      authorDisplayName: item.author.displayName,
      authorHandle: item.author.handle,
      authorId: item.author.id,
      capturedAt: item.capturedAt,
      contentText: content.text ?? null,
      contentTextBlobDigest: null,
      contentType: item.contentType,
      engagementComments: item.engagement?.comments ?? null,
      engagementLikes: item.engagement?.likes ?? null,
      engagementReposts: item.engagement?.reposts ?? null,
      engagementViews: item.engagement?.views ?? null,
      fbGroupId: group?.id ?? null,
      fbGroupName: group?.name ?? null,
      fbGroupUrl: group?.url ?? null,
      hidden: state.hidden,
      liked: state.liked ?? null,
      likedAt: state.likedAt ?? null,
      likedSyncedAt: state.likedSyncedAt ?? null,
      linkDescription: content.linkPreview?.description ?? null,
      linkTitle: content.linkPreview?.title ?? null,
      linkUrl: content.linkPreview?.url ?? null,
      locationLat: location?.coordinates?.lat ?? null,
      locationLng: location?.coordinates?.lng ?? null,
      locationName: location?.name ?? null,
      locationSource: location?.source ?? null,
      locationUrl: location?.url ?? null,
      platform: item.platform,
      preservedAt: preserved?.preservedAt ?? null,
      preservedAuthor: preserved?.author ?? null,
      preservedPublishedAt: preserved?.publishedAt ?? null,
      preservedReadingTime: preserved?.readingTime ?? null,
      preservedText: preserved?.text ?? null,
      preservedTextBlobDigest: null,
      preservedWordCount: preserved?.wordCount ?? null,
      priority: item.priority ?? null,
      priorityComputedAt: item.priorityComputedAt ?? null,
      publishedAt: item.publishedAt,
      readAt: state.readAt ?? null,
      rssFeedTitle: rss?.feedTitle ?? null,
      rssFeedUrl: rss?.feedUrl ?? null,
      rssSiteUrl: rss?.siteUrl ?? null,
      ...sampleFields(item),
      saved: state.saved,
      savedAt: state.savedAt ?? null,
      seenSyncedAt: state.seenSyncedAt ?? null,
      sourceUrl: item.sourceUrl ?? null,
      timeRangeEndsAt: timeRange?.endsAt ?? null,
      timeRangeKind: timeRange?.kind ?? null,
      timeRangeStartsAt: timeRange?.startsAt ?? null,
      updatedAt: Math.max(item.capturedAt, state.archivedAt ?? 0, state.savedAt ?? 0),
    }),
  ];

  const mediaCount = Math.max(content.mediaUrls.length, content.mediaTypes.length);
  for (let ordinal = 0; ordinal < mediaCount; ordinal += 1) {
    const sourceUrl = content.mediaUrls[ordinal];
    const mediaType = content.mediaTypes[ordinal];
    if (!sourceUrl || !mediaType) continue;
    records.push(
      record("11_feed_item_media", [item.globalId, ordinal], {
        blobContentDigest: null,
        mediaType,
        sourceUrl: displayImageUrl(sourceUrl),
      }),
    );
  }
  for (const topic of item.topics) {
    records.push(record("12_feed_item_topic", [item.globalId, topic], { topic }));
  }
  for (const tag of state.tags) {
    records.push(record("13_feed_item_tag", [item.globalId, tag], { tag }));
  }
  if (item.contentSignals) {
    records.push(record("15_feed_item_signal", item.globalId, {
      inferredAt: item.contentSignals.inferredAt,
      method: item.contentSignals.method,
      version: item.contentSignals.version,
    }));
    const tagged = new Set(item.contentSignals.tags);
    for (const [signal, score] of Object.entries(item.contentSignals.scores)
      .sort(([left], [right]) => left.localeCompare(right))) {
      if (score === undefined) continue;
      records.push(record("16_feed_item_signal_score", [item.globalId, signal], {
        score,
        signal,
        tagged: tagged.has(signal as keyof typeof item.contentSignals.scores),
      }));
    }
  }
  return records;
}

function feedRecords(feed: RssFeed) {
  return [
    record("20_rss_feed", feed.url, {
      enabled: feed.enabled,
      folder: feed.folder ?? null,
      imageUrl: displayImageUrl(feed.imageUrl),
      lastFetched: feed.lastFetched ?? null,
      pollInterval: feed.pollInterval ?? null,
      ...sampleFields(feed),
      siteUrl: feed.siteUrl ?? null,
      title: feed.title,
      trackUnread: feed.trackUnread,
      updatedAt: feed.sampleDataFingerprint?.generatedAt ?? DEMO_CREATED_AT,
    }),
  ];
}

function personRecords(person: Person) {
  const records = [
    record("30_person", person.id, {
      avatarUrl: displayImageUrl(person.avatarUrl),
      bio: person.bio ?? null,
      careLevel: person.careLevel,
      createdAt: person.createdAt,
      name: person.name,
      notes: person.notes ?? null,
      reachOutIntervalDays: person.reachOutIntervalDays ?? null,
      relationshipStatus: person.relationshipStatus,
      ...sampleFields(person),
      updatedAt: person.updatedAt,
    }),
  ];
  for (const tag of person.tags ?? []) {
    records.push(record("31_person_tag", [person.id, tag], { tag }));
  }
  for (const [ordinal, reachOut] of (person.reachOutLog ?? []).entries()) {
    records.push(
      record("32_person_reach_out", [person.id, ordinal], {
        channel: reachOut.channel ?? null,
        loggedAt: reachOut.loggedAt,
        notes: reachOut.notes ?? null,
      }),
    );
  }
  return records;
}

function accountRecords(account: Account) {
  const records = [
    record("40_account", account.id, {
      address: account.address ?? null,
      avatarUrl: displayImageUrl(account.avatarUrl),
      createdAt: account.createdAt,
      discoveredFrom: account.discoveredFrom,
      displayName: account.displayName ?? null,
      email: account.email ?? null,
      externalId: account.externalId,
      firstSeenAt: account.firstSeenAt,
      followRosterActive: account.followRosterActive ?? null,
      followRosterSyncedAt: account.followRosterSyncedAt ?? null,
      handle: account.handle ?? null,
      importedAt: account.importedAt ?? null,
      kind: account.kind,
      lastSeenAt: account.lastSeenAt,
      personId: account.personId ?? null,
      phone: account.phone ?? null,
      profileUrl: account.profileUrl ?? null,
      provider: account.provider,
      ...sampleFields(account),
      updatedAt: account.updatedAt,
    }),
  ];
  for (const role of account.followRosterRoles ?? []) {
    records.push(record("41_account_follow_role", [account.id, role], { role }));
  }
  return records;
}

export function createFreedDemoCheckpointRecords(
  options: FreedDemoCheckpointOptions = {},
): readonly LibraryCoreNormalizedCheckpointRecordV2[] {
  const generatedAt = options.generatedAt ?? Date.now();
  const presentationSeed = options.presentationSeed ?? demoPresentationSeed();
  const previousTopItemId = options.previousTopItemId ?? undefined;
  const curated = generateDemoLibraryData({
    batchId: DEMO_BATCH_ID, generatedAt, presentationSeed, previousTopItemId,
  });
  return [
    record("00_checkpoint_header", "checkpoint", {
      authorityEpoch: DEMO_EPOCH_ID,
      checkpointId: `${DEMO_LIBRARY_ID}:${DEMO_EPOCH_ID}:1`,
      createdAtMs: DEMO_CREATED_AT,
      libraryId: DEMO_LIBRARY_ID,
      schemaVersion: 1,
      sourceRevision: 1,
    }),
    record("01_authority_epoch", DEMO_EPOCH_ID, {
      acceptedAt: DEMO_CREATED_AT,
      acceptedManifestGeneration: 0,
      authorityKeyId: DEMO_PUBLIC_KEY,
      authorityPublicKey: DEMO_PUBLIC_KEY,
      canonicalTransitionCertificate: "{}",
      checkpointFrontierDigest: "6".repeat(64),
      epochNumber: 1,
      libraryId: DEMO_LIBRARY_ID,
      materializedStateDigest: "7".repeat(64),
      transitionCertificateDigest: "8".repeat(64),
    }),
    record("03_active_authority", "active", {
      acceptedManifestGeneration: 0,
      activatedAt: DEMO_CREATED_AT,
      activeKey: "active",
      epochId: DEMO_EPOCH_ID,
      libraryId: DEMO_LIBRARY_ID,
      writerId: DEMO_WRITER_ID,
    }),
    ...curated.items.flatMap(feedItemRecords),
    ...curated.feeds.flatMap(feedRecords),
    ...curated.persons.flatMap((person) => {
      const level = options.careLevels?.get(person.id);
      return personRecords(level === undefined ? person : {
        ...person,
        careLevel: level,
        relationshipStatus: level >= 3 ? "friend" : "connection",
      });
    }),
    ...curated.accounts.flatMap(accountRecords),
    record("90_actor_state", DEMO_WRITER_ID, {
      acceptedChainDigest: DEMO_CHAIN_DIGEST,
      acceptedCounter: 0,
      acceptedOperationId: null,
      actorKind: "desktop",
      authorityEpochId: DEMO_EPOCH_ID,
      canonicalEnrollmentCertificate: "{}",
      chainGenesisDigest: DEMO_CHAIN_DIGEST,
      createdAt: DEMO_CREATED_AT,
      enrollmentCertificateDigest: "9".repeat(64),
      enrollmentOperationId: `demo-writer:${DEMO_WRITER_ID}`,
      publicKey: DEMO_PUBLIC_KEY,
      retiredAt: null,
      updatedAt: DEMO_CREATED_AT,
    }),
    record("91_actor_capability", DEMO_CAPABILITY_ID, {
      actorClass: "editor",
      actorId: DEMO_WRITER_ID,
      canonicalCertificate: "{}",
      certificateDigest: "a".repeat(64),
      certificateVersion: 2,
      issuanceIdentity: DEMO_CAPABILITY_ID,
      issuedAt: DEMO_CREATED_AT,
      retiredAt: null,
      retirementCertificateDigest: null,
      retirementIdentity: "b".repeat(64),
      scopeId: null,
      scopeKind: null,
      scopeMode: "library_wide",
    }),
  ];
}

let demoInstallTask: Promise<void> | null = null;
let demoPresentation: FreedDemoCheckpointOptions | null = null;
let demoCareLevels = new Map<string, Person["careLevel"]>();
let demoCareTask = Promise.resolve();
let pendingCareChanges = 0;
let demoCareUnavailable = false;

/** Pin only within the isolated demo, serialized with checkpoint replacement. */
export async function mutateFreedDemoGraphLayout(mutation: LibraryCoreDeviceGraphLayoutMutationV1) {
  if (!isFreedDemoMode(location.hostname, undefined, location.search)) {
    throw new Error("Demo graph changes are unavailable outside the demo.");
  }
  const change = demoCareTask.then(async () => {
    if (!demoInstallTask || demoCareUnavailable) throw new Error("Reload the demo before changing its layout.");
    await demoInstallTask;
    return mutatePwaDeviceGraphLayout(mutation);
  });
  demoCareTask = change.then(() => undefined, () => undefined);
  return change;
}

/** Short-lived, bounded layout snapshot; SQLite remains the session's row store. */
async function readDemoPins(): Promise<LibraryCoreDeviceGraphPositionSetV1[]> {
  const pins: LibraryCoreDeviceGraphPositionSetV1[] = [];
  let count = 0;
  for (const queryId of ["person_graph_page_v1", "account_graph_page_v1"] as const) {
    let cursor: string | null = null;
    const readerSessionId = crypto.randomUUID();
    do {
      const request: { schemaVersion: 1; cursor: string | null; limit: number; readerSessionId: string; cancellationId: string } = { schemaVersion: 1 as const, cursor, limit: 128,
        readerSessionId, cancellationId: crypto.randomUUID() };
      const page: LibraryCorePersonGraphPageResponseV1 | LibraryCoreAccountGraphPageResponseV1 =
        queryId === "person_graph_page_v1"
          ? await queryPwaNormalizedLibrary({ ...request, queryId: "person_graph_page_v1" })
          : await queryPwaNormalizedLibrary({ ...request, queryId: "account_graph_page_v1" });
      count += page.rows.length;
      if (count > 1_000) throw new Error("Demo identity limit exceeded.");
      for (const row of page.rows) {
        if (row.graphPinned && row.graphX !== null && row.graphY !== null && row.graphUpdatedAt !== null) {
          pins.push({
            entityId: row.id, graphX: row.graphX, graphY: row.graphY,
            updatedAt: row.graphUpdatedAt, schemaVersion: 1,
            mutationId: queryId === "person_graph_page_v1" ? "person_graph_position_set_v1" : "account_graph_position_set_v1",
          });
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return pins;
}

/** Replace only the isolated demo fixture, never submit a durable Library edit. */
export async function setFreedDemoPersonCare(
  personId: string,
  level: Person["careLevel"],
): Promise<void> {
  if (!isFreedDemoMode(location.hostname, undefined, location.search)) {
    throw new Error("Demo care changes are unavailable outside the demo.");
  }
  if (!Number.isInteger(level) || level < 1 || level > 5 || personId.length > 512) {
    throw new Error("Invalid demo care rating.");
  }
  if (pendingCareChanges >= 4) throw new Error("A demo care change is already pending.");
  pendingCareChanges += 1;
  const change = demoCareTask.then(async () => {
    if (!demoInstallTask || demoCareUnavailable) throw new Error("Reload the demo before changing care ratings.");
    await demoInstallTask;
    if (!demoPresentation) throw new Error("The demo is not initialized.");
    // Let the rating's pending state paint before constructing this bounded fixture.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const nextLevels = new Map(demoCareLevels).set(personId, level);
    const records = createFreedDemoCheckpointRecords({ ...demoPresentation, careLevels: nextLevels });
    const people = records.filter((entry) => entry.registryKey === "30_person");
    if (people.length > 1_000 || records.filter(entry => entry.registryKey === "10_feed_item").length > 1_000
      || !people.some((entry) => entry.primaryKey === personId)) {
      throw new Error("That identity is not part of this demo.");
    }
    // Activation validates and atomically replaces the memory database. Its new
    // checkpoint digest fences old cursors; no synthetic writer or SQL bypass.
    const pins = await readDemoPins();
    try {
      await activateDemoCheckpoint(records);
      for (const pin of pins) await mutatePwaDeviceGraphLayout(pin);
    } catch (error) {
      // A failed or ambiguous activation requires a fresh isolated document.
      // Do not accumulate abandoned stages or replay a possibly accepted edit.
      demoCareUnavailable = true;
      throw error;
    }
    demoCareLevels = nextLevels;
  });
  demoCareTask = change.catch(() => undefined);
  try {
    await change;
  } finally {
    pendingCareChanges -= 1;
  }
}

async function activateDemoCheckpoint(
  records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
  onProgress?: FreedDemoCheckpointProgressListener,
  progressRange: readonly [start: number, end: number] = [0, 90],
): Promise<void> {
  const stageId = `demo:${crypto.randomUUID()}`;
  const [progressStart, progressEnd] = progressRange;
  await beginPwaNormalizedCheckpointStage({
    authorityEpoch: DEMO_EPOCH_ID,
    createdAt: DEMO_CREATED_AT,
    expectedRecordCount: records.length,
    libraryId: DEMO_LIBRARY_ID,
    sourceRevision: 1,
    stageId,
  });
  onProgress?.(progressStart);
  for (let offset = 0; offset < records.length; offset += DEMO_PAGE_RECORDS) {
    await appendPwaNormalizedCheckpointStagePage({
      records: records.slice(offset, offset + DEMO_PAGE_RECORDS),
      stageId,
    });
    const completedRecords = Math.min(offset + DEMO_PAGE_RECORDS, records.length);
    const fraction = completedRecords / Math.max(records.length, 1);
    onProgress?.(
      Math.round(progressStart + (progressEnd - progressStart) * fraction),
    );
  }
  await activatePwaNormalizedCheckpointStage({
    followerReceipt: null,
    replaceExisting: true,
    stageId,
  });
  onProgress?.(progressEnd);
}

async function installFreedDemoCheckpointOnce(
  onProgress?: FreedDemoCheckpointProgressListener,
): Promise<void> {
  demoPresentation = { generatedAt: Date.now(), presentationSeed: demoPresentationSeed() };
  const records = createFreedDemoCheckpointRecords(demoPresentation);
  onProgress?.(0);
  await activateDemoCheckpoint(records, onProgress, [2, 88]);
  const firstSummary = await queryPwaNormalizedLibrary({
    queryId: "library_facet_summary_v1",
    schemaVersion: 1,
  });
  const expectedItems = records.filter(
    (candidate) => candidate.registryKey === "10_feed_item",
  ).length;
  onProgress?.(92);
  if (firstSummary.summary.totalCount !== expectedItems) {
    await activateDemoCheckpoint(records, onProgress, [92, 98]);
  }
  onProgress?.(98);
}

export function installFreedDemoCheckpoint(
  onProgress?: FreedDemoCheckpointProgressListener,
): Promise<void> {
  demoInstallTask ??= installFreedDemoCheckpointOnce(onProgress).catch((error) => {
    demoInstallTask = null;
    throw error;
  });
  return demoInstallTask;
}
