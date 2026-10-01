import type { Account, ContentSignals, FeedItem, Person, SampleDataFingerprint } from "@freed/shared";
import { buildJevRequest } from "./jev-classification.js";
import { reloadSqliteLibraryState } from "./library-client";
import { commitDesktopLibraryFeedItemAnalysisSets } from "./sqlite-library";

const MAXIMUM_SAMPLE_ITEMS = 500;
const SOCIAL_PLATFORMS = new Set([
  "x", "facebook", "instagram", "linkedin", "reddit", "mastodon", "medium", "substack",
]);

type PreviewItem = FeedItem & { __deleted?: boolean };
interface PreviewLibrary {
  items: Record<string, PreviewItem | undefined>;
  accounts?: Record<string, (Account & { __deleted?: boolean }) | undefined>;
  persons?: Record<string, (Person & { __deleted?: boolean }) | undefined>;
}

let applyTail: Promise<void> = Promise.resolve();

function previewLibrary(): PreviewLibrary {
  if (!import.meta.env.DEV || import.meta.env.VITE_TEST_TAURI !== "1" ||
      import.meta.env.VITE_FREED_FEATURE_PREVIEW !== "1") {
    throw new Error("Jev classification is available only in the mocked feature preview.");
  }
  const previewWindow = window as Window & {
    __TAURI_MOCK_BOOTSTRAPPED__?: boolean;
    __TAURI_MOCK_SQLITE_LIBRARY__?: PreviewLibrary;
  };
  if (!previewWindow.__TAURI_MOCK_BOOTSTRAPPED__ ||
      !previewWindow.__TAURI_MOCK_SQLITE_LIBRARY__?.items) {
    throw new Error("The sample preview library is not ready.");
  }
  return previewWindow.__TAURI_MOCK_SQLITE_LIBRARY__;
}

function isSampleFingerprint(fingerprint: SampleDataFingerprint | undefined): fingerprint is SampleDataFingerprint {
  return Boolean(fingerprint &&
    fingerprint.marker === "freed.sample-data.v1" &&
    typeof fingerprint.batchId === "string" && fingerprint.batchId.length > 0 &&
    Number.isSafeInteger(fingerprint.generatedAt) && fingerprint.generatedAt >= 0 &&
    Number.isSafeInteger(fingerprint.generatorVersion) && fingerprint.generatorVersion >= 0);
}

function isSampleItem(item: PreviewItem | undefined): item is PreviewItem {
  return Boolean(item && !item.__deleted && isSampleFingerprint(item.sampleDataFingerprint));
}

function sameSampleFingerprint(left: SampleDataFingerprint, right: SampleDataFingerprint): boolean {
  return left.marker === right.marker && left.batchId === right.batchId &&
    left.generatedAt === right.generatedAt && left.generatorVersion === right.generatorVersion;
}

/**
 * Reads only synthetic records from the explicitly mocked preview runtime.
 * Production item detail omits complete analysis and source evidence, so it
 * cannot safely serve this demo's replacement writes. A native integration
 * needs its own bounded evidence and analysis reader before activation.
 */
export async function loadJevPreviewSample(limit = MAXIMUM_SAMPLE_ITEMS): Promise<FeedItem[]> {
  const library = previewLibrary();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_SAMPLE_ITEMS) {
    throw new Error("The sample size must be between 1 and 500.");
  }
  // Yield before traversal; retain at most 500 IDs, never a copied corpus.
  await Promise.resolve();
  const buckets = new Map<string, string[]>();
  let retained = 0;
  for (const id in library.items) {
    if (!Object.hasOwn(library.items, id)) continue;
    const item = library.items[id];
    // Check provenance before touching any source text or media.
    if (!isSampleItem(item) || item.globalId !== id || !SOCIAL_PLATFORMS.has(item.platform) ||
        (item.contentType !== "post" && item.contentType !== "story")) continue;
    const key = `${item.platform}:${item.contentType}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    if (retained < limit) {
      bucket.push(id);
      retained += 1;
      continue;
    }
    let largest = bucket;
    for (const candidate of buckets.values()) {
      if (candidate.length > largest.length) largest = candidate;
    }
    // Later, less common platform/format pairs displace overrepresented ones.
    if (largest.length > bucket.length + 1) {
      largest.pop();
      bucket.push(id);
    }
  }
  const result: FeedItem[] = [];
  for (let ordinal = 0; result.length < retained; ordinal += 1) {
    for (const ids of buckets.values()) {
      const id = ids[ordinal];
      if (id === undefined) continue;
      const item = library.items[id];
      if (!isSampleItem(item)) {
        throw new Error("The sample library changed. Load the sample again.");
      }
      result.push(structuredClone(item));
    }
  }
  return result;
}

/** Reads declared relationships for the bounded synthetic sample, never profile guesses. */
export async function loadJevPreviewRelationships(
  items: readonly FeedItem[],
): Promise<Record<string, { kind: "friend" | "connection" | "unknown"; name?: string }>> {
  const library = previewLibrary();
  if (items.length > MAXIMUM_SAMPLE_ITEMS) {
    throw new Error("Relationship lookup accepts at most 500 sample items.");
  }
  await Promise.resolve();
  const relationships: Record<string, { kind: "friend" | "connection" | "unknown"; name?: string }> = Object.create(null);
  for (const original of items) {
    relationships[original.globalId] = { kind: "unknown" };
    if (!isSampleItem(original)) continue;
    const current = library.items[original.globalId];
    if (!isSampleItem(current) || current.globalId !== original.globalId ||
        !sameSampleFingerprint(current.sampleDataFingerprint!, original.sampleDataFingerprint!) ||
        current.platform !== original.platform || current.author?.id !== original.author?.id ||
        !SOCIAL_PLATFORMS.has(current.platform) || !current.author?.id) continue;

    // Generated/discovered social accounts use this exact key. Missing records
    // remain unknown; display-name similarity must never invent a relationship.
    const accountId = `social:${current.platform}:${current.author.id}`;
    const account = library.accounts?.[accountId];
    if (!account || account.__deleted || !isSampleFingerprint(account.sampleDataFingerprint) ||
        !sameSampleFingerprint(account.sampleDataFingerprint, current.sampleDataFingerprint!) ||
        account.id !== accountId || account.kind !== "social" ||
        account.provider !== current.platform || account.externalId !== current.author.id ||
        typeof account.personId !== "string" || !account.personId) continue;
    const person = library.persons?.[account.personId];
    if (!person || person.__deleted || !isSampleFingerprint(person.sampleDataFingerprint) ||
        !sameSampleFingerprint(person.sampleDataFingerprint, current.sampleDataFingerprint!) ||
        person.id !== account.personId ||
        (person.relationshipStatus !== "friend" && person.relationshipStatus !== "connection") ||
        typeof person.name !== "string" || !person.name.trim() || person.name.length > 512) continue;
    relationships[original.globalId] = { kind: person.relationshipStatus, name: person.name };
  }
  return relationships;
}

/** Commits one result; the caller refreshes visible Library windows after its run. */
export async function applyJevPreviewSignals(
  original: FeedItem,
  signals: ContentSignals,
): Promise<void> {
  previewLibrary();
  if (!isSampleItem(original)) {
    throw new Error("Jev preview accepts generated sample items only.");
  }
  const signature = JSON.stringify(buildJevRequest(original));
  const result = applyTail.then(async () => {
    const current = previewLibrary().items[original.globalId];
    if (!isSampleItem(current) || current.globalId !== original.globalId) {
      throw new Error("The sample item was removed or replaced. Load the sample again.");
    }
    if (JSON.stringify(current.sampleDataFingerprint) !==
        JSON.stringify(original.sampleDataFingerprint) ||
        JSON.stringify(buildJevRequest(current)) !== signature) {
      throw new Error("The sample text or media evidence changed. Classify this item again.");
    }
    // Network requests have already completed. Serialize reread and commit so
    // concurrent results preserve the current complete event candidate without
    // rejecting each other's unrelated changes to the Library revision.
    await commitDesktopLibraryFeedItemAnalysisSets([{
      entityId: current.globalId,
      contentSignals: signals,
      eventCandidate: current.eventCandidate ? structuredClone(current.eventCandidate) : undefined,
    }], Date.now());
  });
  applyTail = result.catch(() => {});
  return result;
}

/** Publishes completed writes once, including successful work before cancellation. */
export async function refreshJevPreviewLibrary(): Promise<void> {
  previewLibrary();
  await applyTail;
  // Mock commits have no compact change feed. Reloading after every item would
  // launch a full reset and avatar backfill for every classification result.
  await reloadSqliteLibraryState();
}
