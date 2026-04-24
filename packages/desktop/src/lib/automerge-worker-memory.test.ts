import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(
  join(process.cwd(), "src/lib/automerge.worker.ts"),
  "utf8",
);

function caseBody(caseName: string): string {
  const pattern = new RegExp(`case "${caseName}":[\\s\\S]*?break;`);
  return workerSource.match(pattern)?.[0] ?? "";
}

describe("automerge worker memory routing", () => {
  const patchOnlyMutations = [
    "MARK_AS_READ",
    "MARK_ITEMS_AS_READ",
    "TOGGLE_ARCHIVED",
    "TOGGLE_LIKED",
    "CONFIRM_LIKED_SYNCED",
    "CONFIRM_SEEN_SYNCED",
  ];

  it.each(patchOnlyMutations)("%s emits item patches without full hydration", (caseName) => {
    const body = caseBody(caseName);

    expect(body).toContain("applyItemPatchChange");
    expect(body).not.toContain("applyRequestChange");
    expect(body).not.toContain("saveAndBroadcast");
  });

  it("patch persistence does not hydrate or send a full state update", () => {
    const body = workerSource.match(
      /async function persistAndBroadcastWithoutHydration[\s\S]*?\n}/,
    )?.[0] ?? "";

    expect(body).toContain("persistDoc");
    expect(body).toContain("storage.save");
    expect(body).not.toContain("hydrateFromDoc");
    expect(body).not.toContain("STATE_UPDATE");
  });

  it("batches provisional connection repair into one document mutation", () => {
    const body = caseBody("UPSERT_CONNECTION_PERSONS");

    expect(body).toContain("applyRequestChange");
    expect(body).toContain("updatePerson");
    expect(body).toContain("updateAccount");
    expect(body).toContain("ack(req.reqId)");
  });
});
