import {
  generateSampleLibraryData,
  SAMPLE_CHARACTER_ARCS,
  SAMPLE_CURATED_DEMO_MEDIA,
  sampleCorpusAttribution,
  sampleCorpusMediaUrl,
  sampleCorpusSourceUrl,
  type Account,
  type FeedItem,
  type Person,
  type RssFeed,
} from "@freed/shared";
import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreCheckpointRegistryKey,
  type LibraryCoreCanonicalValue,
  type LibraryCoreNormalizedCheckpointPrimaryKeyV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
} from "@freed/shared/library-core";
import {
  activatePwaNormalizedCheckpointStage,
  appendPwaNormalizedCheckpointStagePage,
  beginPwaNormalizedCheckpointStage,
  queryPwaNormalizedLibrary,
} from "./library-core-sqlite-runtime";

const DEMO_CREATED_AT = Date.UTC(2026, 7, 31, 12);
const DEMO_BATCH_ID = "freed-demo-showcase-v11";
const DEMO_LIBRARY_ID = "freed-demo-library-v11";
const DEMO_EPOCH_ID = "1".repeat(64);
const DEMO_WRITER_ID = "2".repeat(64);
const DEMO_CAPABILITY_ID = "3".repeat(64);
const DEMO_PUBLIC_KEY = "4".repeat(64);
const DEMO_CHAIN_DIGEST = "5".repeat(64);
const DEMO_PAGE_RECORDS = 512;
const DEMO_LAST_TOP_ITEM_KEY = "freed.demo.last-top-item.v1";
export type FreedDemoCheckpointProgressListener = (percent: number) => void;
const DEMO_CHARACTER_CARE_LEVELS = {
  "manny-tis": 5,
  "cygnus-shy": 4,
  "nudi-branch-manager": 3,
  "frogbert-angler": 3,
  "flora-mingo": 2,
  "nova-remains": 1,
  "alma-eight": 4,
  "mora-grey": 2,
  "colm-still": 1,
} as const satisfies Readonly<Record<string, Person["careLevel"]>>;

interface FreedDemoCheckpointOptions {
  generatedAt?: number;
  presentationSeed?: number;
  previousTopItemId?: string | null;
}

function demoPresentationSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0]!;
}

function readPreviousDemoTopItemId(): string | null {
  try {
    return sessionStorage.getItem(DEMO_LAST_TOP_ITEM_KEY);
  } catch {
    return null;
  }
}

function writePreviousDemoTopItemId(globalId: string): void {
  try {
    sessionStorage.setItem(DEMO_LAST_TOP_ITEM_KEY, globalId);
  } catch {
    // A fresh randomized seed still provides variety when storage is unavailable.
  }
}

function stablePresentationNumber(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash;
}

function curatedDemoSample(
  sample: ReturnType<typeof generateSampleLibraryData>,
  generatedAt: number,
  presentationSeed: number,
  previousTopItemId: string | null | undefined,
) {
  const mediaBySha = new Map(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => [asset.sha1, asset]));
  const mediaByCharacter = new Map<string, typeof SAMPLE_CURATED_DEMO_MEDIA>();
  for (const arc of SAMPLE_CHARACTER_ARCS) {
    mediaByCharacter.set(
      arc.characterId,
      arc.episodes.flatMap((episode) => {
        const asset = episode.mediaSha1 ? mediaBySha.get(episode.mediaSha1) : undefined;
        return asset ? [asset] : [];
      }),
    );
  }
  const characterItems = new Map<string, FeedItem[]>();
  let templateIndex = 0;
  for (const arc of SAMPLE_CHARACTER_ARCS) {
    const assets = mediaByCharacter.get(arc.characterId) ?? [];
    const externalId = `${DEMO_BATCH_ID}:sample-character-${arc.characterId}`;
    const items = arc.episodes.map((episode, sequence) => {
      const asset = episode.mediaSha1 ? mediaBySha.get(episode.mediaSha1) : undefined;
      if (episode.mediaSha1 && !asset) {
        throw new Error(`Missing reviewed demo media for ${arc.characterId}:${sequence}`);
      }
      const template = sample.items[templateIndex++]!;
      const globalId = `${DEMO_BATCH_ID}:sample-character:${arc.characterId}:${sequence}`;
      const sourceUrl = asset
        ? sampleCorpusSourceUrl(asset)
        : `https://demo.freed.wtf/?item=${encodeURIComponent(globalId)}`;
      return {
        ...template,
        globalId,
        platform: arc.platform,
        contentType: arc.platform === "rss" ? "article" as const : "post" as const,
        sourceUrl,
        author: {
          id: externalId,
          displayName: arc.identityNameBase,
          handle: arc.characterId,
          avatarUrl: assets[0] ? sampleCorpusMediaUrl(assets[0]) : undefined,
        },
        content: {
          text: episode.body,
          mediaUrls: asset ? [sampleCorpusMediaUrl(asset)] : [],
          mediaTypes: asset ? ["image" as const] : [],
          linkPreview: {
            url: sourceUrl,
            title: episode.title,
            description: asset ? sampleCorpusAttribution(asset) : undefined,
          },
        },
        ...(arc.platform === "rss"
          ? {
              rssSource: {
                feedUrl: `https://sample.freed.wtf/${DEMO_BATCH_ID}/characters/${arc.characterId}`,
                feedTitle: `${arc.identityNameBase} Field Notes`,
                siteUrl: "https://sample.freed.wtf",
              },
            }
          : { rssSource: undefined }),
        ...(arc.location || asset?.coordinates
          ? {
              location: {
                name: arc.location?.name ?? asset!.detail,
                coordinates: arc.location?.coordinates ?? asset!.coordinates!,
                source: "text_extraction" as const,
              },
            }
          : { location: undefined }),
        preservedContent: arc.platform === "rss"
          ? {
              preservedAt: generatedAt,
              publishedAt: generatedAt,
              author: arc.identityNameBase,
              text: episode.body,
              wordCount: episode.body.trim().split(/\s+/).length,
              readingTime: Math.max(1, Math.ceil(episode.body.trim().split(/\s+/).length / 200)),
            }
          : undefined,
        userState: {
          ...template.userState,
          archived: false,
          hidden: false,
        },
      } satisfies FeedItem;
    });
    characterItems.set(arc.characterId, items);
  }

  const newestFirst: FeedItem[] = [];
  const maximumEpisodes = Math.max(...[...characterItems.values()].map((items) => items.length));
  for (let round = 0; round < maximumEpisodes; round += 1) {
    const activeArcs = SAMPLE_CHARACTER_ARCS
      .filter((arc) => round < (characterItems.get(arc.characterId)?.length ?? 0))
      .sort((left, right) =>
        stablePresentationNumber(`${round}:${left.characterId}`, presentationSeed) -
        stablePresentationNumber(`${round}:${right.characterId}`, presentationSeed)
      );
    for (const arc of activeArcs) {
      const episodes = characterItems.get(arc.characterId)!;
      newestFirst.push(episodes[episodes.length - 1 - round]!);
    }
  }
  if (newestFirst.length > 1 && newestFirst[0]?.globalId === previousTopItemId) {
    const replacementIndex = newestFirst.findIndex((item) => item.author.id !== newestFirst[0]!.author.id);
    if (replacementIndex > 0) {
      [newestFirst[0], newestFirst[replacementIndex]] = [newestFirst[replacementIndex]!, newestFirst[0]!];
    }
  }
  const timelineSlots = sample.items
    .slice(0, newestFirst.length)
    .map((item) => item.publishedAt)
    .sort((left, right) => right - left);
  const items = newestFirst.map((item, index) => {
    const publishedAt = timelineSlots[index] ?? generatedAt - index * 60_000;
    const delta = publishedAt - item.publishedAt;
    return {
      ...item,
      publishedAt,
      capturedAt: item.capturedAt + delta,
    };
  });

  const persons = SAMPLE_CHARACTER_ARCS.map((arc, index) => {
    const template = sample.persons[index]!;
    const assets = mediaByCharacter.get(arc.characterId) ?? [];
    return {
      ...template,
      id: `${DEMO_BATCH_ID}:sample-person-${arc.characterId}`,
      name: arc.identityNameBase,
      bio: arc.bio,
      avatarUrl: assets[0] ? sampleCorpusMediaUrl(assets[0]) : undefined,
      careLevel: DEMO_CHARACTER_CARE_LEVELS[arc.characterId as keyof typeof DEMO_CHARACTER_CARE_LEVELS]
        ?? (1 + stablePresentationNumber(arc.characterId, 0) % 5) as Person["careLevel"],
      relationshipStatus: "friend",
    } satisfies Person;
  });
  const accounts = SAMPLE_CHARACTER_ARCS.map((arc, index) => {
    const template = sample.accounts[index]!;
    const assets = mediaByCharacter.get(arc.characterId) ?? [];
    const externalId = `${DEMO_BATCH_ID}:sample-character-${arc.characterId}`;
    return {
      ...template,
      id: `social:${arc.platform}:${externalId}`,
      provider: arc.platform,
      externalId,
      handle: arc.characterId,
      displayName: arc.identityNameBase,
      avatarUrl: assets[0] ? sampleCorpusMediaUrl(assets[0]) : undefined,
      personId: persons[index]!.id,
    } satisfies Account;
  });
  const feedTemplate = sample.feeds[0]!;
  const feeds: RssFeed[] = SAMPLE_CHARACTER_ARCS.filter((arc) => arc.platform === "rss").map((arc) => ({
    ...feedTemplate,
    url: `https://sample.freed.wtf/${DEMO_BATCH_ID}/characters/${arc.characterId}`,
    title: `${arc.identityNameBase} Field Notes`,
    siteUrl: "https://sample.freed.wtf",
    imageUrl: undefined,
  }));
  return { accounts, feeds, items, persons };
}

function demoTopItemId(
  records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
): string | null {
  const visibleItems = records
    .filter((candidate) =>
      candidate.registryKey === "10_feed_item" &&
      candidate.payload.contentType !== "story" &&
      candidate.payload.archived === false &&
      candidate.payload.hidden === false
    )
    .sort((left, right) =>
      Number(right.payload.publishedAt) - Number(left.payload.publishedAt) ||
      String(left.primaryKey).localeCompare(String(right.primaryKey))
    );
  return visibleItems[0] ? String(visibleItems[0].primaryKey) : null;
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
  const sample = generateSampleLibraryData({
    batchId: DEMO_BATCH_ID,
    friendCount: 80,
    generatedAt,
    identitiesPerFriend: 2,
    presentationSeed,
    previousTopItemId,
    seed: 20260831,
    unlinkedIdentityRatio: 1,
  });
  const curated = curatedDemoSample(sample, generatedAt, presentationSeed, previousTopItemId);
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
    ...curated.persons.flatMap(personRecords),
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
  const records = createFreedDemoCheckpointRecords({
    previousTopItemId: readPreviousDemoTopItemId(),
  });
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
  const topItemId = demoTopItemId(records);
  if (topItemId) writePreviousDemoTopItemId(topItemId);
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
