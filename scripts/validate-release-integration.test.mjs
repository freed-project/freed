import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveIntegrationSource, readMergedPromotionSnapshots, validateReleaseIntegration } from "./validate-release-integration.mjs";
import { validateIntegrationJobs } from "./validate-dev-integration-receipt.mjs";

// Admission must distinguish a metadata-only release from changed test/build
// inputs, and must not accept a green workflow whose critical jobs skipped.
test("release admission binds snapshot inputs and rejects drift or skipped durability", async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "freed-release-integration-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  };
  const commit = (message) => {
    git("add", ".");
    git("-c", "user.name=Freed Tests", "-c", "user.email=tests@freed.invalid", "commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  write("packages/desktop/package.json", '{"version":"1.0.0","scripts":{"build":"vite"}}');
  write("packages/shared/src/index.ts", "export const value = 1;\n");
  write("vitest.config.ts", "export default {};\n");
  const source = commit("product");
  write("packages/desktop/package.json", '{"version":"1.0.1","scripts":{"build":"vite"}}');
  commit(`promotion\n\nFreed-Dev-Snapshot: ${source}`);
  assert.equal(resolveIntegrationSource({ cwd }), source);
  const proof = await validateReleaseIntegration({ cwd }, {
    token: "fixture-token",
    fetchImpl: async (url) => ({ ok: true, json: async () =>
      url.pathname.endsWith("/jobs")
        ? { jobs: ["Dev integration", "Tooling smoke", "PWA OPFS durability (macOS WebKit)"].map((name) => ({ name, status: "completed", conclusion: "success" })) }
        : { workflow_runs: [{ id: 42, run_attempt: 1, head_sha: source, head_branch: "dev", event: "push", status: "completed", conclusion: "success" }] },
    }),
  });
  assert.equal(proof.headSha, source);
  const head = "b".repeat(40);
  const pr = { merged_at: "2026-09-09", merge_commit_sha: head, base: { ref: "main" }, head: { sha: "c".repeat(40) } };
  const snapshots = readMergedPromotionSnapshots(head, (endpoint) =>
    endpoint.endsWith("/pulls")
      ? [pr, { ...pr, merge_commit_sha: "d".repeat(40) }, { ...pr, base: { ref: "dev" } }]
      : { commit: { message: `promotion\n\nFreed-Dev-Snapshot: ${source}` } },
  );
  assert.deepEqual(snapshots, [source]);

  write("packages/desktop/package.json", '{"version":"1.0.2","scripts":{"build":"different"}}');
  commit("altered command");
  assert.throws(() => resolveIntegrationSource({ cwd }), /package.json/);
  write("packages/desktop/package.json", '{"version":"1.0.2","scripts":{"build":"vite"}}');
  write("vitest.config.ts", "export default { test: { exclude: ['**'] } };\n");
  commit("altered test config");
  assert.throws(() => resolveIntegrationSource({ cwd }), /vitest.config.ts/);
  const jobs = ["Dev integration", "Tooling smoke", "PWA OPFS durability (macOS WebKit)"].map((name) => ({ name, status: "completed", conclusion: "success" }));
  validateIntegrationJobs(jobs);
  assert.throws(() => validateIntegrationJobs(jobs.slice(0, 2)), /durability/);
  jobs[2].conclusion = "skipped";
  assert.throws(() => validateIntegrationJobs(jobs), /durability/);
});
