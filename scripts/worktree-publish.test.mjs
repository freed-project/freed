import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import { providerApprovalAuthorizationDigest } from "./lib/provider-visible-paths.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const publishScript = path.join(repoRoot, "scripts/worktree-publish.sh");
const trustedPublishScript = path.join(
  repoRoot,
  "scripts/trusted-worktree-publish.sh",
);
const developerDirectory = "/Library/Developer/CommandLineTools";

async function createTrustedControlCheckout(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "freed-trusted-publisher-"),
  );
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.cp(path.join(repoRoot, "scripts"), path.join(root, "scripts"), {
    recursive: true,
  });
  await fs.copyFile(path.join(repoRoot, ".nvmrc"), path.join(root, ".nvmrc"));
  assert.equal(run("git", ["init"], { cwd: root }).status, 0);
  assert.equal(
    run("git", ["config", "user.name", "Freed Tests"], { cwd: root }).status,
    0,
  );
  assert.equal(
    run("git", ["config", "user.email", "tests@freed.invalid"], { cwd: root })
      .status,
    0,
  );
  assert.equal(run("git", ["add", "-A"], { cwd: root }).status, 0);
  assert.equal(
    run("git", ["commit", "-m", "chore: trusted control checkout"], {
      cwd: root,
    }).status,
    0,
  );
  const head = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  return {
    root,
    head,
    publishScript: path.join(root, "scripts/trusted-worktree-publish.sh"),
  };
}

function run(command, args, options = {}) {
  const environment = {
    ...process.env,
    DEVELOPER_DIR: developerDirectory,
    ...(options.env ?? {}),
  };
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
    env: environment,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function assertSuccess(result) {
  assert.equal(
    result.status,
    0,
    `stdout:\n${result.stdout ?? ""}\n\nstderr:\n${result.stderr ?? ""}`,
  );
}

async function createPublishFixture(
  t,
  { seedProviderFile = false, preacquirePublisherLease = true } = {},
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "freed-worktree-publish-"),
  );
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const worktree = path.join(root, "worktree");
  const binDir = path.join(root, "bin");
  const ghStateFile = path.join(root, "gh-state.json");
  const ghLogFile = path.join(root, "gh-log.jsonl");
  const homeDir = path.join(root, "home");
  const automationStateRoot = path.join(homeDir, ".freed", "automation");
  const publisherKeyPair = generateKeyPairSync("ed25519");
  const publisherPublicKey = publisherKeyPair.publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");

  await fs.mkdir(seed, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(ghStateFile, JSON.stringify({ prList: [] }, null, 2));
  await fs.writeFile(ghLogFile, "");
  await fs.mkdir(path.join(automationStateRoot, "control"), {
    recursive: true,
  });
  const publisherCredentialPath = path.join(
    automationStateRoot,
    "control/actor-credentials/freed-pr-publisher.json",
  );
  await fs.mkdir(path.dirname(publisherCredentialPath), { recursive: true });
  await fs.writeFile(
    publisherCredentialPath,
    JSON.stringify({
      schemaVersion: 1,
      actor: "freed-pr-publisher",
      purpose: "publisher-capability-signing",
      publicKeyBase64: publisherPublicKey,
    }),
    { mode: 0o600 },
  );

  assert.equal(run("git", ["init", "--bare", origin]).status, 0);
  assert.equal(run("git", ["init"], { cwd: seed }).status, 0);
  assert.equal(
    run("git", ["config", "user.name", "Freed Tests"], { cwd: seed }).status,
    0,
  );
  assert.equal(
    run("git", ["config", "user.email", "tests@freed.invalid"], { cwd: seed })
      .status,
    0,
  );
  await fs.writeFile(path.join(seed, "README.md"), "seed\n");
  if (seedProviderFile) {
    const providerPath = path.join(
      seed,
      "packages/desktop/src-tauri/src/fb-extract.js",
    );
    await fs.mkdir(path.dirname(providerPath), { recursive: true });
    await fs.writeFile(providerPath, "// original provider extractor\n");
  }
  assert.equal(run("git", ["add", "-A"], { cwd: seed }).status, 0);
  assert.equal(
    run("git", ["commit", "-m", "chore: seed repo"], { cwd: seed }).status,
    0,
  );
  assert.equal(run("git", ["branch", "-M", "dev"], { cwd: seed }).status, 0);
  assert.equal(
    run("git", ["remote", "add", "origin", origin], { cwd: seed }).status,
    0,
  );
  assert.equal(
    run("git", ["push", "-u", "origin", "dev"], { cwd: seed }).status,
    0,
  );

  assert.equal(
    run("git", ["clone", "--branch", "dev", origin, worktree]).status,
    0,
  );
  assert.equal(
    run("git", ["config", "user.name", "Freed Tests"], { cwd: worktree })
      .status,
    0,
  );
  assert.equal(
    run("git", ["config", "user.email", "tests@freed.invalid"], {
      cwd: worktree,
    }).status,
    0,
  );
  assert.equal(
    run("git", ["checkout", "-b", "fix/worktree-publish-test"], {
      cwd: worktree,
    }).status,
    0,
  );
  const canonicalOrigin = "https://github.com/freed-project/freed.git";
  assert.equal(
    run("git", ["remote", "set-url", "origin", canonicalOrigin], {
      cwd: worktree,
    }).status,
    0,
  );
  assert.equal(
    run("git", ["config", `url.${origin}.insteadOf`, canonicalOrigin], {
      cwd: worktree,
    }).status,
    0,
  );

  const ghStub = `#!${process.execPath}
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const args = process.argv.slice(2);
const stateFile = ${JSON.stringify(ghStateFile)};
const logFile = ${JSON.stringify(ghLogFile)};
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));

fs.appendFileSync(logFile, JSON.stringify({
  args,
  persistentActorTokenPresent: Boolean(process.env.FREED_AUTOMATION_ACTOR_TOKEN),
  genericLeaseTokenPresent: Boolean(process.env.FREED_AUTOMATION_LEASE_TOKEN),
  ownerBootstrapTokenPresent: Boolean(process.env.FREED_OWNER_BOOTSTRAP_TOKEN),
  persistentPublisherTokenPresent: Boolean(process.env.FREED_PR_PUBLISHER_ACTOR_TOKEN),
  publisherLeaseTokenPresent: Boolean(process.env.FREED_PR_PUBLISHER_LEASE_TOKEN),
}) + "\\n");

if (args[0] === "api") {
  if (state.canonicalBaseOverride) {
    process.stdout.write(state.canonicalBaseOverride);
    process.exit(0);
  }
  const base = args[1].split("/").at(-1);
  const baseSha = execFileSync("/usr/bin/git", ["rev-parse", "origin/" + base], {
    encoding: "utf8",
  }).trim();
  process.stdout.write(baseSha);
  process.exit(0);
}

if (args[0] !== "pr") {
  process.exit(1);
}

if (args[1] === "list") {
  if (state.invalidateFileOnList) {
    fs.writeFileSync(state.invalidateFileOnList, "{}\\n");
  }
  const headRefOid = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const requestedBase = args[args.indexOf("--base") + 1] || "dev";
  process.stdout.write(JSON.stringify((state.prList || []).map((item) => ({
    headRefOid,
    baseRefName: requestedBase,
    ...item,
  }))));
  process.exit(0);
}

if (args[1] === "create") {
  process.stdout.write(state.createUrl || "https://github.com/freed-project/freed/pull/999");
  process.exit(0);
}

if (args[1] === "view") {
  const headRefOid = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  process.stdout.write(JSON.stringify({
    headRefOid,
    baseRefName: state.viewBase || "dev",
  }));
  process.exit(0);
}

if (args[1] === "edit" || args[1] === "ready") {
  process.exit(0);
}

process.exit(1);
`;

  await fs.writeFile(path.join(binDir, "gh"), ghStub, { mode: 0o755 });
  const ghBin = path.join(binDir, "gh");
  const ghSha256 = createHash("sha256").update(ghStub).digest("hex");
  const nodeSha256 = createHash("sha256")
    .update(await fs.readFile(process.execPath))
    .digest("hex");
  const publisherScope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: await fs.realpath(worktree),
    branch: "fix/worktree-publish-test",
    base: "dev",
    baseSha: run("git", ["rev-parse", "origin/dev"], {
      cwd: worktree,
    }).stdout.trim(),
    headSha: null,
    publishMode: "feature-pr",
  };

  const nowMs = Date.now();
  const capabilityId = `publisher-test-${nowMs}`;
  const capabilityPayload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      capabilityId,
      issuer: "freed-pr-publisher",
      leaseName: "pr-publisher",
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 60_000).toISOString(),
      leaseTtlMs: 1_800_000,
      scope: publisherScope,
    }),
  );
  const capabilityPath = path.join(
    automationStateRoot,
    "control/publisher-capabilities/pending",
    `${capabilityId}.json`,
  );
  await fs.mkdir(path.dirname(capabilityPath), {
    recursive: true,
    mode: 0o700,
  });
  await fs.writeFile(
    capabilityPath,
    `${JSON.stringify({
      schemaVersion: 1,
      payloadBase64: capabilityPayload.toString("base64"),
      signatureBase64: signPayload(
        null,
        capabilityPayload,
        publisherKeyPair.privateKey,
      ).toString("base64"),
    })}\n`,
    { mode: 0o600 },
  );

  let publisherLeaseToken = "";
  if (preacquirePublisherLease) {
    const acquire = run(
      process.execPath,
      [
        path.join(repoRoot, "scripts/automation-control.mjs"),
        "lease",
        "acquire",
        "--state-root",
        automationStateRoot,
        "--name",
        "pr-publisher",
        "--owner",
        "freed-pr-publisher",
        "--ttl-seconds",
        "1800",
        "--capability-file",
        capabilityPath,
        "--scope-json",
        JSON.stringify(publisherScope),
      ],
      {
        env: {
          ...process.env,
          HOME: homeDir,
        },
      },
    );
    assertSuccess(acquire);
    publisherLeaseToken = JSON.parse(acquire.stdout).result.lease.token;
  }

  return {
    origin,
    worktree,
    ghStateFile,
    ghLogFile,
    automationStateRoot,
    capabilityPath,
    publisherScope,
    publisherPrivateKey: publisherKeyPair.privateKey,
    env: {
      ...process.env,
      GH_STATE_FILE: ghStateFile,
      GH_LOG_FILE: ghLogFile,
      HOME: homeDir,
      DEVELOPER_DIR: developerDirectory,
      NODE_BIN: process.execPath,
      FREED_PUBLISH_GIT_BIN: "/usr/bin/git",
      FREED_PUBLISH_GH_BIN: ghBin,
      FREED_PUBLISH_PYTHON_BIN: "/usr/bin/python3",
      FREED_TRUSTED_GH_BIN: ghBin,
      FREED_TRUSTED_GH_SHA256: ghSha256,
      FREED_TRUSTED_NODE_BIN: process.execPath,
      FREED_TRUSTED_NODE_SHA256: nodeSha256,
      FREED_PUBLISH_CONTROL_STATE_ROOT: automationStateRoot,
      FREED_PUBLISH_SCOPE_JSON: JSON.stringify(publisherScope),
      ...(publisherLeaseToken
        ? { FREED_PR_PUBLISHER_LEASE_TOKEN: publisherLeaseToken }
        : {}),
      PATH: `${binDir}:${process.env.PATH}`,
    },
  };
}

async function authorizeProviderApproval(fixture, approval) {
  const authorizationDigest = providerApprovalAuthorizationDigest(approval);
  await fs.writeFile(
    path.join(fixture.automationStateRoot, "control/current-tasks.json"),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      updatedAt: new Date().toISOString(),
      tasks: [
        {
          schemaVersion: 1,
          taskId: approval.approvalSource.reference,
          state: "approved_for_pr",
          revision: 2,
          observerAuthority: "pr-only",
          providerAuthority: "approved",
          providerApprovalReference: authorizationDigest,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          details: {},
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(fixture.automationStateRoot, "control/events.jsonl"),
    `${JSON.stringify({
      schemaVersion: 1,
      eventId: `provider-owner-lease-${approval.approvalId}`,
      type: "lease_acquired",
      ts: "2026-07-10T15:59:30.000Z",
      actor: "freed-owner",
      leaseName: "owner-governance",
      data: {
        credentialKind: "owner-bootstrap",
        ownerBootstrapGrantId: "provider-owner-bootstrap-test",
      },
    })}\n${JSON.stringify({
      schemaVersion: 1,
      eventId: `provider-owner-authorization-${approval.approvalId}`,
      type: "task_authority_updated",
      ts: new Date().toISOString(),
      actor: "freed-owner",
      taskId: approval.approvalSource.reference,
      taskRevision: 2,
      manifestRevision: 1,
      observerAuthority: "pr-only",
      providerAuthority: "approved",
      providerApprovalReference: authorizationDigest,
      data: {
        authorizationProvenance: {
          leaseName: "owner-governance",
          leaseAcquiredAt: "2026-07-10T15:59:30.000Z",
          credentialKind: "owner-bootstrap",
          ownerBootstrapGrantId: "provider-owner-bootstrap-test",
        },
      },
    })}\n`,
  );
  return authorizationDigest;
}

async function readGhLog(logFile) {
  const raw = await fs.readFile(logFile, "utf8");
  return (
    raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      // The doctor preflight probes `gh --version`; these assertions only
      // care about the publish flow's PR interactions.
      .filter((call) => call.args[0] === "pr")
  );
}

test("worktree-publish converts an existing ready PR back to draft and updates it", async (t) => {
  const fixture = await createPublishFixture(t);

  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify(
      {
        prList: [
          {
            number: 253,
            url: "https://github.com/freed-project/freed/pull/253",
            isDraft: false,
          },
        ],
      },
      null,
      2,
    ),
  );

  await fs.writeFile(path.join(fixture.worktree, "README.md"), "updated\n");

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: refresh worktree publish flow",
      "--summary",
      "Refresh the worktree publish flow",
      "--test",
      "node --test scripts/*.test.mjs",
    ],
    {
      cwd: fixture.worktree,
      env: {
        ...fixture.env,
        FREED_AUTOMATION_STATE_ROOT: path.join(
          path.dirname(fixture.worktree),
          "forged-state-root",
        ),
      },
    },
  );

  assertSuccess(result);
  assert.match(
    result.stdout,
    /Updated draft PR: https:\/\/github.com\/freed-project\/freed\/pull\/253/,
  );

  const headMessage = run("git", ["log", "-1", "--pretty=%s"], {
    cwd: fixture.worktree,
  });
  assert.equal(headMessage.stdout.trim(), "fix: refresh worktree publish flow");

  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.deepEqual(ghCalls[0].args.slice(0, 2), ["pr", "list"]);
  const demoteCall = ghCalls.find(
    (call) => call.args[1] === "ready" && call.args.includes("--undo"),
  );
  assert.deepEqual(demoteCall.args, [
    "pr",
    "ready",
    "253",
    "--repo",
    "freed-project/freed",
    "--undo",
  ]);
  const editCall = ghCalls.find((call) => call.args[1] === "edit");
  assert.equal(editCall.args[0], "pr");
  assert.match(editCall.args.join("\n"), /\(AI Generated\)\./);
});

test("worktree-publish updates an existing draft PR without toggling it", async (t) => {
  const fixture = await createPublishFixture(t);

  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify(
      {
        prList: [
          {
            number: 251,
            url: "https://github.com/freed-project/freed/pull/251",
            isDraft: true,
          },
        ],
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "updated draft\n",
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: update draft publish helper",
      "--summary",
      "Update the draft publish helper",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assertSuccess(result);
  assert.match(
    result.stdout,
    /Updated draft PR: https:\/\/github.com\/freed-project\/freed\/pull\/251/,
  );

  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(
    ghCalls.some((call) => call.args[1] === "ready"),
    false,
  );
  assert.equal(
    ghCalls.some((call) => call.args[1] === "edit"),
    true,
  );
  assert.equal(ghCalls.at(-1).args[1], "view");
});

test("worktree-publish refuses an existing PR retargeted after lookup", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify({
      prList: [
        {
          number: 254,
          url: "https://github.com/freed-project/freed/pull/254",
          isDraft: true,
        },
      ],
      viewBase: "main",
    }),
  );
  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "retarget race\n",
  );
  const result = run(
    "bash",
    [publishScript, "--title", "fix: reject retargeted pull request"],
    { cwd: fixture.worktree, env: fixture.env },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pull request target does not match/);
  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(
    ghCalls.some((call) => ["edit", "ready"].includes(call.args[1])),
    false,
  );
});

test("worktree-publish refuses a canonical base that moved after capability issuance", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify({ prList: [], canonicalBaseOverride: "f".repeat(40) }),
  );
  await fs.writeFile(path.join(fixture.worktree, "README.md"), "stale base\n");
  const result = run(
    "bash",
    [publishScript, "--title", "fix: reject stale base capability"],
    { cwd: fixture.worktree, env: fixture.env },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /canonical dev moved/);
  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(
    ghCalls.some((call) => call.args[0] === "pr"),
    false,
  );
});

test("worktree-publish creates a new draft PR when none exists", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "fresh create\n",
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: create a new draft publish helper",
      "--summary",
      "Create the new draft publish helper",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assertSuccess(result);
  assert.match(
    result.stdout,
    /https:\/\/github.com\/freed-project\/freed\/pull\/999/,
  );

  const ghCalls = await readGhLog(fixture.ghLogFile);
  const createCall = ghCalls.find((call) => call.args[1] === "create");
  assert.ok(createCall);
  assert.ok(createCall.args.includes("--draft"));
  assert.equal(ghCalls.at(-1).args[1], "view");
});

test("worktree-publish isolates the short-lived publisher lease inside a nightly process", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "publisher credential isolation\n",
  );
  const hookPath = path.join(fixture.worktree, ".git/hooks/pre-commit");
  await fs.writeFile(
    hookPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${FREED_AUTOMATION_ACTOR_TOKEN:-}" || -n "\${FREED_AUTOMATION_LEASE_TOKEN:-}" || -n "\${FREED_OWNER_BOOTSTRAP_TOKEN:-}" || -n "\${FREED_PR_PUBLISHER_ACTOR_TOKEN:-}" || -n "\${FREED_PR_PUBLISHER_LEASE_TOKEN:-}" ]]; then
  echo "persistent actor credential reached a Git hook" >&2
  exit 91
fi
`,
    { mode: 0o755 },
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: isolate publisher credential",
      "--summary",
      "Keep the publisher credential separate from the nightly credential",
    ],
    {
      cwd: fixture.worktree,
      env: {
        ...fixture.env,
        FREED_AUTOMATION_ACTOR: "freed-nightly-runner",
        FREED_AUTOMATION_ACTOR_TOKEN: "nightly-persistent-secret-1234567890",
        FREED_AUTOMATION_LEASE_TOKEN: "nightly-short-lived-secret-1234567890",
        FREED_OWNER_BOOTSTRAP_TOKEN: "owner-bootstrap-secret-1234567890",
      },
    },
  );

  assertSuccess(result);
  const leaseEvents = await fs.readFile(
    path.join(fixture.automationStateRoot, "control/events.jsonl"),
    "utf8",
  );
  assert.match(leaseEvents, /"actor":"freed-pr-publisher"/);
  const childCalls = (await fs.readFile(fixture.ghLogFile, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(childCalls.length > 0);
  assert.ok(
    childCalls.every((call) => call.persistentActorTokenPresent === false),
  );
  assert.ok(
    childCalls.every((call) => call.genericLeaseTokenPresent === false),
  );
  assert.ok(
    childCalls.every((call) => call.ownerBootstrapTokenPresent === false),
  );
  assert.ok(
    childCalls.every((call) => call.persistentPublisherTokenPresent === false),
  );
  assert.ok(
    childCalls.every((call) => call.publisherLeaseTokenPresent === false),
  );
});

test(
  "trusted publisher launcher consumes a signed capability without a persistent credential",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const fixture = await createPublishFixture(t, {
      preacquirePublisherLease: false,
    });
    const trusted = await createTrustedControlCheckout(t);
    await fs.writeFile(
      path.join(fixture.worktree, "README.md"),
      "trusted lease handoff\n",
    );

    const result = run(
      "bash",
      [
        trusted.publishScript,
        "--title",
        "fix: accept trusted publisher lease handoff",
        "--summary",
        "Use a short-lived publisher lease from the trusted host launcher",
      ],
      {
        cwd: fixture.worktree,
        env: {
          ...fixture.env,
          FREED_AUTOMATION_ACTOR: "freed-nightly-runner",
          FREED_AUTOMATION_ACTOR_TOKEN: "nightly-persistent-secret-1234567890",
          FREED_AUTOMATION_LEASE_TOKEN: "nightly-lease-secret-1234567890",
          FREED_OWNER_BOOTSTRAP_TOKEN: "owner-bootstrap-secret-1234567890",
          FREED_PUBLISHER_CAPABILITY_FILE: fixture.capabilityPath,
          FREED_TRUSTED_CONTROL_SHA: trusted.head,
          FREED_TRUSTED_STATE_ROOT: fixture.automationStateRoot,
          GIT_DIR: "/tmp/attacker-git-dir",
          GH_REPO: "attacker/other-repo",
          NODE_OPTIONS: "--require=/tmp/attacker-node-loader.cjs",
          "BASH_FUNC_cd%%": "() { echo attacker-cd >&2; return 91; }",
        },
      },
    );

    assertSuccess(result);
    const childCalls = (await fs.readFile(fixture.ghLogFile, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(childCalls.length > 0);
    assert.ok(
      childCalls.every((call) => call.persistentActorTokenPresent === false),
    );
    assert.ok(
      childCalls.every((call) => call.genericLeaseTokenPresent === false),
    );
    assert.ok(
      childCalls.every((call) => call.ownerBootstrapTokenPresent === false),
    );
    assert.ok(
      childCalls.every(
        (call) => call.persistentPublisherTokenPresent === false,
      ),
    );
    assert.ok(
      childCalls.every((call) => call.publisherLeaseTokenPresent === false),
    );
  },
);

test(
  "trusted publisher launcher rejects an unpinned GitHub CLI",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const fixture = await createPublishFixture(t, {
      preacquirePublisherLease: false,
    });
    const trusted = await createTrustedControlCheckout(t);
    await fs.writeFile(
      path.join(fixture.worktree, "README.md"),
      "wrong gh digest\n",
    );

    const result = run(
      "bash",
      [trusted.publishScript, "--title", "fix: reject unpinned gh"],
      {
        cwd: fixture.worktree,
        env: {
          ...fixture.env,
          FREED_PUBLISHER_CAPABILITY_FILE: fixture.capabilityPath,
          FREED_TRUSTED_CONTROL_SHA: trusted.head,
          FREED_TRUSTED_STATE_ROOT: fixture.automationStateRoot,
          FREED_TRUSTED_GH_SHA256: "0".repeat(64),
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match FREED_TRUSTED_GH_SHA256/);
    const ghCalls = await readGhLog(fixture.ghLogFile);
    assert.equal(ghCalls.length, 0);
  },
);

test(
  "trusted publisher launcher rejects an ungoverned main branch",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const fixture = await createPublishFixture(t, {
      preacquirePublisherLease: false,
    });
    const trusted = await createTrustedControlCheckout(t);
    const result = run(
      "bash",
      [
        trusted.publishScript,
        "--base",
        "main",
        "--title",
        "chore: bypass promotion",
      ],
      {
        cwd: fixture.worktree,
        env: {
          ...fixture.env,
          FREED_PUBLISHER_CAPABILITY_FILE: fixture.capabilityPath,
          FREED_TRUSTED_CONTROL_SHA: trusted.head,
          FREED_TRUSTED_STATE_ROOT: fixture.automationStateRoot,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /main publishing is restricted/);
    const ghCalls = await readGhLog(fixture.ghLogFile);
    assert.equal(ghCalls.length, 0);
  },
);

test(
  "trusted publisher launcher accepts a prebound release-only main prep",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const fixture = await createPublishFixture(t, {
      preacquirePublisherLease: false,
    });
    const trusted = await createTrustedControlCheckout(t);
    const candidateScripts = path.join(fixture.worktree, "scripts");
    await fs.mkdir(candidateScripts, { recursive: true });
    await fs.copyFile(
      path.join(repoRoot, "scripts/validate-main-pr.mjs"),
      path.join(candidateScripts, "validate-main-pr.mjs"),
    );
    await fs.copyFile(
      path.join(repoRoot, "scripts/release-promotion-shared.mjs"),
      path.join(candidateScripts, "release-promotion-shared.mjs"),
    );
    assert.equal(
      run("git", ["add", "scripts"], { cwd: fixture.worktree }).status,
      0,
    );
    assert.equal(
      run("git", ["commit", "-m", "chore: seed main release guard"], {
        cwd: fixture.worktree,
      }).status,
      0,
    );
    assert.equal(
      run("git", ["push", fixture.origin, "HEAD:refs/heads/main"], {
        cwd: fixture.worktree,
      }).status,
      0,
    );
    assert.equal(
      run("git", ["fetch", "origin", "main"], { cwd: fixture.worktree }).status,
      0,
    );
    assert.equal(
      run(
        "git",
        ["checkout", "-B", "chore/release-v26.7.1001", "origin/main"],
        {
          cwd: fixture.worktree,
        },
      ).status,
      0,
    );
    const releaseFile = path.join(
      fixture.worktree,
      "release-notes/releases/v26.7.1001.json",
    );
    await fs.mkdir(path.dirname(releaseFile), { recursive: true });
    await fs.writeFile(releaseFile, "{}\n");
    assert.equal(
      run("git", ["add", releaseFile], { cwd: fixture.worktree }).status,
      0,
    );
    assert.equal(
      run("git", ["commit", "-m", "chore: prepare v26.7.1001"], {
        cwd: fixture.worktree,
      }).status,
      0,
    );
    const validatedHead = run("git", ["rev-parse", "HEAD"], {
      cwd: fixture.worktree,
    }).stdout.trim();
    const baseSha = run("git", ["rev-parse", "origin/main"], {
      cwd: fixture.worktree,
    }).stdout.trim();
    const nowMs = Date.now();
    const capabilityId = `publisher-main-release-${nowMs}`;
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: await fs.realpath(fixture.worktree),
      branch: "chore/release-v26.7.1001",
      base: "main",
      baseSha,
      headSha: validatedHead,
      publishMode: "production-release-prep",
    };
    const payload = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        capabilityId,
        issuer: "freed-pr-publisher",
        leaseName: "pr-publisher",
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 60_000).toISOString(),
        leaseTtlMs: 1_800_000,
        scope,
      }),
    );
    const capabilityPath = path.join(
      fixture.automationStateRoot,
      "control/publisher-capabilities/pending",
      `${capabilityId}.json`,
    );
    await fs.rm(fixture.capabilityPath, { force: true });
    await fs.writeFile(
      capabilityPath,
      `${JSON.stringify({
        schemaVersion: 1,
        payloadBase64: payload.toString("base64"),
        signatureBase64: signPayload(
          null,
          payload,
          fixture.publisherPrivateKey,
        ).toString("base64"),
      })}\n`,
      { mode: 0o600 },
    );
    await fs.writeFile(
      fixture.ghStateFile,
      JSON.stringify({
        prList: [],
        viewBase: "main",
        createUrl: "https://github.com/freed-project/freed/pull/1001",
      }),
    );

    const result = run(
      "bash",
      [
        trusted.publishScript,
        "--base",
        "main",
        "--ready",
        "--title",
        "chore: prepare v26.7.1001",
      ],
      {
        cwd: fixture.worktree,
        env: {
          ...fixture.env,
          FREED_PUBLISHER_CAPABILITY_FILE: capabilityPath,
          FREED_TRUSTED_CONTROL_SHA: trusted.head,
          FREED_TRUSTED_STATE_ROOT: fixture.automationStateRoot,
        },
      },
    );
    assertSuccess(result);
    const ghCalls = await readGhLog(fixture.ghLogFile);
    const create = ghCalls.find((call) => call.args[1] === "create");
    assert.ok(create);
    assert.equal(create.args[create.args.indexOf("--base") + 1], "main");
  },
);

test(
  "trusted publisher launcher rejects a main head changed after capability issuance",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const fixture = await createPublishFixture(t, {
      preacquirePublisherLease: false,
    });
    const trusted = await createTrustedControlCheckout(t);
    assert.equal(
      run("git", ["push", fixture.origin, "HEAD:refs/heads/main"], {
        cwd: fixture.worktree,
      }).status,
      0,
    );
    assert.equal(
      run("git", ["fetch", "origin", "main"], { cwd: fixture.worktree }).status,
      0,
    );
    assert.equal(
      run("git", ["branch", "-m", "chore/promote-dev-to-main-head-check"], {
        cwd: fixture.worktree,
      }).status,
      0,
    );
    const validatedHead = run("git", ["rev-parse", "HEAD"], {
      cwd: fixture.worktree,
    }).stdout.trim();
    const baseSha = run("git", ["rev-parse", "origin/main"], {
      cwd: fixture.worktree,
    }).stdout.trim();
    const nowMs = Date.now();
    const capabilityId = `publisher-main-head-${nowMs}`;
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: await fs.realpath(fixture.worktree),
      branch: "chore/promote-dev-to-main-head-check",
      base: "main",
      baseSha,
      headSha: validatedHead,
      publishMode: "production-promotion",
    };
    const payload = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        capabilityId,
        issuer: "freed-pr-publisher",
        leaseName: "pr-publisher",
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 60_000).toISOString(),
        leaseTtlMs: 1_800_000,
        scope,
      }),
    );
    const capabilityPath = path.join(
      fixture.automationStateRoot,
      "control/publisher-capabilities/pending",
      `${capabilityId}.json`,
    );
    await fs.rm(fixture.capabilityPath, { force: true });
    await fs.writeFile(
      capabilityPath,
      `${JSON.stringify({
        schemaVersion: 1,
        payloadBase64: payload.toString("base64"),
        signatureBase64: signPayload(
          null,
          payload,
          fixture.publisherPrivateKey,
        ).toString("base64"),
      })}\n`,
      { mode: 0o600 },
    );
    await fs.writeFile(
      path.join(fixture.worktree, "README.md"),
      "head changed after approval\n",
    );
    assert.equal(
      run("git", ["add", "README.md"], { cwd: fixture.worktree }).status,
      0,
    );
    assert.equal(
      run("git", ["commit", "-m", "chore: move promotion head"], {
        cwd: fixture.worktree,
      }).status,
      0,
    );

    const result = run(
      "bash",
      [
        trusted.publishScript,
        "--base",
        "main",
        "--title",
        "chore: enforce promotion head",
      ],
      {
        cwd: fixture.worktree,
        env: {
          ...fixture.env,
          FREED_PUBLISHER_CAPABILITY_FILE: capabilityPath,
          FREED_TRUSTED_CONTROL_SHA: trusted.head,
          FREED_TRUSTED_STATE_ROOT: fixture.automationStateRoot,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /main publishing requires the exact broker-validated head/,
    );
    const ghCalls = await readGhLog(fixture.ghLogFile);
    assert.equal(ghCalls.length, 0);
  },
);

test(
  "trusted publisher launcher rejects a tampered broker capability",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const fixture = await createPublishFixture(t, {
      preacquirePublisherLease: false,
    });
    const trusted = await createTrustedControlCheckout(t);
    await fs.writeFile(
      path.join(fixture.worktree, "README.md"),
      "tampered publisher capability\n",
    );
    const envelope = JSON.parse(
      await fs.readFile(fixture.capabilityPath, "utf8"),
    );
    envelope.signatureBase64 = Buffer.alloc(64, 3).toString("base64");
    await fs.writeFile(
      fixture.capabilityPath,
      `${JSON.stringify(envelope)}\n`,
      { mode: 0o600 },
    );

    const result = run(
      "bash",
      [
        trusted.publishScript,
        "--title",
        "fix: reject tampered publisher capability",
      ],
      {
        cwd: fixture.worktree,
        env: {
          ...fixture.env,
          FREED_PUBLISHER_CAPABILITY_FILE: fixture.capabilityPath,
          FREED_TRUSTED_CONTROL_SHA: trusted.head,
          FREED_TRUSTED_STATE_ROOT: fixture.automationStateRoot,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /publisher_capability_signature_invalid/);
    const ghCalls = await readGhLog(fixture.ghLogFile);
    assert.equal(ghCalls.length, 0);
  },
);

test("publisher scripts disable shell tracing before reading secrets", () => {
  const persistentSecret = "trace-persistent-publisher-secret-1234567890";
  const leaseSecret = "trace-short-lived-publisher-lease-1234567890";
  const trustedResult = run(
    "/bin/bash",
    ["-x", trustedPublishScript, "--help"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        FREED_PR_PUBLISHER_ACTOR_TOKEN: persistentSecret,
        FREED_TRUSTED_CONTROL_SHA: "0".repeat(40),
        FREED_TRUSTED_STATE_ROOT: "/tmp/freed-trace-control",
      },
    },
  );
  const helperResult = run("/bin/bash", ["-x", publishScript, "--help"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FREED_PR_PUBLISHER_LEASE_TOKEN: leaseSecret,
      FREED_PUBLISH_CONTROL_STATE_ROOT: "/tmp/freed-trace-control",
    },
  });
  const traceOutput = [
    trustedResult.stdout,
    trustedResult.stderr,
    helperResult.stdout,
    helperResult.stderr,
  ].join("\n");
  assert.doesNotMatch(traceOutput, new RegExp(persistentSecret));
  assert.doesNotMatch(traceOutput, new RegExp(leaseSecret));
});

test("worktree-publish rejects a nightly token when the publisher lease is missing", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "missing publisher lease\n",
  );
  const {
    FREED_PR_PUBLISHER_LEASE_TOKEN: _publisherLeaseToken,
    ...environmentWithoutPublisherLease
  } = fixture.env;

  const result = run(
    "bash",
    [publishScript, "--title", "fix: reject unrelated publishing credentials"],
    {
      cwd: fixture.worktree,
      env: {
        ...environmentWithoutPublisherLease,
        FREED_AUTOMATION_ACTOR: "freed-nightly-runner",
        FREED_AUTOMATION_ACTOR_TOKEN: "nightly-persistent-secret-1234567890",
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /publishing requires FREED_PR_PUBLISHER_LEASE_TOKEN from the trusted host launcher/,
  );
  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(ghCalls.length, 0);
});

test("worktree-publish rejects a provider file injected after initial inspection", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "race candidate\n",
  );
  const hookPath = path.join(fixture.worktree, ".git/hooks/pre-commit");
  await fs.writeFile(
    hookPath,
    `#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p packages/desktop/src/lib\nprintf '%s\\n' '// injected media fetch change' > packages/desktop/src/lib/media-vault.ts\ngit add packages/desktop/src/lib/media-vault.ts\n`,
    { mode: 0o755 },
  );

  const result = run(
    "bash",
    [publishScript, "--title", "fix: reject post-inspection provider change"],
    { cwd: fixture.worktree, env: fixture.env },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /provider-visible paths changed after the publish gate/,
  );
  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(ghCalls.length, 0);
});

test("worktree-publish refuses a committed provider-visible diff without approval", async (t) => {
  const fixture = await createPublishFixture(t);

  const extractorPath = path.join(
    fixture.worktree,
    "packages/desktop/src-tauri/src/fb-extract.js",
  );
  await fs.mkdir(path.dirname(extractorPath), { recursive: true });
  await fs.writeFile(extractorPath, "// scraped DOM extraction change\n");
  assertSuccess(
    run("git", ["add", "packages/desktop/src-tauri/src/fb-extract.js"], {
      cwd: fixture.worktree,
    }),
  );
  assertSuccess(
    run("git", ["commit", "-m", "fix: adjust fb extractor"], {
      cwd: fixture.worktree,
    }),
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: adjust fb extractor",
      "--summary",
      "Adjust the fb extractor",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provider-visible paths/);
  assert.match(
    result.stderr,
    /packages\/desktop\/src-tauri\/src\/fb-extract\.js/,
  );
  assert.match(result.stderr, /--provider-risk-approval-file/);

  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(ghCalls.length, 0);
});

test("worktree-publish treats a provider file renamed outside the provider tree as visible", async (t) => {
  const fixture = await createPublishFixture(t, { seedProviderFile: true });

  await fs.mkdir(path.join(fixture.worktree, "archive"), { recursive: true });
  assertSuccess(
    run(
      "git",
      [
        "mv",
        "packages/desktop/src-tauri/src/fb-extract.js",
        "archive/fb-extract.js",
      ],
      { cwd: fixture.worktree },
    ),
  );
  assertSuccess(
    run("git", ["commit", "-m", "refactor: move provider extractor"], {
      cwd: fixture.worktree,
    }),
  );

  const result = run(
    "bash",
    [publishScript, "--title", "refactor: move provider extractor"],
    { cwd: fixture.worktree, env: fixture.env },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provider-visible paths/);
  assert.match(
    result.stderr,
    /packages\/desktop\/src-tauri\/src\/fb-extract\.js/,
  );
});

test("worktree-publish accepts an exact structured provider approval and records it", async (t) => {
  const fixture = await createPublishFixture(t);

  const extractorPath = path.join(
    fixture.worktree,
    "packages/desktop/src-tauri/src/fb-extract.js",
  );
  await fs.mkdir(path.dirname(extractorPath), { recursive: true });
  await fs.writeFile(extractorPath, "// scraped DOM extraction change\n");
  assertSuccess(
    run("git", ["add", "packages/desktop/src-tauri/src/fb-extract.js"], {
      cwd: fixture.worktree,
    }),
  );
  assertSuccess(
    run("git", ["commit", "-m", "fix: adjust fb extractor"], {
      cwd: fixture.worktree,
    }),
  );

  const diff = run("git", ["diff", "--binary", "origin/dev...HEAD"], {
    cwd: fixture.worktree,
  }).stdout;
  const diffSha = run("git", ["hash-object", "--stdin"], {
    cwd: fixture.worktree,
    input: diff,
  }).stdout.trim();
  const approvalPath = path.join(
    path.dirname(fixture.worktree),
    "provider-approval.json",
  );
  const now = Date.now();
  const approval = {
    schemaVersion: 1,
    approvalId: "provider-risk-facebook-extractor",
    approvedBy: "AubreyF",
    ownerApprovalReference:
      "Owner approved the Facebook extractor repair in task 019f",
    approvalSource: { kind: "control-task", reference: "P1-04" },
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
    providers: ["facebook"],
    observableBehavior: "Changes the existing Facebook extraction result.",
    fingerprintingRisk:
      "A changed extraction pass could alter page dwell time and make the session pattern easier to distinguish.",
    lowestProfileAlternative:
      "Keep the current extractor and collect passive diagnostics.",
    diffSha,
    paths: ["packages/desktop/src-tauri/src/fb-extract.js"],
    pathScopes: [
      {
        path: "packages/desktop/src-tauri/src/fb-extract.js",
        providers: ["facebook"],
      },
    ],
  };
  await fs.writeFile(approvalPath, JSON.stringify(approval));
  const authorizationDigest = await authorizeProviderApproval(
    fixture,
    approval,
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: adjust fb extractor",
      "--summary",
      "Adjust the fb extractor",
      "--provider-risk-approval-file",
      approvalPath,
    ],
    {
      cwd: fixture.worktree,
      env: {
        ...fixture.env,
        FREED_AUTOMATION_STATE_ROOT: path.join(
          path.dirname(fixture.worktree),
          "forged-provider-state",
        ),
      },
    },
  );

  assertSuccess(result);

  const ghCalls = await readGhLog(fixture.ghLogFile);
  const createCall = ghCalls.find((call) => call.args[1] === "create");
  assert.ok(createCall);
  assert.equal(createCall.args[1], "create");
  const body = createCall.args[createCall.args.indexOf("--body") + 1];
  assert.match(body, /## Provider Visible Approval/);
  assert.match(body, /Approved by: AubreyF/);
  assert.match(
    body,
    /Owner approved the Facebook extractor repair in task 019f/,
  );
  assert.match(body, /Approved diff:/);
  assert.match(body, new RegExp(authorizationDigest));
  assert.match(body, new RegExp(diffSha));
  assert.match(body, /packages\/desktop\/src-tauri\/src\/fb-extract\.js/);
});

test("worktree-publish revalidates provider approval immediately before PR creation", async (t) => {
  const fixture = await createPublishFixture(t);
  const relativeExtractorPath = "packages/desktop/src-tauri/src/fb-extract.js";
  const extractorPath = path.join(fixture.worktree, relativeExtractorPath);
  await fs.mkdir(path.dirname(extractorPath), { recursive: true });
  await fs.writeFile(
    extractorPath,
    "// provider approval revoked before PR write\n",
  );
  assertSuccess(
    run("git", ["add", relativeExtractorPath], { cwd: fixture.worktree }),
  );
  assertSuccess(
    run("git", ["commit", "-m", "fix: test provider revocation"], {
      cwd: fixture.worktree,
    }),
  );

  const diff = run("git", ["diff", "--binary", "origin/dev...HEAD"], {
    cwd: fixture.worktree,
  }).stdout;
  const diffSha = run("git", ["hash-object", "--stdin"], {
    cwd: fixture.worktree,
    input: diff,
  }).stdout.trim();
  const approvalPath = path.join(
    path.dirname(fixture.worktree),
    "revoked-provider-approval.json",
  );
  const now = Date.now();
  const approval = {
    schemaVersion: 1,
    approvalId: "provider-risk-facebook-revoked-before-write",
    approvedBy: "AubreyF",
    ownerApprovalReference:
      "Owner approved the Facebook extractor repair in task 019f",
    approvalSource: { kind: "control-task", reference: "P1-04" },
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
    providers: ["facebook"],
    observableBehavior: "Changes the existing Facebook extraction result.",
    fingerprintingRisk:
      "The changed extraction pass could alter page dwell time.",
    lowestProfileAlternative:
      "Keep the current extractor and collect passive diagnostics.",
    diffSha,
    paths: [relativeExtractorPath],
    pathScopes: [{ path: relativeExtractorPath, providers: ["facebook"] }],
  };
  await fs.writeFile(approvalPath, JSON.stringify(approval));
  await authorizeProviderApproval(fixture, approval);
  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify({ prList: [], invalidateFileOnList: approvalPath }),
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: test provider revocation",
      "--provider-risk-approval-file",
      approvalPath,
    ],
    { cwd: fixture.worktree, env: fixture.env },
  );

  assert.notEqual(result.status, 0);
  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(
    ghCalls.some((call) => call.args[1] === "list"),
    true,
    result.stderr,
  );
  assert.equal(
    ghCalls.some((call) => call.args[1] === "create"),
    false,
  );
});

test("worktree-publish cannot mark a provider-visible pull request ready", async (t) => {
  const fixture = await createPublishFixture(t);
  const extractorPath = path.join(
    fixture.worktree,
    "packages/desktop/src-tauri/src/fb-extract.js",
  );
  await fs.mkdir(path.dirname(extractorPath), { recursive: true });
  await fs.writeFile(extractorPath, "// reviewed provider change\n");
  assertSuccess(
    run("git", ["add", "packages/desktop/src-tauri/src/fb-extract.js"], {
      cwd: fixture.worktree,
    }),
  );
  assertSuccess(
    run("git", ["commit", "-m", "fix: adjust reviewed extractor"], {
      cwd: fixture.worktree,
    }),
  );
  const diff = run("git", ["diff", "--binary", "origin/dev...HEAD"], {
    cwd: fixture.worktree,
  }).stdout;
  const diffSha = run("git", ["hash-object", "--stdin"], {
    cwd: fixture.worktree,
    input: diff,
  }).stdout.trim();
  const approvalPath = path.join(
    path.dirname(fixture.worktree),
    "provider-ready-approval.json",
  );
  const now = Date.now();
  const approval = {
    schemaVersion: 1,
    approvalId: "provider-risk-facebook-ready",
    approvedBy: "AubreyF",
    ownerApprovalReference:
      "Owner approved the Facebook extractor repair in task 019f",
    approvalSource: { kind: "control-task", reference: "P1-04" },
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
    providers: ["facebook"],
    observableBehavior: "Changes the existing Facebook extraction result.",
    fingerprintingRisk:
      "Changed extraction timing could make the session easier to distinguish.",
    lowestProfileAlternative:
      "Keep the current extractor and collect passive diagnostics.",
    diffSha,
    paths: ["packages/desktop/src-tauri/src/fb-extract.js"],
    pathScopes: [
      {
        path: "packages/desktop/src-tauri/src/fb-extract.js",
        providers: ["facebook"],
      },
    ],
  };
  await fs.writeFile(approvalPath, JSON.stringify(approval));
  await authorizeProviderApproval(fixture, approval);

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: adjust reviewed extractor",
      "--provider-risk-approval-file",
      approvalPath,
      "--ready",
    ],
    { cwd: fixture.worktree, env: fixture.env },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must remain draft until the CODEOWNER reviews/);
});

test("worktree-publish requires a value for --provider-risk-approval-file", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(path.join(fixture.worktree, "README.md"), "flag misuse\n");

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: flag misuse",
      "--provider-risk-approval-file",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--provider-risk-approval-file requires/);
});

test("worktree-publish rejects uncommitted provider-visible changes before approval", async (t) => {
  const fixture = await createPublishFixture(t);
  const extractorPath = path.join(
    fixture.worktree,
    "packages/desktop/src-tauri/src/fb-extract.js",
  );
  await fs.mkdir(path.dirname(extractorPath), { recursive: true });
  await fs.writeFile(extractorPath, "// uncommitted provider change\n");

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: reject uncommitted provider change",
      "--include-untracked",
    ],
    { cwd: fixture.worktree, env: fixture.env },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /provider-visible changes must be committed before approval/,
  );
});

test("worktree-publish --ready promotes an existing draft PR after updating it", async (t) => {
  const fixture = await createPublishFixture(t);

  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify(
      {
        prList: [
          {
            number: 321,
            url: "https://github.com/freed-project/freed/pull/321",
            isDraft: true,
          },
        ],
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "ready closeout\n",
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: closeout ready publish helper",
      "--summary",
      "Close out the publish helper",
      "--ready",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assertSuccess(result);
  assert.match(result.stdout, /Updated PR \(ready for review\)/);

  const ghCalls = await readGhLog(fixture.ghLogFile);
  const readyCalls = ghCalls.filter((call) => call.args[1] === "ready");
  assert.deepEqual(
    readyCalls.map((call) => call.args),
    [["pr", "ready", "321", "--repo", "freed-project/freed"]],
  );
  const editIndex = ghCalls.findIndex((call) => call.args[1] === "edit");
  const readyIndex = ghCalls.findIndex((call) => call.args[1] === "ready");
  assert.ok(editIndex < readyIndex, "edit must run before the promotion");
});

test("worktree-publish --ready creates a new PR without --draft", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(
    path.join(fixture.worktree, "README.md"),
    "fresh ready create\n",
  );

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: create a ready publish helper",
      "--summary",
      "Create the ready publish helper",
      "--ready",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assertSuccess(result);
  const ghCalls = await readGhLog(fixture.ghLogFile);
  const createCall = ghCalls.find((call) => call.args[1] === "create");
  assert.ok(createCall);
  assert.equal(createCall.args.includes("--draft"), false);
  assert.equal(ghCalls.at(-1).args[1], "view");
});
