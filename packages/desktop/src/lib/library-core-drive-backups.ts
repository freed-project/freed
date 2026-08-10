import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "@freed/shared/library-core";
import type { GoogleDriveFetch } from "@freed/sync/cloud";
import {
  listSqliteLibraryBackups,
  readSqliteLibraryBackupChunk,
  type SqliteLibraryBackupSummary,
} from "./sqlite-library";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const BACKUP_FOLDER_NAME = "Freed Backups";
const BACKUP_FOLDER_KIND = "freed-library-backup-folder-v1";
const BACKUP_SQLITE_KIND = "freed-library-backup-sqlite-v1";
const BACKUP_MANIFEST_KIND = "freed-library-backup-manifest-v1";
const BACKUP_CHUNK_BYTES = 1_048_576;
const MAX_BACKUPS = 24;
const MAX_DRIVE_RESPONSE_BYTES = 262_144;

interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly appProperties: Readonly<Record<string, string>>;
}

export interface GoogleDriveSqliteBackupMirrorResult {
  readonly uploaded: number;
  readonly current: number;
  readonly removed: number;
}

let lastAttemptedBackupSet: string | null = null;

export function resetSqliteLibraryDriveBackupMirror(): void {
  lastAttemptedBackupSet = null;
}

function driveHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

function quoteDriveQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function propertyQuery(key: string, value: string): string {
  return `appProperties has { key='${quoteDriveQuery(key)}' and value='${quoteDriveQuery(value)}' }`;
}

function exactBytes(bytes: readonly number[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new TypeError("SQLite backup chunk contains an invalid byte");
    }
    result[index] = value;
  }
  return result;
}

function requestBodyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  result.set(bytes);
  return result;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readBoundedJson(response: Response, label: string): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DRIVE_RESPONSE_BYTES) {
    throw new Error(`${label} exceeded the bounded Drive response size`);
  }
  if (bytes.byteLength === 0) return {};
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function driveError(label: string, response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(`${label} failed (${response.status}): ${body.slice(0, 4_096)}`);
}

function parseDriveFile(value: unknown): DriveFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Google Drive returned invalid file metadata");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new TypeError("Google Drive file metadata has no id");
  }
  if (typeof record.name !== "string" || record.name.length === 0) {
    throw new TypeError("Google Drive file metadata has no name");
  }
  const size = typeof record.size === "string" ? Number(record.size) : 0;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new TypeError("Google Drive file metadata has an invalid size");
  }
  const appProperties = record.appProperties;
  if (
    appProperties !== undefined
    && (!appProperties || typeof appProperties !== "object" || Array.isArray(appProperties))
  ) {
    throw new TypeError("Google Drive file metadata has invalid appProperties");
  }
  const parsedProperties: Record<string, string> = {};
  for (const [key, propertyValue] of Object.entries(appProperties ?? {})) {
    if (typeof propertyValue !== "string") {
      throw new TypeError("Google Drive appProperties must contain strings");
    }
    parsedProperties[key] = propertyValue;
  }
  return Object.freeze({
    id: record.id,
    name: record.name,
    size,
    appProperties: Object.freeze(parsedProperties),
  });
}

async function listDriveFiles(input: {
  readonly accessToken: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly query: string;
  readonly signal?: AbortSignal;
}): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: input.query,
    spaces: "drive",
    pageSize: "100",
    fields: "files(id,name,size,appProperties)",
  });
  const response = await input.googleFetch(`${DRIVE_FILES_URL}?${params}`, {
    headers: driveHeaders(input.accessToken),
    signal: input.signal,
  });
  if (!response.ok) throw await driveError("Google Drive backup discovery", response);
  const value = await readBoundedJson(response, "Google Drive backup discovery");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Google Drive backup discovery returned invalid JSON");
  }
  const files = (value as { files?: unknown }).files;
  if (!Array.isArray(files)) throw new TypeError("Google Drive backup discovery omitted files");
  return files.map(parseDriveFile);
}

async function findOrCreateBackupFolder(input: {
  readonly accessToken: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const query = [
    "trashed = false",
    "mimeType = 'application/vnd.google-apps.folder'",
    propertyQuery("kind", BACKUP_FOLDER_KIND),
    propertyQuery("libraryId", input.libraryId),
  ].join(" and ");
  const existing = await listDriveFiles({ ...input, query });
  if (existing.length > 1) {
    throw new Error("Google Drive contains more than one Freed Backups folder for this Library");
  }
  if (existing[0]) return existing[0].id;

  const response = await input.googleFetch(
    `${DRIVE_FILES_URL}?fields=id,name,size,appProperties`,
    {
      method: "POST",
      headers: {
        ...driveHeaders(input.accessToken),
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        name: BACKUP_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: {
          kind: BACKUP_FOLDER_KIND,
          libraryId: input.libraryId,
        },
      }),
      signal: input.signal,
    },
  );
  if (!response.ok) throw await driveError("Freed Backups folder creation", response);
  return parseDriveFile(await readBoundedJson(response, "Freed Backups folder creation")).id;
}

async function beginResumableUpload(input: {
  readonly accessToken: string;
  readonly appProperties: Readonly<Record<string, string>>;
  readonly byteLength: number;
  readonly contentType: string;
  readonly folderId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly name: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const response = await input.googleFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,name,size,appProperties`,
    {
      method: "POST",
      headers: {
        ...driveHeaders(input.accessToken),
        "Content-Type": "application/json; charset=utf-8",
        "X-Upload-Content-Length": input.byteLength.toLocaleString("en-US", {
          useGrouping: false,
        }),
        "X-Upload-Content-Type": input.contentType,
      },
      body: JSON.stringify({
        name: input.name,
        mimeType: input.contentType,
        parents: [input.folderId],
        appProperties: input.appProperties,
      }),
      signal: input.signal,
    },
  );
  if (!response.ok) throw await driveError("Google Drive backup upload session", response);
  const location = response.headers.get("location");
  if (!location || !location.startsWith("https://www.googleapis.com/")) {
    throw new Error("Google Drive backup upload session omitted its trusted upload URL");
  }
  return location;
}

async function uploadBytes(input: {
  readonly accessToken: string;
  readonly appProperties: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly folderId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly name: string;
  readonly signal?: AbortSignal;
}): Promise<DriveFile> {
  const location = await beginResumableUpload({ ...input, byteLength: input.bytes.byteLength });
  const response = await input.googleFetch(location, {
    method: "PUT",
    headers: {
      ...driveHeaders(input.accessToken),
      "Content-Range": `bytes 0-${input.bytes.byteLength - 1}/${input.bytes.byteLength}`,
      "Content-Type": input.contentType,
    },
    body: requestBodyBytes(input.bytes),
    signal: input.signal,
  });
  if (!response.ok) throw await driveError("Google Drive backup upload", response);
  const file = parseDriveFile(await readBoundedJson(response, "Google Drive backup upload"));
  if (file.size !== input.bytes.byteLength) {
    throw new Error("Google Drive backup upload returned the wrong byte length");
  }
  return file;
}

async function uploadSqliteBackup(input: {
  readonly accessToken: string;
  readonly backup: SqliteLibraryBackupSummary;
  readonly folderId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<DriveFile> {
  const location = await beginResumableUpload({
    ...input,
    appProperties: {
      kind: BACKUP_SQLITE_KIND,
      libraryId: input.libraryId,
      backupId: input.backup.backupId,
      sha256: input.backup.sha256,
    },
    byteLength: input.backup.byteLength,
    contentType: "application/vnd.sqlite3",
    name: `freed-v2-backup-sqlite-${input.libraryId}-${input.backup.backupId}-${input.backup.sha256}.sqlite`,
  });
  let offset = 0;
  let completed: DriveFile | null = null;
  while (offset < input.backup.byteLength) {
    const chunk = await readSqliteLibraryBackupChunk({
      backupId: input.backup.backupId,
      offset,
      limit: BACKUP_CHUNK_BYTES,
    });
    if (
      chunk.backupId !== input.backup.backupId
      || chunk.offset !== offset
      || chunk.totalByteLength !== input.backup.byteLength
      || chunk.sha256 !== input.backup.sha256
    ) {
      throw new Error("SQLite backup changed while its Drive upload was in progress");
    }
    const bytes = exactBytes(chunk.bytes);
    if (bytes.byteLength === 0) throw new Error("SQLite backup returned an empty upload chunk");
    const end = offset + bytes.byteLength - 1;
    const response = await input.googleFetch(location, {
      method: "PUT",
      headers: {
        ...driveHeaders(input.accessToken),
        "Content-Range": `bytes ${offset}-${end}/${input.backup.byteLength}`,
        "Content-Type": "application/vnd.sqlite3",
      },
      body: requestBodyBytes(bytes),
      signal: input.signal,
    });
    if (chunk.nextOffset === null) {
      if (!response.ok) throw await driveError("SQLite Drive backup upload", response);
      completed = parseDriveFile(await readBoundedJson(response, "SQLite Drive backup upload"));
    } else if (response.status !== 308) {
      throw await driveError("SQLite Drive backup chunk upload", response);
    }
    offset = chunk.nextOffset ?? input.backup.byteLength;
  }
  if (completed === null || completed.size !== input.backup.byteLength) {
    throw new Error("SQLite Drive backup did not finish at its exact byte length");
  }
  if (
    completed.appProperties.sha256 !== input.backup.sha256
    || completed.appProperties.backupId !== input.backup.backupId
  ) {
    throw new Error("SQLite Drive backup metadata does not match its immutable source");
  }
  return completed;
}

async function uploadManifest(input: {
  readonly accessToken: string;
  readonly backup: SqliteLibraryBackupSummary;
  readonly folderId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
  readonly sqliteFile: DriveFile;
}): Promise<DriveFile> {
  const bytes = encodeLibraryCoreCanonicalValue({
    schema_version: 1,
    kind: "library_core_sqlite_backup_manifest",
    library_id: input.libraryId,
    backup_id: input.backup.backupId,
    created_at_ms: input.backup.createdAtMs,
    revision: input.backup.revision,
    item_count: input.backup.itemCount,
    reason: input.backup.reason,
    sqlite: {
      drive_file_id: input.sqliteFile.id,
      byte_length: input.backup.byteLength,
      sha256: input.backup.sha256,
    },
    exclusions: [
      "sqlite_wal",
      "sqlite_shm",
      "oauth_tokens",
      "provider_sessions",
      "actor_private_keys",
    ],
  } as unknown as LibraryCoreCanonicalValue);
  const digest = await sha256Hex(bytes);
  const file = await uploadBytes({
    ...input,
    appProperties: {
      kind: BACKUP_MANIFEST_KIND,
      libraryId: input.libraryId,
      backupId: input.backup.backupId,
      sha256: digest,
      sqliteFileId: input.sqliteFile.id,
    },
    bytes,
    contentType: "application/json",
    name: `freed-v2-backup-manifest-${input.libraryId}-${input.backup.backupId}-${digest}.json`,
  });
  const response = await input.googleFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`,
    {
      headers: driveHeaders(input.accessToken),
      signal: input.signal,
    },
  );
  if (!response.ok) throw await driveError("Google Drive backup manifest readback", response);
  const stored = new Uint8Array(await response.arrayBuffer());
  if (stored.byteLength !== bytes.byteLength || await sha256Hex(stored) !== digest) {
    throw new Error("Google Drive backup manifest readback did not match its immutable bytes");
  }
  return file;
}

async function removeDriveFile(input: {
  readonly accessToken: string;
  readonly fileId: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const response = await input.googleFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}`,
    {
      method: "DELETE",
      headers: driveHeaders(input.accessToken),
      signal: input.signal,
    },
  );
  if (!response.ok && response.status !== 404) {
    throw await driveError("Google Drive backup retention", response);
  }
}

/** Mirror every retained closed SQLite generation into the private Drive folder. */
export async function mirrorSqliteLibraryBackupsToGoogleDrive(input: {
  readonly accessToken: string;
  readonly googleFetch: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<GoogleDriveSqliteBackupMirrorResult> {
  const localBackups = (await listSqliteLibraryBackups())
    .slice()
    .sort((left, right) => left.createdAtMs - right.createdAtMs);
  const backupSet = localBackups
    .map((backup) => `${backup.backupId}:${backup.sha256}:${backup.byteLength}`)
    .join("|");
  if (lastAttemptedBackupSet === backupSet) {
    return { uploaded: 0, current: localBackups.length, removed: 0 };
  }
  lastAttemptedBackupSet = backupSet;
  if (localBackups.length === 0) {
    return { uploaded: 0, current: 0, removed: 0 };
  }

  const folderId = await findOrCreateBackupFolder(input);
  const query = [
    "trashed = false",
    `'${quoteDriveQuery(folderId)}' in parents`,
    propertyQuery("kind", BACKUP_MANIFEST_KIND),
    propertyQuery("libraryId", input.libraryId),
  ].join(" and ");
  const manifestFiles = await listDriveFiles({ ...input, query });
  const manifestByBackupId = new Map(
    manifestFiles.map((file) => [file.appProperties.backupId, file] as const),
  );
  let uploaded = 0;
  for (const backup of localBackups) {
    if (manifestByBackupId.has(backup.backupId)) continue;
    const sqliteFile = await uploadSqliteBackup({ ...input, backup, folderId });
    const manifestFile = await uploadManifest({ ...input, backup, folderId, sqliteFile });
    manifestByBackupId.set(backup.backupId, manifestFile);
    uploaded += 1;
  }

  const retainedBackupIds = new Set(
    localBackups.slice(-MAX_BACKUPS).map((backup) => backup.backupId),
  );
  let removed = 0;
  for (const manifest of manifestFiles) {
    const backupId = manifest.appProperties.backupId;
    if (retainedBackupIds.has(backupId)) continue;
    const sqliteFileId = manifest.appProperties.sqliteFileId;
    await removeDriveFile({ ...input, fileId: manifest.id });
    if (sqliteFileId) await removeDriveFile({ ...input, fileId: sqliteFileId });
    removed += 1;
  }
  return {
    uploaded,
    current: localBackups.length,
    removed,
  };
}
