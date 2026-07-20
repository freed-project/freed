#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadAndVerifyReleaseTagPublisher,
  verifyReleaseTagPublisherInstallation,
  verifyReleaseTagPublisherInstallationReadiness,
  verifyReleaseTagPublisherReadiness,
} from "./lib/release-tag-publisher.mjs";

export {
  verifyReleaseTagPublisherInstallationReadiness,
  verifyReleaseTagPublisherReadiness,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RULESET_DIR = path.resolve(
  __dirname,
  "../.github/rulesets",
);

const BRANCH_RULE_TYPES = new Set([
  "deletion",
  "non_fast_forward",
  "pull_request",
  "required_status_checks",
]);

const TAG_CREATION_RULE_TYPES = new Set(["creation"]);
const TAG_IMMUTABILITY_RULE_TYPES = new Set(["update", "deletion"]);
const TAG_LOCKDOWN_RULE_TYPES = new Set(["creation", "update", "deletion"]);
export const RELEASE_TAG_CREATION_RULESET_NAME = "Freed release tag creation";
export const RELEASE_TAG_IMMUTABILITY_RULESET_NAME =
  "Freed release tag immutability";
export const RELEASE_TAG_LOCKDOWN_RULESET_NAME = "Freed release tag lockdown";

function hasExactRuleTypes(ruleset, expectedTypes) {
  const types = new Set((ruleset.rules ?? []).map((rule) => rule.type));
  return (
    types.size === expectedTypes.size &&
    [...expectedTypes].every((type) => types.has(type))
  );
}

function hasSafeTagUpdateRule(ruleset) {
  const update = ruleset.rules?.find((rule) => rule.type === "update");
  if (!update) return false;
  if (update.parameters == null) return true;
  return (
    Object.keys(update.parameters).length === 1 &&
    update.parameters.update_allows_fetch_and_merge === false
  );
}

function hasExactReleaseTagTarget(ruleset) {
  return (
    JSON.stringify(ruleset?.conditions?.ref_name?.include) ===
      JSON.stringify(["refs/tags/v*"]) &&
    JSON.stringify(ruleset?.conditions?.ref_name?.exclude) ===
      JSON.stringify([])
  );
}

function isSingleIntegrationBypass(actors) {
  return (
    actors?.length === 1 &&
    actors[0]?.actor_type === "Integration" &&
    actors[0]?.bypass_mode === "always" &&
    Number.isSafeInteger(actors[0]?.actor_id) &&
    actors[0]?.actor_id > 0
  );
}

export function validateRuleset(ruleset, fileName = "ruleset") {
  if (!ruleset || typeof ruleset !== "object" || Array.isArray(ruleset)) {
    throw new Error(`${fileName}: ruleset must be an object.`);
  }
  if (typeof ruleset.name !== "string" || !ruleset.name.startsWith("Freed ")) {
    throw new Error(`${fileName}: name must begin with Freed.`);
  }
  if (!["branch", "tag"].includes(ruleset.target)) {
    throw new Error(`${fileName}: target must be branch or tag.`);
  }
  if (!Array.isArray(ruleset.bypass_actors))
    throw new Error(`${fileName}: bypass_actors must be an array.`);
  const includes = ruleset.conditions?.ref_name?.include;
  if (ruleset.target === "tag") {
    if (!hasExactReleaseTagTarget(ruleset)) {
      throw new Error(
        `${fileName}: release tag ruleset must include exactly refs/tags/v* and exclude nothing.`,
      );
    }
    if (!Array.isArray(ruleset.rules))
      throw new Error(`${fileName}: rules must be an array.`);
    if (ruleset.name === RELEASE_TAG_CREATION_RULESET_NAME) {
      const pending =
        ruleset.enforcement === "active" && ruleset.bypass_actors.length === 0;
      const active =
        ruleset.enforcement === "active" &&
        isSingleIntegrationBypass(ruleset.bypass_actors);
      if (!pending && !active) {
        throw new Error(
          `${fileName}: release tag creation must be active with either no bypass or one GitHub App bypass.`,
        );
      }
      if (!hasExactRuleTypes(ruleset, TAG_CREATION_RULE_TYPES)) {
        throw new Error(
          `${fileName}: release tag creation may contain only the creation rule.`,
        );
      }
      return ruleset;
    }
    if (ruleset.name === RELEASE_TAG_LOCKDOWN_RULESET_NAME) {
      if (
        ruleset.enforcement !== "active" ||
        ruleset.bypass_actors.length !== 0 ||
        !hasExactRuleTypes(ruleset, TAG_LOCKDOWN_RULE_TYPES)
      ) {
        throw new Error(
          `${fileName}: release tag lockdown must be active, have no bypass, and contain only creation, update, and deletion rules.`,
        );
      }
      if (!hasSafeTagUpdateRule(ruleset)) {
        throw new Error(
          `${fileName}: release tag lockdown has an unsafe update rule.`,
        );
      }
      return ruleset;
    }
    if (ruleset.name !== RELEASE_TAG_IMMUTABILITY_RULESET_NAME) {
      throw new Error(
        `${fileName}: unknown release tag ruleset ${ruleset.name}.`,
      );
    }
    if (
      ruleset.enforcement !== "active" ||
      ruleset.bypass_actors.length !== 0 ||
      !hasExactRuleTypes(ruleset, TAG_IMMUTABILITY_RULE_TYPES)
    ) {
      throw new Error(
        `${fileName}: release tag immutability must be active, have no bypass, and contain only update and deletion rules.`,
      );
    }
    if (!hasSafeTagUpdateRule(ruleset)) {
      throw new Error(
        `${fileName}: release tag immutability has an unsafe update rule.`,
      );
    }
    return ruleset;
  }
  if (ruleset.enforcement !== "active")
    throw new Error(`${fileName}: branch enforcement must be active.`);
  if (ruleset.bypass_actors.length !== 0)
    throw new Error(`${fileName}: branch bypass_actors must be empty.`);
  if (
    !Array.isArray(includes) ||
    includes.length !== 1 ||
    !/^refs\/heads\/(dev|main|www)$/.test(includes[0])
  ) {
    throw new Error(
      `${fileName}: ruleset must target exactly dev, main, or www.`,
    );
  }
  if (!Array.isArray(ruleset.rules))
    throw new Error(`${fileName}: rules must be an array.`);
  const types = new Set(ruleset.rules.map((rule) => rule.type));
  for (const requiredType of BRANCH_RULE_TYPES) {
    if (!types.has(requiredType))
      throw new Error(`${fileName}: missing ${requiredType} rule.`);
  }
  const pullRequest = ruleset.rules.find(
    (rule) => rule.type === "pull_request",
  )?.parameters;
  if (
    JSON.stringify(pullRequest?.allowed_merge_methods) !==
      JSON.stringify(["squash"]) ||
    pullRequest?.require_code_owner_review !== true ||
    pullRequest?.required_review_thread_resolution !== true ||
    pullRequest?.dismiss_stale_reviews_on_push !== true
  ) {
    throw new Error(
      `${fileName}: pull_request must require squash, CODEOWNER review, stale dismissal, and resolved threads.`,
    );
  }
  const checks = ruleset.rules.find(
    (rule) => rule.type === "required_status_checks",
  )?.parameters;
  if (
    !Array.isArray(checks?.required_status_checks) ||
    checks.required_status_checks.length === 0
  ) {
    throw new Error(`${fileName}: at least one status check is required.`);
  }
  if (checks.strict_required_status_checks_policy !== true) {
    throw new Error(
      `${fileName}: status checks must use strict head validation.`,
    );
  }
  return ruleset;
}

export function loadRulesets(directory = DEFAULT_RULESET_DIR) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      validateRuleset(
        JSON.parse(readFileSync(path.join(directory, name), "utf8")),
        name,
      ),
    );
}

function comparableRuleset(value) {
  return {
    name: value.name,
    target: value.target,
    enforcement: value.enforcement,
    bypass_actors: value.bypass_actors ?? [],
    conditions: value.conditions,
    rules: value.rules,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

export function planRulesetSync(desiredRulesets, currentRulesets) {
  const byName = new Map(
    currentRulesets.map((ruleset) => [ruleset.name, ruleset]),
  );
  return desiredRulesets.map((desired) => {
    const current = byName.get(desired.name);
    if (!current) return { action: "create", desired };
    const unchanged =
      JSON.stringify(canonicalJson(comparableRuleset(current))) ===
      JSON.stringify(canonicalJson(comparableRuleset(desired)));
    return {
      action: unchanged ? "unchanged" : "update",
      desired,
      currentId: current.id,
    };
  });
}

export function rulesetBranch(ruleset) {
  if (ruleset.target !== "branch") {
    throw new Error(`${ruleset.name} is not a branch ruleset.`);
  }
  return ruleset.conditions.ref_name.include[0].replace("refs/heads/", "");
}

export function verifyReleaseTagActivation(rulesets, releaseAppId) {
  const creation = rulesets.find(
    (ruleset) => ruleset.name === RELEASE_TAG_CREATION_RULESET_NAME,
  );
  const immutability = rulesets.find(
    (ruleset) => ruleset.name === RELEASE_TAG_IMMUTABILITY_RULESET_NAME,
  );
  if (
    creation?.enforcement !== "active" ||
    creation.bypass_actors.length === 0
  ) {
    throw new Error(
      "Release tag creation is locked with no bypass. Add the reviewed dedicated GitHub App ID before applying activation.",
    );
  }
  const actorId = Number(releaseAppId);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new Error("Release GitHub App ID must be a positive integer.");
  }
  if (creation.bypass_actors[0]?.actor_id !== actorId) {
    throw new Error(
      `Checked-in release App ID ${Number(creation.bypass_actors[0]?.actor_id ?? 0).toLocaleString()} does not match requested App ID ${actorId.toLocaleString()}.`,
    );
  }
  if (!immutability)
    throw new Error("Missing release tag immutability ruleset.");
  return { creation, immutability, releaseAppId: actorId };
}

export function verifyReleaseTagLockdown(rulesets) {
  const lockdown = rulesets.find(
    (ruleset) => ruleset.name === RELEASE_TAG_LOCKDOWN_RULESET_NAME,
  );
  if (
    lockdown?.target !== "tag" ||
    lockdown?.enforcement !== "active" ||
    lockdown.bypass_actors?.length !== 0 ||
    !hasExactReleaseTagTarget(lockdown) ||
    !hasExactRuleTypes(lockdown, TAG_LOCKDOWN_RULE_TYPES) ||
    !hasSafeTagUpdateRule(lockdown)
  ) {
    throw new Error(
      "Release tag lockdown must actively restrict creation, update, and deletion with no bypass.",
    );
  }
  return { lockdown };
}

export function verifyLiveReleaseTagAuthority(
  rulesets,
  expectedReleaseAppId,
  { allowActiveLockdown = false } = {},
) {
  const expectedAppId = Number(expectedReleaseAppId);
  const lockdowns = rulesets.filter(
    (ruleset) => ruleset.name === RELEASE_TAG_LOCKDOWN_RULESET_NAME,
  );
  const activeLockdowns = lockdowns.filter(
    (ruleset) => ruleset.enforcement === "active",
  );
  if (activeLockdowns.length > 0 && !allowActiveLockdown) {
    throw new Error(
      "The no-bypass release tag lockdown is still active. Release publication must remain closed until the controlled authority transition removes it.",
    );
  }
  if (activeLockdowns.length > 0) {
    if (lockdowns.length !== 1 || activeLockdowns.length !== 1) {
      throw new Error(
        "The controlled release authority transition requires exactly one active lockdown ruleset. Duplicate lockdown names fail closed.",
      );
    }
    verifyReleaseTagLockdown(activeLockdowns);
  }
  const creations = rulesets.filter(
    (ruleset) => ruleset.name === RELEASE_TAG_CREATION_RULESET_NAME,
  );
  const immutabilities = rulesets.filter(
    (ruleset) => ruleset.name === RELEASE_TAG_IMMUTABILITY_RULESET_NAME,
  );
  if (creations.length !== 1 || immutabilities.length !== 1) {
    throw new Error(
      "Live release tag authority requires exactly one creation ruleset and exactly one immutability ruleset. Duplicate names are ambiguous and fail closed.",
    );
  }
  const [creation] = creations;
  const [immutability] = immutabilities;
  if (
    creation?.target !== "tag" ||
    creation?.enforcement !== "active" ||
    !hasExactReleaseTagTarget(creation) ||
    !hasExactRuleTypes(creation, TAG_CREATION_RULE_TYPES)
  ) {
    throw new Error(
      "Live release tag creation must be active, target every refs/tags/v* tag, and contain only the creation rule.",
    );
  }
  if (
    !isSingleIntegrationBypass(creation.bypass_actors) ||
    creation.bypass_actors[0].actor_id !== expectedAppId
  ) {
    throw new Error(
      `Live release tag creation must grant its only bypass to reviewed GitHub App ${expectedAppId.toLocaleString()}.`,
    );
  }
  if (
    immutability?.target !== "tag" ||
    immutability?.enforcement !== "active" ||
    !hasExactReleaseTagTarget(immutability) ||
    immutability.bypass_actors?.length !== 0 ||
    !hasExactRuleTypes(immutability, TAG_IMMUTABILITY_RULE_TYPES)
  ) {
    throw new Error(
      "Live release tag immutability must be active, target every refs/tags/v* tag, contain only update and deletion rules, and grant no bypass.",
    );
  }
  if (!hasSafeTagUpdateRule(immutability)) {
    throw new Error(
      "The live release tag authority has an unsafe update rule.",
    );
  }
  return { ready: true, releaseAppId: expectedAppId };
}

export function verifyReleaseAppReadiness({
  installations,
  installationReadiness,
  releaseAppId,
  releaseAppSlug,
  repo,
}) {
  const actorId = Number(releaseAppId);
  const native = verifyReleaseTagPublisherInstallationReadiness(
    installationReadiness,
    { repo, releaseAppId, releaseAppSlug },
  );
  const installation = (installations ?? []).find(
    (item) =>
      Number.isSafeInteger(item?.app_id) &&
      item.app_id === actorId &&
      item.app_slug === releaseAppSlug,
  );
  if (!installation) {
    throw new Error(
      `Release App ${releaseAppSlug} is not installed for the authenticated repository owner.`,
    );
  }
  if (installation.suspended_at || installation.suspended_by) {
    throw new Error(`Release App ${releaseAppSlug} installation is suspended.`);
  }
  if (!Number.isSafeInteger(installation.id) || installation.id <= 0) {
    throw new Error(
      `Release App ${releaseAppSlug} installation ID is invalid.`,
    );
  }
  const permissionKeys = Object.keys(installation.permissions ?? {}).sort();
  if (
    JSON.stringify(permissionKeys) !==
      JSON.stringify(["contents", "metadata"]) ||
    installation.permissions.contents !== "write" ||
    installation.permissions.metadata !== "read"
  ) {
    throw new Error(
      `Release App ${releaseAppSlug} installation requires exact Contents write and Metadata read permissions.`,
    );
  }
  if (
    installation.account?.login !== "freed-project" ||
    installation.account?.type !== "Organization" ||
    installation.target_type !== "Organization" ||
    installation.repository_selection !== "selected" ||
    JSON.stringify(installation.events ?? []) !== JSON.stringify([])
  ) {
    throw new Error(
      `Release App ${releaseAppSlug} must be an event-free selected-repository installation owned by freed-project.`,
    );
  }
  if (native.installationId !== installation.id) {
    throw new Error(
      `Release App ${releaseAppSlug} native installation proof does not match the organization installation.`,
    );
  }
  return {
    ready: true,
    appId: actorId,
    installationId: installation.id,
  };
}

export function requiredCheckContexts(ruleset) {
  return ruleset.rules
    .find((rule) => rule.type === "required_status_checks")
    .parameters.required_status_checks.map((check) => check.context);
}

export function verifyRulesetReadiness(ruleset, checkRuns) {
  const successful = new Set(
    checkRuns
      .filter((run) => run.conclusion === "success")
      .map((run) => run.name),
  );
  const missing = requiredCheckContexts(ruleset).filter(
    (context) => !successful.has(context),
  );
  if (missing.length > 0) {
    throw new Error(
      `${rulesetBranch(ruleset)} ruleset is not ready. Missing successful check contexts: ${missing.join(", ")}.`,
    );
  }
  return { ready: true, contexts: [...successful].sort() };
}

export function verifyCodeownerApprovalReadiness({
  pull,
  reviews,
  publisherLogin,
  ownerLogin = "AubreyF",
}) {
  const expectedPublisher = String(publisherLogin ?? "")
    .trim()
    .toLowerCase();
  const expectedOwner = ownerLogin.toLowerCase();
  const author = String(pull?.user?.login ?? "")
    .trim()
    .toLowerCase();
  const authorType = String(pull?.user?.type ?? "").trim();
  const headSha = String(pull?.head?.sha ?? "").trim();
  if (!expectedPublisher || expectedPublisher === expectedOwner) {
    throw new Error(
      "Ruleset readiness requires a distinct publisher GitHub identity so the sole CODEOWNER can review without self-approval.",
    );
  }
  if (author !== expectedPublisher) {
    throw new Error(
      `PR #${Number(pull?.number ?? 0).toLocaleString()} was authored by ${author || "unknown"}, expected publisher ${expectedPublisher}.`,
    );
  }
  if (authorType !== "Bot") {
    throw new Error(
      `PR #${Number(pull?.number ?? 0).toLocaleString()} publisher ${author || "unknown"} is not a GitHub App or bot identity.`,
    );
  }

  const ownerReviews = reviews
    .filter(
      (review) =>
        String(review?.user?.login ?? "")
          .trim()
          .toLowerCase() === expectedOwner &&
        ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review?.state),
    )
    .sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0));
  const latestOwnerReview = ownerReviews.at(-1);
  if (
    latestOwnerReview?.state !== "APPROVED" ||
    latestOwnerReview?.commit_id !== headSha
  ) {
    throw new Error(
      `PR #${Number(pull?.number ?? 0).toLocaleString()} lacks an exact-head APPROVED review from @${ownerLogin}.`,
    );
  }
  return {
    ready: true,
    author: author,
    reviewer: expectedOwner,
    headSha,
  };
}

export function verifyCodeownersReadiness(branch, apiFile, desiredText) {
  if (
    apiFile?.type !== "file" ||
    apiFile?.encoding !== "base64" ||
    typeof apiFile?.content !== "string" ||
    apiFile.content.length === 0
  ) {
    throw new Error(
      `${branch} ruleset is not ready. The target branch has no readable .github/CODEOWNERS file.`,
    );
  }
  const targetText = Buffer.from(
    apiFile.content.replace(/\s+/g, ""),
    "base64",
  ).toString("utf8");
  if (targetText !== desiredText) {
    throw new Error(
      `${branch} ruleset is not ready. The target branch CODEOWNERS file does not match the governed policy in this checkout.`,
    );
  }
  if (!targetText.includes("@AubreyF")) {
    throw new Error(
      `${branch} ruleset is not ready. CODEOWNERS does not name @AubreyF.`,
    );
  }
  return { ready: true, sha: String(apiFile.sha ?? "") };
}

function ghJson(args, { exec = execFileSync } = {}) {
  return JSON.parse(
    exec("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
  );
}

function ghPaginatedArray(endpoint, { exec = execFileSync } = {}) {
  const pages = ghJson(["api", "--paginate", "--slurp", endpoint], { exec });
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    !pages.every((page) => Array.isArray(page))
  ) {
    throw new Error("GitHub returned an invalid paginated ruleset listing.");
  }
  return pages.flat();
}

function applyRuleset(repo, item, { exec = execFileSync } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "freed-ruleset-"));
  const inputPath = path.join(directory, "ruleset.json");
  try {
    writeFileSync(inputPath, `${JSON.stringify(item.desired, null, 2)}\n`);
    const endpoint =
      item.action === "create"
        ? `repos/${repo}/rulesets`
        : `repos/${repo}/rulesets/${item.currentId}`;
    const method = item.action === "create" ? "POST" : "PUT";
    exec("gh", ["api", "-X", method, endpoint, "--input", inputPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function deleteRuleset(repo, rulesetId, { exec = execFileSync } = {}) {
  exec("gh", ["api", "-X", "DELETE", `repos/${repo}/rulesets/${rulesetId}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function findRulesetReadinessEvidence(
  repo,
  ruleset,
  publisherLogin,
  { exec = execFileSync } = {},
) {
  const branch = rulesetBranch(ruleset);
  const pulls = ghJson(
    [
      "api",
      `repos/${repo}/pulls?state=closed&base=${branch}&sort=updated&direction=desc&per_page=50`,
    ],
    { exec },
  ).filter((pull) => pull.merged_at && pull.head?.sha);
  const failures = [];
  for (const pull of pulls) {
    const reviews = ghJson(
      ["api", `repos/${repo}/pulls/${pull.number}/reviews?per_page=100`],
      { exec },
    );
    const checkRuns =
      ghJson(
        [
          "api",
          `repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`,
        ],
        { exec },
      ).check_runs ?? [];
    try {
      verifyCodeownerApprovalReadiness({
        pull,
        reviews,
        publisherLogin,
      });
      verifyRulesetReadiness(ruleset, checkRuns);
      return { pullNumber: pull.number, headSha: pull.head.sha };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  const required = requiredCheckContexts(ruleset).join(", ");
  throw new Error(
    `Refusing to apply ${branch} governance. No recent merged ${branch} pull request has successful evidence for every required context: ${required}.${failures.length > 0 ? ` Latest check: ${failures[0]}` : ""}`,
  );
}

function findCodeownersReadinessEvidence(
  repo,
  ruleset,
  { exec = execFileSync } = {},
) {
  const branch = rulesetBranch(ruleset);
  let apiFile;
  try {
    apiFile = ghJson(
      [
        "api",
        `repos/${repo}/contents/.github/CODEOWNERS?ref=${encodeURIComponent(branch)}`,
      ],
      { exec },
    );
  } catch {
    throw new Error(
      `Refusing to apply ${branch} governance. Merge the governed .github/CODEOWNERS file into ${branch} first.`,
    );
  }
  const desiredText = readFileSync(
    path.resolve(__dirname, "../.github/CODEOWNERS"),
    "utf8",
  );
  return verifyCodeownersReadiness(branch, apiFile, desiredText);
}

export function findReleaseAppReadinessEvidence(
  repo,
  releaseAppId,
  releaseAppSlug,
  installationReadiness,
  { exec = execFileSync } = {},
) {
  const [owner, name, ...extra] = repo.split("/");
  if (!owner || !name || extra.length > 0) {
    throw new Error("Release repository must use the owner/name format.");
  }
  const installations =
    ghJson(["api", `orgs/${owner}/installations?per_page=100`], { exec })
      .installations ?? [];
  return verifyReleaseAppReadiness({
    installations,
    installationReadiness,
    releaseAppId,
    releaseAppSlug,
    repo,
  });
}

function findReleaseTagPublisherReadinessEvidence(
  repo,
  releaseAppId,
  releaseAppSlug,
) {
  const binding = loadAndVerifyReleaseTagPublisher();
  if (
    binding.repo !== repo ||
    binding.appId !== Number(releaseAppId) ||
    binding.appSlug.toLowerCase() !== String(releaseAppSlug).toLowerCase()
  ) {
    throw new Error(
      "Root-owned release tag publisher binding does not match the reviewed repository and App identity.",
    );
  }
  const installation = verifyReleaseTagPublisherInstallation(binding);
  return {
    ready: true,
    publisherDigest: binding.publisherSha256,
    provisionerDigest: binding.provisionerSha256,
    nativePairDigest: binding.nativePairSha256,
    installationAttestation: installation.attestation,
  };
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    repo: "freed-project/freed",
    rulesetDir: DEFAULT_RULESET_DIR,
    branch: null,
    publisherLogin: null,
    releaseTags: false,
    releaseTagLockdown: false,
    releaseAppId: null,
    releaseAppSlug: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--ruleset-dir")
      args.rulesetDir = path.resolve(argv[++index]);
    else if (arg === "--branch") args.branch = argv[++index];
    else if (arg === "--publisher-login") args.publisherLogin = argv[++index];
    else if (arg === "--release-tags") args.releaseTags = true;
    else if (arg === "--lock-release-tags") args.releaseTagLockdown = true;
    else if (arg === "--release-app-id") args.releaseAppId = argv[++index];
    else if (arg === "--release-app-slug") args.releaseAppSlug = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.branch !== null && !["dev", "main", "www"].includes(args.branch)) {
    throw new Error("--branch must be dev, main, or www.");
  }
  const tagModeCount =
    Number(args.releaseTags) + Number(args.releaseTagLockdown);
  if (args.branch !== null && tagModeCount > 0) {
    throw new Error("Choose one branch or release-tag mode, not both.");
  }
  if (tagModeCount > 1)
    throw new Error("Choose --release-tags or --lock-release-tags, not both.");
  if (
    !args.releaseTags &&
    (args.releaseAppId !== null || args.releaseAppSlug !== null)
  ) {
    throw new Error(
      "Release App and publisher arguments require --release-tags.",
    );
  }
  if (args.apply && args.branch === null && tagModeCount === 0) {
    throw new Error(
      "--apply requires exactly one branch, --lock-release-tags, or --release-tags target.",
    );
  }
  if (args.apply && args.branch !== null && !args.publisherLogin) {
    throw new Error(
      "--apply requires --publisher-login for a distinct PR author identity that @AubreyF can review.",
    );
  }
  if (
    args.apply &&
    args.releaseTags &&
    (!args.releaseAppId || !args.releaseAppSlug)
  ) {
    throw new Error(
      "Applying --release-tags requires --release-app-id and --release-app-slug.",
    );
  }
  if (
    args.releaseAppId !== null &&
    (!Number.isSafeInteger(Number(args.releaseAppId)) ||
      Number(args.releaseAppId) <= 0)
  ) {
    throw new Error("--release-app-id must be a positive integer.");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: node scripts/sync-github-rulesets.mjs [--repo owner/repo] [--ruleset-dir path] [--branch dev|main|www --publisher-login login | --lock-release-tags | --release-tags --release-app-id id --release-app-slug slug] [--apply]\n",
    );
    return;
  }
  const templates = loadRulesets(args.rulesetDir);
  let desired;
  if (args.releaseTagLockdown) {
    const lockdown = verifyReleaseTagLockdown(
      templates.filter((ruleset) => ruleset.target === "tag"),
    );
    desired = [lockdown.lockdown];
  } else if (args.releaseTags) {
    const activation = verifyReleaseTagActivation(
      templates.filter((ruleset) => ruleset.target === "tag"),
      args.releaseAppId,
    );
    desired = [activation.immutability, activation.creation];
  } else {
    desired = templates.filter(
      (ruleset) =>
        ruleset.target === "branch" &&
        (args.branch === null || rulesetBranch(ruleset) === args.branch),
    );
  }
  const summary = ghPaginatedArray(`repos/${args.repo}/rulesets?per_page=100`);
  const current = summary.map((item) =>
    ghJson(["api", `repos/${args.repo}/rulesets/${item.id}`]),
  );
  const plan = planRulesetSync(desired, current);
  let releaseEvidence = null;
  if (args.apply && args.releaseTags) {
    verifyReleaseTagLockdown(current);
    const publisher = findReleaseTagPublisherReadinessEvidence(
      args.repo,
      args.releaseAppId,
      args.releaseAppSlug,
    );
    const app = findReleaseAppReadinessEvidence(
      args.repo,
      args.releaseAppId,
      args.releaseAppSlug,
      publisher.installationAttestation,
    );
    releaseEvidence = { app, publisher };
    process.stdout.write(
      `release-app: ${args.releaseAppSlug} app ${app.appId.toLocaleString()} installation ${app.installationId.toLocaleString()}\n`,
    );
    process.stdout.write(
      `release-publisher-pair: ${publisher.nativePairDigest || "attested"}\n`,
    );
  }
  for (const item of plan) {
    process.stdout.write(`${item.action}: ${item.desired.name}\n`);
    if (args.apply && item.action !== "unchanged") {
      if (item.desired.target === "tag") {
        if (args.releaseTags && !releaseEvidence)
          throw new Error("Release tag readiness evidence is missing.");
        applyRuleset(args.repo, item);
        continue;
      }
      const codeowners = findCodeownersReadinessEvidence(
        args.repo,
        item.desired,
      );
      process.stdout.write(
        `codeowners: ${rulesetBranch(item.desired)} ${codeowners.sha || "verified"}\n`,
      );
      const evidence = findRulesetReadinessEvidence(
        args.repo,
        item.desired,
        args.publisherLogin,
      );
      process.stdout.write(
        `readiness: ${rulesetBranch(item.desired)} PR #${evidence.pullNumber.toLocaleString()} ${evidence.headSha}\n`,
      );
      applyRuleset(args.repo, item);
    }
  }
  if (args.apply && args.releaseTags) {
    const refreshedSummary = ghPaginatedArray(
      `repos/${args.repo}/rulesets?per_page=100`,
    );
    const refreshed = refreshedSummary.map((item) =>
      ghJson(["api", `repos/${args.repo}/rulesets/${item.id}`]),
    );
    verifyLiveReleaseTagAuthority(refreshed, Number(args.releaseAppId), {
      allowActiveLockdown: true,
    });
    const lockdown = refreshed.find(
      (ruleset) =>
        ruleset.name === RELEASE_TAG_LOCKDOWN_RULESET_NAME &&
        ruleset.enforcement === "active",
    );
    if (lockdown?.id) {
      deleteRuleset(args.repo, lockdown.id);
      process.stdout.write(
        "removed: Freed release tag lockdown after split authority verification\n",
      );
    }
  }
  if (!args.apply && !args.releaseTags && !args.releaseTagLockdown) {
    const creation = templates.find(
      (ruleset) => ruleset.name === RELEASE_TAG_CREATION_RULESET_NAME,
    );
    if (
      creation?.enforcement === "active" &&
      creation.bypass_actors.length === 0
    ) {
      process.stdout.write(
        "lockdown: Freed release tag lockdown must be applied with --lock-release-tags before App activation.\n",
      );
    }
  }
  if (!args.apply && plan.some((item) => item.action !== "unchanged")) {
    process.stdout.write(
      args.releaseTags
        ? "Dry run only. Re-run with --apply after the dedicated release GitHub App is installed with tag-push authority.\n"
        : args.releaseTagLockdown
          ? "Dry run only. Apply the no-bypass release-tag lockdown before provisioning App creation authority.\n"
          : "Dry run only. Re-run with --apply after matching CODEOWNERS and required workflow checks exist on the target branch.\n",
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
