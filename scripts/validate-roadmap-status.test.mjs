import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  phaseStatusFromMarkdown,
  validateRoadmapStatus,
} from "./validate-roadmap-status.mjs";

test("roadmap status manifest matches every phase document", () => {
  const manifest = validateRoadmapStatus();
  assert.equal(manifest.phases.length, 13);
  assert.equal(
    manifest.phases.find((phase) => phase.id === 3)?.status,
    "current",
  );
  assert.equal(
    manifest.phases.find((phase) => phase.id === 6)?.status,
    "complete",
  );
});

test("phase status normalization handles current project vocabulary", () => {
  assert.equal(
    phaseStatusFromMarkdown("> **Status:** ✅ Complete"),
    "complete",
  );
  assert.equal(
    phaseStatusFromMarkdown("> **Status:** 🚧 In Progress"),
    "current",
  );
  assert.equal(phaseStatusFromMarkdown("> **Status:** Current"), "current");
  assert.equal(phaseStatusFromMarkdown("> **Status:** Future"), "upcoming");
});

test("roadmap status validation rejects omitted phase documents", () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-roadmap-status-"));
  mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "docs", "PHASE-1-ONE.md"),
    "> **Status:** Complete\n",
  );
  writeFileSync(
    path.join(repoRoot, "docs", "PHASE-2-TWO.md"),
    "> **Status:** Future\n",
  );
  const manifestPath = path.join(repoRoot, "docs", "roadmap-status.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      phases: [{ id: 1, status: "complete", source: "docs/PHASE-1-ONE.md" }],
    }),
  );

  assert.throws(
    () => validateRoadmapStatus({ repoRoot, manifestPath }),
    /Missing: docs\/PHASE-2-TWO\.md/,
  );
});
