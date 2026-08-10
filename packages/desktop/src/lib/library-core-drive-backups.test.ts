import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlite = vi.hoisted(() => ({
  listBackups: vi.fn(),
  readChunk: vi.fn(),
}));

vi.mock("./sqlite-library", () => ({
  listSqliteLibraryBackups: sqlite.listBackups,
  readSqliteLibraryBackupChunk: sqlite.readChunk,
}));

import {
  mirrorSqliteLibraryBackupsToGoogleDrive,
  resetSqliteLibraryDriveBackupMirror,
} from "./library-core-drive-backups";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("SQLite Library Drive backups", () => {
  beforeEach(() => {
    resetSqliteLibraryDriveBackupMirror();
    sqlite.listBackups.mockReset();
    sqlite.readChunk.mockReset();
  });

  it("uploads the closed SQLite bytes before its immutable manifest and skips an unchanged generation", async () => {
    sqlite.listBackups.mockResolvedValue([{
      backupId: "backup-1",
      fileName: "backup-1.sqlite",
      createdAtMs: 1_700_000_000_000,
      revision: 42,
      itemCount: 17_000,
      reason: "auto",
      byteLength: 5,
      sha256: "a".repeat(64),
    }]);
    sqlite.readChunk.mockResolvedValue({
      backupId: "backup-1",
      bytes: [1, 2, 3, 4, 5],
      nextOffset: null,
      offset: 0,
      sha256: "a".repeat(64),
      totalByteLength: 5,
    });

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const googleFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("uploadType=resumable")) {
        const metadata = JSON.parse(String(init?.body)) as { name: string };
        const target = metadata.name.endsWith(".sqlite") ? "sqlite" : "manifest";
        return new Response(null, {
          status: 200,
          headers: { Location: `https://www.googleapis.com/upload/${target}` },
        });
      }
      if (url.includes("/drive/v3/files?") && init?.method !== "POST") {
        return jsonResponse({ files: [] });
      }
      if (url.includes("/drive/v3/files?") && init?.method === "POST") {
        return jsonResponse({
          id: "folder-1",
          name: "Freed Backups",
          size: "0",
          appProperties: {},
        });
      }
      if (url.endsWith("/upload/sqlite")) {
        return jsonResponse({
          id: "sqlite-1",
          name: "backup.sqlite",
          size: "5",
          appProperties: {
            backupId: "backup-1",
            sha256: "a".repeat(64),
          },
        });
      }
      if (url.endsWith("/upload/manifest")) {
        const body = init?.body as Uint8Array;
        const stored = new Uint8Array(new ArrayBuffer(body.byteLength));
        stored.set(body);
        (googleFetch as unknown as { manifestBytes?: Uint8Array<ArrayBuffer> }).manifestBytes = stored;
        return jsonResponse({
          id: "manifest-1",
          name: "manifest.json",
          size: String(body.byteLength),
          appProperties: { backupId: "backup-1" },
        });
      }
      if (url.includes("/drive/v3/files/manifest-1?alt=media")) {
        return new Response(
          (googleFetch as unknown as { manifestBytes: Uint8Array<ArrayBuffer> }).manifestBytes,
        );
      }
      throw new Error(`Unexpected Drive request: ${url}`);
    });

    const first = await mirrorSqliteLibraryBackupsToGoogleDrive({
      accessToken: "token",
      googleFetch,
      libraryId: "library-1",
    });
    expect(first).toEqual({ uploaded: 1, current: 1, removed: 0 });
    expect(sqlite.readChunk).toHaveBeenCalledWith({
      backupId: "backup-1",
      offset: 0,
      limit: 1_048_576,
    });
    const sqliteUpload = requests.find((request) => request.url.endsWith("/upload/sqlite"));
    expect(sqliteUpload?.init?.headers).toMatchObject({
      "Content-Range": "bytes 0-4/5",
    });
    const manifestUploadIndex = requests.findIndex((request) =>
      request.url.endsWith("/upload/manifest"),
    );
    const sqliteUploadIndex = requests.findIndex((request) =>
      request.url.endsWith("/upload/sqlite"),
    );
    expect(manifestUploadIndex).toBeGreaterThan(sqliteUploadIndex);
    expect(requests.map((request) => request.url).join(" ")).not.toMatch(/wal|shm/i);

    const requestCount = requests.length;
    const second = await mirrorSqliteLibraryBackupsToGoogleDrive({
      accessToken: "token",
      googleFetch,
      libraryId: "library-1",
    });
    expect(second).toEqual({ uploaded: 0, current: 1, removed: 0 });
    expect(requests).toHaveLength(requestCount);
  });
});
