/**
 * What an operation does to the authoritative SQLite tables.
 *
 * A materializer is the step that turns a verified, committed operation into
 * rows. It is the piece that makes SQLite the store rather than a projection
 * of something else, so until one exists for an operation that operation
 * cannot be the source of truth for anything.
 *
 * The implementations are native, inside the journal commit, because a
 * materializer must land in the same SQLite transaction as the operation row
 * it comes from. A materializer that could commit separately would let the
 * journal and the tables disagree after a crash.
 *
 * These contracts therefore describe rather than implement. They exist so the
 * registry can say which operations are materialized and against what, and so
 * a test can hold the description to the native code. TypeScript exhaustiveness
 * cannot cross into Rust, so that binding is a source-reading test rather than
 * a type.
 */

export interface LibraryCoreOperationMaterializerContract {
  readonly materializerId: string;
  readonly schemaVersion: 1;
  readonly operationType: string;
  /** The authoritative table the operation writes. */
  readonly targetTable: string;
  /** The column the upsert conflicts on. */
  readonly conflictColumn: string;
  /**
   * The field algebra this upsert implements for the value itself.
   *
   * The materializer and the algebra must agree or a replayed operation would
   * converge differently from a merged one.
   */
  readonly mergeAlgebraId: string;
  /**
   * How the upsert breaks a tie when the algebra leaves two writes equal.
   *
   * This is a second rule, not part of the algebra. `minimum_present_...`
   * says which value wins; it says nothing about which of two equal values
   * wins, and the answer decides provenance columns. Conflating them was the
   * original error here: the declaration named only the algebra while the SQL
   * also ordered on the source operation id.
   */
  readonly equalValueTieBreak: string;
  /**
   * The module that owns the implementation, relative to the repository root.
   *
   * Recorded so the binding test knows where to look, and so a reader can find
   * the real code from the declaration.
   */
  readonly nativeModulePath: string;
}

/**
 * Traced from `commit_read_transaction` in the desktop journal.
 *
 * The upsert keeps the earliest read time, which is
 * `minimum_present_nonnegative_safe_integer_v1` for the `readAt` leaf. At equal
 * read times it prefers the lower source operation id, which the algebra does
 * not describe and which decides the provenance columns, so it is declared
 * separately and has its own native test.
 * It runs inside the same transaction as the operation row, the causal tip and
 * the replication outbox entry, so a crash cannot leave the journal ahead of
 * the table.
 */
export const FEED_ITEM_READ_ASSIGNMENT_MATERIALIZER = Object.freeze({
  materializerId: "feed_item_read_state_v1",
  schemaVersion: 1,
  operationType: "feed_item_read_assignment",
  targetTable: "library_core_feed_item_read_state",
  conflictColumn: "entityId",
  mergeAlgebraId: "minimum_present_nonnegative_safe_integer_v1",
  equalValueTieBreak: "lower_source_operation_id_v1",
  nativeModulePath: "packages/desktop/src-tauri/src/library_core_journal.rs",
}) satisfies LibraryCoreOperationMaterializerContract;
