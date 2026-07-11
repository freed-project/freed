import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRulesets,
  parseArgs,
  planRulesetSync,
  requiredCheckContexts,
  validateRuleset,
  verifyCodeownersReadiness,
  verifyRulesetReadiness,
} from "./sync-github-rulesets.mjs";

test("checked-in branch rulesets require PRs, CODEOWNER review, squash, and strict checks", () => {
  const rulesets = loadRulesets();
  assert.equal(rulesets.length, 3);
  assert.deepEqual(
    rulesets.map((ruleset) => ruleset.conditions.ref_name.include[0]).sort(),
    ["refs/heads/dev", "refs/heads/main", "refs/heads/www"],
  );
  assert.deepEqual(
    Object.fromEntries(
      rulesets.map((ruleset) => [
        ruleset.conditions.ref_name.include[0],
        requiredCheckContexts(ruleset),
      ]),
    ),
    {
      "refs/heads/dev": ["Tooling smoke", "Feature validation"],
      "refs/heads/main": [
        "Tooling smoke",
        "Main PR guard",
        "Production validation",
      ],
      "refs/heads/www": ["Build website"],
    },
  );
});

test("ruleset readiness requires the exact governed CODEOWNERS policy on the target branch", () => {
  const desired = "/.github/ @AubreyF\n/scripts/ @AubreyF\n";
  const ready = verifyCodeownersReadiness(
    "dev",
    {
      type: "file",
      encoding: "base64",
      content: Buffer.from(desired).toString("base64"),
      sha: "abc123",
    },
    desired,
  );
  assert.deepEqual(ready, { ready: true, sha: "abc123" });
  assert.throws(
    () => verifyCodeownersReadiness("main", null, desired),
    /no readable \.github\/CODEOWNERS/,
  );
  assert.throws(
    () =>
      verifyCodeownersReadiness(
        "www",
        {
          type: "file",
          encoding: "base64",
          content: Buffer.from("/website/ @AubreyF\n").toString("base64"),
        },
        desired,
      ),
    /does not match the governed policy/,
  );
});

test("ruleset apply requires one branch and successful check evidence", () => {
  assert.throws(() => parseArgs(["--apply"]), /requires exactly one --branch/);
  assert.equal(parseArgs(["--apply", "--branch", "dev"]).branch, "dev");
  const dev = loadRulesets().find(
    (ruleset) => ruleset.name === "Freed dev governance",
  );
  assert.throws(
    () =>
      verifyRulesetReadiness(dev, [
        { name: "Tooling smoke", conclusion: "success" },
      ]),
    /Missing successful check contexts: Feature validation/,
  );
  assert.deepEqual(
    verifyRulesetReadiness(dev, [
      { name: "Tooling smoke", conclusion: "success" },
      { name: "Feature validation", conclusion: "success" },
    ]).ready,
    true,
  );
});

test("ruleset validation rejects bypass actors and missing checks", () => {
  const valid = loadRulesets()[0];
  assert.throws(
    () =>
      validateRuleset({
        ...valid,
        bypass_actors: [{ actor_type: "User", actor_id: 1 }],
      }),
    /bypass_actors must be empty/,
  );
  assert.throws(
    () =>
      validateRuleset({
        ...valid,
        rules: valid.rules.filter(
          (rule) => rule.type !== "required_status_checks",
        ),
      }),
    /missing required_status_checks rule/,
  );
});

test("ruleset sync planning creates, updates, and preserves by stable name", () => {
  const desired = loadRulesets();
  const current = [
    { ...desired[0], id: 1 },
    { ...desired[1], id: 2, enforcement: "disabled" },
  ];
  const plan = planRulesetSync(desired, current);
  assert.deepEqual(
    plan.map((item) => item.action),
    ["unchanged", "update", "create"],
  );
});
