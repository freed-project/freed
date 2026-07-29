import type {
  Account,
  AIPreferences,
  Author,
  Content,
  ContentSignal,
  ContentSignals,
  DesktopClientRegistration,
  DisplayPreferences,
  DocumentMeta,
  Engagement,
  EventCandidate,
  FacebookCapturePreferences,
  FbGroupInfo,
  FeedItem,
  FriendSuggestionPreferences,
  Highlight,
  LegacyDeviceContact,
  LegacyFriendSource,
  LinkPreview,
  Location,
  Person,
  PreservedContent,
  ReachOutLog,
  ReadingEnhancements,
  RssFeed,
  RssSourceInfo,
  SampleDataFingerprint,
  StoryWallPreferences,
  StoryWallPublishTarget,
  StoryWallStylePreferences,
  SyncPreferences,
  TimeRange,
  UlyssesPreferences,
  UserPreferences,
  UserState,
  WeightPreferences,
  XAccount,
  XCapturePreferences,
} from "../types.js";
import type {
  DesktopClientKeyPrefix,
  FreedDoc,
  LegacyFriend,
} from "../schema.js";
import type {
  LibraryCoreActivationBlocker,
  LibraryCoreCurrentAuthority,
  LibraryCoreCurrentLocality,
  LibraryCoreEntity,
  LibraryCoreFieldRegistryEntry,
  LibraryCoreLegacyDisposition,
  LibraryCorePathPattern,
  LibraryCorePathSegment,
  LibraryCorePresence,
  LibraryCoreRootRegistryEntry,
} from "./protocol-registry.js";
import {
  FEED_ITEM_READ_AT_FIELD_ALGEBRA,
  LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY,
} from "./operation-field-algebra-contracts.js";

type Primitive = string | number | boolean;

type LegacyValueShapeFor<T> = T extends string
  ? "typescript-string"
  : T extends number
    ? "typescript-number"
    : T extends boolean
      ? "typescript-boolean"
      : never;

type CodecFor<T> = T extends number
  ? null
  : T extends string
    ? null
    : T extends boolean
      ? "boolean"
      : never;

type AllowedValuesFor<T> = T extends string
  ? null
  : { readonly kind: "not-applicable" };

type NumericRangeFor<T> = T extends number
  ? null
  : { readonly kind: "not-applicable" };

interface LeafNode<T> {
  readonly kind: "leaf";
  readonly legacyValueShape: LegacyValueShapeFor<T>;
  readonly codec: CodecFor<T>;
  readonly allowedValues: AllowedValuesFor<T>;
  readonly legacyDisposition: LibraryCoreLegacyDisposition;
  readonly currentLocality: LibraryCoreCurrentLocality;
  readonly currentAuthority: LibraryCoreCurrentAuthority;
  readonly numericRange: NumericRangeFor<T>;
}

interface ArrayNode<T> {
  readonly kind: "array";
  readonly element: ValueNode<T>;
}

interface DynamicMapNode<T> {
  readonly kind: "dynamic-map";
  readonly keyName: string;
  readonly value: ValueNode<T>;
}

interface FixedMapNode<T extends object> {
  readonly kind: "fixed-map";
  readonly keyName: string;
  readonly keys: { readonly [K in keyof T]-?: true };
  readonly keyPresence: undefined extends T[keyof T] ? "optional" : "required";
  readonly value: ValueNode<NonNullable<T[keyof T]>>;
}

interface ExactKeyIdentity<Keys extends PropertyKey> {
  readonly input: (key: Keys) => void;
  readonly output: Keys;
}

const exactObjectKeysSymbol = Symbol("library-core-exact-object-keys");

interface ObjectNode<T extends object> {
  readonly kind: "object";
  readonly [exactObjectKeysSymbol]: ExactKeyIdentity<keyof T>;
  readonly fields: {
    readonly [K in keyof T]-?: PropertyNode<T[K]>;
  };
}

type Defined<T> = Exclude<T, undefined>;

type ValueNode<T> = null extends T
  ? never
  : Defined<T> extends Primitive
    ? LeafNode<Defined<T>>
    : Defined<T> extends readonly (infer Element)[]
      ? ArrayNode<Element>
      : Defined<T> extends object
        ? string extends keyof Defined<T>
          ? DynamicMapNode<Defined<T>[string]>
          : ObjectNode<Defined<T>> | FixedMapNode<Defined<T>>
        : never;

type PropertyNode<T> = undefined extends T
  ? {
      readonly presence: "optional";
      readonly value: ValueNode<T>;
    }
  : {
      readonly presence: "required";
      readonly value: ValueNode<T>;
    };

type RuntimeValueNode =
  | LeafNode<Primitive>
  | {
      readonly kind: "array";
      readonly element: RuntimeValueNode;
    }
  | {
      readonly kind: "dynamic-map";
      readonly keyName: string;
      readonly value: RuntimeValueNode;
    }
  | {
      readonly kind: "fixed-map";
      readonly keyName: string;
      readonly keys: Readonly<Record<string, true>>;
      readonly keyPresence: LibraryCorePresence;
      readonly value: RuntimeValueNode;
    }
  | {
      readonly kind: "object";
      readonly [exactObjectKeysSymbol]: ExactKeyIdentity<PropertyKey>;
      readonly fields: Readonly<
        Record<
          string,
          {
            readonly presence: LibraryCorePresence;
            readonly value: RuntimeValueNode;
          }
        >
      >;
    };

const unresolvedFutureSemantics = null;

const authorityFor = (
  locality: LibraryCoreCurrentLocality,
): LibraryCoreCurrentAuthority => {
  switch (locality) {
    case "legacy-synchronized":
      return "legacy-automerge-document";
    case "legacy-device-local":
      return "installation-local-store";
    case "legacy-derived":
      return "derived-runtime";
    case "legacy-compatibility":
      return "legacy-automerge-read-only";
  }
};

const localityFor = (
  disposition: LibraryCoreLegacyDisposition,
): LibraryCoreCurrentLocality => {
  switch (disposition) {
    case "sync":
    case "positive-sync":
      return "legacy-synchronized";
    case "device-local":
      return "legacy-device-local";
    case "compatibility-only":
      return "legacy-compatibility";
  }
};

const leaf = <
  Token extends "typescript-string" | "typescript-number" | "boolean",
  Disposition extends LibraryCoreLegacyDisposition,
>(
  token: Token,
  legacyDisposition: Disposition,
  _futureSemantics: null,
  currentLocality: LibraryCoreCurrentLocality = localityFor(legacyDisposition),
): {
  readonly kind: "leaf";
  readonly legacyValueShape: Token extends "typescript-number"
    ? "typescript-number"
    : Token extends "boolean"
      ? "typescript-boolean"
      : "typescript-string";
  readonly codec: Token extends "boolean" ? "boolean" : null;
  readonly allowedValues: Token extends "typescript-string"
    ? null
    : { readonly kind: "not-applicable" };
  readonly legacyDisposition: Disposition;
  readonly currentLocality: LibraryCoreCurrentLocality;
  readonly currentAuthority: LibraryCoreCurrentAuthority;
  readonly numericRange: Token extends "typescript-number"
    ? null
    : { readonly kind: "not-applicable" };
} =>
  ({
    kind: "leaf",
    legacyValueShape:
      token === "typescript-number"
        ? "typescript-number"
        : token === "boolean"
          ? "typescript-boolean"
          : "typescript-string",
    codec: token === "boolean" ? token : null,
    allowedValues:
      token === "typescript-string" ? null : { kind: "not-applicable" },
    legacyDisposition,
    currentLocality,
    currentAuthority: authorityFor(currentLocality),
    numericRange:
      token === "typescript-number" ? null : { kind: "not-applicable" },
  }) as never;

const required = <Node>(value: Node) =>
  ({ presence: "required", value }) as const;

const optional = <Node>(value: Node) =>
  ({ presence: "optional", value }) as const;

const object = <Fields extends object>(fields: Fields) =>
  ({
    kind: "object",
    [exactObjectKeysSymbol]: null as unknown as ExactKeyIdentity<keyof Fields>,
    fields,
  }) as const;

const array = <Element>(element: Element) =>
  ({ kind: "array", element }) as const;

const dynamicMap = <Value>(keyName: string, value: Value) =>
  ({ kind: "dynamic-map", keyName, value }) as const;

const fixedMap = <Keys, Presence extends LibraryCorePresence, Value>(
  keyName: string,
  keys: Keys,
  keyPresence: Presence,
  value: Value,
) => ({ kind: "fixed-map", keyName, keys, keyPresence, value }) as const;

const exactKeyObject =
  <Expected extends PropertyKey>() =>
  <Actual extends Record<Expected, unknown>>(
    value: Actual & Record<Exclude<keyof Actual, Expected>, never>,
  ): Actual =>
    value;

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const desktopClientKeyPrefix: DesktopClientKeyPrefix = "desktopClient:";

const sortBlockers = (
  blockers: readonly LibraryCoreActivationBlocker[],
): readonly LibraryCoreActivationBlocker[] =>
  [...blockers].sort(compareCodeUnits);

const fingerprintSchema = object({
  marker: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  batchId: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  generatedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  generatorVersion: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<SampleDataFingerprint>;

const authorSchema = object({
  id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  handle: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  displayName: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  avatarUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<Author>;

const linkPreviewSchema = object({
  url: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  title: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  description: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<LinkPreview>;

const contentSchema = object({
  text: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  mediaUrls: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  mediaTypes: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  linkPreview: optional(linkPreviewSchema),
}) satisfies ObjectNode<Content>;

const engagementSchema = object({
  likes: optional(leaf("typescript-number", "sync", unresolvedFutureSemantics)),
  reposts: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  comments: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  views: optional(leaf("typescript-number", "sync", unresolvedFutureSemantics)),
}) satisfies ObjectNode<Engagement>;

const locationSchema = object({
  name: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  coordinates: optional(
    object({
      lat: required(
        leaf("typescript-number", "sync", unresolvedFutureSemantics),
      ),
      lng: required(
        leaf("typescript-number", "sync", unresolvedFutureSemantics),
      ),
    }),
  ),
  url: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  source: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<Location>;

const timeRangeSchema = object({
  startsAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  endsAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  kind: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
}) satisfies ObjectNode<TimeRange>;

const rssSourceSchema = object({
  feedUrl: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  feedTitle: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  siteUrl: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<RssSourceInfo>;

const fbGroupSchema = object({
  id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  name: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  url: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
}) satisfies ObjectNode<FbGroupInfo>;

const preservedContentSchema = object({
  html: optional(
    leaf(
      "typescript-string",
      "compatibility-only",
      unresolvedFutureSemantics,
      "legacy-compatibility",
    ),
  ),
  text: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  author: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  publishedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  wordCount: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  readingTime: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  preservedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<PreservedContent>;

const highlightSchema = object({
  text: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  note: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  createdAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<Highlight>;

const userStateSchema = object({
  hidden: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  readAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  saved: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  savedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  archived: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  archivedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  tags: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  highlights: optional(array(highlightSchema)),
  liked: optional(leaf("boolean", "sync", unresolvedFutureSemantics)),
  likedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  likedSyncedAt: optional(
    leaf("typescript-number", "positive-sync", unresolvedFutureSemantics),
  ),
  seenSyncedAt: optional(
    leaf("typescript-number", "positive-sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<UserState>;

const contentSignalKeySet = exactKeyObject<ContentSignal>()({
  event: true,
  deadline: true,
  opportunity: true,
  how_to: true,
  reference: true,
  transaction: true,
  product_update: true,
  alert: true,
  deal: true,
  place: true,
  media: true,
  essay: true,
  moment: true,
  life_update: true,
  announcement: true,
  recommendation: true,
  request: true,
  discussion: true,
  promotion: true,
  news: true,
} as const);

const contentSignalsSchema = object({
  version: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  method: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  inferredAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  scores: required(
    fixedMap(
      "contentSignal",
      contentSignalKeySet,
      "optional",
      leaf("typescript-number", "sync", unresolvedFutureSemantics),
    ),
  ),
  tags: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
}) satisfies ObjectNode<ContentSignals>;

const eventCandidateSchema = object({
  version: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  method: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  detectedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  confidence: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  title: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  startsAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  endsAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  timezone: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  locationName: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  locationUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  evidence: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<EventCandidate>;

const feedItemSchema = object({
  globalId: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  platform: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  contentType: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  capturedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  publishedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  author: required(authorSchema),
  content: required(contentSchema),
  engagement: optional(engagementSchema),
  location: optional(locationSchema),
  timeRange: optional(timeRangeSchema),
  rssSource: optional(rssSourceSchema),
  fbGroup: optional(fbGroupSchema),
  preservedContent: optional(preservedContentSchema),
  userState: required(userStateSchema),
  topics: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  contentSignals: optional(contentSignalsSchema),
  eventCandidate: optional(eventCandidateSchema),
  priority: optional(
    leaf(
      "typescript-number",
      "device-local",
      unresolvedFutureSemantics,
      "legacy-derived",
    ),
  ),
  priorityComputedAt: optional(
    leaf(
      "typescript-number",
      "device-local",
      unresolvedFutureSemantics,
      "legacy-derived",
    ),
  ),
  sourceUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  sampleDataFingerprint: optional(fingerprintSchema),
}) satisfies ObjectNode<FeedItem>;

const rssFeedSchema = object({
  url: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  title: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  siteUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  lastFetched: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  lastFetchAttemptedAt: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  nextFetchAfter: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  consecutiveFailures: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  lastFetchError: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  etag: optional(
    leaf("typescript-string", "compatibility-only", unresolvedFutureSemantics),
  ),
  lastModified: optional(
    leaf("typescript-string", "compatibility-only", unresolvedFutureSemantics),
  ),
  imageUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  enabled: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  pollInterval: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  trackUnread: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  folder: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  sampleDataFingerprint: optional(fingerprintSchema),
}) satisfies ObjectNode<RssFeed>;

const reachOutLogSchema = object({
  loggedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  channel: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  notes: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
}) satisfies ObjectNode<ReachOutLog>;

const personSchema = object({
  id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  name: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  avatarUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  bio: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  relationshipStatus: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  careLevel: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  reachOutIntervalDays: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  reachOutLog: optional(array(reachOutLogSchema)),
  tags: optional(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  notes: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  graphX: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  graphY: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  graphPinned: optional(
    leaf("boolean", "device-local", unresolvedFutureSemantics),
  ),
  graphUpdatedAt: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  sampleDataFingerprint: optional(fingerprintSchema),
  createdAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  updatedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<Person>;

const accountSchema = object({
  id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  personId: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  kind: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  provider: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  externalId: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  handle: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  displayName: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  avatarUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  profileUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  email: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  phone: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  address: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  importedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  firstSeenAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  lastSeenAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  discoveredFrom: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  followRosterActive: optional(
    leaf("boolean", "sync", unresolvedFutureSemantics),
  ),
  followRosterSyncedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  followRosterRoles: optional(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  graphX: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  graphY: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  graphPinned: optional(
    leaf("boolean", "device-local", unresolvedFutureSemantics),
  ),
  graphUpdatedAt: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  sampleDataFingerprint: optional(fingerprintSchema),
  createdAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  updatedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<Account>;

const legacyFriendSourceSchema = object({
  platform: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  authorId: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  handle: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  displayName: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  avatarUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  profileUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<LegacyFriendSource>;

const legacyDeviceContactSchema = object({
  importedFrom: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  name: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  phone: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  email: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  address: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  nativeId: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  importedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<LegacyDeviceContact>;

const friendSchema = object({
  id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  name: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  avatarUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  bio: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  sources: required(array(legacyFriendSourceSchema)),
  contact: optional(legacyDeviceContactSchema),
  careLevel: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  reachOutIntervalDays: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  reachOutLog: optional(array(reachOutLogSchema)),
  tags: optional(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  notes: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  createdAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  updatedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<LegacyFriend>;

const weightPreferencesSchema = object({
  recency: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  platforms: required(
    dynamicMap(
      "platform",
      leaf("typescript-number", "sync", unresolvedFutureSemantics),
    ),
  ),
  topics: required(
    dynamicMap(
      "topic",
      leaf("typescript-number", "sync", unresolvedFutureSemantics),
    ),
  ),
  authors: required(
    dynamicMap(
      "authorId",
      leaf("typescript-number", "sync", unresolvedFutureSemantics),
    ),
  ),
}) satisfies ObjectNode<WeightPreferences>;

const ulyssesPreferencesSchema = object({
  enabled: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  blockedPlatforms: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  allowedPaths: required(
    dynamicMap(
      "platform",
      array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
    ),
  ),
}) satisfies ObjectNode<UlyssesPreferences>;

const syncPreferencesSchema = object({
  cloudProvider: optional(
    leaf("typescript-string", "compatibility-only", unresolvedFutureSemantics),
  ),
  autoBackup: required(
    leaf("boolean", "compatibility-only", unresolvedFutureSemantics),
  ),
  backupFrequency: optional(
    leaf("typescript-string", "compatibility-only", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<SyncPreferences>;

const readingEnhancementsSchema = object({
  focusMode: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  focusIntensity: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  markReadOnScroll: required(
    leaf("boolean", "sync", unresolvedFutureSemantics),
  ),
  showReadInGrayscale: required(
    leaf("boolean", "sync", unresolvedFutureSemantics),
  ),
  dualColumnMode: optional(
    leaf("boolean", "device-local", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<ReadingEnhancements>;

const displayPreferencesSchema = object({
  itemsPerPage: optional(
    leaf("typescript-number", "compatibility-only", unresolvedFutureSemantics),
  ),
  compactMode: optional(
    leaf("boolean", "compatibility-only", unresolvedFutureSemantics),
  ),
  themeId: required(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  showEngagementCounts: required(
    leaf("boolean", "sync", unresolvedFutureSemantics),
  ),
  animationIntensity: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  reading: required(readingEnhancementsSchema),
  sidebarWidth: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  sidebarMode: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  friendsSidebarWidth: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  friendsSidebarOpen: optional(
    leaf("boolean", "device-local", unresolvedFutureSemantics),
  ),
  friendsMode: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  friendAvatarTint: optional(
    leaf("typescript-string", "compatibility-only", unresolvedFutureSemantics),
  ),
  debugPanelWidth: optional(
    leaf("typescript-number", "device-local", unresolvedFutureSemantics),
  ),
  mapMode: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  mapTimeMode: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  feedSignalMode: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  feedSignalModes: optional(
    array(leaf("typescript-string", "device-local", unresolvedFutureSemantics)),
  ),
  savedContentSortMode: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  archivePruneDays: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<DisplayPreferences>;

const xAccountSchema = object({
  id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  handle: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  displayName: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  avatarUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  addedAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  note: optional(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
}) satisfies ObjectNode<XAccount>;

const xCapturePreferencesSchema = object({
  mode: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  whitelist: required(dynamicMap("accountId", xAccountSchema)),
  blacklist: required(dynamicMap("accountId", xAccountSchema)),
  includeRetweets: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  includeReplies: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
}) satisfies ObjectNode<XCapturePreferences>;

const facebookCapturePreferencesSchema = object({
  knownGroups: optional(
    dynamicMap(
      "groupId",
      object({
        id: required(
          leaf("typescript-string", "device-local", unresolvedFutureSemantics),
        ),
        name: required(
          leaf("typescript-string", "device-local", unresolvedFutureSemantics),
        ),
        url: required(
          leaf("typescript-string", "device-local", unresolvedFutureSemantics),
        ),
      }) satisfies ObjectNode<FbGroupInfo>,
    ),
  ),
  excludedGroupIds: required(
    dynamicMap("groupId", leaf("boolean", "sync", unresolvedFutureSemantics)),
  ),
}) satisfies ObjectNode<FacebookCapturePreferences>;

const friendSuggestionPreferencesSchema = object({
  dismissedSuggestionIds: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
}) satisfies ObjectNode<FriendSuggestionPreferences>;

const aiPreferencesSchema = object({
  provider: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  model: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  ollamaUrl: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  autoSummarize: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  extractTopics: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
}) satisfies ObjectNode<AIPreferences>;

const storyWallStyleSchema = object({
  palette: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  typographyScale: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  mediaDensity: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  captionsEnabled: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  locationGroupingEnabled: required(
    leaf("boolean", "sync", unresolvedFutureSemantics),
  ),
  dateGroupingEnabled: required(
    leaf("boolean", "sync", unresolvedFutureSemantics),
  ),
  motionLevel: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<StoryWallStylePreferences>;

const storyWallPublishTargetSchema = object({
  provider: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  repoName: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  branch: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  directory: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  pagesUrl: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  lastPublishedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
  lastError: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
  status: optional(
    leaf("typescript-string", "device-local", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<StoryWallPublishTarget>;

const storyWallPreferencesSchema = object({
  enabled: required(leaf("boolean", "sync", unresolvedFutureSemantics)),
  selectedYears: required(
    array(leaf("typescript-number", "sync", unresolvedFutureSemantics)),
  ),
  includedPlatforms: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  includedAccountIds: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  visibilityDefault: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  layoutPreset: required(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  style: required(storyWallStyleSchema),
  embedModeEnabled: required(
    leaf("boolean", "sync", unresolvedFutureSemantics),
  ),
  publishTarget: required(storyWallPublishTargetSchema),
  featuredItemIds: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  hiddenItemIds: required(
    array(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  ),
  lastReviewedAt: optional(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<StoryWallPreferences>;

const userPreferencesSchema = object({
  weights: required(weightPreferencesSchema),
  ulysses: required(ulyssesPreferencesSchema),
  sync: optional(syncPreferencesSchema),
  display: required(displayPreferencesSchema),
  xCapture: required(xCapturePreferencesSchema),
  fbCapture: required(facebookCapturePreferencesSchema),
  friendSuggestions: required(friendSuggestionPreferencesSchema),
  ai: required(aiPreferencesSchema),
  storyWall: required(storyWallPreferencesSchema),
}) satisfies ObjectNode<UserPreferences>;

const documentMetaSchema = object({
  documentId: optional(
    leaf("typescript-string", "sync", unresolvedFutureSemantics),
  ),
  deviceId: optional(
    leaf("typescript-string", "compatibility-only", unresolvedFutureSemantics),
  ),
  lastSync: optional(
    leaf("typescript-number", "compatibility-only", unresolvedFutureSemantics),
  ),
  version: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<DocumentMeta>;

const desktopClientRegistrationSchema = object({
  id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
  registeredAt: required(
    leaf("typescript-number", "sync", unresolvedFutureSemantics),
  ),
}) satisfies ObjectNode<DesktopClientRegistration>;

/*
 * These unreachable assignments make schema drift a compile failure. The
 * exact-key identity rejects stale nested keys, and nullable additions require
 * an explicit registry model instead of silently inheriting a leaf codec.
 */
if (false) {
  const staleDesktopClientSchema = object({
    id: required(leaf("typescript-string", "sync", unresolvedFutureSemantics)),
    registeredAt: required(
      leaf("typescript-number", "sync", unresolvedFutureSemantics),
    ),
    stale: required(
      leaf("typescript-string", "sync", unresolvedFutureSemantics),
    ),
  });
  // @ts-expect-error Extra nested keys must not satisfy a registered object.
  const exactDesktopClientSchema: ObjectNode<DesktopClientRegistration> =
    staleDesktopClientSchema;

  interface NullableFieldFixture {
    value: string | null;
  }
  const unmodeledNullableSchema = object({
    value: required(
      leaf("typescript-string", "sync", unresolvedFutureSemantics),
    ),
  });
  // @ts-expect-error Nullable fields require an explicit registry node.
  const exactNullableSchema: ObjectNode<NullableFieldFixture> =
    unmodeledNullableSchema;

  void exactDesktopClientSchema;
  void exactNullableSchema;
}

interface RootSchema<T extends object = object> {
  readonly root: Exclude<
    LibraryCoreFieldRegistryEntry["root"],
    "<unknown-root>"
  >;
  readonly entity: LibraryCoreEntity;
  readonly baseSegments: readonly LibraryCorePathSegment[];
  readonly schema: ObjectNode<T>;
  readonly currentLocalityOverride?: LibraryCoreCurrentLocality;
  readonly currentAuthorityOverride?: LibraryCoreCurrentAuthority;
  readonly additionalBlockers?: readonly LibraryCoreActivationBlocker[];
}

type StaticRootSchemas = {
  readonly feedItems: RootSchema<FeedItem>;
  readonly rssFeeds: RootSchema<RssFeed>;
  readonly persons: RootSchema<Person>;
  readonly accounts: RootSchema<Account>;
  readonly preferences: RootSchema<UserPreferences>;
  readonly meta: RootSchema<DocumentMeta>;
};

const staticRootSchemas = exactKeyObject<keyof FreedDoc>()({
  feedItems: {
    root: "feedItems",
    entity: "FeedItem",
    baseSegments: [
      { kind: "property", name: "feedItems" },
      { kind: "entity-key", name: "globalId" },
    ],
    schema: feedItemSchema,
  },
  rssFeeds: {
    root: "rssFeeds",
    entity: "RssFeed",
    baseSegments: [
      { kind: "property", name: "rssFeeds" },
      { kind: "entity-key", name: "url" },
    ],
    schema: rssFeedSchema,
  },
  persons: {
    root: "persons",
    entity: "Person",
    baseSegments: [
      { kind: "property", name: "persons" },
      { kind: "entity-key", name: "personId" },
    ],
    schema: personSchema,
  },
  accounts: {
    root: "accounts",
    entity: "Account",
    baseSegments: [
      { kind: "property", name: "accounts" },
      { kind: "entity-key", name: "accountId" },
    ],
    schema: accountSchema,
  },
  preferences: {
    root: "preferences",
    entity: "UserPreferences",
    baseSegments: [{ kind: "property", name: "preferences" }],
    schema: userPreferencesSchema,
  },
  meta: {
    root: "meta",
    entity: "DocumentMeta",
    baseSegments: [{ kind: "property", name: "meta" }],
    schema: documentMetaSchema,
  },
} as const satisfies StaticRootSchemas);

const desktopClientRootSchema = {
  root: "desktopClient:*",
  entity: "DesktopClientRegistration",
  baseSegments: [
    {
      kind: "dynamic-root-key",
      prefix: desktopClientKeyPrefix,
      name: "installationId",
    },
  ],
  schema: desktopClientRegistrationSchema,
} as const satisfies RootSchema<DesktopClientRegistration>;

const friendRootSchema = {
  root: "friends",
  entity: "LegacyFriend",
  baseSegments: [
    { kind: "property", name: "friends" },
    { kind: "entity-key", name: "friendId" },
  ],
  schema: friendSchema,
  currentLocalityOverride: "legacy-compatibility",
  currentAuthorityOverride: "legacy-automerge-read-only",
  additionalBlockers: ["legacy_root_requires_migration"],
} as const satisfies RootSchema<LegacyFriend>;

const rootSchemas = [
  ...Object.keys(staticRootSchemas)
    .sort(compareCodeUnits)
    .map(
      (root) =>
        staticRootSchemas[
          root as keyof typeof staticRootSchemas
        ] as unknown as RootSchema,
    ),
  desktopClientRootSchema as unknown as RootSchema,
  friendRootSchema as unknown as RootSchema,
];

const pathText = (segments: readonly LibraryCorePathSegment[]): string =>
  segments
    .map((segment) => {
      switch (segment.kind) {
        case "property":
          return segment.name;
        case "entity-key":
        case "dynamic-map-key":
          return `{${segment.name}}`;
        case "fixed-map-key":
          return `{${segment.name}:${segment.allowedKeys.join("|")}}`;
        case "array-element":
          return "[]";
        case "dynamic-root-key":
          return `${segment.prefix}{${segment.name}}`;
        case "unregistered-descendant":
          return "<unregistered-descendant:**>";
        case "unknown-root":
          return "<unknown-root>";
      }
    })
    .reduce(
      (text, part) =>
        part === "[]"
          ? `${text}[]`
          : text.length === 0
            ? part
            : `${text}.${part}`,
      "",
    );

const pattern = (
  segments: readonly LibraryCorePathSegment[],
): LibraryCorePathPattern => ({
  text: pathText(segments),
  segments,
});

const unresolvedProtocolBlockers = [
  "allowed_operations_undecided",
  "backup_behavior_undecided",
  "delete_behavior_undecided",
  "executable_validation_undecided",
  "explicit_clear_undecided",
  "export_behavior_undecided",
  "legacy_migration_rule_undecided",
  "materialized_projection_undecided",
  "merge_algebra_undecided",
  "omission_semantics_undecided",
  "planned_authority_undecided",
  "planned_locality_undecided",
  "provenance_behavior_undecided",
  "query_eligibility_undecided",
  "redaction_behavior_undecided",
  "relationship_cascade_undecided",
  "restore_semantics_undecided",
  "storage_tier_undecided",
] as const satisfies readonly LibraryCoreActivationBlocker[];

const blockersFor = (
  leafNode: LeafNode<Primitive>,
): readonly LibraryCoreActivationBlocker[] => [
  ...unresolvedProtocolBlockers,
  ...(leafNode.allowedValues === null
    ? (["allowed_values_undecided"] as const)
    : []),
  ...(leafNode.codec === null ? (["protocol_codec_undecided"] as const) : []),
  ...(leafNode.numericRange === null
    ? (["field_range_undecided"] as const)
    : []),
];

const entryFor = (
  root: Exclude<LibraryCoreFieldRegistryEntry["root"], "<unknown-root>">,
  entity: LibraryCoreEntity,
  pathSegments: readonly LibraryCorePathSegment[],
  localPresence: LibraryCorePresence,
  ancestorOptional: boolean,
  leafNode: LeafNode<Primitive>,
  currentLocalityOverride?: LibraryCoreCurrentLocality,
  currentAuthorityOverride?: LibraryCoreCurrentAuthority,
  additionalBlockers: readonly LibraryCoreActivationBlocker[] = [],
): LibraryCoreFieldRegistryEntry => {
  const fieldPath = pattern(pathSegments);
  return {
    registryKey: `library-core-v1:${fieldPath.text}`,
    root,
    entity,
    path: fieldPath,
    legacyValueShape: leafNode.legacyValueShape,
    valueCodec: leafNode.codec,
    allowedValues: leafNode.allowedValues,
    localPresence,
    ancestorOptional,
    nullable: false,
    currentValidation: {
      kind: "typescript-shape-census",
      schema: `${entity}:${fieldPath.text}`,
    },
    executableValidation: null,
    currentLocality: currentLocalityOverride ?? leafNode.currentLocality,
    currentAuthority: currentAuthorityOverride ?? leafNode.currentAuthority,
    plannedLocality: null,
    plannedAuthority: null,
    legacyDisposition: leafNode.legacyDisposition,
    numericRange: leafNode.numericRange,
    storageTier: null,
    allowedOperationTypes: null,
    mergeAlgebra: null,
    omissionSemantics: null,
    explicitClear: null,
    deleteBehavior: null,
    restoreSemantics: null,
    relationshipCascade: null,
    legacySourcePaths: [fieldPath.text],
    opaqueRetention: null,
    migrationRule: null,
    backupBehavior: null,
    exportBehavior: null,
    redactionBehavior: null,
    provenanceBehavior: null,
    materializedProjection: null,
    queryEligible: null,
    activation: {
      status: "blocked",
      blockers: sortBlockers([...blockersFor(leafNode), ...additionalBlockers]),
    },
  };
};

const flattenValue = (
  output: LibraryCoreFieldRegistryEntry[],
  root: Exclude<LibraryCoreFieldRegistryEntry["root"], "<unknown-root>">,
  entity: LibraryCoreEntity,
  pathSegments: readonly LibraryCorePathSegment[],
  localPresence: LibraryCorePresence,
  ancestorOptional: boolean,
  node: RuntimeValueNode,
  currentLocalityOverride?: LibraryCoreCurrentLocality,
  currentAuthorityOverride?: LibraryCoreCurrentAuthority,
  additionalBlockers: readonly LibraryCoreActivationBlocker[] = [],
): void => {
  switch (node.kind) {
    case "leaf":
      output.push(
        entryFor(
          root,
          entity,
          pathSegments,
          localPresence,
          ancestorOptional,
          node as LeafNode<Primitive>,
          currentLocalityOverride,
          currentAuthorityOverride,
          additionalBlockers,
        ),
      );
      return;
    case "array":
      flattenValue(
        output,
        root,
        entity,
        [...pathSegments, { kind: "array-element" }],
        "required",
        ancestorOptional || localPresence === "optional",
        node.element,
        currentLocalityOverride,
        currentAuthorityOverride,
        additionalBlockers,
      );
      return;
    case "dynamic-map":
      flattenValue(
        output,
        root,
        entity,
        [...pathSegments, { kind: "dynamic-map-key", name: node.keyName }],
        "required",
        ancestorOptional || localPresence === "optional",
        node.value,
        currentLocalityOverride,
        currentAuthorityOverride,
        additionalBlockers,
      );
      return;
    case "fixed-map": {
      const allowedKeys = Object.keys(node.keys).sort(compareCodeUnits);
      flattenValue(
        output,
        root,
        entity,
        [
          ...pathSegments,
          { kind: "fixed-map-key", name: node.keyName, allowedKeys },
        ],
        node.keyPresence,
        ancestorOptional || localPresence === "optional",
        node.value,
        currentLocalityOverride,
        currentAuthorityOverride,
        additionalBlockers,
      );
      return;
    }
    case "object":
      for (const name of Object.keys(node.fields).sort(compareCodeUnits)) {
        const property = node.fields[name];
        flattenValue(
          output,
          root,
          entity,
          [...pathSegments, { kind: "property", name }],
          property.presence,
          ancestorOptional || localPresence === "optional",
          property.value,
          currentLocalityOverride,
          currentAuthorityOverride,
          additionalBlockers,
        );
      }
  }
};

const typedEntries: LibraryCoreFieldRegistryEntry[] = [];
for (const rootSchema of rootSchemas) {
  flattenValue(
    typedEntries,
    rootSchema.root,
    rootSchema.entity,
    rootSchema.baseSegments,
    "required",
    false,
    rootSchema.schema as unknown as RuntimeValueNode,
    rootSchema.currentLocalityOverride,
    rootSchema.currentAuthorityOverride,
    rootSchema.additionalBlockers,
  );
}

const opaqueEntry = (
  registryKey: string,
  root: LibraryCoreFieldRegistryEntry["root"],
  entity: LibraryCoreEntity,
  segments: readonly LibraryCorePathSegment[],
  blocker: Extract<
    LibraryCoreActivationBlocker,
    | "unknown_root_requires_classification"
    | "unregistered_descendant_requires_classification"
  >,
): LibraryCoreFieldRegistryEntry => ({
  registryKey,
  root,
  entity,
  path: pattern(segments),
  legacyValueShape: "unregistered-legacy-value",
  valueCodec: null,
  allowedValues: null,
  localPresence: null,
  ancestorOptional: null,
  nullable: true,
  currentValidation: {
    kind: "unregistered-legacy-shape",
    schema: "retained in the current legacy Automerge document",
  },
  executableValidation: null,
  currentLocality: "legacy-compatibility",
  currentAuthority: "legacy-automerge-read-only",
  plannedLocality: null,
  plannedAuthority: null,
  legacyDisposition: null,
  numericRange: null,
  storageTier: null,
  allowedOperationTypes: null,
  mergeAlgebra: null,
  omissionSemantics: null,
  explicitClear: null,
  deleteBehavior: null,
  restoreSemantics: null,
  relationshipCascade: null,
  legacySourcePaths: [pattern(segments).text],
  opaqueRetention: null,
  migrationRule: null,
  backupBehavior: null,
  exportBehavior: null,
  redactionBehavior: null,
  provenanceBehavior: null,
  materializedProjection: null,
  queryEligible: null,
  activation: {
    status: "blocked",
    blockers: sortBlockers([
      ...unresolvedProtocolBlockers,
      "allowed_values_undecided",
      "field_range_undecided",
      "opaque_retention_unimplemented",
      "presence_semantics_undecided",
      "protocol_codec_undecided",
      blocker,
    ]),
  },
});

const unregisteredDescendantEntries = rootSchemas.map((rootSchema) =>
  opaqueEntry(
    `library-core-v1:${rootSchema.root}:<unregistered-descendant:**>`,
    rootSchema.root,
    "OpaqueRecoveryEvidence",
    [
      ...rootSchema.baseSegments,
      { kind: "unregistered-descendant", recursive: true },
    ],
    "unregistered_descendant_requires_classification",
  ),
);

const retainedEntries = [
  opaqueEntry(
    "library-core-v1:<unknown-root>",
    "<unknown-root>",
    "OpaqueRecoveryEvidence",
    [{ kind: "unknown-root" }],
    "unknown_root_requires_classification",
  ),
] as const;

/**
 * Deterministic, exhaustive census of every current synchronized schema leaf.
 *
 * Every undecided v1 semantic is encoded as null and paired with an explicit
 * activation blocker. This registry cannot authorize persistence or cutover.
 */
export const LIBRARY_CORE_FIELD_REGISTRY = [
  ...typedEntries,
  ...unregisteredDescendantEntries,
  ...retainedEntries,
]
  .map((entry) => {
    if (
      entry.registryKey !==
      LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY
    ) {
      return entry;
    }
    return {
      ...entry,
      mergeAlgebra: FEED_ITEM_READ_AT_FIELD_ALGEBRA.algebraId,
      activation: {
        status: "blocked" as const,
        blockers: entry.activation.blockers.filter(
          (blocker) => blocker !== "merge_algebra_undecided",
        ),
      },
    };
  })
  .sort((left, right) => compareCodeUnits(left.registryKey, right.registryKey));

const staticRootKinds = exactKeyObject<keyof FreedDoc>()({
  accounts: "entity-map",
  feedItems: "entity-map",
  meta: "singleton",
  persons: "entity-map",
  preferences: "singleton",
  rssFeeds: "entity-map",
} as const);

const rootBlockers = [
  "planned_authority_undecided",
  "planned_locality_undecided",
] as const satisfies readonly LibraryCoreActivationBlocker[];

const rootEntry = (
  rootSchema: RootSchema,
  kind: LibraryCoreRootRegistryEntry["kind"],
  additionalBlockers: readonly LibraryCoreActivationBlocker[] = [],
): LibraryCoreRootRegistryEntry => ({
  registryKey: `library-core-v1:root:${rootSchema.root}`,
  root: rootSchema.root,
  entity: rootSchema.entity,
  kind,
  path: pattern(rootSchema.baseSegments),
  currentLocality: rootSchema.currentLocalityOverride ?? "legacy-synchronized",
  currentAuthority:
    rootSchema.currentAuthorityOverride ?? "legacy-automerge-document",
  plannedLocality: null,
  plannedAuthority: null,
  cutover: "blocked",
  blockers: sortBlockers([...rootBlockers, ...additionalBlockers]),
});

export const LIBRARY_CORE_ROOT_REGISTRY = [
  ...Object.keys(staticRootSchemas)
    .sort(compareCodeUnits)
    .map((root) =>
      rootEntry(
        staticRootSchemas[
          root as keyof typeof staticRootSchemas
        ] as unknown as RootSchema,
        staticRootKinds[root as keyof typeof staticRootKinds],
      ),
    ),
  rootEntry(desktopClientRootSchema as unknown as RootSchema, "dynamic-root"),
  rootEntry(friendRootSchema as unknown as RootSchema, "legacy-root", [
    "legacy_root_requires_migration",
  ]),
  {
    registryKey: "library-core-v1:root:<unknown-root>",
    root: "<unknown-root>",
    entity: "OpaqueRecoveryEvidence",
    kind: "opaque-fallback",
    path: pattern([{ kind: "unknown-root" }]),
    currentLocality: "legacy-compatibility",
    currentAuthority: "legacy-automerge-read-only",
    plannedLocality: null,
    plannedAuthority: null,
    cutover: "blocked",
    blockers: sortBlockers([
      ...rootBlockers,
      "unknown_root_requires_classification",
    ]),
  } satisfies LibraryCoreRootRegistryEntry,
].sort((left, right) =>
  compareCodeUnits(left.registryKey, right.registryKey),
) satisfies readonly LibraryCoreRootRegistryEntry[];
