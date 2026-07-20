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
  const exec = (_file, args) => {
    calls.push(args);
    const endpoint = args.at(-1);
    if (endpoint.includes("?targets=tag")) {
      return JSON.stringify([
        [
          { id: 7, name: "Freed release tag creation" },
          { id: 8, name: "Freed release tag immutability" },
        ],
      ]);
    }
    return JSON.stringify({
      id: Number(endpoint.split("/").at(-1)),
      target: "tag",
    });
  };
  assert.deepEqual(
    loadLiveReleaseTagRulesets("freed-project/freed", { exec }).map(
      (ruleset) => ruleset.id,
    ),
    [7, 8],
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 3), ["api", "--paginate", "--slurp"]);
});

test("live release tag authority loader fails when provisioning is absent", () => {
  const exec = () => JSON.stringify([[]]);
  assert.throws(
    () => loadLiveReleaseTagRulesets("freed-project/freed", { exec }),
    /Release tags are blocked until a dedicated release GitHub App/,
  );
});

test("live authority loader includes the bootstrap lockdown when it exists", () => {
  const exec = (_file, args) => {
    const endpoint = args.at(-1);
    if (endpoint.includes("?targets=tag")) {
      return JSON.stringify([
        [
          { id: 7, name: "Freed release tag creation" },
          { id: 8, name: "Freed release tag immutability" },
          { id: 9, name: "Freed release tag lockdown" },
          { id: 10, name: "Freed release tag lockdown" },
        ],
      ]);
    }
    const id = Number(endpoint.split("/").at(-1));
    return JSON.stringify({
      id,
      name:
        id === 7
          ? "Freed release tag creation"
          : id === 8
            ? "Freed release tag immutability"
            : "Freed release tag lockdown",
      target: "tag",
      enforcement: "active",
    });
  };
  assert.deepEqual(
    loadLiveReleaseTagRulesets("freed-project/freed", { exec }).map(
      (ruleset) => ruleset.name,
    ),
    [
      "Freed release tag creation",
      "Freed release tag immutability",
      "Freed release tag lockdown",
      "Freed release tag lockdown",
    ],
  );
});

test("live authority loader finds an active lockdown after the first page", () => {
  const firstPage = [
    { id: 7, name: "Freed release tag creation" },
    { id: 8, name: "Freed release tag immutability" },
    ...Array.from({ length: 98 }, (_, index) => ({
      id: index + 100,
      name: `Unrelated tag rule ${index.toLocaleString("en-US")}`,
    })),
  ];
  const exec = (_file, args) => {
    const endpoint = args.at(-1);
    if (endpoint.includes("?targets=tag")) {
      return JSON.stringify([
        firstPage,
        [{ id: 999, name: "Freed release tag lockdown" }],
      ]);
    }
    const id = Number(endpoint.split("/").at(-1));
    return JSON.stringify({
      id,
      name:
        id === 7
          ? "Freed release tag creation"
          : id === 8
            ? "Freed release tag immutability"
            : "Freed release tag lockdown",
      target: "tag",
      enforcement: "active",
    });
  };
  const rulesets = loadLiveReleaseTagRulesets("freed-project/freed", { exec });
  assert.equal(rulesets.length, 3);
  assert.equal(rulesets[2].name, "Freed release tag lockdown");
  assert.equal(rulesets[2].enforcement, "active");
});
