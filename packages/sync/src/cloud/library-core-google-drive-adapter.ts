import {
  isLibraryCoreOperationInstanceId,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreImmutableObjectDescriptorV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreControlCompareAndSwapResultV1,
  LibraryCoreControlReadV1,
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
  LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";
import type { GoogleDriveFetch } from "./gdrive.js";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const PROTOCOL_PROPERTY = "library-core-v1";
const MAX_ACCESS_TOKEN_BYTES = 16_384;
const MAX_DRIVE_FILE_ID_BYTES = 1_024;
const MAX_LIST_PAGES = 16;
const MAX_DUPLICATE_IMMUTABLE_OBJECTS = 8;
const MAX_CONTROL_BYTES = 65_536;
const MAX_DRIVE_JSON_BYTES = 262_144;
const MAX_DRIVE_ERROR_BYTES = 4_096;

/**
 * Ordinary Library Core wire objects remain below 5 MB so Google Drive can
 * publish them in one multipart request. Large media uses a separate resumable
 * content-addressed blob path.
 */
export const LIBRARY_CORE_GOOGLE_DRIVE_SIMPLE_UPLOAD_LIMIT = 5_000_000;

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
    readonly revision: string;
  };
  readonly libraryId: string;
}

export interface GoogleDriveLibraryCoreAdapterOptionsV1 {
  readonly accessToken: string;
  readonly libraryId: string;
  readonly controlFileId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
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

type LibraryCoreDriveObjectKind =
  | "epoch"
  | "enrollment"
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

function controlAppProperties(
  libraryDigest: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    freedProtocol: PROTOCOL_PROPERTY,
    freedLibraryDigest: libraryDigest,
    freedObjectKind: "control",
  });
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

async function readDriveFile(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly maxBytes: number;
  readonly label: string;
}): Promise<{ readonly revision: string; readonly bytes: Uint8Array }> {
  const response = await input.googleFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}?alt=media`,
    {
      headers: authorizationHeaders(input.accessToken),
      signal: input.signal,
    },
  );
  if (!response.ok) throw await responseError(input.label, response);
  const revision = response.headers.get("ETag");
  assertBoundedText(revision, `${input.label} ETag`, MAX_DRIVE_FILE_ID_BYTES);
  return {
    revision,
    bytes: await readBoundedResponseBytes(
      response,
      input.maxBytes,
      input.label,
    ),
  };
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
  const googleFetch = input.googleFetch ?? fetch;
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
  const googleFetch = input.googleFetch ?? fetch;
  const files = await listDriveFilesByProperties({
    accessToken: input.accessToken,
    properties: Object.freeze({
      freedProtocol: PROTOCOL_PROPERTY,
      freedObjectKind: "control",
    }),
    googleFetch,
    signal: input.signal,
    maxFiles: 1,
  });
  const file = files[0];
  if (file === undefined) return null;
  const control = await readDriveFile({
    accessToken: input.accessToken,
    fileId: file.id,
    googleFetch,
    signal: input.signal,
    maxBytes: MAX_CONTROL_BYTES,
    label: "Library Core Drive control discovery",
  });
  const decoded = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(control.bytes),
  );
  const pointer = parseLibraryCoreControlPointerV1(decoded);
  return Object.freeze({
    controlFileId: file.id,
    control: Object.freeze(control),
    libraryId: pointer.libraryId,
  });
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

  const googleFetch = input.googleFetch ?? fetch;
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

/**
 * Create the dormant Google Drive adapter for immutable Library Core objects.
 *
 * This adapter has no timer, poller, product caller, or provider action path.
 * Automerge remains replication authority until the replacement protocol is
 * separately activated.
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
  const googleFetch = options.googleFetch ?? fetch;
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
    const stored = await readDriveFile({
      accessToken: options.accessToken,
      fileId,
      googleFetch,
      signal: options.signal,
      maxBytes: descriptor.byteLength,
      label: `immutable Drive object ${descriptor.objectKey}`,
    });
    if (stored.bytes.byteLength !== descriptor.byteLength) {
      throw new Error(
        `immutable Drive byte length mismatch for ${descriptor.objectKey}`,
      );
    }
    const storedDigest = await sha256Hex(stored.bytes);
    if (storedDigest !== descriptor.contentDigest) {
      throw new Error(
        `immutable Drive digest mismatch for ${descriptor.objectKey}`,
      );
    }
    return Object.freeze({
      bytes: stored.bytes,
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
    const stored = await readDriveFile({
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
      assertBoundedText(
        input.expectedRevision,
        "expected Drive control revision",
        MAX_DRIVE_FILE_ID_BYTES,
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
        `${DRIVE_UPLOAD_URL}/${encodeURIComponent(
          options.controlFileId,
        )}?uploadType=media`,
        {
          method: "PATCH",
          headers: {
            ...authorizationHeaders(options.accessToken),
            "Content-Type": "application/json; charset=UTF-8",
            "If-Match": input.expectedRevision,
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
