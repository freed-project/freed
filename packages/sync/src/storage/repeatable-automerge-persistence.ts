import * as A from "@automerge/automerge";
import type { RevisionedStorageAdapter, StorageRevision } from "../types.js";

export type DocumentLoadFailureKind = "corrupt" | "load_failed";

const RESOURCE_EXHAUSTION_PATTERN =
  /out of memory|allocation failed|failed to allocate|cannot allocate|unable to grow|memory access out of bounds|array buffer allocation|invalid array buffer length|maximum call stack/i;

const DOCUMENT_DECODE_FAILURE_PATTERN =
  /bad checksum|invalid magic|unable to parse|failed to parse|not enough data|invalid chunk|unexpected end of|deserialize|decoding/i;

/**
 * Decide whether a failed Automerge decode proves the stored bytes are corrupt.
 *
 * Automerge reports both damaged bytes and allocation exhaustion as
 * RangeError. Only recognized decode failures may authorize a local clear.
 * Unknown failures preserve the document and fail closed.
 */
export function classifyDocumentLoadFailure(
  error: unknown,
): DocumentLoadFailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (RESOURCE_EXHAUSTION_PATTERN.test(message)) return "load_failed";
  return DOCUMENT_DECODE_FAILURE_PATTERN.test(message)
    ? "corrupt"
    : "load_failed";
}

export interface CommittedAutomergePersistenceState {
  revision: StorageRevision;
  heads: readonly string[];
  byteLength: number;
  hasDocument: boolean;
}

export interface CommittedAutomergePersistenceSnapshot {
  revision: StorageRevision;
  heads: readonly string[];
  bytes: Uint8Array | null;
}

export interface LoadedAutomergePersistence<T> {
  document: A.Doc<T> | null;
  committed: CommittedAutomergePersistenceState;
}

export type AutomergePersistenceOptions =
  | {
      mode?: "incremental" | "compact";
      expectedRevision?: StorageRevision;
    }
  | {
      mode: "replace";
      expectedRevision: StorageRevision;
    };

interface InternalCommittedState {
  revision: StorageRevision;
  heads: string[];
  bytes: Uint8Array | null;
  /**
   * False when durable bytes exist but Automerge could not decode them.
   *
   * The revision is still exact and the raw bytes are still retained, which is
   * what lets a caller run the revision-fenced clear that recovers from
   * corruption. What it may not do is write: appending a delta onto bytes that
   * failed to decode would persist a corrupt document forward and destroy the
   * evidence of what went wrong.
   */
  readable: boolean;
}

function copyRevision(revision: StorageRevision): StorageRevision {
  return {
    generation: revision.generation,
    saveRevision: revision.saveRevision,
  };
}

function sameRevision(left: StorageRevision, right: StorageRevision): boolean {
  return (
    left.generation === right.generation &&
    left.saveRevision === right.saveRevision
  );
}

function sameHeads(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((head, index) => head === right[index])
  );
}

function appendBytes(
  committed: Uint8Array | null,
  delta: Uint8Array,
): Uint8Array {
  if (!committed) return Uint8Array.from(delta);
  const candidate = new Uint8Array(committed.byteLength + delta.byteLength);
  candidate.set(committed);
  candidate.set(delta, committed.byteLength);
  return candidate;
}

function publicState(
  state: InternalCommittedState,
): CommittedAutomergePersistenceState {
  return {
    revision: copyRevision(state.revision),
    heads: [...state.heads],
    byteLength: state.bytes?.byteLength ?? 0,
    hasDocument: state.bytes !== null,
  };
}

export class StaleAutomergePersistenceStateError extends Error {
  readonly code = "STALE_AUTOMERGE_PERSISTENCE_STATE";
  readonly expected: StorageRevision;
  readonly actual: StorageRevision;

  constructor(expected: StorageRevision, actual: StorageRevision) {
    super(
      `Automerge persistence state is stale: expected ${expected.generation.toLocaleString()}:${expected.saveRevision.toLocaleString()}, current ${actual.generation.toLocaleString()}:${actual.saveRevision.toLocaleString()}`,
    );
    this.name = "StaleAutomergePersistenceStateError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class UnreadableAutomergePersistenceStateError extends Error {
  readonly code = "UNREADABLE_AUTOMERGE_PERSISTENCE_STATE";
  readonly revision: StorageRevision;

  constructor(revision: StorageRevision) {
    super(
      `Automerge persistence holds undecodable committed bytes at ${revision.generation.toLocaleString()}:${revision.saveRevision.toLocaleString()}; clear at this exact revision before writing again`,
    );
    this.name = "UnreadableAutomergePersistenceStateError";
    this.revision = revision;
  }
}

/**
 * Produces repeatable Automerge save candidates from the last durable heads.
 *
 * The wrapper advances its committed bytes, heads, and revision only after the
 * storage compare-and-swap commits. A failed or lost save can therefore retry
 * from the same heads without consuming Automerge's mutable incremental-save
 * cursor.
 */
export class RepeatableAutomergePersistence {
  private committed: InternalCommittedState | null = null;
  private readonly storage: RevisionedStorageAdapter;

  constructor(storage: RevisionedStorageAdapter) {
    this.storage = storage;
  }

  async load<T>(): Promise<LoadedAutomergePersistence<T>> {
    const stored = await this.storage.load();
    const bytes = stored.data ? Uint8Array.from(stored.data) : null;

    // Committed state is recorded BEFORE decoding, because decoding is the step
    // that can fail. If A.load throws on corrupt bytes and we have not yet
    // retained the revision, `this.committed` stays null and every recovery
    // entry point - current, snapshot, clear - throws "must load before use".
    // The caller is then holding a corrupt document it is not permitted to
    // replace, which is the one situation recovery exists for.
    const committed: InternalCommittedState = {
      revision: copyRevision(stored.revision),
      heads: [],
      bytes,
      readable: false,
    };
    this.committed = committed;

    let document: A.Doc<T> | null = null;
    if (bytes) {
      // Rethrown deliberately. The caller must learn the document is corrupt;
      // returning a null document here would look like an empty library and
      // invite a write that silently discards the user's data.
      document = A.load<T>(bytes);
      committed.heads = [...A.getHeads(document)];
    }
    committed.readable = true;

    return {
      document,
      committed: publicState(committed),
    };
  }

  current(): CommittedAutomergePersistenceState {
    if (!this.committed) {
      throw new Error("Automerge persistence must load before use");
    }
    return publicState(this.committed);
  }

  snapshot(): CommittedAutomergePersistenceSnapshot {
    if (!this.committed) {
      throw new Error("Automerge persistence must load before use");
    }
    return {
      revision: copyRevision(this.committed.revision),
      heads: [...this.committed.heads],
      bytes: this.committed.bytes
        ? Uint8Array.from(this.committed.bytes)
        : null,
    };
  }

  async persist<T>(
    document: A.Doc<T>,
    options: AutomergePersistenceOptions = {},
  ): Promise<CommittedAutomergePersistenceState> {
    const base = this.committed;
    if (!base) {
      throw new Error("Automerge persistence must load before use");
    }
    if (!base.readable) {
      // Every write path below either appends to `base.bytes` or trusts
      // `base.heads`, and neither is meaningful when the committed bytes did
      // not decode. Refusing here is what stops a corrupt document being
      // extended and made permanent. Recovery goes through clear().
      throw new UnreadableAutomergePersistenceStateError(
        copyRevision(base.revision),
      );
    }

    const mode = options.mode ?? "incremental";
    const expectedRevision = options.expectedRevision;
    if (expectedRevision && !sameRevision(expectedRevision, base.revision)) {
      throw new StaleAutomergePersistenceStateError(
        copyRevision(expectedRevision),
        copyRevision(base.revision),
      );
    }
    if (mode === "replace" && !expectedRevision) {
      throw new Error(
        "Automerge replacement requires the caller's expected committed revision",
      );
    }

    const nextHeads = [...A.getHeads(document)];
    let candidateBytes: Uint8Array;

    if (mode === "replace") {
      candidateBytes = A.save(document);
    } else {
      if (!A.hasHeads(document, base.heads)) {
        throw new Error(
          "Automerge persistence candidate does not descend from the committed heads",
        );
      }
      if (mode === "compact") {
        candidateBytes = A.save(document);
      } else {
        if (sameHeads(nextHeads, base.heads) && base.bytes) {
          return publicState(base);
        }
        const delta = A.saveSince(document, base.heads);
        // A document with no changes has no saveSince payload. Its compact
        // encoding is still required for a durable first write.
        candidateBytes =
          base.bytes === null && delta.byteLength === 0
            ? A.save(document)
            : appendBytes(base.bytes, delta);
      }
    }

    const nextRevision = await this.storage.save(candidateBytes, base.revision);
    if (this.committed !== base) {
      throw new Error(
        "Automerge persistence changed while its compare-and-swap was in flight",
      );
    }

    const committed: InternalCommittedState = {
      revision: copyRevision(nextRevision),
      heads: nextHeads,
      bytes: candidateBytes,
      // These bytes came from A.save on a live document, so they decode by
      // construction. Only load() can produce an unreadable state.
      readable: true,
    };
    this.committed = committed;
    return publicState(committed);
  }

  async clear(
    expectedRevision: StorageRevision,
  ): Promise<CommittedAutomergePersistenceState> {
    const base = this.committed;
    if (!base) {
      throw new Error("Automerge persistence must load before use");
    }
    if (!sameRevision(expectedRevision, base.revision)) {
      throw new StaleAutomergePersistenceStateError(
        copyRevision(expectedRevision),
        copyRevision(base.revision),
      );
    }

    const nextRevision = await this.storage.clear(base.revision);
    if (this.committed !== base) {
      throw new Error(
        "Automerge persistence changed while its clear was in flight",
      );
    }

    // Clearing is the documented escape from an unreadable committed state, so
    // the successful clear is also what restores readability. There are no
    // bytes left to fail to decode.
    const committed: InternalCommittedState = {
      revision: copyRevision(nextRevision),
      heads: [],
      bytes: null,
      readable: true,
    };
    this.committed = committed;
    return publicState(committed);
  }
}
