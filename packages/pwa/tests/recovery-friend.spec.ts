import { test, expect } from "@playwright/test";

// Tier 1 browser integration for the PWA wrapper and shared form. Storage and
// cryptography have separate real SQLite tests; these boundaries are mocked.
for (const paged of [false, true]) {
test(`PWA Friend ${paged ? "paged" : "small"} review retains one action after response loss`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/src/main.tsx*", route => route.fulfill({ contentType: "text/javascript",
    body: "import '/tests/fixtures/recovery-friend.tsx';" }));
  await page.route("**/src/lib/library-core-pwa-recovery-editors.ts*", route => route.fulfill({ contentType: "text/javascript", body: `
    export async function loadPwaRecoveryFriendDraft(review, signal) {
      const person = { id: 'person:one', name: 'Current Friend', careLevel: 3, relationshipStatus: 'friend', createdAt: 1, updatedAt: 2 };
      const accounts = ['one', 'two'].map(id => ({ id: 'account:' + id, personId: person.id,
        kind: 'social', provider: 'instagram', externalId: id, discoveredFrom: 'manual_entry',
        firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2 }));
      const row = account => ({ id: account.id, account, current: account, archived: account, currentlyLinked: true, selected: !${paged} });
      const paging = ${paged} ? { first: { accounts: accounts.map(row), nextCursor: 'next' },
        load: async () => ({ accounts: accounts.map(account => row({ ...account, id: account.id + '-next' })), nextCursor: null }) } : undefined;
      return { replacement: null, draft: { person, currentPerson: person, archivedPerson: { ...person, name: 'Archived Friend' },
        accounts: accounts.map(row), paged: paging } };
    }
  ` }));
  await page.route("**/src/lib/library-core-pwa-follower-mutations.ts*", route => route.fulfill({ contentType: "text/javascript", body: `
    export function createPwaRecoveryFriendAction(review, person, accounts) {
      const proof = window.__friendProof;
      proof.prepared++; proof.input = structuredClone({ review, person, accounts });
      return async () => {
        proof.attempts++;
        if (proof.attempts === 1) throw new Error('response lost');
        return { replacementTransactionId: 'replacement' };
      };
    }
  ` }));
  await page.goto("/");
  const person = page.getByTestId("recovery-person-editor");
  await expect(person.getByLabel("Name", { exact: true })).toHaveValue("Current Friend");
  await person.getByLabel("Name", { exact: true }).fill("Reviewed Friend");
  await person.getByRole("checkbox").check();
  await person.getByRole("button", { name: "Review account selection", exact: true }).click();
  const editor = page.getByTestId("recovery-friend-editor");
  await expect(editor).toContainText("omitted contact account is deleted");
  const confirmation = editor.getByLabel("Apply this complete Friend replacement, including account moves, omissions and avatar URL changes.", { exact: true });
  const submit = editor.getByRole("button", { name: "Store revised Friend", exact: true });
  if (paged) await editor.getByLabel("Include this account", { exact: true }).check();
  await confirmation.check();
  await expect(submit).toBeDisabled();
  await editor.getByRole("button", { name: "Next account", exact: true }).click();
  if (paged) await editor.getByLabel("Include this account", { exact: true }).check();
  await editor.getByLabel("Include this account", { exact: true }).uncheck();
  await expect(confirmation).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await confirmation.check();
  if (paged) {
    await expect(submit).toBeDisabled();
    await editor.getByRole("button", { name: "Next linked-account page", exact: true }).click();
    await editor.getByRole("button", { name: "Next account", exact: true }).click();
    await expect(editor).toContainText("All current links reviewed");
    await expect(submit).toBeDisabled();
    await editor.getByRole("button", { name: "Review archived accounts", exact: true }).click();
    await editor.getByRole("button", { name: "Next account", exact: true }).click();
    await confirmation.check();
  }
  expect(await page.evaluate(() => (window as any).__friendProof.prepared)).toBe(0);
  await expect(editor.locator("img")).toHaveCount(0);
  await submit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("pwa-friend-confirmation.png") });
  await submit.click();
  await expect(editor).toContainText("No replacement was confirmed");
  await expect(editor.getByLabel("Include this account", { exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Review Person again", exact: true })).toBeDisabled();
  await submit.click();
  await expect.poll(() => page.evaluate(() => (window as any).__friendProof.replacement)).toEqual({ replacementTransactionId: "replacement" });
  const proof = await page.evaluate(() => (window as any).__friendProof);
  expect(proof.prepared).toBe(1);
  expect(proof.attempts).toBe(2);
  expect(proof.input.person.name).toBe("Reviewed Friend");
  expect(proof.input.accounts.map((account: { id: string }) => account.id)).toEqual(["account:one"]);
  expect(proof.busy).toEqual([true, false, true, false]);
});

}
