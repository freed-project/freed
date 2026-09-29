// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveryFriendFields, type RecoveryFriendDraft } from "./RecoveryFriendFields";

let root: Root, container: HTMLDivElement;
const submit = vi.fn(async () => {});
const person = { id: "person:one", name: "Current", relationshipStatus: "friend" as const, careLevel: 3 as const, createdAt: 1, updatedAt: 2 };
const accounts = ["one", "two"].map(id => ({ id: `account:${id}`, personId: person.id, kind: "social" as const, provider: "instagram" as const,
  externalId: id, discoveredFrom: "manual_entry" as const, firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2, avatarUrl: `https://example.com/${id}` }));
function Harness() {
  const [draft, setDraft] = useState<RecoveryFriendDraft>({ archivedPerson: person, currentPerson: person, person,
    accounts: accounts.map(account => ({ id: account.id, archived: account, current: account, currentlyLinked: true, selected: true, account })) });
  return <RecoveryFriendFields draft={draft} onChange={setDraft} onSubmit={submit} saving={false} locked={false} error={null} />;
}
function button(text: string) { return Array.from(container.querySelectorAll("button")).find(value => value.textContent === text)!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function checkbox(index: number) { await act(async () => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]!.click()); }
beforeEach(() => { submit.mockClear(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("requires both review steps, all accounts and fresh confirmation after changing the complete selection", async () => {
  await act(async () => root.render(<Harness />));
  await checkbox(0); await click("Review account selection");
  expect(submit).not.toHaveBeenCalled();
  expect(container.textContent).toContain("omitted contact account is deleted");
  await checkbox(1);
  expect(button("Store revised Friend").disabled).toBe(true);
  await click("Next account");
  expect(button("Store revised Friend").disabled).toBe(false);
  await checkbox(0);
  expect(button("Store revised Friend").disabled).toBe(true);
  await checkbox(1); await click("Store revised Friend");
  expect(submit).toHaveBeenCalledExactlyOnceWith(person, [accounts[0]]);
  expect(accounts).toHaveLength(2);
  expect(container.querySelectorAll("img")).toHaveLength(0);
});

it("reviews paged current links and archived accounts before committing one bounded selection", async () => {
  const row = (account: typeof accounts[number]) => ({ id: account.id, archived: account, current: account, account, currentlyLinked: true, selected: false });
  const third = { ...accounts[0]!, id: "account:three", externalId: "three" };
  const fourth = { ...accounts[0]!, id: "account:four", externalId: "four" };
  const load = vi.fn(async () => ({ accounts: [row(third), row(fourth)], nextCursor: null }));
  function Paged() {
    const [draft, setDraft] = useState<RecoveryFriendDraft>({ archivedPerson: person, currentPerson: person, person,
      accounts: accounts.map(row), paged: { first: { accounts: accounts.map(row), nextCursor: "next" }, load } });
    return <RecoveryFriendFields draft={draft} onChange={setDraft} onSubmit={submit} saving={false} locked={false} error={null} />;
  }
  await act(async () => root.render(<Paged />));
  await checkbox(0); await click("Review account selection");
  expect(container.textContent).toContain("Nothing starts selected");
  await checkbox(0); // Keep first current account.
  await checkbox(1); // Confirmation alone cannot skip either review.
  expect(button("Store revised Friend").disabled).toBe(true);
  await click("Next account"); await click("Next linked-account page");
  expect(load).toHaveBeenCalledExactlyOnceWith("next");
  expect(container.textContent).toContain("Selected accounts: 1");
  await checkbox(0); // Keep the first account on the next page as well.
  await click("Next account");
  expect(container.textContent).toContain("All current links reviewed");
  expect(container.textContent).toContain("Archived-account review is incomplete");
  await click("Review archived accounts");
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  await click("Next account");
  expect(container.textContent).toContain("All archived accounts reviewed");
  await checkbox(1); await click("Store revised Friend");
  expect(submit).toHaveBeenCalledExactlyOnceWith(person, [accounts[0], third]);
});

it("caps retained selections across pages and blocks submission after a failed page read", async () => {
  const all = Array.from({ length: 65 }, (_, i) => {
    const account = { ...accounts[0]!, id: `account:${String(i).padStart(3, "0")}`, externalId: String(i) };
    return { id: account.id, account, archived: null, current: account, currentlyLinked: true, selected: false };
  });
  let fail = false;
  const load = async (cursor: string | null) => {
    if (fail) throw new Error("CURSOR_STALE");
    const offset = Number(cursor ?? 0);
    return { accounts: all.slice(offset, offset + 8), nextCursor: offset + 8 < all.length ? String(offset + 8) : null };
  };
  const first = await load(null);
  function Paged() {
    const [draft, setDraft] = useState<RecoveryFriendDraft>({ archivedPerson: person, currentPerson: person, person, accounts: [], paged: { first, load } });
    return <RecoveryFriendFields draft={draft} onChange={setDraft} onSubmit={submit} saving={false} locked={false} error={null} />;
  }
  await act(async () => root.render(<Paged />));
  await checkbox(0); await click("Review account selection");
  for (let i = 0; i < 65; i++) {
    await checkbox(0);
    if (i < 64) await click(i % 8 === 7 ? "Next linked-account page" : "Next account");
  }
  expect(container.textContent).toContain("Selected accounts: 64");
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(container.textContent).toContain("no more than 64 accounts");
  fail = true; await click("Review current links from start");
  expect(container.textContent).toContain("Start again to review the complete account set");
  await checkbox(1);
  expect(button("Store revised Friend").disabled).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});
