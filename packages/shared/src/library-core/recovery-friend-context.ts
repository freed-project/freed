import type { Account, Person } from "../types.js";
import { validateArchivedFriendReplacePayloadV1 } from "./operation-payload-contracts.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";

export interface RecoveryFriendAccountPage {
  readonly accounts: RecoveryFriendDraft["accounts"];
  readonly nextCursor: string | null;
}
export interface RecoveryFriendDraft {
  readonly archivedPerson: Person;
  readonly currentPerson: Person | null;
  readonly person: Person;
  /** Large current link sets are reviewed a page at a time, initially unselected. */
  readonly paged?: {
    readonly first: RecoveryFriendAccountPage;
    readonly load: (cursor: string | null) => Promise<RecoveryFriendAccountPage>;
  };
  readonly accounts: readonly {
    readonly id: string;
    readonly archived: Account | null;
    readonly current: Account | null;
    readonly currentlyLinked: boolean;
    readonly selected: boolean;
    readonly account: Account;
  }[];
}
/** Assemble bounded editor context after the platform verifies the complete archive. */
export async function readLibraryCoreRecoveryFriendDraftV1(
  review: LibraryCoreRecoveryIntentReviewResponseV1,
  row: LibraryCoreRecoveryIntentReviewResponseV1["rows"][number],
  envelope: Readonly<Record<string, unknown>>,
  query: LibraryCoreNormalizedReaderRuntime["query"],
  checkCancellation: () => void,
): Promise<RecoveryFriendDraft> {
  if (review.memberCount !== 1) throw new Error("Friend recovery requires its complete single-member transaction");
  const sameSource = (source: { generationId: string; projectionRevision: number }) => {
    checkCancellation();
    if (source.generationId !== review.source.generationId || source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
  };
    const payload = validateArchivedFriendReplacePayloadV1(envelope.payload);
    if (row.operationType !== "friend_replace" || envelope.entity_type !== "Person" || !payload.ok ||
      payload.value.person.id !== row.entityId || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs a different editor. No members were removed.");
    if (row.personState === "deleted") throw new Error("A person in this edit was deleted. Recovery cannot recreate them.");
    if (row.personState !== "present" && row.personState !== "absent") throw new Error("Person recovery state is unavailable");
    const root = await query({ queryId: "person_root_v1", schemaVersion: 1, personId: row.entityId });
    sameSource(root.source);
    if ((root.person !== null) !== (row.personState === "present")) throw new Error("CURSOR_STALE");
    const links = await query({ queryId: "person_account_page_v1", schemaVersion: 1, personId: row.entityId, cursor: null, limit: 64 });
    sameSource(links.source);
    const large = links.nextCursor !== null;
    const linked = new Set(links.rows.map(account => account.accountId));
    if (linked.size !== links.rows.length) throw new Error("Friend account identities are incomplete");
    const archived = new Map(payload.value.accounts.map(account => [account.id as string, account as unknown as Account]));
    const archivedPerson = payload.value.person as unknown as Person;
    const currentPerson = root.person as unknown as Person | null;
    const person = { ...(currentPerson ?? archivedPerson) };
    if (!currentPerson) delete person.avatarUrl;
    async function readAccount(id: string, mustBeLinked: boolean): Promise<RecoveryFriendDraft["accounts"][number]> {
      checkCancellation();
      const response = await query({ queryId: "account_root_v1", schemaVersion: 1, accountId: id });
      sameSource(response.source);
      const current = response.account as unknown as Account | null;
      if (current && current.id !== id || mustBeLinked && (!current || current.personId !== row.entityId)) throw new Error("CURSOR_STALE");
      const old = archived.get(id) ?? null;
      if (!current && !old) throw new Error("Friend account is unavailable");
      const account = { ...(current ?? old!), personId: row.entityId };
      if (!current) delete account.avatarUrl;
      const currentlyLinked = current?.personId === row.entityId;
      return { id, archived: old, current, currentlyLinked, selected: !large && currentlyLinked, account };
    }
    // At most 64 archived roots, or 128 small-set union roots, are retained.
    // Each current root is independently capped by account_root_v1 at 64 KiB.
    const ids = [...new Set([...(large ? [] : linked), ...archived.keys()])].sort();
    const accounts: RecoveryFriendDraft["accounts"][number][] = [];
    for (const id of ids) accounts.push(await readAccount(id, !large && linked.has(id)));
    if (large) {
      const load = async (cursor: string | null): Promise<RecoveryFriendAccountPage> => {
        checkCancellation();
        const page = await query({ queryId: "person_account_page_v1", schemaVersion: 1, personId: row.entityId, cursor, limit: 8 });
        sameSource(page.source);
        const accounts: RecoveryFriendDraft["accounts"][number][] = [];
        for (const entry of page.rows) accounts.push(await readAccount(entry.accountId, true));
        return { accounts, nextCursor: page.nextCursor };
      };
      return { archivedPerson, currentPerson, person, accounts, paged: { first: await load(null), load } };
    }
    return { archivedPerson, currentPerson, person, accounts };
}
