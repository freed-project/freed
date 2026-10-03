#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveGitHubCli } from "./lib/github-tooling.mjs";
import {
  validateRequest,
  validateControllerRules,
} from "./cloud-release-request.mjs";
import {
  verifyLiveReleaseTagAuthority,
  RELEASE_TAG_CREATION_RULESET_NAME,
  RELEASE_TAG_IMMUTABILITY_RULESET_NAME,
} from "./sync-github-rulesets.mjs";

export const REPOSITORY = "freed-project/freed";
export const REPOSITORY_ID = 1143010014;
export const OWNER_ID = 2789037;
export const RESPONSE_WORKFLOW =
  ".github/workflows/cloud-release-policy-response.yml";
export const POLICY_TTL_MS = 180_000;
export const POLICY_SPEC = Object.freeze({
  version: 1,
  repository: REPOSITORY,
  repositoryId: REPOSITORY_ID,
  controllerBranch: "release-controller",
  publisherEnvironment: "release-publisher",
  controller: {
    noBypass: true,
    ownerReview: true,
    approvals: 1,
    dismissStale: true,
    lastPushApproval: true,
    deletionDenied: true,
    forcePushDenied: true,
  },
  environmentCheckedSeparatelyByReadOnlyRunner: true,
  tags: {
    target: "refs/tags/v*",
    onlyCreatorApp: 4296969,
    immutableNoBypass: true,
  },
});
export const POLICY_DIGEST = createHash("sha256")
  .update(JSON.stringify(POLICY_SPEC))
  .digest("hex");
const proofBrands = new WeakSet();
const challengeKeys = [
  "schemaVersion",
  "purpose",
  "repository",
  "repositoryId",
  "controllerSha",
  "publisherRunId",
  "publisherAttempt",
  "channel",
  "tag",
  "source_sha",
  "receipt_sha256",
  "nonce",
  "issuedAtMs",
  "expiresAtMs",
  "policyDigest",
];
function exactKeys(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Unexpected or missing policy protocol fields.");
}
export function parseEnvelope(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 8192)
    throw new Error("Policy envelope exceeds its bound.");
  const value = JSON.parse(raw);
  if (JSON.stringify(value) !== raw.trim())
    throw new Error(
      "Require canonical compact JSON, without duplicate fields.",
    );
  return value;
}
export function validateChallenge(value, now = Date.now()) {
  exactKeys(value, challengeKeys);
  validateRequest(value);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== "freed-owner-live-release-policy" ||
    value.repository !== REPOSITORY ||
    value.repositoryId !== REPOSITORY_ID ||
    !/^[0-9a-f]{40}$/.test(value.controllerSha) ||
    !/^[1-9][0-9]*$/.test(value.publisherRunId) ||
    value.publisherAttempt !== 1 ||
    !/^[0-9a-f]{64}$/.test(value.nonce) ||
    value.policyDigest !== POLICY_DIGEST ||
    !Number.isSafeInteger(value.issuedAtMs) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.expiresAtMs - value.issuedAtMs !== POLICY_TTL_MS ||
    now < value.issuedAtMs ||
    now >= value.expiresAtMs
  )
    throw new Error("Invalid, future or expired owner policy challenge.");
  return value;
}
export function createChallenge(
  request,
  context,
  now = Date.now(),
  nonce = randomBytes(32).toString("hex"),
) {
  const input = validateRequest(request);
  return validateChallenge(
    {
      schemaVersion: 1,
      purpose: "freed-owner-live-release-policy",
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      controllerSha: context.controllerSha,
      publisherRunId: String(context.publisherRunId),
      publisherAttempt: Number(context.publisherAttempt),
      channel: input.channel,
      tag: input.tag,
      source_sha: input.source_sha,
      receipt_sha256: input.receipt_sha256,
      nonce,
      issuedAtMs: now,
      expiresAtMs: now + POLICY_TTL_MS,
      policyDigest: POLICY_DIGEST,
    },
    now,
  );
}
export function validateChallengeContext(
  challenge,
  request,
  context,
  now = Date.now(),
) {
  validateChallenge(challenge, now);
  const input = validateRequest(request);
  if (
    ["channel", "tag", "source_sha", "receipt_sha256"].some(
      (key) => input[key] !== challenge[key],
    ) ||
    context.controllerSha !== challenge.controllerSha ||
    String(context.publisherRunId) !== challenge.publisherRunId ||
    Number(context.publisherAttempt) !== challenge.publisherAttempt
  )
    throw new Error(
      "Policy challenge does not bind this exact publisher attempt.",
    );
}
export function validateResponsePushIdentity(
  challenge,
  run,
  workflow,
  now = Date.now(),
) {
  if (
    workflow?.path !== RESPONSE_WORKFLOW ||
    workflow.state !== "active" ||
    run?.workflow_id !== workflow.id ||
    run.path !== RESPONSE_WORKFLOW ||
    run.event !== "push" ||
    run.run_attempt !== 1 ||
    run.actor?.id !== OWNER_ID ||
    run.actor?.login !== "AubreyF" ||
    run.triggering_actor?.id !== OWNER_ID ||
    run.triggering_actor?.login !== "AubreyF" ||
    run.head_repository?.id !== REPOSITORY_ID ||
    run.head_repository?.full_name !== REPOSITORY ||
    run.head_branch !== `release-policy-responses/${challenge.nonce}` ||
    !/^[0-9a-f]{40}$/.test(run.head_sha ?? "") ||
    run.head_sha === challenge.controllerSha ||
    !Number.isSafeInteger(run.id) ||
    !Number.isFinite(Date.parse(run.created_at)) ||
    Date.parse(run.created_at) < challenge.issuedAtMs - 1000 ||
    Date.parse(run.created_at) > now ||
    (run.status === "completed" && run.conclusion !== "success")
  )
    throw new Error(
      "Policy response is not an original immutable owner push in the expected workflow.",
    );
  return {
    runId: run.id,
    immutableResponseSha: run.head_sha,
    ownerId: OWNER_ID,
    repositoryId: REPOSITORY_ID,
    publicationAuthorized: false,
  };
}

export function validateOwnerPolicyResponse({
  challenge,
  response,
  run,
  workflow,
  now = Date.now(),
}) {
  validateChallenge(challenge, now);
  exactKeys(response, [...challengeKeys, "observedAtMs", "verified"]);
  if (
    challengeKeys.some((key) => response[key] !== challenge[key]) ||
    response.verified !== true ||
    !Number.isSafeInteger(response.observedAtMs) ||
    response.observedAtMs < challenge.issuedAtMs ||
    response.observedAtMs > now
  )
    throw new Error(
      "Owner response substituted or predates the live challenge.",
    );
  validateResponsePushIdentity(challenge, run, workflow, now);
  const proof = Object.freeze({
    expiresAtMs: challenge.expiresAtMs,
    nonce: challenge.nonce,
    policyDigest: POLICY_DIGEST,
    runId: run.id,
    responseSha: run.head_sha,
  });
  proofBrands.add(proof);
  return proof;
}
export function assertFreshPolicyEvidence(proof, now = Date.now()) {
  if (!proofBrands.has(proof) || now >= proof.expiresAtMs)
    throw new Error("Fresh authenticated owner policy evidence is required.");
}
export function consumeNonce(proof, file, now = Date.now()) {
  assertFreshPolicyEvidence(proof, now);
  writeFileSync(
    file,
    JSON.stringify({ nonce: proof.nonce, consumedAtMs: now }),
    { flag: "wx", mode: 0o600 },
  );
}
function api(route, body) {
  return JSON.parse(
    execFileSync(
      resolveGitHubCli(),
      ["api", route, ...(body ? ["--method", "POST", "--input", "-"] : [])],
      {
        encoding: "utf8",
        ...(body ? { input: JSON.stringify(body) } : {}),
        maxBuffer: 1024 * 1024,
      },
    ),
  );
}
function repoApi(route, body) {
  return api(`repos/${REPOSITORY}/${route}`, body);
}
export function validatePrivateLivePolicies(challenge, { rulesets }) {
  // Raw private replies stay in memory. Missing bypass fields remain a hard error.
  if (rulesets.some((rule) => !Object.hasOwn(rule, "bypass_actors")))
    throw new Error("Collector lacks complete private ruleset evidence.");
  validateControllerRules(rulesets);
  verifyLiveReleaseTagAuthority(
    [
      RELEASE_TAG_CREATION_RULESET_NAME,
      RELEASE_TAG_IMMUTABILITY_RULESET_NAME,
    ].map((name) => rulesets.find((rule) => rule.name === name)),
    4296969,
  );
}
export function readAuthenticatedResponse(challenge, runId) {
  const workflow = repoApi(
    "actions/workflows/cloud-release-policy-response.yml",
  );
  const run = repoApi(`actions/runs/${runId}`);
  if (!/^[0-9a-f]{40}$/.test(run.head_sha ?? ""))
    throw new Error("Invalid immutable response commit.");
  const blob = repoApi(
    `contents/release-policy-response.json?ref=${run.head_sha}`,
  );
  if (blob.encoding !== "base64" || blob.size > 8192)
    throw new Error("Invalid bounded owner response blob.");
  const response = parseEnvelope(
    Buffer.from(blob.content, "base64").toString("utf8"),
  );
  return validateOwnerPolicyResponse({ challenge, response, run, workflow });
}
async function main() {
  const [command, challengeFile, output] = process.argv.slice(2);
  if (command === "issue" && challengeFile) {
    const challenge = createChallenge(
      {
        channel: process.env.RELEASE_CHANNEL,
        tag: process.env.RELEASE_TAG,
        source_sha: process.env.RELEASE_SOURCE_SHA,
        receipt_sha256: process.env.RELEASE_RECEIPT_SHA256,
      },
      {
        controllerSha: process.env.GITHUB_SHA,
        publisherRunId: process.env.GITHUB_RUN_ID,
        publisherAttempt: process.env.GITHUB_RUN_ATTEMPT,
      },
    );
    if (
      process.env.GITHUB_REF !== "refs/heads/release-controller" ||
      challenge.controllerSha !== process.env.APPROVED_CONTROLLER_SHA
    )
      throw new Error(
        "Only the pinned running controller can issue a challenge.",
      );
    writeFileSync(challengeFile, JSON.stringify(challenge) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      `Owner live-policy challenge issued for run ${challenge.publisherRunId}; expires in ${POLICY_TTL_MS / 1000}s.`,
    );
    return;
  }
  if (command === "inspect-owner-push") {
    if (
      !/^[0-9a-f]{64}$/.test(challengeFile ?? "") ||
      !/^[1-9][0-9]*$/.test(output ?? "")
    )
      throw new Error("Require exact QA nonce and run ID.");
    const run = repoApi(`actions/runs/${output}`);
    const workflow = repoApi(
      "actions/workflows/cloud-release-policy-response.yml",
    );
    const identity = validateResponsePushIdentity(
      {
        nonce: challengeFile,
        controllerSha: "0".repeat(40),
        issuedAtMs: Date.parse(run.created_at),
      },
      run,
      workflow,
    );
    console.log(
      JSON.stringify({
        purpose: "freed-owner-policy-provenance-test",
        ...identity,
      }),
    );
    return;
  }
  const challenge = validateChallenge(
    parseEnvelope(readFileSync(challengeFile, "utf8")),
  );
  if (command === "collect") {
    const collector = api("user");
    if (collector.id !== OWNER_ID || collector.login !== "AubreyF")
      throw new Error("Collector requires the existing owner identity.");
    const run = repoApi(`actions/runs/${challenge.publisherRunId}`);
    const workflow = repoApi("actions/workflows/cloud-release-request.yml");
    if (
      run.event !== "workflow_dispatch" ||
      run.head_repository?.id !== REPOSITORY_ID ||
      run.head_repository?.full_name !== REPOSITORY ||
      run.head_sha !== challenge.controllerSha ||
      run.head_branch !== "release-controller" ||
      run.path !== workflow.path ||
      workflow.path !== ".github/workflows/cloud-release-request.yml" ||
      run.workflow_id !== workflow.id ||
      run.run_attempt !== 1 ||
      run.status !== "in_progress"
    )
      throw new Error(
        "Challenge does not belong to the actual running controller.",
      );
    if (
      !/^[0-9a-f]{40}$/.test(output ?? "") ||
      output !== challenge.controllerSha
    )
      throw new Error(
        "Collector requires the exact independently approved controller SHA.",
      );
    const summaries = repoApi("rulesets?includes_parents=true&per_page=100");
    if (summaries.length >= 100)
      throw new Error("Ruleset inventory exceeds bounded complete page.");
    // Every read is made after challenge creation, not restored from a snapshot.
    const facts = {
      rulesets: summaries.map((item) => repoApi(`rulesets/${item.id}`)),
    };
    validatePrivateLivePolicies(challenge, facts);
    validateChallenge(challenge);
    const response = { ...challenge, observedAtMs: Date.now(), verified: true };
    repoApi("git/refs", {
      ref: `refs/heads/release-policy-responses/${challenge.nonce}`,
      sha: challenge.controllerSha,
    });
    // Only public allowlisted facts are committed; never private bypass details.
    execFileSync(
      resolveGitHubCli(),
      [
        "api",
        `repos/${REPOSITORY}/contents/release-policy-response.json`,
        "--method",
        "PUT",
        "--input",
        "-",
      ],
      {
        input: JSON.stringify({
          message: "chore: attest live owner release policy",
          branch: `release-policy-responses/${challenge.nonce}`,
          content: Buffer.from(JSON.stringify(response) + "\n").toString(
            "base64",
          ),
        }),
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    console.log(
      `Submitted owner policy attestation for ${challenge.publisherRunId}.`,
    );
    return;
  }
  if (command === "wait" && output) {
    while (Date.now() < challenge.expiresAtMs) {
      const runs = repoApi(
        `actions/workflows/cloud-release-policy-response.yml/runs?event=push&branch=${encodeURIComponent(`release-policy-responses/${challenge.nonce}`)}&per_page=20`,
      ).workflow_runs.filter((run) => run.head_sha !== challenge.controllerSha);
      if (runs.length) {
        const proof = readAuthenticatedResponse(challenge, runs[0].id);
        writeFileSync(output, JSON.stringify({ runId: proof.runId }) + "\n", {
          flag: "wx",
          mode: 0o600,
        });
        console.log("Fresh immutable owner policy response authenticated.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(
      "Owner policy challenge expired; submit a new release request.",
    );
  }
  throw new Error(
    "Usage: cloud-release-policy.mjs issue|collect|wait <challenge.json> [proof.json]",
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
