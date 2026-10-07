import type { Account, Person } from "@freed/shared";

/** Resolve current native identity rows before an explicitly requested link. */
export async function executeCurrentAccountLink({
  accountId, personId, isCurrent, readAccount, readPerson, assign, onApplied,
}: {
  accountId: string;
  personId: string;
  isCurrent: () => boolean;
  readAccount: (id: string) => Promise<Account | null>;
  readPerson: (id: string) => Promise<Person | null>;
  assign: (accountId: string, personId: string) => Promise<void>;
  onApplied: () => void;
}): Promise<void> {
  if (!isCurrent()) return;
  const [account, person] = await Promise.all([readAccount(accountId), readPerson(personId)]);
  if (!isCurrent()) return;
  if (account?.id !== accountId || person?.id !== personId) {
    throw new Error("The current Account or Person SQLite detail is unavailable.");
  }
  await assign(accountId, personId);
  if (isCurrent()) onApplied();
}
