// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveryPersonFields, type RecoveryPersonDraft } from "./RecoveryPersonFields";

let root: Root, container: HTMLDivElement;
const submit = vi.fn(async () => {});
const tags = Array.from({ length: 17 }, (_, i) => `tag ${i}`);
const person = { id: "person-1", name: "Current", relationshipStatus: "friend" as const, careLevel: 3 as const, createdAt: 1, updatedAt: 2, tags };
function Harness() {
  const [drafts, setDrafts] = useState<readonly RecoveryPersonDraft[]>([{ archived: { ...person, name: "Archived" }, current: person, person: { ...person } }]);
  return <RecoveryPersonFields drafts={drafts} onChange={setDrafts} onSubmit={submit} saving={false} locked={false} error={null} />;
}
function button(text: string) { return Array.from(container.querySelectorAll("button")).find(b => b.textContent === text)!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function confirm() { await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
beforeEach(() => { submit.mockClear(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("requires every tag page again after structural edits and preserves original tags", async () => {
  await act(async () => root.render(<Harness />));
  expect(container.querySelectorAll('textarea[aria-label^="Tag "]')).toHaveLength(8);
  await confirm();
  expect(button("Store revised people").disabled).toBe(true);
  await click("Next tags"); await click("Next tags");
  expect(button("Store revised people").disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove tag 17"]')!.click());
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  await confirm();
  expect(button("Store revised people").disabled).toBe(true);
  await click("Next tags"); await click("Next tags");
  await click("Store revised people");
  expect(submit).toHaveBeenCalledExactlyOnceWith([{ ...person, tags: tags.slice(0, 16) }]);
  expect(tags).toHaveLength(17);
  expect(container.querySelectorAll("img")).toHaveLength(0);
});
