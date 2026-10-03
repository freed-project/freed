import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createChallenge,
  validateChallengeContext,
  validateChallenge,
  validateOwnerPolicyResponse,
  assertFreshPolicyEvidence,
  consumeNonce,
  parseEnvelope,
  RESPONSE_WORKFLOW,
  POLICY_TTL_MS,
  POLICY_SPEC,
  validatePrivateLivePolicies,
} from "./cloud-release-policy.mjs";
import { loadRulesets } from "./sync-github-rulesets.mjs";
const now = 1_800_000_000_000;
const request = {
  channel: "dev",
  tag: "v26.10.200-dev",
  source_sha: "a".repeat(40),
  receipt_sha256: "b".repeat(64),
};
const context = {
  controllerSha: "c".repeat(40),
  publisherRunId: "1234",
  publisherAttempt: 1,
};
function fixture() {
  const challenge = createChallenge(request, context, now, "d".repeat(64));
  const response = { ...challenge, observedAtMs: now + 1000, verified: true };
  const workflow = { id: 7, path: RESPONSE_WORKFLOW, state: "active" };
  const run = {
    id: 5678,
    workflow_id: 7,
    path: RESPONSE_WORKFLOW,
    event: "push",
    run_attempt: 1,
    actor: { id: 2789037, login: "AubreyF" },
    triggering_actor: { id: 2789037, login: "AubreyF" },
    head_repository: { id: 1143010014, full_name: "freed-project/freed" },
    head_branch: `release-policy-responses/${challenge.nonce}`,
    head_sha: "e".repeat(40),
    created_at: new Date(now + 2000).toISOString(),
    status: "queued",
  };
  return { challenge, response, workflow, run, now: now + 3000 };
}
test("challenge binds repository/controller/run/attempt and every release field", () => {
  const { challenge } = fixture();
  assert.doesNotThrow(() =>
    validateChallengeContext(challenge, request, context, now),
  );
  for (const changed of [
    { publisherRunId: "2345" },
    { publisherAttempt: 2 },
    { controllerSha: "f".repeat(40) },
  ])
    assert.throws(() =>
      validateChallengeContext(
        challenge,
        request,
        { ...context, ...changed },
        now,
      ),
    );
  assert.throws(() =>
    validateChallengeContext(
      challenge,
      { ...request, source_sha: "f".repeat(40) },
      context,
      now,
    ),
  );
  assert.throws(() =>
    validateChallenge({ ...challenge, unexpected: true }, now),
  );
});
test("original owner push authenticates policy assertion without trusting commit author", () => {
  const input = fixture();
  const proof = validateOwnerPolicyResponse(input);
  assert.doesNotThrow(() => assertFreshPolicyEvidence(proof, input.now));
  assert.throws(() => assertFreshPolicyEvidence({ ...proof }, input.now));
  assert.throws(() =>
    assertFreshPolicyEvidence(proof, input.challenge.expiresAtMs),
  );
});
test("owner account ID, immutable workflow/run/repo and first attempt reject spoofing", () => {
  const input = fixture();
  for (const change of [
    { actor: { id: 123, login: "AubreyF" } },
    { actor: { id: 123, login: "github-actions[bot]" } },
    { triggering_actor: { id: 123, login: "collaborator" } },
    { run_attempt: 2 },
    { workflow_id: 8 },
    { path: ".github/workflows/unrelated.yml" },
    { event: "workflow_dispatch" },
    { head_repository: { id: 123, full_name: "freed-project/freed" } },
    { head_sha: "main" },
    { head_branch: "release-policy-responses/other" },
    { head_sha: input.challenge.controllerSha },
    { status: "completed", conclusion: "cancelled" },
  ])
    assert.throws(() =>
      validateOwnerPolicyResponse({
        ...input,
        run: { ...input.run, ...change },
      }),
    );
  assert.throws(() =>
    validateOwnerPolicyResponse({
      ...input,
      workflow: { ...input.workflow, state: "disabled_manually" },
    }),
  );
});
test("substitution, old policy reads, expired and future challenges fail closed", () => {
  const input = fixture();
  for (const field of [
    "repositoryId",
    "controllerSha",
    "publisherRunId",
    "publisherAttempt",
    "channel",
    "tag",
    "source_sha",
    "receipt_sha256",
    "nonce",
    "policyDigest",
  ])
    assert.throws(() =>
      validateOwnerPolicyResponse({
        ...input,
        response: { ...input.response, [field]: "substitution" },
      }),
    );
  for (const observedAtMs of [now - 1, now + POLICY_TTL_MS + 1])
    assert.throws(() =>
      validateOwnerPolicyResponse({
        ...input,
        response: { ...input.response, observedAtMs },
      }),
    );
  assert.throws(() =>
    validateOwnerPolicyResponse({ ...input, now: now + POLICY_TTL_MS }),
  );
  assert.throws(() => validateOwnerPolicyResponse({ ...input, now: now - 1 }));
});
test("nonce is consumed once and no unbranded proof can be persisted", (t) => {
  const input = fixture();
  const proof = validateOwnerPolicyResponse(input);
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-owner-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "nonce-used.json");
  consumeNonce(proof, file, input.now);
  assert.throws(() => consumeNonce(proof, file, input.now));
  assert.throws(() =>
    consumeNonce({ ...proof }, path.join(dir, "forged.json"), input.now),
  );
  assert.equal(JSON.parse(readFileSync(file)).nonce, input.challenge.nonce);
});
test("bounded canonical protocol refuses duplicate/unknown/oversized fields", () => {
  const input = fixture();
  assert.deepEqual(
    parseEnvelope(JSON.stringify(input.response) + "\n"),
    input.response,
  );
  assert.throws(() => parseEnvelope('{"verified":false,"verified":true}'));
  assert.throws(() => parseEnvelope(" ".repeat(8193)));
  assert.throws(() =>
    validateOwnerPolicyResponse({
      ...input,
      response: { ...input.response, bypass_actors: [] },
    }),
  );
  assert.equal(JSON.stringify(input.response).includes("bypass_actors"), false);
  assert.equal(POLICY_SPEC.tags.onlyCreatorApp, 4296969);
});

test("collector requires complete private replies and checks actual controller/tag bypass rules", () => {
  const { challenge } = fixture();
  const controller = {
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: { include: ["refs/heads/release-controller"], exclude: [] },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 1,
          require_code_owner_review: true,
          dismiss_stale_reviews_on_push: true,
          require_last_push_approval: true,
        },
      },
    ],
  };
  const facts = {
    environment: {
      deployment_branch_policy: {
        custom_branch_policies: true,
        protected_branches: false,
      },
    },
    policies: [{ name: "release-controller", type: "branch" }],
    rulesets: [
      controller,
      ...loadRulesets().filter(
        (rule) => rule.target === "tag" && rule.enforcement === "active",
      ),
    ],
  };
  assert.doesNotThrow(() => validatePrivateLivePolicies(challenge, facts));
  const redacted = structuredClone(facts);
  delete redacted.rulesets[0].bypass_actors;
  assert.throws(
    () => validatePrivateLivePolicies(challenge, redacted),
    /complete private/,
  );
  const bypass = structuredClone(facts);
  bypass.rulesets[0].bypass_actors = [
    { actor_id: 1337, actor_type: "RepositoryRole", bypass_mode: "always" },
  ];
  assert.throws(() => validatePrivateLivePolicies(challenge, bypass));
  const wrongApp = structuredClone(facts);
  wrongApp.rulesets.find(
    (rule) => rule.name === "Freed release tag creation",
  ).bypass_actors[0].actor_id = 1337;
  assert.throws(() => validatePrivateLivePolicies(challenge, wrongApp));
});
