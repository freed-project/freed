import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { planPwaVercelBuild } from "./pwa-vercel-ignore-build.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd, message) {
  git(cwd, "add", ".");
  git(
    cwd,
    "-c",
    "user.name=Freed Test",
    "-c",
    "user.email=tests@freed.invalid",
    "commit",
    "-m",
    message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

for (const invocationDirectory of [".", "packages/pwa"]) {
  test(`PWA Vercel filtering compares the last successful deployment from ${invocationDirectory}`, (t) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "freed-pwa-ignore-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    git(cwd, "init", "-q");
    mkdirSync(path.join(cwd, "packages", "pwa"), { recursive: true });
    mkdirSync(path.join(cwd, "docs"), { recursive: true });
    writeFileSync(path.join(cwd, "packages", "pwa", "app.ts"), "first\n");
    const deployed = commit(cwd, "initial PWA");
    const planFromInvocationDirectory = (options) => planPwaVercelBuild({
      ...options,
      cwd: path.join(cwd, invocationDirectory),
    });

    writeFileSync(path.join(cwd, "docs", "notes.md"), "docs only\n");
    const docsOnly = commit(cwd, "docs only");
    assert.deepEqual(
      planFromInvocationDirectory({ previousSha: deployed, currentSha: docsOnly }),
      { ignore: true, reason: "no PWA-relevant changes" },
    );

    writeFileSync(path.join(cwd, "packages", "pwa", "app.ts"), "functional\n");
    commit(cwd, "functional change");
    writeFileSync(path.join(cwd, "docs", "notes.md"), "trailing docs\n");
    const functionalThenDocs = commit(cwd, "trailing docs");
    assert.deepEqual(
      planFromInvocationDirectory({
        cwd,
        previousSha: docsOnly,
        currentSha: functionalThenDocs,
      }),
      { ignore: false, reason: "PWA-relevant changes detected" },
    );

    assert.equal(
      planFromInvocationDirectory({ previousSha: "", currentSha: docsOnly }).ignore,
      false,
    );
    assert.equal(
      planFromInvocationDirectory({
        cwd,
        previousSha: "f".repeat(40),
        currentSha: docsOnly,
      }).ignore,
      false,
    );

    mkdirSync(path.join(cwd, "scripts"), { recursive: true });
    writeFileSync(path.join(cwd, "scripts", "pwa-vercel-ignore-build.mjs"), "// filter repair\n");
    const filterChange = commit(cwd, "filter repair");
    assert.deepEqual(
      planFromInvocationDirectory({ previousSha: functionalThenDocs, currentSha: filterChange }),
      { ignore: false, reason: "PWA-relevant changes detected" },
    );

    git(cwd, "checkout", "-q", "--orphan", "unrelated");
    writeFileSync(path.join(cwd, "docs", "notes.md"), "unrelated root\n");
    const unrelated = commit(cwd, "unrelated root");
    assert.deepEqual(
      planFromInvocationDirectory({ previousSha: deployed, currentSha: unrelated }),
      { ignore: false, reason: "deployment baseline is not an ancestor" },
    );
  });
}
