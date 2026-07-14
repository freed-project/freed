import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  findReleaseAppReadinessEvidence,
  loadRulesets,
  parseArgs,
  planRulesetSync,
  requiredCheckContexts,
  validateRuleset,
  verifyCodeownerApprovalReadiness,
  verifyCodeownersReadiness,
  verifyLiveReleaseTagAuthority,
  verifyReleaseAppReadiness,
  verifyReleaseTagActivation,
  verifyReleaseTagLockdown,
  verifyReleaseTagPublisherReadiness,
  verifyRulesetReadiness,
} from "./sync-github-rulesets.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

test("checked-in branch rulesets require PRs, CODEOWNER review, squash, and strict checks", () => {
  const rulesets = loadRulesets();
  const branchRulesets = rulesets.filter(
    (ruleset) => ruleset.target === "branch",
  );
  assert.equal(branchRulesets.length, 3);
  assert.deepEqual(
    branchRulesets
      .map((ruleset) => ruleset.conditions.ref_name.include[0])
      .sort(),
    ["refs/heads/dev", "refs/heads/main", "refs/heads/www"],
  );
  assert.deepEqual(
    Object.fromEntries(
      branchRulesets.map((ruleset) => [
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
  assert.throws(
    () => parseArgs(["--apply"]),
    /requires exactly one branch, --lock-release-tags, or --release-tags/,
  );
  assert.equal(
    parseArgs(["--apply", "--lock-release-tags"]).releaseTagLockdown,
    true,
  );
  assert.throws(
    () => parseArgs(["--apply", "--branch", "dev"]),
    /requires --publisher-login/,
  );
  assert.equal(
    parseArgs([
      "--apply",
      "--branch",
      "dev",
      "--publisher-login",
      "freed-pr-publisher[bot]",
    ]).branch,
    "dev",
  );
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

test("bootstrap lockdown performs one ruleset POST without App provisioning", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "freed-tag-lockdown-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binDir = path.join(root, "bin");
  const rulesetDir = path.join(root, "rulesets");
  const logPath = path.join(root, "gh.log");
  mkdirSync(binDir);
  mkdirSync(rulesetDir);
  writeFileSync(
    path.join(rulesetDir, "release-tag-lockdown.json"),
    readFileSync(
      path.join(
        scriptsDir,
        "..",
        ".github",
        "rulesets",
        "release-tag-lockdown.json",
      ),
      "utf8",
    ),
  );
  const ghPath = path.join(binDir, "gh");
  writeFileSync(
    ghPath,
    `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_GH_LOG"
if [ "$*" = "api repos/freed-project/freed/rulesets" ]; then
  printf '[]'
else
  printf '{}'
fi
`,
  );
  chmodSync(ghPath, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      path.join(scriptsDir, "sync-github-rulesets.mjs"),
      "--ruleset-dir",
      rulesetDir,
      "--lock-release-tags",
      "--apply",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        FAKE_GH_LOG: logPath,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(calls.filter((call) => call.includes("-X POST")).length, 1);
  assert.equal(
    calls.some((call) => call.includes("apps/")),
    false,
  );
  assert.equal(
    calls.some((call) => call.includes("user/installations")),
    false,
  );
});

test("release tag creation stays pending while immutability grants no bypass", () => {
  const tagRulesets = loadRulesets().filter(
    (ruleset) => ruleset.target === "tag",
  );
  const creation = tagRulesets.find(
    (ruleset) => ruleset.name === "Freed release tag creation",
  );
  const immutability = tagRulesets.find(
    (ruleset) => ruleset.name === "Freed release tag immutability",
  );
  const lockdown = tagRulesets.find(
    (ruleset) => ruleset.name === "Freed release tag lockdown",
  );
  assert.equal(creation.enforcement, "active");
  assert.deepEqual(creation.bypass_actors, []);
  assert.equal(immutability.enforcement, "active");
  assert.deepEqual(immutability.bypass_actors, []);
  assert.equal(verifyReleaseTagLockdown(tagRulesets).lockdown, lockdown);
  assert.throws(
    () =>
      verifyReleaseTagLockdown([
        {
          ...lockdown,
          conditions: {
            ref_name: {
              include: ["refs/tags/v*"],
              exclude: ["refs/tags/v26.*"],
            },
          },
        },
      ]),
    /must actively restrict creation, update, and deletion/,
  );
  assert.throws(
    () =>
      verifyReleaseTagLockdown([
        {
          ...lockdown,
          rules: lockdown.rules.map((rule) =>
            rule.type === "update"
              ? {
                  ...rule,
                  parameters: { update_allows_fetch_and_merge: true },
                }
              : rule,
          ),
        },
      ]),
    /must actively restrict creation, update, and deletion/,
  );
  assert.throws(
    () => parseArgs(["--apply", "--release-tags"]),
    /requires --release-app-id and --release-app-slug/,
  );
  assert.throws(
    () => verifyReleaseTagActivation(tagRulesets, 123456),
    /Release tag creation is locked with no bypass/,
  );

  const activeCreation = {
    ...creation,
    enforcement: "active",
    bypass_actors: [
      {
        actor_id: 123456,
        actor_type: "Integration",
        bypass_mode: "always",
      },
    ],
  };
  const activeRulesets = [activeCreation, immutability];
  assert.equal(
    verifyReleaseTagActivation(activeRulesets, 123456).releaseAppId,
    123456,
  );
  assert.deepEqual(verifyLiveReleaseTagAuthority(activeRulesets, 123456), {
    ready: true,
    releaseAppId: 123456,
  });
  assert.throws(
    () =>
      verifyLiveReleaseTagAuthority(
        [{ ...activeCreation, bypass_actors: [] }, immutability],
        123456,
      ),
    /only bypass to reviewed GitHub App/,
  );
  assert.throws(
    () => verifyLiveReleaseTagAuthority(activeRulesets, 654321),
    /reviewed GitHub App 654,321/,
  );
  assert.throws(
    () =>
      verifyLiveReleaseTagAuthority(
        [
          {
            ...activeCreation,
            conditions: {
              ref_name: {
                include: ["refs/tags/v*"],
                exclude: ["refs/tags/v26.*"],
              },
            },
          },
          immutability,
        ],
        123456,
      ),
    /target every refs\/tags\/v\*/,
  );
  assert.throws(
    () =>
      verifyLiveReleaseTagAuthority(
        [
          activeCreation,
          {
            ...immutability,
            bypass_actors: activeCreation.bypass_actors,
          },
        ],
        123456,
      ),
    /grant no bypass/,
  );
});

test("release tag activation verifies the exact App installation and repository", () => {
  const installationReadiness = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-installation-readiness",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    appName: "Freed Release Publisher",
    appExternalUrl: "https://freed.wtf",
    appOwnerLogin: "freed-project",
    appOwnerType: "Organization",
    appPermissions: { contents: "write", metadata: "read" },
    appEvents: [],
    installationId: 42,
    accountLogin: "freed-project",
    accountType: "Organization",
    repositorySelection: "selected",
    permissions: { contents: "write", metadata: "read" },
    repositories: ["freed-project/freed"],
  };
  const input = {
    installations: [
      {
        id: 42,
        app_id: 123456,
        app_slug: "freed-release-publisher",
        account: { login: "freed-project", type: "Organization" },
        target_type: "Organization",
        repository_selection: "selected",
        permissions: { contents: "write", metadata: "read" },
        events: [],
        suspended_at: null,
      },
    ],
    installationReadiness,
    releaseAppId: 123456,
    releaseAppSlug: "freed-release-publisher",
    publisherDigest: "a".repeat(64),
    repo: "freed-project/freed",
  };
  assert.deepEqual(verifyReleaseAppReadiness(input), {
    ready: true,
    appId: 123456,
    installationId: 42,
  });
  assert.throws(
    () => verifyReleaseAppReadiness({ ...input, releaseAppId: 999999 }),
    /does not match the dedicated selected-repository App contract/,
  );
  assert.throws(
    () =>
      verifyReleaseAppReadiness({
        ...input,
        installationReadiness: {
          ...installationReadiness,
          appExternalUrl: "https://example.com",
        },
      }),
    /does not match the dedicated selected-repository App contract/,
  );
  assert.throws(
    () => verifyReleaseAppReadiness({ ...input, installations: [] }),
    /is not installed/,
  );
  assert.throws(
    () =>
      verifyReleaseAppReadiness({
        ...input,
        installationReadiness: {
          ...installationReadiness,
          repositories: [],
        },
      }),
    /does not match the dedicated selected-repository App contract/,
  );
  assert.throws(
    () =>
      verifyReleaseAppReadiness({
        ...input,
        installations: [
          {
            id: 42,
            app_id: 123456,
            app_slug: "freed-release-publisher",
            account: { login: "freed-project", type: "Organization" },
            target_type: "Organization",
            repository_selection: "selected",
            permissions: { contents: "read", metadata: "read" },
            events: [],
          },
        ],
      }),
    /requires exact Contents write and Metadata read permissions/,
  );
  assert.throws(
    () =>
      verifyReleaseAppReadiness({
        ...input,
        installations: [
          {
            id: 42,
            app_id: 123456,
            app_slug: "freed-release-publisher",
            account: { login: "freed-project", type: "Organization" },
            target_type: "Organization",
            repository_selection: "selected",
            permissions: { contents: "write", metadata: "read" },
            events: [],
            suspended_at: "2026-07-12T00:00:00Z",
          },
        ],
      }),
    /installation is suspended/,
  );
});

test("release activation uses organization installation evidence and never user installations", () => {
  const calls = [];
  const installationReadiness = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-installation-readiness",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    appName: "Freed Release Publisher",
    appExternalUrl: "https://freed.wtf",
    appOwnerLogin: "freed-project",
    appOwnerType: "Organization",
    appPermissions: { contents: "write", metadata: "read" },
    appEvents: [],
    installationId: 42,
    accountLogin: "freed-project",
    accountType: "Organization",
    repositorySelection: "selected",
    permissions: { contents: "write", metadata: "read" },
    repositories: ["freed-project/freed"],
  };
  const result = findReleaseAppReadinessEvidence(
    "freed-project/freed",
    123456,
    "freed-release-publisher",
    installationReadiness,
    {
      exec(file, args) {
        calls.push([file, ...args]);
        if (args[1] === "orgs/freed-project/installations?per_page=100") {
          return JSON.stringify({
            installations: [
              {
                id: 42,
                app_id: 123456,
                app_slug: "freed-release-publisher",
                account: {
                  login: "freed-project",
                  type: "Organization",
                },
                target_type: "Organization",
                repository_selection: "selected",
                permissions: { contents: "write", metadata: "read" },
                events: [],
                suspended_at: null,
              },
            ],
          });
        }
        throw new Error(`Unexpected fake gh call: ${args.join(" ")}`);
      },
    },
  );
  assert.equal(result.installationId, 42);
  assert.equal(
    calls.some((call) => call.join(" ").includes("user/installations")),
    false,
  );
  assert.equal(
    calls.some((call) => call.join(" ").includes("apps/")),
    false,
  );
  assert.equal(
    calls.some((call) =>
      call.join(" ").includes("orgs/freed-project/installations?per_page=100"),
    ),
    true,
  );
});

test("release tag publisher attestation permits one narrow short-lived operation", () => {
  const expected = {
    repo: "freed-project/freed",
    releaseAppId: 123456,
    releaseAppSlug: "freed-release-publisher",
    publisherDigest: "a".repeat(64),
  };
  const attestation = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-readiness",
    repo: expected.repo,
    appId: expected.releaseAppId,
    appSlug: expected.releaseAppSlug,
    credentialMode: "short-lived-installation-token",
    operations: ["create-annotated-tag"],
    allowsArbitraryRefs: false,
    allowsUpdates: false,
    allowsDeletions: false,
    digest: "a".repeat(64),
  };
  assert.deepEqual(verifyReleaseTagPublisherReadiness(attestation, expected), {
    ready: true,
    publisherDigest: "a".repeat(64),
  });
  assert.throws(
    () =>
      verifyReleaseTagPublisherReadiness(
        { ...attestation, allowsUpdates: true },
        expected,
      ),
    /does not match the pinned short-lived annotated-tag publisher/,
  );
});

test("ruleset readiness requires a distinct publisher and exact-head owner approval", () => {
  const pull = {
    number: 949,
    user: { login: "freed-pr-publisher[bot]", type: "Bot" },
    head: { sha: "a".repeat(40) },
  };
  const approved = {
    id: 2,
    user: { login: "AubreyF" },
    state: "APPROVED",
    commit_id: "a".repeat(40),
  };
  assert.equal(
    verifyCodeownerApprovalReadiness({
      pull,
      reviews: [approved],
      publisherLogin: "freed-pr-publisher[bot]",
    }).ready,
    true,
  );
  assert.throws(
    () =>
      verifyCodeownerApprovalReadiness({
        pull: { ...pull, user: { login: "AubreyF" } },
        reviews: [approved],
        publisherLogin: "AubreyF",
      }),
    /distinct publisher GitHub identity/,
  );
  assert.throws(
    () =>
      verifyCodeownerApprovalReadiness({
        pull: {
          ...pull,
          user: { login: "freed-pr-publisher[bot]", type: "User" },
        },
        reviews: [approved],
        publisherLogin: "freed-pr-publisher[bot]",
      }),
    /is not a GitHub App or bot identity/,
  );
  assert.throws(
    () =>
      verifyCodeownerApprovalReadiness({
        pull,
        reviews: [{ ...approved, commit_id: "b".repeat(40) }],
        publisherLogin: "freed-pr-publisher[bot]",
      }),
    /lacks an exact-head APPROVED review/,
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
  const desired = loadRulesets().filter(
    (ruleset) => ruleset.target === "branch",
  );
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
