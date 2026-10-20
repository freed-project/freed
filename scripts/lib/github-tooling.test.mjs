import assert from "node:assert/strict";
import test from "node:test";

import {
  githubCliCandidates,
  isTrustedIssueAuthor,
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

test("trusted issue authors are the owner and verified GitHub Actions only", () => {
  assert.equal(isTrustedIssueAuthor({ login: "AubreyF", is_bot: false }), true);
  assert.equal(isTrustedIssueAuthor({ login: "AubreyF" }), true);
  assert.equal(isTrustedIssueAuthor({ login: "app/github-actions", is_bot: true }), true);
  assert.equal(isTrustedIssueAuthor({ login: "github-actions[bot]", is_bot: true }), true);
  for (const author of [
    { login: "outsider", is_bot: false },
    { login: "aubreyf", is_bot: false },
    { login: "AubreyF", is_bot: true },
    { login: "github-actions", is_bot: false },
    { login: "app/github-actions", is_bot: false },
    { login: "app/dependabot", is_bot: true },
    { login: "", is_bot: false },
    { login: 1 },
    "AubreyF",
    null,
    undefined,
  ]) {
    assert.equal(isTrustedIssueAuthor(author), false, JSON.stringify(author));
  }
});
