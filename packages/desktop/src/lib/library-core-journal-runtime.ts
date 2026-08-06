import { invoke } from "@tauri-apps/api/core";

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

/**
 * Opens the journal during startup without letting a failure reach the user.
 *
 * The journal is a shadow. Nothing reads from it yet, so a machine that cannot
 * open it must still start normally and behave exactly as before. The failure
 * is surfaced to the console as evidence rather than raised, because the only
 * consumer of that evidence today is us.
 *
 * Opening is all that happens here. An earlier revision also minted a local
 * authority key, created an epoch, minted an actor key and enrolled an actor,
 * all as a side effect of launching the app. The contract forbids it: startup
 * absence never chooses a creator, and a key the app creates and signs proves
 * only that the app possesses the key it just created, authenticating neither
 * the owner nor another installation. Two Desktops holding the same Library
 * would each have silently declared themselves its origin. Choosing a creator
 * is an explicit owner action and belongs to the legacy epoch bootstrap.
 */
export async function openLibraryCoreJournalForStartup(): Promise<LibraryCoreJournalStatusV1 | null> {
  try {
    return await openLibraryCoreJournal();
  } catch (error) {
    console.warn(
      "[library-core] journal unavailable; continuing on Automerge only",
      error,
    );
    return null;
  }
}
