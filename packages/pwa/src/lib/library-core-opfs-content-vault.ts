import {
  createLibraryCoreMediaBlobDigestStateV1,
  createLibraryCoreContentRangeStorageKeyV1,
  isLibraryCoreLowercaseHex64,
  LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES,
  parseLibraryCoreContentRangePublicationAbortV1,
  parseLibraryCoreContentRangePublicationAppendV1,
  parseLibraryCoreContentRangePublicationBeginV1,
  parseLibraryCoreContentRangePublicationFinalizeV1,
  parseLibraryCoreContentRangePublicationStatusV1,
  parseLibraryCoreContentRangeReadRequestV1,
  parseLibraryCoreContentRangeReadResponseV1,
  type LibraryCoreContentRangePublicationAbortV1,
  type LibraryCoreContentRangePublicationAppendV1,
  type LibraryCoreContentRangePublicationBeginV1,
  type LibraryCoreContentRangePublicationFinalizeV1,
  type LibraryCoreContentRangePublicationStatusV1,
  type LibraryCoreContentRangeReadRequestV1,
  type LibraryCoreContentRangeReadResponseV1,
  type LibraryCoreVerifiedContentRangeReceiptV1,
} from "@freed/shared/library-core";

import type { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import { PWA_LIBRARY_CORE_CONTENT_VAULT_DIRECTORY } from "./library-core-sqlite-storage";

const MAXIMUM_ACTIVE_PUBLICATIONS = 2;

export interface PwaContentRangeObjectWriterV1 {
  close(): Promise<void>;
  flush(): Promise<void>;
  write(bytes: Uint8Array, at: number): Promise<number>;
}

export interface PwaContentRangeObjectV1 {
  readonly storageKey: string;
  readonly writer: PwaContentRangeObjectWriterV1;
}

export interface PwaContentRangeStorageV1 {
  create(
    publicationId: string,
    storageKey: string,
  ): Promise<PwaContentRangeObjectV1>;
  remove(storageKey: string): Promise<void>;
  read(
    storageKey: string,
    at: number,
    maximumBytes: number,
  ): Promise<Uint8Array>;
  scan(
    visit: (
      entry: Readonly<{ byteLength: number; storageKey: string }>,
    ) => Promise<void>,
  ): Promise<void>;
  stat(storageKey: string): Promise<number | null>;
}

interface PublicationSession {
  readonly contentDigest: string;
  readonly expectedByteLength: number;
  readonly expectedRangeContentDigest: string;
  readonly hash: ReturnType<typeof createLibraryCoreMediaBlobDigestStateV1>;
  nextOffset: number;
  readonly publicationId: string;
  readonly rangeIndex: number;
  readonly storageKey: string;
  readonly writer: PwaContentRangeObjectWriterV1;
}

interface OpfsSyncAccessHandleV1 {
  close(): void;
  flush(): void;
  truncate(size: number): void;
  write(bytes: Uint8Array, options: { readonly at: number }): number;
}

interface OpfsDirectoryHandleV1 extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

export class PwaLibraryCoreOpfsContentVault {
  readonly #engine: PwaLibraryCoreSqliteEngine;
  readonly #sessions = new Map<string, PublicationSession>();
  readonly #storage: PwaContentRangeStorageV1;

  constructor(
    engine: PwaLibraryCoreSqliteEngine,
    storage: PwaContentRangeStorageV1 = new BrowserOpfsContentRangeStorageV1(),
  ) {
    this.#engine = engine;
    this.#storage = storage;
  }

  async begin(
    input: LibraryCoreContentRangePublicationBeginV1,
  ): Promise<LibraryCoreContentRangePublicationStatusV1> {
    const parsed = parseLibraryCoreContentRangePublicationBeginV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    if (this.#sessions.has(request.publicationId)) {
      throw new Error("content range publication identity is already active");
    }
    if (
      [...this.#sessions.values()].some(
        (session) =>
          session.contentDigest === request.contentDigest &&
          session.rangeIndex === request.rangeIndex,
      )
    ) {
      throw new Error("content range is already being published");
    }
    if (this.#sessions.size >= MAXIMUM_ACTIVE_PUBLICATIONS) {
      throw new Error("content range publication capacity is exhausted");
    }
    const canonical = this.#engine.readCanonicalContentRange(
      request.contentDigest,
      request.rangeIndex,
    );
    const storageKey = createLibraryCoreContentRangeStorageKeyV1(
      request.contentDigest,
      request.rangeIndex,
      canonical.rangeContentDigest,
    );
    const object = await this.#storage.create(
      request.publicationId,
      storageKey,
    );
    const session: PublicationSession = {
      contentDigest: request.contentDigest,
      expectedByteLength: canonical.byteLength,
      expectedRangeContentDigest: canonical.rangeContentDigest,
      hash: createLibraryCoreMediaBlobDigestStateV1(),
      nextOffset: 0,
      publicationId: request.publicationId,
      rangeIndex: request.rangeIndex,
      storageKey: object.storageKey,
      writer: object.writer,
    };
    this.#sessions.set(request.publicationId, session);
    return this.#status(session);
  }

  async append(
    input: LibraryCoreContentRangePublicationAppendV1,
  ): Promise<LibraryCoreContentRangePublicationStatusV1> {
    const parsed = parseLibraryCoreContentRangePublicationAppendV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    const session = this.#session(request.publicationId);
    if (
      request.expectedOffset !== session.nextOffset ||
      request.bytes.byteLength > session.expectedByteLength - session.nextOffset
    ) {
      throw new TypeError(
        "content range publication append request is invalid",
      );
    }
    const written = await session.writer.write(
      request.bytes,
      session.nextOffset,
    );
    if (written !== request.bytes.byteLength) {
      throw new Error("content range publication write was incomplete");
    }
    session.hash.update(request.bytes);
    session.nextOffset += written;
    return this.#status(session);
  }

  async finalize(
    input: LibraryCoreContentRangePublicationFinalizeV1,
  ): Promise<LibraryCoreVerifiedContentRangeReceiptV1> {
    const parsed = parseLibraryCoreContentRangePublicationFinalizeV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    const session = this.#session(request.publicationId);
    if (session.nextOffset !== session.expectedByteLength) {
      throw new Error("content range publication is incomplete");
    }
    if (session.hash.digestLowerHex() !== session.expectedRangeContentDigest) {
      await this.#discard(session);
      throw new Error("content range publication digest is invalid");
    }
    try {
      await session.writer.flush();
      await session.writer.close();
      this.#sessions.delete(session.publicationId);
      return this.#engine.registerVerifiedContentRange({
        byteLength: session.expectedByteLength,
        contentDigest: session.contentDigest,
        rangeContentDigest: session.expectedRangeContentDigest,
        rangeIndex: session.rangeIndex,
        schemaVersion: 1,
        storageKey: session.storageKey,
        storageKind: "opfs",
        verifiedAt: request.verifiedAt,
      });
    } catch (error) {
      this.#sessions.delete(session.publicationId);
      await session.writer.close().catch(() => undefined);
      await this.#storage.remove(session.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async abort(
    input: LibraryCoreContentRangePublicationAbortV1,
  ): Promise<boolean> {
    const parsed = parseLibraryCoreContentRangePublicationAbortV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const session = this.#sessions.get(parsed.value.publicationId);
    if (!session) return false;
    await this.#discard(session);
    return true;
  }

  async read(
    input: LibraryCoreContentRangeReadRequestV1,
  ): Promise<LibraryCoreContentRangeReadResponseV1> {
    const parsed = parseLibraryCoreContentRangeReadRequestV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    const proof = this.#engine.readVerifiedContentRangeReadProof(
      request.contentDigest,
      request.rangeIndex,
    );
    if (request.rangeOffset >= proof.byteLength) {
      throw new TypeError("content range read offset is outside the range");
    }
    const expectedBytes = Math.min(
      request.maximumBytes,
      proof.byteLength - request.rangeOffset,
    );
    const bytes = await this.#storage.read(
      proof.storageKey,
      request.rangeOffset,
      expectedBytes,
    );
    if (bytes.byteLength !== expectedBytes) {
      throw new Error("verified content range object is truncated");
    }
    const response = parseLibraryCoreContentRangeReadResponseV1({
      bytes,
      contentDigest: request.contentDigest,
      nextRangeOffset: request.rangeOffset + bytes.byteLength,
      rangeComplete:
        request.rangeOffset + bytes.byteLength === proof.byteLength,
      rangeIndex: request.rangeIndex,
      rangeOffset: request.rangeOffset,
      schemaVersion: 1,
    });
    if (!response.ok) throw new TypeError(response.error);
    return response.value;
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    await Promise.all(sessions.map((session) => this.#discard(session)));
  }

  async reconcile(): Promise<void> {
    let staleStorageKeys: string[] = [];
    const flushStaleProofs = () => {
      if (staleStorageKeys.length === 0) return;
      this.#engine.pruneVerifiedContentRangeStorageProofs(staleStorageKeys);
      staleStorageKeys = [];
    };
    await this.#storage.scan(async (entry) => {
      const proof = this.#engine.readVerifiedContentRangeStorageProof(
        entry.storageKey,
      );
      if (
        proof === null ||
        proof.storageKey !== proof.canonicalStorageKey ||
        proof.byteLength !== entry.byteLength
      ) {
        await this.#storage.remove(entry.storageKey);
        if (proof !== null) staleStorageKeys.push(entry.storageKey);
        if (staleStorageKeys.length === 128) flushStaleProofs();
      }
    });
    flushStaleProofs();

    let afterStorageKey: string | null = null;
    while (true) {
      const page =
        this.#engine.pageVerifiedContentRangeStorageProofs(afterStorageKey);
      if (page.length === 0) return;
      for (const proof of page) {
        const byteLength = await this.#storage.stat(proof.storageKey);
        if (
          proof.storageKey !== proof.canonicalStorageKey ||
          byteLength !== proof.byteLength
        ) {
          await this.#storage.remove(proof.storageKey).catch(() => undefined);
          staleStorageKeys.push(proof.storageKey);
        }
      }
      flushStaleProofs();
      afterStorageKey = page.at(-1)!.storageKey;
    }
  }

  #session(publicationId: string): PublicationSession {
    if (!isLibraryCoreLowercaseHex64(publicationId)) {
      throw new TypeError("content range publication identity is invalid");
    }
    const session = this.#sessions.get(publicationId);
    if (!session) throw new Error("content range publication is not active");
    return session;
  }

  #status(
    session: PublicationSession,
  ): LibraryCoreContentRangePublicationStatusV1 {
    const status = parseLibraryCoreContentRangePublicationStatusV1({
      contentDigest: session.contentDigest,
      expectedByteLength: session.expectedByteLength,
      expectedRangeContentDigest: session.expectedRangeContentDigest,
      maximumAppendBytes: LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES,
      nextOffset: session.nextOffset,
      publicationId: session.publicationId,
      rangeIndex: session.rangeIndex,
      schemaVersion: 1,
      state: "staging",
    });
    if (!status.ok) throw new TypeError(status.error);
    return status.value;
  }

  async #discard(session: PublicationSession): Promise<void> {
    this.#sessions.delete(session.publicationId);
    await session.writer.close().catch(() => undefined);
    await this.#storage.remove(session.storageKey).catch(() => undefined);
  }
}

class BrowserOpfsContentRangeStorageV1 implements PwaContentRangeStorageV1 {
  async create(
    _publicationId: string,
    storageKey: string,
  ): Promise<PwaContentRangeObjectV1> {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(
      PWA_LIBRARY_CORE_CONTENT_VAULT_DIRECTORY,
      { create: true },
    );
    const file = await directory.getFileHandle(storageKey, { create: true });
    if ((await file.getFile()).size !== 0) {
      throw new Error("content range publication object already exists");
    }
    const handle = await (
      file as FileSystemFileHandle & {
        createSyncAccessHandle(): Promise<OpfsSyncAccessHandleV1>;
      }
    ).createSyncAccessHandle();
    handle.truncate(0);
    return Object.freeze({
      storageKey,
      writer: {
        async close() {
          handle.close();
        },
        async flush() {
          handle.flush();
        },
        async write(bytes: Uint8Array, at: number) {
          return handle.write(bytes, { at });
        },
      },
    });
  }

  async remove(storageKey: string): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(
      PWA_LIBRARY_CORE_CONTENT_VAULT_DIRECTORY,
      { create: true },
    );
    await directory.removeEntry(storageKey);
  }

  async read(
    storageKey: string,
    at: number,
    maximumBytes: number,
  ): Promise<Uint8Array> {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(
      PWA_LIBRARY_CORE_CONTENT_VAULT_DIRECTORY,
      { create: true },
    );
    const file = await (await directory.getFileHandle(storageKey)).getFile();
    return new Uint8Array(
      await file.slice(at, at + maximumBytes).arrayBuffer(),
    );
  }

  async scan(
    visit: (
      entry: Readonly<{ byteLength: number; storageKey: string }>,
    ) => Promise<void>,
  ): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(
      PWA_LIBRARY_CORE_CONTENT_VAULT_DIRECTORY,
      { create: true },
    );
    for await (const [storageKey, handle] of (
      directory as OpfsDirectoryHandleV1
    ).entries()) {
      if (handle.kind !== "file") {
        throw new Error("content vault contains a non-file entry");
      }
      const file = await (handle as FileSystemFileHandle).getFile();
      await visit(Object.freeze({ byteLength: file.size, storageKey }));
    }
  }

  async stat(storageKey: string): Promise<number | null> {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(
      PWA_LIBRARY_CORE_CONTENT_VAULT_DIRECTORY,
      { create: true },
    );
    try {
      const file = await directory.getFileHandle(storageKey);
      return (await file.getFile()).size;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return null;
      }
      throw error;
    }
  }
}
