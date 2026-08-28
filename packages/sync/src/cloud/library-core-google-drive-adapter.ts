import {
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreMediaBlobDigestStateV1,
  createLibraryCoreIntentHeadObjectKey,
  createLibraryCoreResultHeadObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  isLibraryCoreOperationInstanceId,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreMediaBlobDescriptorV1,
  parseLibraryCoreMediaBlobReferenceV1,
  parseLibraryCoreIntentHeadV1,
  parseLibraryCoreResultHeadV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreMediaBlobDescriptorV1,
  type LibraryCoreMediaBlobReferenceV1,
  type LibraryCoreIntentHeadV1,
  type LibraryCoreResultHeadV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreMediaBlobAdapterV1,
  LibraryCoreMediaBlobSourceV1,
  LibraryCorePreparedMediaBlobV1,
} from "./library-core-media-blob.js";
import type {
  LibraryCoreControlCompareAndSwapResultV1,
  LibraryCoreControlReadV1,
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
  LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";
import type {
  LibraryCoreIntentHeadReadV1,
  LibraryCoreIntentPublicationAdapterV1,
} from "./library-core-intent-publication.js";
import type {
  LibraryCoreResultHeadReadV1,
  LibraryCoreResultPublicationAdapterV1,
} from "./library-core-result-publication.js";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_V2_FILES_URL = "https://www.googleapis.com/drive/v2/files";
const DRIVE_V2_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v2/files";
const PROTOCOL_PROPERTY = "library-core-v1";
const MAX_ACCESS_TOKEN_BYTES = 16_384;
const MAX_DRIVE_FILE_ID_BYTES = 1_024;
const MAX_DRIVE_ETAG_BYTES = 1_024;
const MAX_LIST_PAGES = 16;
const MAX_DUPLICATE_IMMUTABLE_OBJECTS = 8;
const MAX_CONTROL_DISCOVERY_CANDIDATES = 16;
const MAX_ACTOR_ENROLLMENT_REQUESTS = 256;
const MAX_INTENT_SEGMENTS = 1_500;
const MAX_CONTROL_BYTES = 65_536;
const MAX_INTENT_HEAD_BYTES = 65_536;
const MAX_RESULT_HEAD_BYTES = 65_536;
const MAX_DRIVE_JSON_BYTES = 262_144;
const MAX_DRIVE_ERROR_BYTES = 4_096;
const MAX_CONSISTENT_MUTABLE_READ_ATTEMPTS = 3;
const MAX_RESUMABLE_SESSION_URL_BYTES = 8_192;
const MAX_RESUMABLE_SESSION_RESTARTS = 3;
const MAX_RESUMABLE_CHUNK_RECOVERIES = 3;

export type GoogleDriveFetch = typeof fetch;

function defaultGoogleDriveFetch(): GoogleDriveFetch {
  return globalThis.fetch.bind(globalThis);
}

/**
 * Ordinary Library Core wire objects remain below 5 MB so Google Drive can
 * publish them in one multipart request. Large media uses a separate resumable
 * content-addressed blob path.
 */
export const LIBRARY_CORE_GOOGLE_DRIVE_SIMPLE_UPLOAD_LIMIT = 5_000_000;
export const LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES = 1_048_576;

const textEncoder = new TextEncoder();

interface DriveFileMetadataV1 {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly appProperties: Readonly<Record<string, string>>;
}

interface DriveFileListResponse {
  readonly files: readonly unknown[];
  readonly nextPageToken?: unknown;
}

export interface GoogleDriveLibraryCoreControlLocatorV1 {
  readonly controlFileId: string;
}

export interface ProvisionedGoogleDriveLibraryCoreControlV1
  extends GoogleDriveLibraryCoreControlLocatorV1 {
  readonly created: boolean;
}

export interface PublishedGoogleDriveLibraryCoreControlV1
  extends GoogleDriveLibraryCoreControlLocatorV1 {
  readonly control: {
    readonly bytes: Uint8Array;
  };
  readonly libraryId: string;
}

export interface DiscoveredGoogleDriveLibraryCoreActorEnrollmentRequestV1 {
  readonly bytes: Uint8Array;
  readonly reference: LibraryCorePublishedImmutableObjectReceiptV1;
}

export type DiscoveredGoogleDriveLibraryCoreActorEnrollmentV1 =
  DiscoveredGoogleDriveLibraryCoreActorEnrollmentRequestV1;

export interface DiscoveredGoogleDriveLibraryCoreIntentSegmentV1 {
  readonly firstIntentSequence: number;
  readonly lastIntentSequence: number;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
}

export interface DiscoveredGoogleDriveLibraryCoreResultSegmentV1 {
  readonly firstResultSequence: number;
  readonly lastResultSequence: number;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
}

export interface GoogleDriveLibraryCoreAdapterOptionsV1 {
  readonly accessToken: string;
  readonly libraryId: string;
  readonly controlFileId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}

export interface GoogleDriveLibraryCoreMediaBlobAdapterOptionsV1 {
  readonly accessToken: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}

export interface GoogleDriveLibraryCoreIntentHeadLocatorV1 {
  readonly intentHeadFileId: string;
}

export interface GoogleDriveLibraryCoreResultHeadLocatorV1 {
  readonly resultHeadFileId: string;
}

export interface ProvisionedGoogleDriveLibraryCoreResultHeadV1
  extends GoogleDriveLibraryCoreResultHeadLocatorV1 {
  readonly created: boolean;
}

export interface ProvisionedGoogleDriveLibraryCoreIntentHeadV1
  extends GoogleDriveLibraryCoreIntentHeadLocatorV1 {
  readonly created: boolean;
}

export interface GoogleDriveLibraryCoreIntentAdapterOptionsV1
  extends GoogleDriveLibraryCoreAdapterOptionsV1,
    GoogleDriveLibraryCoreIntentHeadLocatorV1 {
  readonly actorId: string;
  readonly epochId: string;
}

export interface GoogleDriveLibraryCoreResultAdapterOptionsV1
  extends GoogleDriveLibraryCoreAdapterOptionsV1,
    GoogleDriveLibraryCoreResultHeadLocatorV1 {
  readonly actorId: string;
  readonly epochId: string;
}

function assertBoundedText(
  value: unknown,
  label: string,
  maxBytes: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > maxBytes ||
    /[\r\n]/u.test(value)
  ) {
    throw new TypeError(`${label} must be bounded nonempty text`);
  }
}

function assertLibraryId(value: unknown): asserts value is string {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError("libraryId must be a bounded Library Core identifier");
  }
}

function ownRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain record`);
  }
  return value as Record<string, unknown>;
}

function parseStrongDriveEtag(value: unknown, label: string): string {
  assertBoundedText(value, label, MAX_DRIVE_ETAG_BYTES);
  if (!/^"[\x21\x23-\x7e]+"$/u.test(value)) {
    throw new TypeError(`${label} must be a bounded strong entity tag`);
  }
  return value;
}

function parseNonnegativeSize(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} must be a canonical byte count`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`${label} exceeds the supported byte range`);
  }
  return parsed;
}

function parseAppProperties(value: unknown): Readonly<Record<string, string>> {
  const record = ownRecord(value, "Drive appProperties");
  const parsed: Record<string, string> = {};
  for (const [key, propertyValue] of Object.entries(record)) {
    if (typeof propertyValue !== "string") {
      throw new TypeError("Drive appProperties values must be strings");
    }
    parsed[key] = propertyValue;
  }
  return Object.freeze(parsed);
}

function parseDriveFileMetadata(value: unknown): DriveFileMetadataV1 {
  const record = ownRecord(value, "Drive file metadata");
  assertBoundedText(record.id, "Drive file id", MAX_DRIVE_FILE_ID_BYTES);
  assertBoundedText(record.name, "Drive file name", 2_048);
  return Object.freeze({
    id: record.id,
    name: record.name,
    size: parseNonnegativeSize(record.size, "Drive file size"),
    appProperties: parseAppProperties(record.appProperties),
  });
}

function quoteDriveQueryValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function propertyQuery(key: string, value: string): string {
  return `appProperties has { key='${quoteDriveQueryValue(
    key,
  )}' and value='${quoteDriveQueryValue(value)}' }`;
}

function authorizationHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function responseError(
  label: string,
  response: Response,
): Promise<Error & { readonly status: number }> {
  const body = await readBoundedResponseBytes(
    response,
    MAX_DRIVE_ERROR_BYTES,
    `${label} error body`,
  ).catch(() => new Uint8Array());
  const detail = new TextDecoder().decode(body).trim().slice(0, 500);
  return Object.assign(
    new Error(
      `${label}: ${response.status.toLocaleString()}${
        response.statusText ? ` ${response.statusText}` : ""
      }${detail ? ` - ${detail}` : ""}`,
    ),
    { status: response.status },
  );
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null) {
    const parsed = parseNonnegativeSize(
      contentLength,
      `${label} content length`,
    );
    if (parsed > maxBytes) {
      throw new RangeError(
        `${label} exceeds ${maxBytes.toLocaleString()} bytes`,
      );
    }
  }

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new RangeError(
          `${label} exceeds ${maxBytes.toLocaleString()} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    exactArrayBuffer(bytes),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function objectKeyDigest(objectKey: string): Promise<string> {
  return sha256Hex(textEncoder.encode(objectKey));
}

async function libraryIdentityDigest(libraryId: string): Promise<string> {
  return sha256Hex(textEncoder.encode(libraryId));
}

async function actorIdentityDigest(actorId: string): Promise<string> {
  return sha256Hex(textEncoder.encode(actorId));
}

type LibraryCoreDriveObjectKind =
  | "epoch"
  | "enrollment"
  | "enrollment_request"
  | "operations"
  | "manifest"
  | "checkpoint"
  | "search_manifest"
  | "search_shard"
  | "search_delta"
  | "intents"
  | "results"
  | "blob"
  | "backup";

function driveObjectKind(objectKey: string): LibraryCoreDriveObjectKind {
  if (objectKey.startsWith("freed-v2-epoch~")) return "epoch";
  if (objectKey.startsWith("freed-v2-enrollment-request~")) {
    return "enrollment_request";
  }
  if (objectKey.startsWith("freed-v2-enrollment~")) return "enrollment";
  if (objectKey.startsWith("freed-v2-ops~")) return "operations";
  if (objectKey.startsWith("freed-v2-manifest~")) return "manifest";
  if (objectKey.startsWith("freed-v2-checkpoint~")) return "checkpoint";
  if (objectKey.startsWith("freed-v2-search-delta~")) return "search_delta";
  if (/~g(?:0|[1-9][0-9]*)~manifest~[0-9a-f]{64}\.json$/u.test(objectKey)) {
    return "search_manifest";
  }
  if (objectKey.startsWith("freed-v2-search~")) return "search_shard";
  if (objectKey.startsWith("freed-v2-intents~")) return "intents";
  if (objectKey.startsWith("freed-v2-results~")) return "results";
  if (objectKey.startsWith("freed-v2-blob~")) return "blob";
  if (objectKey.startsWith("freed-v2-backup~")) return "backup";
  throw new TypeError("unsupported Library Core immutable object key");
}

function objectKeyBelongsToLibrary(
  objectKey: string,
  libraryId: string,
): boolean {
  const [, encodedLibraryId] = objectKey.split("~", 3);
  return encodedLibraryId === libraryId;
}

function immutableAppProperties(
  libraryDigest: string,
  descriptor: LibraryCoreImmutableObjectDescriptorV1,
  keyDigest: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    freedProtocol: PROTOCOL_PROPERTY,
    freedLibraryDigest: libraryDigest,
    freedObjectKind: driveObjectKind(descriptor.objectKey),
    freedObjectKeyDigest: keyDigest,
    freedContentDigest: descriptor.contentDigest,
  });
}

function mediaBlobAppProperties(
  libraryDigest: string,
  descriptor: LibraryCoreMediaBlobDescriptorV1,
  keyDigest: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    freedProtocol: PROTOCOL_PROPERTY,
    freedLibraryDigest: libraryDigest,
    freedObjectKind: "blob",
    freedObjectKeyDigest: keyDigest,
    freedContentDigest: descriptor.blobContentDigest,
    freedDigestDomain: "blob-content",
  });
}

function controlAppProperties(
  libraryDigest: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    freedProtocol: PROTOCOL_PROPERTY,
    freedLibraryDigest: libraryDigest,
    freedObjectKind: "control",
  });
}

function intentHeadAppProperties(
  libraryDigest: string,
  epochDigest: string,
  actorDigest: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    freedProtocol: PROTOCOL_PROPERTY,
    freedLibraryDigest: libraryDigest,
    freedObjectKind: "intent_head",
    freedEpochDigest: epochDigest,
    freedActorDigest: actorDigest,
  });
}

function resultHeadAppProperties(
  libraryDigest: string,
  epochDigest: string,
  actorDigest: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    freedProtocol: PROTOCOL_PROPERTY,
    freedLibraryDigest: libraryDigest,
    freedObjectKind: "result_head",
    freedEpochDigest: epochDigest,
    freedActorDigest: actorDigest,
  });
}

function encodeIntentHead(head: LibraryCoreIntentHeadV1): Uint8Array {
  return encodeLibraryCoreCanonicalValue(
    head as unknown as LibraryCoreCanonicalValue,
  );
}

function decodeIntentHead(bytes: Uint8Array): LibraryCoreIntentHeadV1 {
  return parseLibraryCoreIntentHeadV1(
    decodeLibraryCoreCanonicalValue(bytes, {
      maximumBytes: MAX_INTENT_HEAD_BYTES,
    }),
  );
}

function encodeResultHead(head: LibraryCoreResultHeadV1): Uint8Array {
  return encodeLibraryCoreCanonicalValue(head as unknown as LibraryCoreCanonicalValue);
}

function decodeResultHead(bytes: Uint8Array): LibraryCoreResultHeadV1 {
  return parseLibraryCoreResultHeadV1(
    decodeLibraryCoreCanonicalValue(bytes, { maximumBytes: MAX_RESULT_HEAD_BYTES }),
  );
}

function assertExpectedProperties(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
  label: string,
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${label} has mismatched ${key}`);
    }
  }
}

async function listDriveFilesByProperties(input: {
  readonly accessToken: string;
  readonly properties: Readonly<Record<string, string>>;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly maxFiles: number;
}): Promise<readonly DriveFileMetadataV1[]> {
  const files: DriveFileMetadataV1[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const query = [
      "trashed = false",
      ...Object.entries(input.properties).map(([key, value]) =>
        propertyQuery(key, value),
      ),
    ].join(" and ");
    const params = new URLSearchParams({
      spaces: "appDataFolder",
      q: query,
      fields: "nextPageToken,files(id,name,size,appProperties)",
      pageSize: String(Math.min(100, input.maxFiles + 1)),
    });
    if (pageToken !== null) params.set("pageToken", pageToken);
    const response = await input.googleFetch(
      `${DRIVE_FILES_URL}?${params.toString()}`,
      {
        headers: authorizationHeaders(input.accessToken),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw await responseError("Library Core Drive list failed", response);
    }
    const responseBytes = await readBoundedResponseBytes(
      response,
      MAX_DRIVE_JSON_BYTES,
      "Drive file list response",
    );
    const parsed = ownRecord(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(responseBytes),
      ),
      "Drive file list response",
    ) as unknown as DriveFileListResponse;
    if (!Array.isArray(parsed.files)) {
      throw new TypeError("Drive file list response must contain files");
    }
    for (const candidate of parsed.files) {
      files.push(parseDriveFileMetadata(candidate));
      if (files.length > input.maxFiles) {
        throw new Error(
          `Drive object identity has more than ${input.maxFiles.toLocaleString()} matches`,
        );
      }
    }
    if (parsed.nextPageToken === undefined) return files;
    assertBoundedText(
      parsed.nextPageToken,
      "Drive nextPageToken",
      MAX_DRIVE_FILE_ID_BYTES,
    );
    pageToken = parsed.nextPageToken;
  }
  throw new Error(
    `Drive object lookup exceeded ${MAX_LIST_PAGES.toLocaleString()} pages`,
  );
}

async function readDriveFileWithRevision(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly maxBytes: number;
  readonly label: string;
}): Promise<{ readonly revision: string; readonly bytes: Uint8Array }> {
  for (
    let attempt = 0;
    attempt < MAX_CONSISTENT_MUTABLE_READ_ATTEMPTS;
    attempt += 1
  ) {
    // Drive's v3 media and metadata responses do not reliably expose an ETag.
    // Drive v2 exposes the same strong revision as a bounded JSON field. Read
    // that revision on both sides of the v3 media body so the returned bytes
    // and compare-and-swap token describe one stable file generation.
    const revisionBefore = await readDriveFileRevision(input);
    const bytes = await readDriveFileBytes(input);
    const revisionAfter = await readDriveFileRevision(input);
    if (revisionBefore === revisionAfter) {
      return Object.freeze({ revision: revisionAfter, bytes });
    }
  }
  throw new Error(`${input.label} changed during read`);
}

async function readDriveFileRevision(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly label: string;
}): Promise<string> {
  const response = await input.googleFetch(
    `${DRIVE_V2_FILES_URL}/${encodeURIComponent(
      input.fileId,
    )}?fields=id,etag`,
    {
      headers: authorizationHeaders(input.accessToken),
      signal: input.signal,
    },
  );
  if (!response.ok) throw await responseError(input.label, response);
  const responseBytes = await readBoundedResponseBytes(
    response,
    MAX_DRIVE_JSON_BYTES,
    `${input.label} metadata`,
  );
  const metadata = ownRecord(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(responseBytes)),
    `${input.label} metadata`,
  );
  assertBoundedText(metadata.id, `${input.label} file id`, MAX_DRIVE_FILE_ID_BYTES);
  if (metadata.id !== input.fileId) {
    throw new Error(`${input.label} returned the wrong file identity`);
  }
  return parseStrongDriveEtag(
    metadata.etag,
    `${input.label} metadata ETag`,
  );
}

async function readDriveFileBytes(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly maxBytes: number;
  readonly label: string;
}): Promise<Uint8Array> {
  const response = await input.googleFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}?alt=media`,
    {
      headers: authorizationHeaders(input.accessToken),
      signal: input.signal,
    },
  );
  if (!response.ok) throw await responseError(input.label, response);
  return readBoundedResponseBytes(response, input.maxBytes, input.label);
}

async function readDriveFileMetadata(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<DriveFileMetadataV1> {
  const response = await input.googleFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(
      input.fileId,
    )}?fields=id,name,size,appProperties`,
    {
      headers: authorizationHeaders(input.accessToken),
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw await responseError("Library Core Drive metadata failed", response);
  }
  const responseBytes = await readBoundedResponseBytes(
    response,
    MAX_DRIVE_JSON_BYTES,
    "Library Core Drive metadata",
  );
  return parseDriveFileMetadata(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(responseBytes)),
  );
}

function multipartUploadBody(
  boundary: string,
  metadata: Readonly<Record<string, unknown>>,
  bytes: Uint8Array,
): Blob {
  return new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      exactArrayBuffer(bytes),
      `\r\n--${boundary}--\r\n`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
}

/**
 * Discover the one control file for a library without trusting its filename.
 *
 * Bootstrap creation is intentionally separate. Normal publication requires
 * one already-provisioned exact file ID so Drive filename duplication can
 * never select authority.
 */
export async function discoverGoogleDriveLibraryCoreControlV1(input: {
  readonly accessToken: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<GoogleDriveLibraryCoreControlLocatorV1 | null> {
  assertBoundedText(
    input.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  assertLibraryId(input.libraryId);
  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const expectedProperties = controlAppProperties(
    await libraryIdentityDigest(input.libraryId),
  );
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: expectedProperties,
    googleFetch,
    signal: input.signal,
    maxFiles: 1,
  });
  if (files.length === 0) return null;
  const [file] = files;
  if (file === undefined) return null;
  assertExpectedProperties(
    file.appProperties,
    expectedProperties,
    "Library Core Drive control",
  );
  return Object.freeze({ controlFileId: file.id });
}

/**
 * Discover the sole published Library Core control available to a fresh PWA.
 * The control body supplies the library identity. App properties only narrow
 * discovery to the protocol and object kind, and never establish authority.
 */
export async function discoverPublishedGoogleDriveLibraryCoreControlV1(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<PublishedGoogleDriveLibraryCoreControlV1 | null> {
  assertBoundedText(
    input.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const expectedProperties = Object.freeze({
    freedProtocol: PROTOCOL_PROPERTY,
    freedObjectKind: "control",
  });
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: expectedProperties,
    googleFetch,
    signal: input.signal,
    maxFiles: MAX_CONTROL_DISCOVERY_CANDIDATES,
  });
  let discovered: PublishedGoogleDriveLibraryCoreControlV1 | null = null;
  for (const file of files) {
    assertExpectedProperties(
      file.appProperties,
      expectedProperties,
      "Library Core Drive control discovery",
    );
    // Provisioning writes the canonical empty object as exactly two bytes.
    // appDataFolder is private to this app, so its authenticated object kind
    // and exact stored size are enough to ignore an abandoned placeholder
    // without downloading it on every PWA refresh.
    if (file.size === 2) continue;
    const controlBytes = await readDriveFileBytes({
      accessToken: input.accessToken,
      fileId: file.id,
      googleFetch,
      signal: input.signal,
      maxBytes: MAX_CONTROL_BYTES,
      label: "Library Core Drive control discovery",
    });
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(controlBytes),
    );
    const pointer = parseLibraryCoreControlPointerV1(decoded);
    if (discovered !== null) {
      throw new Error(
        "Drive contains more than one published Library Core control",
      );
    }
    discovered = Object.freeze({
      controlFileId: file.id,
      control: Object.freeze({ bytes: controlBytes }),
      libraryId: pointer.libraryId,
    });
  }
  return discovered;
}

/**
 * Discover bounded proof-only PWA enrollment requests for one Library.
 * File names are checked against authenticated app properties and exact bytes;
 * they are locators, never authority.
 */
async function discoverGoogleDriveLibraryCoreActorObjectsV1(input: {
  readonly accessToken: string;
  readonly epochId: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}, kind: "enrollment" | "enrollment_request"): Promise<readonly DiscoveredGoogleDriveLibraryCoreActorEnrollmentRequestV1[]> {
  assertBoundedText(
    input.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  assertLibraryId(input.libraryId);
  if (!isLibraryCoreOperationInstanceId(input.epochId)) {
    throw new TypeError("epochId must be a bounded Library Core identifier");
  }
  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const libraryDigest = await libraryIdentityDigest(input.libraryId);
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: Object.freeze({
      freedProtocol: PROTOCOL_PROPERTY,
      freedLibraryDigest: libraryDigest,
      freedObjectKind: kind,
    }),
    googleFetch,
    signal: input.signal,
    maxFiles: MAX_ACTOR_ENROLLMENT_REQUESTS,
  });
  const discovered: DiscoveredGoogleDriveLibraryCoreActorEnrollmentRequestV1[] = [];
  const epochPrefix = kind === "enrollment_request"
    ? `freed-v2-enrollment-request~${input.libraryId}~${input.epochId}~`
    : `freed-v2-enrollment~${input.libraryId}~${input.epochId}~`;
  for (const file of [...files].filter((candidate) =>
    candidate.name.startsWith(epochPrefix)
  ).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
      byteLength: file.size,
      contentDigest: file.appProperties.freedContentDigest,
      objectKey: file.name,
    });
    if (!objectKeyBelongsToLibrary(descriptor.objectKey, input.libraryId)) {
      throw new Error(`actor ${kind} belongs to another Library`);
    }
    const expectedProperties = immutableAppProperties(
      libraryDigest,
      descriptor,
      await objectKeyDigest(descriptor.objectKey),
    );
    assertExpectedProperties(
      file.appProperties,
      expectedProperties,
      `actor ${kind} ${descriptor.objectKey}`,
    );
    const storedBytes = await readDriveFileBytes({
      accessToken: input.accessToken,
      fileId: file.id,
      googleFetch,
      signal: input.signal,
      maxBytes: descriptor.byteLength,
      label: `actor ${kind} ${descriptor.objectKey}`,
    });
    if (
      storedBytes.byteLength !== descriptor.byteLength ||
      (await sha256Hex(storedBytes)) !== descriptor.contentDigest
    ) {
      throw new Error(`actor ${kind} bytes are corrupt`);
    }
    discovered.push(
      Object.freeze({
        bytes: storedBytes,
        reference: Object.freeze({
          descriptor,
          transportObjectId: file.id,
        }),
      }),
    );
  }
  return Object.freeze(discovered);
}

export function discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1(input: {
  readonly accessToken: string;
  readonly epochId: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<readonly DiscoveredGoogleDriveLibraryCoreActorEnrollmentRequestV1[]> {
  return discoverGoogleDriveLibraryCoreActorObjectsV1(input, "enrollment_request");
}

export function discoverGoogleDriveLibraryCoreActorEnrollmentsV1(input: {
  readonly accessToken: string;
  readonly epochId: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<readonly DiscoveredGoogleDriveLibraryCoreActorEnrollmentV1[]> {
  return discoverGoogleDriveLibraryCoreActorObjectsV1(input, "enrollment");
}

/**
 * Discover one actor's immutable intent segments in canonical sequence order.
 *
 * The actor head remains the publication authority. This bounded listing only
 * locates referenced immutable bytes so Desktop can verify and import the
 * exact contiguous chain named by that head.
 */
export async function discoverGoogleDriveLibraryCoreIntentSegmentsV1(input: {
  readonly accessToken: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<readonly DiscoveredGoogleDriveLibraryCoreIntentSegmentV1[]> {
  assertBoundedText(
    input.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  assertLibraryId(input.libraryId);
  assertLibraryId(input.epochId);
  assertLibraryId(input.actorId);
  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const libraryDigest = await libraryIdentityDigest(input.libraryId);
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: Object.freeze({
      freedProtocol: PROTOCOL_PROPERTY,
      freedLibraryDigest: libraryDigest,
      freedObjectKind: "intents",
    }),
    googleFetch,
    signal: input.signal,
    maxFiles: MAX_INTENT_SEGMENTS,
  });
  const prefix = `freed-v2-intents~${input.libraryId}~e${input.epochId}~${input.actorId}~s`;
  const grouped = new Map<string, DriveFileMetadataV1[]>();
  for (const file of files) {
    if (!file.name.startsWith(prefix)) continue;
    const group = grouped.get(file.name) ?? [];
    group.push(file);
    if (group.length > MAX_DUPLICATE_IMMUTABLE_OBJECTS) {
      throw new Error("intent segment has too many duplicate Drive objects");
    }
    grouped.set(file.name, group);
  }

  const discovered: DiscoveredGoogleDriveLibraryCoreIntentSegmentV1[] = [];
  for (const [objectKey, duplicates] of grouped) {
    const suffix = objectKey.slice(prefix.length);
    const match = /^(0|[1-9][0-9]*)-(0|[1-9][0-9]*)~([0-9a-f]{64})\.fseg\.gz$/u.exec(
      suffix,
    );
    if (match === null) throw new Error("intent segment object key is invalid");
    const firstIntentSequence = Number(match[1]);
    const lastIntentSequence = Number(match[2]);
    if (
      !Number.isSafeInteger(firstIntentSequence)
      || !Number.isSafeInteger(lastIntentSequence)
      || firstIntentSequence < 1
      || lastIntentSequence < firstIntentSequence
    ) {
      throw new Error("intent segment sequence range is invalid");
    }
    const expectedKey = createLibraryCoreImmutableObjectKey({
      actorId: input.actorId,
      digest: match[3]!,
      epochId: input.epochId,
      firstSequence: firstIntentSequence,
      kind: "intent_segment",
      lastSequence: lastIntentSequence,
      libraryId: input.libraryId,
    });
    if (expectedKey !== objectKey) {
      throw new Error("intent segment object key is not canonical");
    }
    const ordered = [...duplicates].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    for (const file of ordered) {
      const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
        byteLength: file.size,
        contentDigest: file.appProperties.freedContentDigest,
        objectKey,
      });
      const expectedProperties = immutableAppProperties(
        libraryDigest,
        descriptor,
        await objectKeyDigest(objectKey),
      );
      assertExpectedProperties(
        file.appProperties,
        expectedProperties,
        `intent segment ${objectKey}`,
      );
    }
    const selected = ordered[0];
    if (selected === undefined) continue;
    discovered.push(Object.freeze({
      firstIntentSequence,
      lastIntentSequence,
      reference: Object.freeze({
        descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
          byteLength: selected.size,
          contentDigest: selected.appProperties.freedContentDigest,
          objectKey,
        }),
        transportObjectId: selected.id,
      }),
    }));
  }
  discovered.sort((left, right) =>
    left.firstIntentSequence - right.firstIntentSequence
      || left.lastIntentSequence - right.lastIntentSequence,
  );
  return Object.freeze(discovered);
}

/** Locate one actor's immutable result chain. The mutable result head remains authority. */
export async function discoverGoogleDriveLibraryCoreResultSegmentsV1(input: {
  readonly accessToken: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<readonly DiscoveredGoogleDriveLibraryCoreResultSegmentV1[]> {
  assertBoundedText(input.accessToken, "Google Drive access token", MAX_ACCESS_TOKEN_BYTES);
  assertLibraryId(input.libraryId);
  assertLibraryId(input.epochId);
  assertLibraryId(input.actorId);
  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const libraryDigest = await libraryIdentityDigest(input.libraryId);
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: Object.freeze({
      freedProtocol: PROTOCOL_PROPERTY,
      freedLibraryDigest: libraryDigest,
      freedObjectKind: "results",
    }),
    googleFetch,
    signal: input.signal,
    maxFiles: MAX_INTENT_SEGMENTS,
  });
  const prefix = `freed-v2-results~${input.libraryId}~e${input.epochId}~${input.actorId}~s`;
  const grouped = new Map<string, DriveFileMetadataV1[]>();
  for (const file of files) {
    if (!file.name.startsWith(prefix)) continue;
    const group = grouped.get(file.name) ?? [];
    group.push(file);
    if (group.length > MAX_DUPLICATE_IMMUTABLE_OBJECTS) {
      throw new Error("result segment has too many duplicate Drive objects");
    }
    grouped.set(file.name, group);
  }
  const discovered: DiscoveredGoogleDriveLibraryCoreResultSegmentV1[] = [];
  for (const [objectKey, duplicates] of grouped) {
    const match = /^(0|[1-9][0-9]*)-(0|[1-9][0-9]*)~([0-9a-f]{64})\.fseg\.gz$/u.exec(objectKey.slice(prefix.length));
    if (!match) throw new Error("result segment object key is invalid");
    const firstResultSequence = Number(match[1]);
    const lastResultSequence = Number(match[2]);
    if (!Number.isSafeInteger(firstResultSequence) || !Number.isSafeInteger(lastResultSequence) || firstResultSequence < 1 || lastResultSequence < firstResultSequence) {
      throw new Error("result segment sequence range is invalid");
    }
    const expectedKey = createLibraryCoreImmutableObjectKey({
      actorId: input.actorId,
      digest: match[3]!,
      epochId: input.epochId,
      firstSequence: firstResultSequence,
      kind: "result_segment",
      lastSequence: lastResultSequence,
      libraryId: input.libraryId,
    });
    if (expectedKey !== objectKey) throw new Error("result segment object key is not canonical");
    const ordered = [...duplicates].sort((left, right) => left.id.localeCompare(right.id));
    for (const file of ordered) {
      const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
        byteLength: file.size,
        contentDigest: file.appProperties.freedContentDigest,
        objectKey,
      });
      assertExpectedProperties(file.appProperties, immutableAppProperties(libraryDigest, descriptor, await objectKeyDigest(objectKey)), `result segment ${objectKey}`);
    }
    const selected = ordered[0];
    if (!selected) continue;
    discovered.push(Object.freeze({
      firstResultSequence,
      lastResultSequence,
      reference: Object.freeze({
        descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
          byteLength: selected.size,
          contentDigest: selected.appProperties.freedContentDigest,
          objectKey,
        }),
        transportObjectId: selected.id,
      }),
    }));
  }
  discovered.sort((left, right) => left.firstResultSequence - right.firstResultSequence || left.lastResultSequence - right.lastResultSequence);
  return Object.freeze(discovered);
}

/**
 * Provision the one empty CAS control file for a Library Core library.
 *
 * The empty object is not authority. The first immutable checkpoint
 * publication replaces it with a validated control pointer using the exact
 * ETag returned by Drive. A concurrent duplicate bootstrap fails closed when
 * discovery observes more than one matching control object.
 */
export async function provisionGoogleDriveLibraryCoreControlV1(input: {
  readonly accessToken: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<ProvisionedGoogleDriveLibraryCoreControlV1> {
  const existing = await discoverGoogleDriveLibraryCoreControlV1(input);
  if (existing !== null) {
    return Object.freeze({ ...existing, created: false });
  }

  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const bytes = textEncoder.encode("{}");
  const boundary = `freed-control-${await libraryIdentityDigest(input.libraryId)}`;
  const response = await googleFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,size,appProperties`,
    {
      method: "POST",
      headers: {
        ...authorizationHeaders(input.accessToken),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartUploadBody(
        boundary,
        {
          name: `freed-v2-control~${input.libraryId}.json`,
          parents: ["appDataFolder"],
          appProperties: controlAppProperties(
            await libraryIdentityDigest(input.libraryId),
          ),
        },
        bytes,
      ),
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw await responseError(
      "Library Core Drive control bootstrap failed",
      response,
    );
  }
  await readBoundedResponseBytes(
    response,
    MAX_DRIVE_JSON_BYTES,
    "Library Core Drive control bootstrap response",
  );

  const provisioned = await discoverGoogleDriveLibraryCoreControlV1(input);
  if (provisioned === null) {
    throw new Error("Library Core Drive control bootstrap was not discoverable");
  }
  return Object.freeze({ ...provisioned, created: true });
}

/** Discover one actor-scoped mutable intent head by private identity properties. */
export async function discoverGoogleDriveLibraryCoreIntentHeadV1(input: {
  readonly accessToken: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<GoogleDriveLibraryCoreIntentHeadLocatorV1 | null> {
  assertBoundedText(
    input.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  assertLibraryId(input.libraryId);
  assertLibraryId(input.epochId);
  assertLibraryId(input.actorId);
  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const expectedProperties = intentHeadAppProperties(
    await libraryIdentityDigest(input.libraryId),
    await libraryIdentityDigest(input.epochId),
    await actorIdentityDigest(input.actorId),
  );
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: expectedProperties,
    googleFetch,
    signal: input.signal,
    maxFiles: 1,
  });
  const file = files[0];
  if (file === undefined) return null;
  assertExpectedProperties(
    file.appProperties,
    expectedProperties,
    "Library Core Drive intent head",
  );
  return Object.freeze({ intentHeadFileId: file.id });
}

/**
 * Provision an actor's empty intent head before its first publication.
 *
 * The actor enrollment remains the authority record. This mutable head only
 * names the latest immutable segment accepted for that exact actor.
 */
export async function provisionGoogleDriveLibraryCoreIntentHeadV1(input: {
  readonly accessToken: string;
  readonly head: LibraryCoreIntentHeadV1;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<ProvisionedGoogleDriveLibraryCoreIntentHeadV1> {
  assertBoundedText(
    input.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  const head = parseLibraryCoreIntentHeadV1(input.head);
  const discovery = {
    accessToken: input.accessToken,
    actorId: head.actor_id,
    epochId: head.epoch_id,
    libraryId: head.library_id,
    googleFetch: input.googleFetch,
    signal: input.signal,
  };
  const existing = await discoverGoogleDriveLibraryCoreIntentHeadV1(discovery);
  if (existing !== null) {
    return Object.freeze({ ...existing, created: false });
  }

  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const bytes = encodeIntentHead(head);
  const actorDigest = await actorIdentityDigest(head.actor_id);
  const boundary = `freed-intent-head-${actorDigest.slice(0, 32)}`;
  const response = await googleFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,size,appProperties`,
    {
      method: "POST",
      headers: {
        ...authorizationHeaders(input.accessToken),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartUploadBody(
        boundary,
        {
          name: createLibraryCoreIntentHeadObjectKey(
            head.library_id,
            head.epoch_id,
            head.actor_id,
          ),
          parents: ["appDataFolder"],
          appProperties: intentHeadAppProperties(
            await libraryIdentityDigest(head.library_id),
            await libraryIdentityDigest(head.epoch_id),
            actorDigest,
          ),
        },
        bytes,
      ),
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw await responseError(
      "Library Core Drive intent-head bootstrap failed",
      response,
    );
  }
  await readBoundedResponseBytes(
    response,
    MAX_DRIVE_JSON_BYTES,
    "Library Core Drive intent-head bootstrap response",
  );
  const provisioned = await discoverGoogleDriveLibraryCoreIntentHeadV1(
    discovery,
  );
  if (provisioned === null) {
    throw new Error(
      "Library Core Drive intent-head bootstrap was not discoverable",
    );
  }
  return Object.freeze({ ...provisioned, created: true });
}

/** Create an exact actor-head CAS adapter atop the immutable Drive adapter. */
export function createGoogleDriveLibraryCoreIntentAdapterV1(
  options: GoogleDriveLibraryCoreIntentAdapterOptionsV1,
): LibraryCoreIntentPublicationAdapterV1 {
  assertLibraryId(options.libraryId);
  assertLibraryId(options.epochId);
  assertLibraryId(options.actorId);
  assertBoundedText(
    options.intentHeadFileId,
    "Google Drive intent-head file id",
    MAX_DRIVE_FILE_ID_BYTES,
  );
  const googleFetch = options.googleFetch ?? defaultGoogleDriveFetch();
  const immutableAdapter = createGoogleDriveLibraryCoreAdapterV1(options);
  const expectedPropertiesPromise = Promise.all([
    libraryIdentityDigest(options.libraryId),
    libraryIdentityDigest(options.epochId),
    actorIdentityDigest(options.actorId),
  ]).then(([libraryDigest, epochDigest, actorDigest]) =>
    intentHeadAppProperties(libraryDigest, epochDigest, actorDigest),
  );

  const readIntentHead = async (): Promise<LibraryCoreIntentHeadReadV1> => {
    const metadata = await readDriveFileMetadata({
      accessToken: options.accessToken,
      fileId: options.intentHeadFileId,
      googleFetch,
      signal: options.signal,
    });
    assertExpectedProperties(
      metadata.appProperties,
      await expectedPropertiesPromise,
      "Library Core Drive intent head",
    );
    const stored = await readDriveFileWithRevision({
      accessToken: options.accessToken,
      fileId: options.intentHeadFileId,
      googleFetch,
      signal: options.signal,
      maxBytes: MAX_INTENT_HEAD_BYTES,
      label: "Library Core Drive intent-head read failed",
    });
    const head = decodeIntentHead(stored.bytes);
    if (
      head.library_id !== options.libraryId ||
      head.epoch_id !== options.epochId ||
      head.actor_id !== options.actorId
    ) {
      throw new Error("Library Core Drive intent-head identity is incorrect");
    }
    return Object.freeze({ ...stored, head });
  };

  return Object.freeze({
    ...immutableAdapter,
    readIntentHead,
    async compareAndSwapIntentHead(input: {
      readonly bytes: Uint8Array;
      readonly expectedRevision: string;
    }) {
      const expectedRevision = parseStrongDriveEtag(
        input.expectedRevision,
        "expected Drive intent-head revision",
      );
      if (
        !(input.bytes instanceof Uint8Array) ||
        input.bytes.byteLength === 0 ||
        input.bytes.byteLength > MAX_INTENT_HEAD_BYTES
      ) {
        throw new RangeError(
          `intent-head bytes must contain 1 to ${MAX_INTENT_HEAD_BYTES.toLocaleString()} bytes`,
        );
      }
      const proposed = decodeIntentHead(input.bytes);
      if (
        proposed.library_id !== options.libraryId ||
        proposed.epoch_id !== options.epochId ||
        proposed.actor_id !== options.actorId
      ) {
        throw new TypeError("proposed intent head has the wrong identity");
      }
      const response = await googleFetch(
        `${DRIVE_V2_UPLOAD_URL}/${encodeURIComponent(
          options.intentHeadFileId,
        )}?uploadType=media&fields=id,etag`,
        {
          method: "PUT",
          headers: {
            ...authorizationHeaders(options.accessToken),
            "Content-Type": "application/json; charset=UTF-8",
            "If-Match": expectedRevision,
          },
          body: exactArrayBuffer(input.bytes),
          signal: options.signal,
        },
      );
      if (response.status === 412) {
        return Object.freeze({
          status: "conflict" as const,
          current: await readIntentHead(),
        });
      }
      if (!response.ok) {
        throw await responseError(
          "Library Core Drive intent-head update failed",
          response,
        );
      }
      const readBack = await readIntentHead();
      if (!bytesEqual(readBack.bytes, input.bytes)) {
        throw new Error(
          "Library Core Drive intent-head readback did not match committed bytes",
        );
      }
      return Object.freeze({ status: "committed" as const });
    },
  });
}

export async function discoverGoogleDriveLibraryCoreResultHeadV1(input: {
  readonly accessToken: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly libraryId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<GoogleDriveLibraryCoreResultHeadLocatorV1 | null> {
  assertBoundedText(input.accessToken, "Google Drive access token", MAX_ACCESS_TOKEN_BYTES);
  assertLibraryId(input.libraryId);
  assertLibraryId(input.epochId);
  assertLibraryId(input.actorId);
  const expectedProperties = resultHeadAppProperties(
    await libraryIdentityDigest(input.libraryId),
    await libraryIdentityDigest(input.epochId),
    await actorIdentityDigest(input.actorId),
  );
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: expectedProperties,
    googleFetch: input.googleFetch ?? defaultGoogleDriveFetch(),
    signal: input.signal,
    maxFiles: 1,
  });
  const file = files[0];
  if (!file) return null;
  assertExpectedProperties(file.appProperties, expectedProperties, "Library Core Drive result head");
  return Object.freeze({ resultHeadFileId: file.id });
}

export async function provisionGoogleDriveLibraryCoreResultHeadV1(input: {
  readonly accessToken: string;
  readonly head: LibraryCoreResultHeadV1;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<ProvisionedGoogleDriveLibraryCoreResultHeadV1> {
  assertBoundedText(input.accessToken, "Google Drive access token", MAX_ACCESS_TOKEN_BYTES);
  const head = parseLibraryCoreResultHeadV1(input.head);
  const discovery = {
    accessToken: input.accessToken,
    actorId: head.actor_id,
    epochId: head.epoch_id,
    libraryId: head.library_id,
    googleFetch: input.googleFetch,
    signal: input.signal,
  };
  const existing = await discoverGoogleDriveLibraryCoreResultHeadV1(discovery);
  if (existing) return Object.freeze({ ...existing, created: false });
  const googleFetch = input.googleFetch ?? defaultGoogleDriveFetch();
  const actorDigest = await actorIdentityDigest(head.actor_id);
  const bytes = encodeResultHead(head);
  const boundary = `freed-result-head-${actorDigest.slice(0, 32)}`;
  const response = await googleFetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,size,appProperties`, {
    method: "POST",
    headers: {
      ...authorizationHeaders(input.accessToken),
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartUploadBody(boundary, {
      name: createLibraryCoreResultHeadObjectKey(
        head.library_id,
        head.epoch_id,
        head.actor_id,
      ),
      parents: ["appDataFolder"],
      appProperties: resultHeadAppProperties(
        await libraryIdentityDigest(head.library_id),
        await libraryIdentityDigest(head.epoch_id),
        actorDigest,
      ),
    }, bytes),
    signal: input.signal,
  });
  if (!response.ok) throw await responseError("Library Core Drive result-head bootstrap failed", response);
  await readBoundedResponseBytes(response, MAX_DRIVE_JSON_BYTES, "Library Core Drive result-head bootstrap response");
  const provisioned = await discoverGoogleDriveLibraryCoreResultHeadV1(discovery);
  if (!provisioned) throw new Error("Library Core Drive result-head bootstrap was not discoverable");
  return Object.freeze({ ...provisioned, created: true });
}

export function createGoogleDriveLibraryCoreResultAdapterV1(
  options: GoogleDriveLibraryCoreResultAdapterOptionsV1,
): LibraryCoreResultPublicationAdapterV1 {
  assertLibraryId(options.libraryId);
  assertLibraryId(options.epochId);
  assertLibraryId(options.actorId);
  assertBoundedText(options.resultHeadFileId, "Google Drive result-head file id", MAX_DRIVE_FILE_ID_BYTES);
  const googleFetch = options.googleFetch ?? defaultGoogleDriveFetch();
  const immutableAdapter = createGoogleDriveLibraryCoreAdapterV1(options);
  const expectedPropertiesPromise = Promise.all([
    libraryIdentityDigest(options.libraryId),
    libraryIdentityDigest(options.epochId),
    actorIdentityDigest(options.actorId),
  ]).then(([libraryDigest, epochDigest, actorDigest]) =>
    resultHeadAppProperties(libraryDigest, epochDigest, actorDigest));
  const readResultHead = async (): Promise<LibraryCoreResultHeadReadV1> => {
    const metadata = await readDriveFileMetadata({
      accessToken: options.accessToken, fileId: options.resultHeadFileId,
      googleFetch, signal: options.signal,
    });
    assertExpectedProperties(metadata.appProperties, await expectedPropertiesPromise, "Library Core Drive result head");
    const stored = await readDriveFileWithRevision({
      accessToken: options.accessToken, fileId: options.resultHeadFileId,
      googleFetch, signal: options.signal, maxBytes: MAX_RESULT_HEAD_BYTES,
      label: "Library Core Drive result-head read failed",
    });
    const head = decodeResultHead(stored.bytes);
    if (
      head.library_id !== options.libraryId
      || head.epoch_id !== options.epochId
      || head.actor_id !== options.actorId
    ) {
      throw new Error("Library Core Drive result-head identity is incorrect");
    }
    return Object.freeze({ ...stored, head });
  };
  return Object.freeze({
    ...immutableAdapter,
    readResultHead,
    async compareAndSwapResultHead(input: {
      readonly bytes: Uint8Array;
      readonly expectedRevision: string;
    }) {
      const expectedRevision = parseStrongDriveEtag(
        input.expectedRevision,
        "expected Drive result-head revision",
      );
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_RESULT_HEAD_BYTES) {
        throw new RangeError(`result-head bytes must contain 1 to ${MAX_RESULT_HEAD_BYTES.toLocaleString()} bytes`);
      }
      const proposed = decodeResultHead(input.bytes);
      if (
        proposed.library_id !== options.libraryId
        || proposed.epoch_id !== options.epochId
        || proposed.actor_id !== options.actorId
      ) {
        throw new TypeError("proposed result head has the wrong identity");
      }
      const response = await googleFetch(`${DRIVE_V2_UPLOAD_URL}/${encodeURIComponent(options.resultHeadFileId)}?uploadType=media&fields=id,etag`, {
        method: "PUT",
        headers: {
          ...authorizationHeaders(options.accessToken),
          "Content-Type": "application/json; charset=UTF-8",
          "If-Match": expectedRevision,
        },
        body: exactArrayBuffer(input.bytes),
        signal: options.signal,
      });
      if (response.status === 412) return Object.freeze({ status: "conflict" as const, current: await readResultHead() });
      if (!response.ok) throw await responseError("Library Core Drive result-head update failed", response);
      const readBack = await readResultHead();
      if (!bytesEqual(readBack.bytes, input.bytes)) throw new Error("Library Core Drive result-head readback did not match committed bytes");
      return Object.freeze({ status: "committed" as const });
    },
  });
}

function isExactUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    (value as Uint8Array).BYTES_PER_ELEMENT === 1
  );
}

function parseGoogleDriveResumableSessionUrl(value: unknown): string {
  assertBoundedText(
    value,
    "Google Drive resumable session URL",
    MAX_RESUMABLE_SESSION_URL_BYTES,
  );
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Google Drive resumable session URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.googleapis.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== "" ||
    !/^\/(?:resumable\/)?upload\/drive\/v3\/files(?:\/[^/]*)?$/u.test(
      parsed.pathname,
    )
  ) {
    throw new TypeError(
      "Google Drive resumable session URL is outside the trusted Drive upload endpoint",
    );
  }
  return parsed.href;
}

function parseResumableAcknowledgedOffset(
  response: Response,
  totalByteLength: number,
  maximumAcknowledgedOffset: number,
): number {
  const range = response.headers.get("Range");
  if (range === null) return 0;
  const match = /^bytes=0-(0|[1-9][0-9]*)$/u.exec(range);
  if (match === null) {
    throw new Error("Google Drive resumable response has an invalid Range");
  }
  const lastByte = Number(match[1]);
  const nextOffset = lastByte + 1;
  if (
    !Number.isSafeInteger(lastByte) ||
    nextOffset > totalByteLength ||
    nextOffset > maximumAcknowledgedOffset
  ) {
    throw new Error(
      "Google Drive resumable response acknowledges impossible bytes",
    );
  }
  return nextOffset;
}

async function parseDriveUploadMetadata(
  response: Response,
  label: string,
): Promise<DriveFileMetadataV1> {
  const responseBytes = await readBoundedResponseBytes(
    response,
    MAX_DRIVE_JSON_BYTES,
    label,
  );
  return parseDriveFileMetadata(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(responseBytes),
    ),
  );
}

async function readMediaBlobRange(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly offset: number;
  readonly byteLength: number;
  readonly totalByteLength: number;
}): Promise<Uint8Array> {
  const end = input.offset + input.byteLength - 1;
  const response = await input.googleFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}?alt=media`,
    {
      headers: {
        ...authorizationHeaders(input.accessToken),
        Range: `bytes=${input.offset.toLocaleString("en-US", {
          useGrouping: false,
        })}-${end.toLocaleString("en-US", { useGrouping: false })}`,
      },
      signal: input.signal,
    },
  );
  const wholeBoundedObject =
    response.status === 200 &&
    input.offset === 0 &&
    input.byteLength === input.totalByteLength;
  if (response.status !== 206 && !wholeBoundedObject) {
    if (!response.ok) {
      throw await responseError("Library Core Drive media read failed", response);
    }
    throw new Error("Google Drive ignored a bounded media range request");
  }
  if (response.status === 206) {
    const contentRange = response.headers.get("Content-Range");
    const expected = `bytes ${input.offset.toLocaleString("en-US", {
      useGrouping: false,
    })}-${end.toLocaleString("en-US", {
      useGrouping: false,
    })}/${input.totalByteLength.toLocaleString("en-US", {
      useGrouping: false,
    })}`;
    if (contentRange !== expected) {
      throw new Error("Google Drive media range identity is incorrect");
    }
  }
  const bytes = await readBoundedResponseBytes(
    response,
    input.byteLength,
    "Library Core Drive media range",
  );
  if (bytes.byteLength !== input.byteLength) {
    throw new Error("Google Drive media range byte length is incorrect");
  }
  return bytes;
}

async function readMediaBlobDigest(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly byteLength: number;
}): Promise<string> {
  const digest = createLibraryCoreMediaBlobDigestStateV1();
  if (input.byteLength === 0) {
    const bytes = await readDriveFileBytes({
      accessToken: input.accessToken,
      fileId: input.fileId,
      googleFetch: input.googleFetch,
      signal: input.signal,
      maxBytes: 0,
      label: "Library Core Drive empty media blob",
    });
    if (bytes.byteLength !== 0) {
      throw new Error("Google Drive empty media blob contains bytes");
    }
    return digest.digestLowerHex();
  }
  for (let offset = 0; offset < input.byteLength; ) {
    const byteLength = Math.min(
      LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES,
      input.byteLength - offset,
    );
    const bytes = await readMediaBlobRange({
      ...input,
      offset,
      byteLength,
      totalByteLength: input.byteLength,
    });
    digest.update(bytes);
    offset += byteLength;
  }
  return digest.digestLowerHex();
}

async function readExactMediaBlobSourceRange(
  source: LibraryCoreMediaBlobSourceV1,
  offset: number,
  byteLength: number,
): Promise<Uint8Array> {
  const bytes = await source.readRange({ offset, byteLength });
  if (!isExactUint8Array(bytes)) {
    throw new TypeError("media blob source range must be a Uint8Array");
  }
  if (bytes.byteLength !== byteLength) {
    throw new Error("media blob source returned the wrong byte length");
  }
  return bytes;
}

async function verifyLocalMediaBlobSource(
  descriptor: LibraryCoreMediaBlobDescriptorV1,
  source: LibraryCoreMediaBlobSourceV1,
): Promise<void> {
  if (
    source === null ||
    typeof source !== "object" ||
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength < 0 ||
    typeof source.readRange !== "function"
  ) {
    throw new TypeError("media blob source is invalid");
  }
  if (source.byteLength !== descriptor.byteLength) {
    throw new Error("media blob source byte length is incorrect");
  }
  const digest = createLibraryCoreMediaBlobDigestStateV1();
  for (let offset = 0; offset < descriptor.byteLength; ) {
    const byteLength = Math.min(
      LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES,
      descriptor.byteLength - offset,
    );
    digest.update(
      await readExactMediaBlobSourceRange(source, offset, byteLength),
    );
    offset += byteLength;
  }
  if (digest.digestLowerHex() !== descriptor.blobContentDigest) {
    throw new Error("media blob source digest is incorrect");
  }
}

/**
 * Create the provider-neutral, dormant Google Drive media blob boundary.
 *
 * Callers supply a replayable random-access source. The adapter validates it
 * locally, uploads exact 1 MiB resumable chunks, and streams an exact remote
 * readback before accepting the provider receipt. It owns no timer, token
 * acquisition, product caller, content-provider fetch, or deletion policy.
 * No production entry point invokes this factory.
 */
export function createGoogleDriveLibraryCoreMediaBlobAdapterV1(
  options: GoogleDriveLibraryCoreMediaBlobAdapterOptionsV1,
): LibraryCoreMediaBlobAdapterV1 {
  assertBoundedText(
    options.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  assertLibraryId(options.libraryId);
  const googleFetch = options.googleFetch ?? defaultGoogleDriveFetch();
  const libraryDigestPromise = libraryIdentityDigest(options.libraryId);

  async function mediaBlobProperties(
    descriptor: LibraryCoreMediaBlobDescriptorV1,
  ): Promise<Readonly<Record<string, string>>> {
    return mediaBlobAppProperties(
      await libraryDigestPromise,
      descriptor,
      await objectKeyDigest(descriptor.objectKey),
    );
  }

  async function verifyMediaBlobAtFile(
    descriptorInput: LibraryCoreMediaBlobDescriptorV1,
    fileId: string,
  ): Promise<LibraryCoreMediaBlobDescriptorV1> {
    const descriptor = parseLibraryCoreMediaBlobDescriptorV1(descriptorInput);
    assertBoundedText(
      fileId,
      "media blob Drive file id",
      MAX_DRIVE_FILE_ID_BYTES,
    );
    if (!objectKeyBelongsToLibrary(descriptor.objectKey, options.libraryId)) {
      throw new TypeError("media blob does not belong to this library");
    }
    const expectedProperties = await mediaBlobProperties(descriptor);
    const metadata = await readDriveFileMetadata({
      accessToken: options.accessToken,
      fileId,
      googleFetch,
      signal: options.signal,
    });
    if (metadata.id !== fileId || metadata.size !== descriptor.byteLength) {
      throw new Error(
        `media blob Drive metadata mismatch for ${descriptor.objectKey}`,
      );
    }
    assertExpectedProperties(
      metadata.appProperties,
      expectedProperties,
      `media blob Drive object ${descriptor.objectKey}`,
    );
    const storedDigest = await readMediaBlobDigest({
      accessToken: options.accessToken,
      fileId,
      googleFetch,
      signal: options.signal,
      byteLength: descriptor.byteLength,
    });
    if (storedDigest !== descriptor.blobContentDigest) {
      throw new Error(
        `media blob Drive digest mismatch for ${descriptor.objectKey}`,
      );
    }
    return descriptor;
  }

  async function discoverVerifiedMediaBlob(
    descriptor: LibraryCoreMediaBlobDescriptorV1,
    properties: Readonly<Record<string, string>>,
  ): Promise<string | null> {
    const existing = await listDriveFilesByProperties({
      accessToken: options.accessToken,
      properties,
      googleFetch,
      signal: options.signal,
      maxFiles: MAX_DUPLICATE_IMMUTABLE_OBJECTS,
    });
    if (existing.length === 0) return null;
    const ordered = [...existing].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    for (const candidate of ordered) {
      await verifyMediaBlobAtFile(descriptor, candidate.id);
    }
    return ordered[0]?.id ?? null;
  }

  async function initiateResumableSession(
    descriptor: LibraryCoreMediaBlobDescriptorV1,
    properties: Readonly<Record<string, string>>,
  ): Promise<string> {
    const response = await googleFetch(
      `${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,name,size,appProperties`,
      {
        method: "POST",
        headers: {
          ...authorizationHeaders(options.accessToken),
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "application/octet-stream",
          "X-Upload-Content-Length": descriptor.byteLength.toLocaleString(
            "en-US",
            { useGrouping: false },
          ),
        },
        body: JSON.stringify({
          name: descriptor.objectKey,
          parents: ["appDataFolder"],
          appProperties: properties,
        }),
        redirect: "error",
        signal: options.signal,
      },
    );
    if (!response.ok) {
      throw await responseError(
        `media blob Drive session failed for ${descriptor.objectKey}`,
        response,
      );
    }
    return parseGoogleDriveResumableSessionUrl(
      response.headers.get("Location"),
    );
  }

  async function acceptCompletedUpload(
    response: Response,
    descriptor: LibraryCoreMediaBlobDescriptorV1,
  ): Promise<string> {
    const metadata = await parseDriveUploadMetadata(
      response,
      "media blob Drive upload response",
    );
    await verifyMediaBlobAtFile(descriptor, metadata.id);
    return metadata.id;
  }

  return Object.freeze({
    async putMediaBlob(
      blob: LibraryCorePreparedMediaBlobV1,
    ): Promise<{ readonly transportObjectId: string }> {
      const descriptor = parseLibraryCoreMediaBlobDescriptorV1(
        blob.descriptor,
      );
      if (!objectKeyBelongsToLibrary(descriptor.objectKey, options.libraryId)) {
        throw new TypeError("media blob does not belong to this library");
      }
      await verifyLocalMediaBlobSource(descriptor, blob.source);
      const properties = await mediaBlobProperties(descriptor);
      const existing = await discoverVerifiedMediaBlob(
        descriptor,
        properties,
      );
      if (existing !== null) {
        return Object.freeze({ transportObjectId: existing });
      }

      for (
        let sessionAttempt = 0;
        sessionAttempt <= MAX_RESUMABLE_SESSION_RESTARTS;
        sessionAttempt += 1
      ) {
        const sessionUrl = await initiateResumableSession(
          descriptor,
          properties,
        );
        let offset = 0;
        let consecutiveChunkRecoveries = 0;
        for (;;) {
          const byteLength =
            descriptor.byteLength === 0
              ? 0
              : Math.min(
                  LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES,
                  descriptor.byteLength - offset,
                );
          const endOffset = offset + byteLength;
          const finalRequest = endOffset === descriptor.byteLength;
          const sourceBytes =
            byteLength === 0
              ? new Uint8Array()
              : await readExactMediaBlobSourceRange(
                  blob.source,
                  offset,
                  byteLength,
                );
          let response: Response;
          let responseFromStatusQuery = false;
          try {
            response = await googleFetch(sessionUrl, {
              method: "PUT",
              headers: {
                ...authorizationHeaders(options.accessToken),
                "Content-Type": "application/octet-stream",
                "Content-Range":
                  descriptor.byteLength === 0
                    ? "bytes */0"
                    : `bytes ${offset.toLocaleString("en-US", {
                        useGrouping: false,
                      })}-${(endOffset - 1).toLocaleString("en-US", {
                        useGrouping: false,
                      })}/${descriptor.byteLength.toLocaleString("en-US", {
                        useGrouping: false,
                      })}`,
              },
              body: exactArrayBuffer(sourceBytes),
              redirect: "error",
              signal: options.signal,
            });
          } catch (uploadError) {
            const recovered = await discoverVerifiedMediaBlob(
              descriptor,
              properties,
            );
            if (recovered !== null) {
              return Object.freeze({ transportObjectId: recovered });
            }
            try {
              responseFromStatusQuery = true;
              response = await googleFetch(sessionUrl, {
                method: "PUT",
                headers: {
                  ...authorizationHeaders(options.accessToken),
                  "Content-Range": `bytes */${descriptor.byteLength.toLocaleString(
                    "en-US",
                    { useGrouping: false },
                  )}`,
                },
                body: new ArrayBuffer(0),
                redirect: "error",
                signal: options.signal,
              });
            } catch {
              throw uploadError;
            }
          }

          if (response.ok) {
            if (!finalRequest && !responseFromStatusQuery) {
              throw new Error(
                "Google Drive completed a resumable upload before all blob bytes",
              );
            }
            try {
              return Object.freeze({
                transportObjectId: await acceptCompletedUpload(
                  response,
                  descriptor,
                ),
              });
            } catch (completionError) {
              const recovered = await discoverVerifiedMediaBlob(
                descriptor,
                properties,
              );
              if (recovered !== null) {
                return Object.freeze({ transportObjectId: recovered });
              }
              throw completionError;
            }
          }
          if (response.status === 308) {
            const nextOffset = parseResumableAcknowledgedOffset(
              response,
              descriptor.byteLength,
              endOffset,
            );
            if (nextOffset === descriptor.byteLength) {
              const recovered = await discoverVerifiedMediaBlob(
                descriptor,
                properties,
              );
              if (recovered !== null) {
                return Object.freeze({ transportObjectId: recovered });
              }
              throw new Error(
                "Google Drive acknowledged the complete blob without a discoverable object",
              );
            }
            if (
              descriptor.byteLength === 0 ||
              nextOffset < offset
            ) {
              throw new Error(
                "Google Drive resumable upload did not make valid progress",
              );
            }
            if (nextOffset === offset) {
              if (!responseFromStatusQuery || sourceBytes.byteLength === 0) {
                throw new Error(
                  "Google Drive resumable upload did not make valid progress",
                );
              }
              consecutiveChunkRecoveries += 1;
              if (
                consecutiveChunkRecoveries > MAX_RESUMABLE_CHUNK_RECOVERIES
              ) {
                throw new Error(
                  "Google Drive resumable upload exhausted chunk response recovery",
                );
              }
              continue;
            }
            consecutiveChunkRecoveries = 0;
            offset = nextOffset;
            continue;
          }
          if (response.status === 404 || response.status === 410) {
            const recovered = await discoverVerifiedMediaBlob(
              descriptor,
              properties,
            );
            if (recovered !== null) {
              return Object.freeze({ transportObjectId: recovered });
            }
            break;
          }
          if (finalRequest) {
            const recovered = await discoverVerifiedMediaBlob(
              descriptor,
              properties,
            );
            if (recovered !== null) {
              return Object.freeze({ transportObjectId: recovered });
            }
          }
          throw await responseError(
            `media blob Drive upload failed for ${descriptor.objectKey}`,
            response,
          );
        }
      }
      throw new Error(
        `media blob Drive upload exhausted ${MAX_RESUMABLE_SESSION_RESTARTS.toLocaleString()} session restarts`,
      );
    },

    async verifyMediaBlob(
      reference: LibraryCoreMediaBlobReferenceV1,
    ): Promise<LibraryCoreMediaBlobDescriptorV1> {
      const parsed = parseLibraryCoreMediaBlobReferenceV1(reference);
      return verifyMediaBlobAtFile(
        parsed.descriptor,
        parsed.transportObjectId,
      );
    },
  });
}

/**
 * Create the shared Google Drive adapter for Library Core objects.
 *
 * The adapter owns no timer, scheduler, or OAuth acquisition. Freed Desktop
 * and the PWA consume it through their platform fetch and runtime boundaries.
 */
export function createGoogleDriveLibraryCoreAdapterV1(
  options: GoogleDriveLibraryCoreAdapterOptionsV1,
): LibraryCoreImmutablePublicationAdapterV1<Uint8Array> &
  LibraryCoreImmutableReadAdapterV1 {
  assertBoundedText(
    options.accessToken,
    "Google Drive access token",
    MAX_ACCESS_TOKEN_BYTES,
  );
  assertLibraryId(options.libraryId);
  assertBoundedText(
    options.controlFileId,
    "Google Drive control file id",
    MAX_DRIVE_FILE_ID_BYTES,
  );
  const googleFetch = options.googleFetch ?? defaultGoogleDriveFetch();
  const libraryDigestPromise = libraryIdentityDigest(options.libraryId);

  async function readDescriptorAtFile(
    descriptorInput: LibraryCoreImmutableObjectDescriptorV1,
    fileId: string,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
  }> {
    const descriptor =
      parseLibraryCoreImmutableObjectDescriptorV1(descriptorInput);
    if (!objectKeyBelongsToLibrary(descriptor.objectKey, options.libraryId)) {
      throw new TypeError(
        "immutable object descriptor does not belong to this library",
      );
    }
    if (descriptor.byteLength > LIBRARY_CORE_GOOGLE_DRIVE_SIMPLE_UPLOAD_LIMIT) {
      throw new RangeError(
        "immutable object requires the resumable large-blob adapter",
      );
    }
    const keyDigest = await objectKeyDigest(descriptor.objectKey);
    const expectedProperties = immutableAppProperties(
      await libraryDigestPromise,
      descriptor,
      keyDigest,
    );
    const metadata = await readDriveFileMetadata({
      accessToken: options.accessToken,
      fileId,
      googleFetch,
      signal: options.signal,
    });
    if (metadata.id !== fileId || metadata.size !== descriptor.byteLength) {
      throw new Error(
        `immutable Drive metadata mismatch for ${descriptor.objectKey}`,
      );
    }
    assertExpectedProperties(
      metadata.appProperties,
      expectedProperties,
      `immutable Drive object ${descriptor.objectKey}`,
    );
    const storedBytes = await readDriveFileBytes({
      accessToken: options.accessToken,
      fileId,
      googleFetch,
      signal: options.signal,
      maxBytes: descriptor.byteLength,
      label: `immutable Drive object ${descriptor.objectKey}`,
    });
    if (storedBytes.byteLength !== descriptor.byteLength) {
      throw new Error(
        `immutable Drive byte length mismatch for ${descriptor.objectKey}`,
      );
    }
    const storedDigest = await sha256Hex(storedBytes);
    if (storedDigest !== descriptor.contentDigest) {
      throw new Error(
        `immutable Drive digest mismatch for ${descriptor.objectKey}`,
      );
    }
    return Object.freeze({
      bytes: storedBytes,
      descriptor,
    });
  }

  async function verifyDescriptorAtFile(
    descriptorInput: LibraryCoreImmutableObjectDescriptorV1,
    fileId: string,
  ): Promise<LibraryCoreImmutableObjectDescriptorV1> {
    return (await readDescriptorAtFile(descriptorInput, fileId)).descriptor;
  }

  const readControl = async (): Promise<LibraryCoreControlReadV1> => {
    const stored = await readDriveFileWithRevision({
      accessToken: options.accessToken,
      fileId: options.controlFileId,
      googleFetch,
      signal: options.signal,
      maxBytes: MAX_CONTROL_BYTES,
      label: "Library Core Drive control read failed",
    });
    return Object.freeze({
      revision: stored.revision,
      bytes: stored.bytes,
    });
  };

  return Object.freeze({
    readControl,

    async putImmutable(
      object: LibraryCorePreparedImmutableObjectV1<Uint8Array>,
    ): Promise<{ readonly transportObjectId: string }> {
      const descriptor = parseLibraryCoreImmutableObjectDescriptorV1(
        object.descriptor,
      );
      if (
        !ArrayBuffer.isView(object.source) ||
        Object.prototype.toString.call(object.source) !==
          "[object Uint8Array]" ||
        object.source.BYTES_PER_ELEMENT !== 1
      ) {
        throw new TypeError("immutable object source must be a Uint8Array");
      }
      if (!objectKeyBelongsToLibrary(descriptor.objectKey, options.libraryId)) {
        throw new TypeError(
          "immutable object descriptor does not belong to this library",
        );
      }
      if (
        descriptor.byteLength > LIBRARY_CORE_GOOGLE_DRIVE_SIMPLE_UPLOAD_LIMIT
      ) {
        throw new RangeError(
          "immutable object requires the resumable large-blob adapter",
        );
      }
      if (object.source.byteLength !== descriptor.byteLength) {
        throw new Error("immutable object source byte length is incorrect");
      }
      const sourceDigest = await sha256Hex(object.source);
      if (sourceDigest !== descriptor.contentDigest) {
        throw new Error("immutable object source digest is incorrect");
      }

      const keyDigest = await objectKeyDigest(descriptor.objectKey);
      const properties = immutableAppProperties(
        await libraryDigestPromise,
        descriptor,
        keyDigest,
      );
      const existing = await listDriveFilesByProperties({
        accessToken: options.accessToken,
        properties,
        googleFetch,
        signal: options.signal,
        maxFiles: MAX_DUPLICATE_IMMUTABLE_OBJECTS,
      });
      if (existing.length > 0) {
        const ordered = [...existing].sort((left, right) =>
          left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
        );
        for (const candidate of ordered) {
          await verifyDescriptorAtFile(descriptor, candidate.id);
        }
        const selected = ordered[0];
        if (selected === undefined) {
          throw new Error("immutable Drive object lookup was inconsistent");
        }
        return Object.freeze({ transportObjectId: selected.id });
      }

      const boundary = `freed-${descriptor.contentDigest.slice(0, 32)}`;
      const response = await googleFetch(
        `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,size,appProperties`,
        {
          method: "POST",
          headers: {
            ...authorizationHeaders(options.accessToken),
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartUploadBody(
            boundary,
            {
              name: descriptor.objectKey,
              parents: ["appDataFolder"],
              appProperties: properties,
            },
            object.source,
          ),
          signal: options.signal,
        },
      );
      if (!response.ok) {
        throw await responseError(
          `immutable Drive upload failed for ${descriptor.objectKey}`,
          response,
        );
      }
      const responseBytes = await readBoundedResponseBytes(
        response,
        MAX_DRIVE_JSON_BYTES,
        "immutable Drive upload response",
      );
      const stored = parseDriveFileMetadata(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(responseBytes),
        ),
      );
      await verifyDescriptorAtFile(descriptor, stored.id);
      return Object.freeze({ transportObjectId: stored.id });
    },

    async verifyImmutable(
      receipt: LibraryCorePublishedImmutableObjectReceiptV1,
    ): Promise<LibraryCoreImmutableObjectDescriptorV1> {
      assertBoundedText(
        receipt.transportObjectId,
        "immutable Drive file id",
        MAX_DRIVE_FILE_ID_BYTES,
      );
      return verifyDescriptorAtFile(
        receipt.descriptor,
        receipt.transportObjectId,
      );
    },

    async readImmutable(
      receipt: LibraryCorePublishedImmutableObjectReceiptV1,
    ): Promise<Uint8Array> {
      assertBoundedText(
        receipt.transportObjectId,
        "immutable Drive file id",
        MAX_DRIVE_FILE_ID_BYTES,
      );
      return (
        await readDescriptorAtFile(
          receipt.descriptor,
          receipt.transportObjectId,
        )
      ).bytes;
    },

    async compareAndSwapControl(input: {
      readonly expectedRevision: string | null;
      readonly bytes: Uint8Array;
    }): Promise<LibraryCoreControlCompareAndSwapResultV1> {
      const expectedRevision = parseStrongDriveEtag(
        input.expectedRevision,
        "expected Drive control revision",
      );
      if (
        !ArrayBuffer.isView(input.bytes) ||
        Object.prototype.toString.call(input.bytes) !== "[object Uint8Array]" ||
        input.bytes.BYTES_PER_ELEMENT !== 1
      ) {
        throw new TypeError("control bytes must be a Uint8Array");
      }
      if (
        input.bytes.byteLength === 0 ||
        input.bytes.byteLength > MAX_CONTROL_BYTES
      ) {
        throw new RangeError(
          `control bytes must contain 1 to ${MAX_CONTROL_BYTES.toLocaleString()} bytes`,
        );
      }
      const response = await googleFetch(
        `${DRIVE_V2_UPLOAD_URL}/${encodeURIComponent(
          options.controlFileId,
        )}?uploadType=media&fields=id,etag`,
        {
          method: "PUT",
          headers: {
            ...authorizationHeaders(options.accessToken),
            "Content-Type": "application/json; charset=UTF-8",
            "If-Match": expectedRevision,
          },
          body: exactArrayBuffer(input.bytes),
          signal: options.signal,
        },
      );
      if (response.status === 412) {
        return Object.freeze({
          status: "conflict",
          current: await readControl(),
        });
      }
      if (!response.ok) {
        throw await responseError(
          "Library Core Drive control update failed",
          response,
        );
      }
      const readback = await readControl();
      if (
        readback.revision === null ||
        readback.bytes === null ||
        !bytesEqual(readback.bytes, input.bytes)
      ) {
        throw new Error(
          "Library Core Drive control readback did not match committed bytes",
        );
      }
      return Object.freeze({
        status: "committed",
        revision: readback.revision,
      });
    },
  });
}
