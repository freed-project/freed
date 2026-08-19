import { describe, expect, it } from "vitest";

import {
  createLibraryCoreMediaBlobObjectKey,
  digestLibraryCoreMediaBlobBytesV1,
  parseLibraryCoreMediaBlobDescriptorV1,
  type LibraryCoreMediaBlobDescriptorV1,
} from "@freed/shared/library-core";
import {
  LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES,
  createGoogleDriveLibraryCoreMediaBlobAdapterV1,
} from "./library-core-google-drive-adapter.js";
import type { LibraryCoreMediaBlobSourceV1 } from "./library-core-media-blob.js";

interface StoredFile {
  readonly id: string;
  readonly name: string;
  bytes: Uint8Array;
  readonly appProperties: Record<string, string>;
}

interface UploadSession {
  readonly id: string;
  readonly totalByteLength: number;
  readonly metadata: {
    readonly name: string;
    readonly appProperties: Record<string, string>;
  };
  readonly chunks: Uint8Array[];
  offset: number;
  completedFileId: string | null;
}

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly bodyByteLength: number;
  readonly redirect: RequestRedirect | undefined;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const byteLength = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

class FakeResumableGoogleDrive {
  readonly files = new Map<string, StoredFile>();
  readonly sessions = new Map<string, UploadSession>();
  readonly requests: RecordedRequest[] = [];
  expireFirstSessionWith: 404 | 410 | null = null;
  invalidSessionLocation: string | null = null;
  loseChunkBeforeAcceptAtOffset: number | null = null;
  loseChunkResponseAtOffset: number | null = null;
  loseFinalResponse = false;
  corruptCompletedBytes = false;
  private expiredFirstSession = false;
  private lostFinalResponse = false;
  private lostChunkBeforeAccept = false;
  private lostChunkResponse = false;
  private nextSession = 1;
  private nextFile = 1;

  async addExisting(
    descriptor: LibraryCoreMediaBlobDescriptorV1,
    bytes: Uint8Array,
    id = "blob-existing",
  ): Promise<void> {
    this.files.set(id, {
      id,
      name: descriptor.objectKey,
      bytes: bytes.slice(),
      appProperties: await this.properties(descriptor),
    });
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input);
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const bodyByteLength =
      init.body instanceof ArrayBuffer ? init.body.byteLength : 0;
    this.requests.push({
      url,
      method,
      headers,
      bodyByteLength,
      redirect: init.redirect,
    });

    if (
      method === "GET" &&
      parsed.pathname === "/drive/v3/files"
    ) {
      const query = parsed.searchParams.get("q") ?? "";
      const properties = new Map<string, string>();
      for (const match of query.matchAll(
        /appProperties has \{ key='([^']+)' and value='([^']*)' \}/gu,
      )) {
        const key = match[1];
        const value = match[2];
        if (key !== undefined && value !== undefined) {
          properties.set(key, value);
        }
      }
      const files = [...this.files.values()].filter((file) =>
        [...properties].every(
          ([key, value]) => file.appProperties[key] === value,
        ),
      );
      return Response.json({ files: files.map((file) => this.metadata(file)) });
    }

    if (
      method === "POST" &&
      parsed.pathname === "/upload/drive/v3/files" &&
      parsed.searchParams.get("uploadType") === "resumable"
    ) {
      if (typeof init.body !== "string") {
        return new Response("expected JSON metadata", { status: 400 });
      }
      const metadata = JSON.parse(init.body) as {
        readonly name: string;
        readonly appProperties: Record<string, string>;
      };
      const id = `session-${this.nextSession}`;
      this.nextSession += 1;
      this.sessions.set(id, {
        id,
        totalByteLength: Number(headers.get("X-Upload-Content-Length")),
        metadata,
        chunks: [],
        offset: 0,
        completedFileId: null,
      });
      return new Response(null, {
        status: 200,
        headers: {
          Location:
            this.invalidSessionLocation ??
            `https://www.googleapis.com/resumable/upload/drive/v3/files/${id}?upload_id=${id}`,
        },
      });
    }

    const sessionMatch =
      /^\/resumable\/upload\/drive\/v3\/files\/(session-[0-9]+)$/u.exec(
        parsed.pathname,
      );
    if (method === "PUT" && sessionMatch !== null) {
      const session = this.sessions.get(sessionMatch[1] ?? "");
      if (session === undefined) return new Response("missing", { status: 404 });
      if (
        this.expireFirstSessionWith !== null &&
        session.id === "session-1" &&
        !this.expiredFirstSession
      ) {
        this.expiredFirstSession = true;
        return new Response("expired", {
          status: this.expireFirstSessionWith,
        });
      }
      const contentRange = headers.get("Content-Range") ?? "";
      const queryMatch = /^bytes \*\/(0|[1-9][0-9]*)$/u.exec(contentRange);
      if (queryMatch !== null) {
        if (session.completedFileId !== null) {
          const completed = this.files.get(session.completedFileId)!;
          return Response.json(this.metadata(completed));
        }
        if (session.totalByteLength === 0) {
          return this.complete(session);
        }
        return new Response(null, {
          status: 308,
          headers:
            session.offset === 0
              ? undefined
              : { Range: `bytes=0-${session.offset - 1}` },
        });
      }
      const chunkMatch =
        /^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/u.exec(
          contentRange,
        );
      if (chunkMatch === null || !(init.body instanceof ArrayBuffer)) {
        return new Response("invalid chunk", { status: 400 });
      }
      const start = Number(chunkMatch[1]);
      const end = Number(chunkMatch[2]);
      const total = Number(chunkMatch[3]);
      if (
        start !== session.offset ||
        end - start + 1 !== init.body.byteLength ||
        total !== session.totalByteLength
      ) {
        return new Response("wrong chunk range", { status: 400 });
      }
      if (
        this.loseChunkBeforeAcceptAtOffset === start &&
        !this.lostChunkBeforeAccept
      ) {
        this.lostChunkBeforeAccept = true;
        throw new TypeError("simulated pre-accept chunk loss");
      }
      session.chunks.push(new Uint8Array(init.body).slice());
      session.offset = end + 1;
      if (session.offset < session.totalByteLength) {
        if (
          this.loseChunkResponseAtOffset === start &&
          !this.lostChunkResponse
        ) {
          this.lostChunkResponse = true;
          throw new TypeError("simulated lost chunk response");
        }
        return new Response(null, {
          status: 308,
          headers: { Range: `bytes=0-${session.offset - 1}` },
        });
      }
      const response = await this.complete(session);
      if (this.loseFinalResponse && !this.lostFinalResponse) {
        this.lostFinalResponse = true;
        throw new TypeError("simulated lost final response");
      }
      return response;
    }

    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/u.exec(
      parsed.pathname,
    );
    if (method === "GET" && fileMatch !== null) {
      const file = this.files.get(decodeURIComponent(fileMatch[1] ?? ""));
      if (file === undefined) return new Response("missing", { status: 404 });
      if (parsed.searchParams.get("alt") !== "media") {
        return Response.json(this.metadata(file));
      }
      const range = headers.get("Range");
      if (file.bytes.byteLength === 0 && range === null) {
        return new Response(new ArrayBuffer(0), {
          headers: { "Content-Length": "0" },
        });
      }
      const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/u.exec(
        range ?? "",
      );
      if (match === null) return new Response("range required", { status: 400 });
      const start = Number(match[1]);
      const end = Number(match[2]);
      const responseBytes = file.bytes.slice(start, end + 1);
      return new Response(exactArrayBuffer(responseBytes), {
        status: 206,
        headers: {
          "Content-Length": String(responseBytes.byteLength),
          "Content-Range": `bytes ${start}-${end}/${file.bytes.byteLength}`,
        },
      });
    }

    return new Response(`unhandled ${method} ${url}`, { status: 500 });
  };

  private async properties(
    descriptor: LibraryCoreMediaBlobDescriptorV1,
  ): Promise<Record<string, string>> {
    return {
      freedProtocol: "library-core-v1",
      freedLibraryDigest: await sha256Hex(new TextEncoder().encode("library-1")),
      freedObjectKind: "blob",
      freedObjectKeyDigest: await sha256Hex(
        new TextEncoder().encode(descriptor.objectKey),
      ),
      freedContentDigest: descriptor.blobContentDigest,
      freedDigestDomain: "blob-content",
    };
  }

  private async complete(session: UploadSession): Promise<Response> {
    const id = `blob-${this.nextFile}`;
    this.nextFile += 1;
    const bytes = concatenate(session.chunks);
    if (this.corruptCompletedBytes && bytes.byteLength > 0) {
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    }
    const file: StoredFile = {
      id,
      name: session.metadata.name,
      bytes,
      appProperties: { ...session.metadata.appProperties },
    };
    this.files.set(id, file);
    session.completedFileId = id;
    return Response.json(this.metadata(file));
  }

  private metadata(file: StoredFile): Record<string, unknown> {
    return {
      id: file.id,
      name: file.name,
      size: String(file.bytes.byteLength),
      appProperties: file.appProperties,
    };
  }
}

function mediaBytes(byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    result[index] = index % 251;
  }
  return result;
}

function fixture(value: Uint8Array): {
  readonly descriptor: LibraryCoreMediaBlobDescriptorV1;
  readonly source: LibraryCoreMediaBlobSourceV1;
  readonly reads: Array<{ readonly offset: number; readonly byteLength: number }>;
} {
  const blobContentDigest = digestLibraryCoreMediaBlobBytesV1(value);
  const descriptor = parseLibraryCoreMediaBlobDescriptorV1({
    objectKey: createLibraryCoreMediaBlobObjectKey({
      libraryId: "library-1",
      blobContentDigest,
    }),
    blobContentDigest,
    byteLength: value.byteLength,
  });
  const reads: Array<{ readonly offset: number; readonly byteLength: number }> = [];
  return {
    descriptor,
    reads,
    source: {
      byteLength: value.byteLength,
      async readRange(input) {
        reads.push(input);
        return value.slice(input.offset, input.offset + input.byteLength);
      },
    },
  };
}

function adapter(fake: FakeResumableGoogleDrive) {
  return createGoogleDriveLibraryCoreMediaBlobAdapterV1({
    accessToken: "test-token",
    libraryId: "library-1",
    googleFetch: fake.fetch,
  });
}

describe("Google Drive Library Core media blob adapter", () => {
  it("uploads and verifies a large blob in exact bounded resumable chunks", async () => {
    const fake = new FakeResumableGoogleDrive();
    const blob = fixture(
      mediaBytes(2 * LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES + 37),
    );

    await expect(adapter(fake).putMediaBlob(blob)).resolves.toEqual({
      transportObjectId: "blob-1",
    });
    const uploads = fake.requests.filter(
      (request) =>
        request.method === "PUT" &&
        request.headers.get("Content-Range")?.startsWith("bytes ") === true &&
        request.bodyByteLength > 0,
    );
    expect(uploads.map((request) => request.bodyByteLength)).toEqual([
      LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES,
      LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES,
      37,
    ]);
    expect(uploads.every((request) => request.redirect === "error")).toBe(
      true,
    );
    expect(uploads.map((request) => request.headers.get("Content-Range"))).toEqual([
      `bytes 0-${LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES - 1}/${blob.descriptor.byteLength}`,
      `bytes ${LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES}-${2 * LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES - 1}/${blob.descriptor.byteLength}`,
      `bytes ${2 * LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES}-${blob.descriptor.byteLength - 1}/${blob.descriptor.byteLength}`,
    ]);
    expect(
      Math.max(...blob.reads.map((read) => read.byteLength)),
    ).toBe(LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES);
    await expect(
      adapter(fake).verifyMediaBlob({
        descriptor: blob.descriptor,
        transportObjectId: "blob-1",
      }),
    ).resolves.toEqual(blob.descriptor);
  });

  it("publishes and verifies the valid zero-byte blob", async () => {
    const fake = new FakeResumableGoogleDrive();
    const blob = fixture(new Uint8Array());

    await expect(adapter(fake).putMediaBlob(blob)).resolves.toEqual({
      transportObjectId: "blob-1",
    });
    expect(blob.reads).toEqual([]);
    const finalRequest = fake.requests.find(
      (request) => request.headers.get("Content-Range") === "bytes */0",
    );
    expect(finalRequest?.bodyByteLength).toBe(0);
    await expect(
      adapter(fake).verifyMediaBlob({
        descriptor: blob.descriptor,
        transportObjectId: "blob-1",
      }),
    ).resolves.toEqual(blob.descriptor);
  });

  it.each([404, 410] as const)(
    "restarts an expired resumable session after %s",
    async (status) => {
      const fake = new FakeResumableGoogleDrive();
      fake.expireFirstSessionWith = status;
      const blob = fixture(mediaBytes(1_048_577));

      await expect(adapter(fake).putMediaBlob(blob)).resolves.toEqual({
        transportObjectId: "blob-1",
      });
      expect(fake.sessions.size).toBe(2);
      expect(
        fake.requests.filter(
          (request) =>
            request.method === "POST" &&
            new URL(request.url).searchParams.get("uploadType") === "resumable",
        ),
      ).toHaveLength(2);
    },
  );

  it("discovers and verifies a completed object after the final response is lost", async () => {
    const fake = new FakeResumableGoogleDrive();
    fake.loseFinalResponse = true;
    const blob = fixture(mediaBytes(1_048_577));

    await expect(adapter(fake).putMediaBlob(blob)).resolves.toEqual({
      transportObjectId: "blob-1",
    });
    expect(fake.sessions.size).toBe(1);
    expect(
      fake.requests.filter(
        (request) =>
          request.method === "GET" &&
          new URL(request.url).pathname === "/drive/v3/files",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("queries a lost chunk response and resumes from the exact 308 offset", async () => {
    const fake = new FakeResumableGoogleDrive();
    fake.loseChunkResponseAtOffset = 0;
    const blob = fixture(
      mediaBytes(2 * LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES + 1),
    );

    await expect(adapter(fake).putMediaBlob(blob)).resolves.toEqual({
      transportObjectId: "blob-1",
    });
    expect(
      fake.requests.some(
        (request) =>
          request.method === "PUT" &&
          request.bodyByteLength === 0 &&
          request.headers.get("Content-Range") ===
            `bytes */${blob.descriptor.byteLength}`,
      ),
    ).toBe(true);
    expect(fake.sessions.size).toBe(1);
  });

  it("resends the same bounded chunk when a status query reports no progress", async () => {
    const fake = new FakeResumableGoogleDrive();
    fake.loseChunkBeforeAcceptAtOffset = 0;
    const blob = fixture(mediaBytes(1_048_577));

    await expect(adapter(fake).putMediaBlob(blob)).resolves.toEqual({
      transportObjectId: "blob-1",
    });
    const firstChunkRange =
      `bytes 0-${LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES - 1}/${blob.descriptor.byteLength}`;
    expect(
      fake.requests.filter(
        (request) => request.headers.get("Content-Range") === firstChunkRange,
      ),
    ).toHaveLength(2);
    expect(fake.sessions.size).toBe(1);
  });

  it("rejects an untrusted resumable session URL before sending blob bytes", async () => {
    const fake = new FakeResumableGoogleDrive();
    fake.invalidSessionLocation =
      "https://attacker.example/upload/drive/v3/files?upload_id=stolen";
    const blob = fixture(mediaBytes(32));

    await expect(adapter(fake).putMediaBlob(blob)).rejects.toThrow(
      "outside the trusted Drive upload endpoint",
    );
    expect(
      fake.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(0);
    expect(
      fake.requests.find((request) => request.method === "POST")?.redirect,
    ).toBe("error");
  });

  it("collapses an exact retry only after bounded remote readback", async () => {
    const fake = new FakeResumableGoogleDrive();
    const bytes = mediaBytes(1_048_577);
    const blob = fixture(bytes);
    await fake.addExisting(blob.descriptor, bytes, "blob-existing");

    await expect(adapter(fake).putMediaBlob(blob)).resolves.toEqual({
      transportObjectId: "blob-existing",
    });
    expect(
      fake.requests.some((request) => request.method === "POST"),
    ).toBe(false);
    expect(
      fake.requests
        .filter((request) => request.headers.has("Range"))
        .every(
          (request) =>
            Number(request.headers.get("Range")?.split("-").at(-1)) + 1 <=
            bytes.byteLength,
        ),
    ).toBe(true);
  });

  it("fails closed when remote readback does not match the blob identity", async () => {
    const fake = new FakeResumableGoogleDrive();
    fake.corruptCompletedBytes = true;
    const blob = fixture(mediaBytes(64));

    await expect(adapter(fake).putMediaBlob(blob)).rejects.toThrow(
      "digest mismatch",
    );
  });

  it("rejects a wrong local DB(blob-content) identity before any Drive call", async () => {
    const fake = new FakeResumableGoogleDrive();
    const blob = fixture(mediaBytes(64));
    const changed = mediaBytes(64);
    changed[0] = (changed[0] ?? 0) ^ 0xff;

    await expect(
      adapter(fake).putMediaBlob({
        descriptor: blob.descriptor,
        source: {
          byteLength: changed.byteLength,
          async readRange(input) {
            return changed.slice(
              input.offset,
              input.offset + input.byteLength,
            );
          },
        },
      }),
    ).rejects.toThrow("source digest is incorrect");
    expect(fake.requests).toHaveLength(0);
  });
});
