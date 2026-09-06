import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateRoutingFixtures,
  validateContractRoutes,
  validateLaneParity,
} from "./validate-instruction-routing.mjs";

test("checked-in workflow fixtures and extracted chapters have complete bounded routes", () => {
  const reports = validateRoutingFixtures();
  assert.ok(reports.length >= 6);
  assert.ok(validateContractRoutes().length >= 19);
});

test("fixture validation rejects disconnected routes, missing stops, exclusions and byte growth", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-routing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "entry.md"), "[detail](detail.md)\n");
  writeFileSync(path.join(root, "detail.md"), "Do not mutate.\n");
  const item = {
    id: "example",
    prompt: "Inspect",
    rationale: "Inspection only",
    entry: "entry.md",
    files: ["entry.md", "detail.md"],
    maxBytes: 100,
  };
  const run = (changes) =>
    validateRoutingFixtures({
      root,
      fixtures: { cases: [{ ...item, ...changes }] },
    });
  assert.equal(run({}).length, 1);
  assert.throws(() => run({ maxBytes: 1 }), /byte budget/);
  assert.throws(() => run({ excluded: ["detail.md"] }), /unrelated reference/);
  assert.throws(
    () => run({ required: [{ file: "detail.md", text: "Invented rule" }] }),
    /missing required/,
  );
  writeFileSync(path.join(root, "entry.md"), "No route\n");
  assert.throws(() => run({}), /not reachable/);
});

test("contract route validation catches orphaned chapters and broken links", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-contract-routes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "docs/library-core-contract"), { recursive: true });
  const index = path.join(root, "docs/LIBRARY-CORE-CONTRACT.md");
  writeFileSync(index, "[chapter](library-core-contract/chapter.md)\n");
  const chapter = path.join(root, "docs/library-core-contract/chapter.md");
  writeFileSync(chapter, "Contract\n");
  assert.equal(validateContractRoutes(root).length, 2);
  writeFileSync(
    path.join(root, "docs/library-core-contract/orphan.md"),
    "Lost\n",
  );
  assert.throws(() => validateContractRoutes(root), /Unrouted/);
  writeFileSync(chapter, "[missing](missing.md)\n");
  assert.throws(() => validateContractRoutes(root), /ENOENT/);
});

test("lane parity detects authority and universal safety drift while permitting documented lane differences", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const product = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const website =
    product +
    "\nIt requires Level 6 or 7.\nNever base website work on `dev`, merge `dev` into `www`\n";
  const lanes = { dev: product, main: product, www: website };
  assert.equal(validateLaneParity(lanes).length, 3);
  assert.throws(
    () =>
      validateLaneParity({
        ...lanes,
        main: product.replace(
          "7. **Full task authority:**",
          "7. **Changed authority:**",
        ),
      }),
    /authorization model drift/,
  );
  assert.throws(
    () =>
      validateLaneParity({
        ...lanes,
        www: website.replace("Preserve user changes.", "Ignore user changes."),
      }),
    /universal safety stop/,
  );
  assert.throws(
    () => validateLaneParity({ ...lanes, www: product }),
    /production or lane separation/,
  );
});
