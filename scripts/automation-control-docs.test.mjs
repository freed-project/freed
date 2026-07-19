import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlPlaneDocs = readFileSync(
  new URL("../docs/AUTOMATION-CONTROL-PLANE.md", import.meta.url),
  "utf8",
);

test("documented lease mutations retain caller-owned operation identity and token", () => {
  const documentedMutations = [
    ...controlPlaneDocs.matchAll(
      /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/g,
    ),
  ];
  const bashBlocks = [
    ...controlPlaneDocs.matchAll(/```bash\n([\s\S]*?)```/g),
  ].map((match) => match[1]);
  const mutationBlocks = bashBlocks.filter((block) =>
    /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/.test(
      block,
    ),
  );

  assert.ok(documentedMutations.length > 0);
  assert.equal(
    mutationBlocks.reduce(
      (count, block) =>
        count +
        [
          ...block.matchAll(
            /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/g,
          ),
        ].length,
      0,
    ),
    documentedMutations.length,
  );
  for (const block of mutationBlocks) {
    const mutationCount = [
      ...block.matchAll(
        /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/g,
      ),
    ].length;
    const acquireCount = [
      ...block.matchAll(
        /node scripts\/automation-control\.mjs lease acquire/g,
      ),
    ].length;
    assert.equal(
      [...block.matchAll(/FREED_AUTOMATION_LEASE_OPERATION_ID=/g)].length,
      mutationCount,
    );
    assert.equal(
      [...block.matchAll(/FREED_AUTOMATION_LEASE_TOKEN=/g)].length,
      mutationCount,
    );
    assert.equal([...block.matchAll(/randomUUID\(\)/g)].length, mutationCount);
    assert.equal([...block.matchAll(/randomBytes\(32\)/g)].length, acquireCount);
  }

  assert.doesNotMatch(
    controlPlaneDocs,
    /command generates and returns only a short lease token/i,
  );
});
