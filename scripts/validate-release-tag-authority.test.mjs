import assert from "node:assert/strict";
import test from "node:test";

import {
  loadLiveReleaseTagRulesets,
  parseArgs,
} from "./validate-release-tag-authority.mjs";

test("release tag authority arguments accept only owner and repository", () => {
  assert.equal(parseArgs([]).repo, "freed-project/freed");
  assert.equal(
    parseArgs(["--repo=freed-project/freed"]).repo,
    "freed-project/freed",
  );
  assert.throws(() => parseArgs(["--repo", "freed"]), /owner\/repository/);
});

test("live release tag authority loader resolves the named ruleset", () => {
  const calls = [];
  const exec = (file, args) => {
    calls.push({ file, args });
    if (args[1].includes("?targets=tag")) {
      return JSON.stringify([
        { id: 7, name: "Freed release tag creation" },
        { id: 8, name: "Freed release tag immutability" },
      ]);
    }
    return JSON.stringify({
      id: Number(args[1].split("/").at(-1)),
      target: "tag",
    });
  };
  assert.deepEqual(
    loadLiveReleaseTagRulesets("freed-project/freed", {
      exec,
      githubCli: "/opt/homebrew/bin/gh",
    }).map((ruleset) => ruleset.id),
    [7, 8],
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.file),
    [
      "/opt/homebrew/bin/gh",
      "/opt/homebrew/bin/gh",
      "/opt/homebrew/bin/gh",
    ],
  );
});

test("live release tag authority loader fails when provisioning is absent", () => {
  const exec = () => JSON.stringify([]);
  assert.throws(
    () =>
      loadLiveReleaseTagRulesets("freed-project/freed", {
        exec,
        githubCli: "/fixture/gh",
      }),
    /Release tags are blocked until a dedicated release GitHub App/,
  );
});
