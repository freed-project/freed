import { invoke } from "@tauri-apps/api/core";

import { getLibraryCoreProjectionSource } from "./automerge";
import type { LibraryCoreProjectionSourceV1 } from "./automerge-types";

/**
 * Desktop client for the Library Core journal.
 *
 * The journal, its verifiers and its one materializer have been merged and
 * tested for a while, but nothing outside their own Rust modules referenced
 * them: every `LibraryCoreJournal::open` call site sat inside a test module.
 * This is the first production caller.
 *
 * Automerge remains authoritative. Opening the database and reading counts
 * changes no user-visible behaviour and grants no write authority. It exists so
 * the shadow slice has a call path, and so we can see whether a real
 * installation can open the journal at all before anything depends on it.
 */

export interface LibraryCoreJournalStatusV1 {
  /** SQLite `user_version`. 1 is the only schema that has ever existed. */
  readonly schemaVersion: number;
  /** How far materialization has consumed the operation log. */
  readonly materializerIngestSequence: number;
  readonly actors: number;
  readonly operations: number;
  readonly readState: number;
  readonly unacknowledgedOutbox: number;
}

/**
 * Opens the journal, creating the database and its private directory.
 *
 * Idempotent. A second call reopens the same file and reports the same counts;
 * it never enrolls an actor or writes an operation, so it cannot advance state.
 */
export function openLibraryCoreJournal(): Promise<LibraryCoreJournalStatusV1> {
  return invoke<LibraryCoreJournalStatusV1>("open_library_core_journal");
}

/** Reports the held journal, or null when it has not been opened. */
export function libraryCoreJournalStatus(): Promise<LibraryCoreJournalStatusV1 | null> {
  return invoke<LibraryCoreJournalStatusV1 | null>(
    "library_core_journal_status",
  );
}

/** What this installation established as its own Library Core identity. */
export interface LibraryCoreGenesisAuthorityV1 {
  readonly libraryId: string;
  readonly epoch: number;
  readonly epochId: string;
  readonly authorityKeyId: string;
  readonly actorId: string;
  /**
   * The sequence this actor's next operation would take. 1 means it has
   * written nothing, which is the only value this path can produce.
   */
  readonly nextSequence: number;
}

/**
 * Establishes this installation's Library Core identity: the genesis authority
 * epoch for one exact durable Automerge revision, then its own enrolled actor.
 * Mints the authority and actor signing keys if it has none.
 *
 * One call, because an epoch with no actor can write nothing and an actor
 * cannot exist without an epoch. Both halves are idempotent, so a call that
 * fails after the epoch lands completes the actor on the next attempt.
 *
 * Requires the journal to be open. Everything the epoch is derived from is a
 * pure function of the library, the key and the revision, so replaying the same
 * revision returns the same epoch instead of writing a second one. A revision
 * that differs from the one already established is refused rather than
 * silently re-pointing the library.
 */
export function establishLibraryCoreGenesisAuthority(
  source: LibraryCoreProjectionSourceV1,
): Promise<LibraryCoreGenesisAuthorityV1> {
  return invoke<LibraryCoreGenesisAuthorityV1>(
    "establish_library_core_genesis_authority",
    {
      source: {
        documentId: source.documentId,
        headsDigest: source.headsDigest,
        headCount: source.headCount,
        storageGeneration: source.storageRevision.generation,
        storageSaveRevision: source.storageRevision.saveRevision,
      },
    },
  );
}

/**
 * Opens the journal during startup without letting a failure reach the user.
 *
 * The journal is a shadow. Nothing reads from it yet, so a machine that cannot
 * open it must still start normally and behave exactly as before. The failure
 * is surfaced to the console as evidence rather than raised, because the only
 * consumer of that evidence today is us.
 *
 * Once the journal is open, the installation establishes its own identity
 * against the document's current durable revision: a genesis authority epoch
 * and an actor enrolled under it. Until both exist nothing can be written at
 * all, because Library Core fences every operation commit against an active
 * epoch and an enrolled actor. This is dormant either way: no operations are
 * written here, Automerge stays authoritative, and no provider traffic is
 * emitted.
 *
 * The document may not be readable yet at startup, which is why establishment
 * is attempted and not required. The next start tries again against whatever
 * revision is durable then, and the first one to succeed pins the library.
 */
export async function openLibraryCoreJournalForStartup(): Promise<LibraryCoreJournalStatusV1 | null> {
  let status: LibraryCoreJournalStatusV1;
  try {
    status = await openLibraryCoreJournal();
  } catch (error) {
    console.warn(
      "[library-core] journal unavailable; continuing on Automerge only",
      error,
    );
    return null;
  }

  try {
    const source = await getLibraryCoreProjectionSource();
    const authority = await establishLibraryCoreGenesisAuthority(source);
    console.info(
      `[library-core] authority epoch ${authority.epoch} for library ${authority.libraryId}, actor ${authority.actorId} at sequence ${authority.nextSequence}`,
    );
  } catch (error) {
    console.warn(
      "[library-core] identity not established; retrying next start",
      error,
    );
  }

  return status;
}
