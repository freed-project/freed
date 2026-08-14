import assert from "node:assert/strict";
import test from "node:test";

import {
  githubCliCandidates,
  resolveGitHubCli,
} from "./github-tooling.mjs";

test("GitHub CLI resolution survives a PATH without Homebrew", () => {
  const executablePaths = new Set(["/opt/homebrew/bin/gh"]);
  assert.equal(
    resolveGitHubCli({
      environment: { PATH: "/usr/bin:/bin" },
      executable: (candidate) => executablePaths.has(candidate),
    }),
    "/opt/homebrew/bin/gh",
  );
});

test("GitHub CLI resolution prefers an explicit absolute binary", () => {
  assert.equal(
    resolveGitHubCli({
      environment: {
        GH_BIN: "/private/tools/gh",
        PATH: "/usr/bin:/bin",
      },
      executable: (candidate) =>
        candidate === "/private/tools/gh" ||
        candidate === "/opt/homebrew/bin/gh",
    }),
    "/private/tools/gh",
  );
});

test("GitHub CLI resolution uses PATH before installation fallbacks", () => {
  assert.deepEqual(
    githubCliCandidates({ PATH: "/custom/bin:/usr/bin" }).slice(0, 4),
    [
      "/custom/bin/gh",
      "/usr/bin/gh",
      "/opt/homebrew/bin/gh",
      "/usr/local/bin/gh",
    ],
  );
});

test("GitHub CLI resolution fails with actionable remediation", () => {
  assert.throws(
    () =>
      resolveGitHubCli({
        environment: { PATH: "/usr/bin:/bin" },
        executable: () => false,
      }),
    /Set GH_BIN.*add gh to PATH.*opt\/homebrew\/bin/s,
  );
  assert.equal(
    resolveGitHubCli({
      environment: { PATH: "/usr/bin:/bin" },
      executable: () => false,
      required: false,
    }),
    "",
  );
});
