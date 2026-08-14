import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, rmSync } from "node:fs";

import { resolveGithubReadToken } from "./github-release-publications.mjs";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-dev)?$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ACTIVATION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const GITHUB_APPROVAL_REFERENCE_PATTERN =
  /^https:\/\/github\.com\/freed-project\/freed\/pull\/([1-9][0-9]*)#issuecomment-([1-9][0-9]*)$/;
const CURRENT_TASK_APPROVAL_REFERENCE_PATTERN =
  /^current-task:([a-z0-9][a-z0-9._-]{0,127})#sha256:([0-9a-f]{64})$/;
const LIBRARY_CORE_APPROVAL_REPOSITORY = "freed-project/freed";
const LIBRARY_CORE_APPROVAL_REVIEWER = "AubreyF";
export const LIBRARY_CORE_ACTIVATION_MANIFEST_PATH =
  "docs/library-core-activation-manifest.json";

const LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION = 1;
const LIBRARY_CORE_ACTIVATION_MANIFEST_SCHEMA_VERSION = 1;
const MAX_MANIFEST_TRANSITIONS = 4_096;

export const LIBRARY_CORE_ACTIVATION_DECISION_STATES = Object.freeze({
  REVIEW_REQUIRED: "review_required",
  NO_ACTIVATION_DECLARED: "no_activation_declared",
  OWNER_APPROVED: "owner_approved",
});

// This is the cooperative serialization boundary for every supported release
// artifact writer. It prevents prepare-release-notes and the owner-approval
// recorder from clobbering one another. Direct or manual file writes are not a
// supported concurrent mutation path and cannot be made atomic by a sidecar
// lock they deliberately ignore.
export function withReleaseArtifactWriteLock(filePath, operation) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Release artifact writer requires one file path.");
  }
  if (typeof operation !== "function") {
    throw new Error("Release artifact writer requires one operation.");
  }
  const lockPath = `${filePath}.release-artifact-write.lock`;
  let lockDescriptor = null;
  try {
    try {
      lockDescriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      throw new Error(
        `Another supported release artifact writer is active or the artifact cannot be locked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return operation();
  } finally {
    if (lockDescriptor !== null) {
      try {
        closeSync(lockDescriptor);
      } finally {
        rmSync(lockPath, { force: true });
      }
    }
  }
}

const LIBRARY_CORE_TRANSITION_KINDS_BY_GATE = Object.freeze({
  C: Object.freeze([
    "migration_candidate_claim",
    "migration_candidate_execution",
    "source_admission_fencing",
  ]),
  D: Object.freeze([
    "sql_read_cutover",
    "legacy_worker_eviction",
    "renderer_corpus_eviction",
  ]),
  E: Object.freeze(["replication_protocol_activation"]),
  F: Object.freeze([
    "library_core_writer_activation",
    "migration_cutover",
    "storage_epoch_cutover",
    "rollback_execution",
    "restore_execution",
    "authority_key_rotation",
    "recovery_activation",
  ]),
  G: Object.freeze(["installed_soak_activation"]),
  H: Object.freeze(["legacy_engine_retirement"]),
});

const LIBRARY_CORE_RECEIPT_EXPECTATIONS = Object.freeze([
  "authority_transition_certificate",
  "authority_rotation_receipt",
  "installed_soak_verdict",
  "migration_claim_lifecycle",
  "migration_receipt",
  "read_cutover_parity",
  "recovery_receipt",
  "replication_convergence",
  "restore_receipt",
  "retirement_receipt",
  "roll_forward_recovery_receipt",
  "rollback_receipt",
  "same_frontier_rollback_receipt",
]);

const PRIMARY_RECEIPT_BY_TRANSITION_KIND = Object.freeze({
  migration_candidate_claim: "migration_claim_lifecycle",
  migration_candidate_execution: "migration_receipt",
  source_admission_fencing: "migration_receipt",
  sql_read_cutover: "read_cutover_parity",
  legacy_worker_eviction: "read_cutover_parity",
  renderer_corpus_eviction: "read_cutover_parity",
  replication_protocol_activation: "replication_convergence",
  library_core_writer_activation: "authority_transition_certificate",
  migration_cutover: "migration_receipt",
  storage_epoch_cutover: "authority_transition_certificate",
  rollback_execution: "rollback_receipt",
  restore_execution: "restore_receipt",
  authority_key_rotation: "authority_rotation_receipt",
  recovery_activation: "recovery_receipt",
  installed_soak_activation: "installed_soak_verdict",
  legacy_engine_retirement: "retirement_receipt",
});

const ROLLBACK_RECEIPT_EXPECTATIONS = new Set([
  "same_frontier_rollback_receipt",
  "roll_forward_recovery_receipt",
]);

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareAscii)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort(compareAscii);
  const expected = [...keys].sort(compareAscii);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has unsupported or missing fields.`);
  }
}

function requireFullCommitSha(value, label) {
  if (typeof value !== "string" || !FULL_COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a full Git commit SHA.`);
  }
  return value;
}

function requireCanonicalText(value, label, maxBytes = 4_096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throw new Error(`${label} must be canonical nonempty text.`);
  }
  return value;
}

function validateRange(range) {
  exactKeys(
    range,
    [
      "channel",
      "previousPublishedTag",
      "startMode",
      "fromExclusiveCommitSha",
      "toInclusiveProductCommitSha",
    ],
    "Library Core activation range",
  );
  if (range.channel !== "dev" && range.channel !== "production") {
    throw new Error("Library Core activation range channel is invalid.");
  }
  requireFullCommitSha(
    range.toInclusiveProductCommitSha,
    "Library Core activation range end",
  );

  if (range.startMode === "complete_history") {
    if (
      range.previousPublishedTag !== null ||
      range.fromExclusiveCommitSha !== null
    ) {
      throw new Error(
        "Complete-history Library Core activation ranges cannot name a previous release.",
      );
    }
  } else {
    if (
      range.startMode !== "previous_product_commit" &&
      range.startMode !== "historical_tag_commit"
    ) {
      throw new Error("Library Core activation range start mode is invalid.");
    }
    if (
      typeof range.previousPublishedTag !== "string" ||
      !RELEASE_TAG_PATTERN.test(range.previousPublishedTag) ||
      (range.channel === "dev") !== range.previousPublishedTag.endsWith("-dev")
    ) {
      throw new Error(
        "Library Core activation range previous published tag is invalid.",
      );
    }
    requireFullCommitSha(
      range.fromExclusiveCommitSha,
      "Library Core activation range start",
    );
  }

  return {
    channel: range.channel,
    previousPublishedTag: range.previousPublishedTag,
    startMode: range.startMode,
    fromExclusiveCommitSha: range.fromExclusiveCommitSha,
    toInclusiveProductCommitSha: range.toInclusiveProductCommitSha,
  };
}

function validateReceiptExpectations(values, transitionKind) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      "Library Core transition receipt expectations must be a nonempty array.",
    );
  }
  const allowed = new Set(LIBRARY_CORE_RECEIPT_EXPECTATIONS);
  const normalized = values.map((value) => {
    if (typeof value !== "string" || !allowed.has(value)) {
      throw new Error(
        `Unsupported Library Core receipt expectation: ${String(value)}.`,
      );
    }
    return value;
  });
  const sorted = [...new Set(normalized)].sort(compareAscii);
  if (JSON.stringify(sorted) !== JSON.stringify(normalized)) {
    throw new Error(
      "Library Core receipt expectations must be unique and ASCII sorted.",
    );
  }
  const primary = PRIMARY_RECEIPT_BY_TRANSITION_KIND[transitionKind];
  if (!normalized.includes(primary)) {
    throw new Error(
      `Library Core transition ${transitionKind} requires ${primary}.`,
    );
  }
  if (!normalized.some((value) => ROLLBACK_RECEIPT_EXPECTATIONS.has(value))) {
    throw new Error(
      "Library Core transitions require a same-frontier rollback or roll-forward recovery receipt expectation.",
    );
  }
  return normalized;
}

function validateTransition(transition) {
  exactKeys(
    transition,
    ["activationId", "gate", "kind", "rollbackTrigger", "receiptExpectations"],
    "Library Core transition declaration",
  );
  if (
    typeof transition.activationId !== "string" ||
    !ACTIVATION_ID_PATTERN.test(transition.activationId)
  ) {
    throw new Error("Library Core activation ID is invalid.");
  }
  const gateKinds = LIBRARY_CORE_TRANSITION_KINDS_BY_GATE[transition.gate];
  if (!gateKinds || !gateKinds.includes(transition.kind)) {
    throw new Error(
      `Library Core transition ${String(transition.kind)} is invalid for Gate ${String(transition.gate)}.`,
    );
  }
  return {
    activationId: transition.activationId,
    gate: transition.gate,
    kind: transition.kind,
    rollbackTrigger: requireCanonicalText(
      transition.rollbackTrigger,
      "Library Core rollback trigger",
    ),
    receiptExpectations: validateReceiptExpectations(
      transition.receiptExpectations,
      transition.kind,
    ),
  };
}

function validateTransitions(transitions) {
  if (!Array.isArray(transitions) || transitions.length > 64) {
    throw new Error(
      "Library Core transition declarations must be an array of at most 64 entries.",
    );
  }
  const normalized = transitions.map(validateTransition);
  const activationIds = normalized.map((entry) => entry.activationId);
  const sortedIds = [...new Set(activationIds)].sort(compareAscii);
  if (JSON.stringify(activationIds) !== JSON.stringify(sortedIds)) {
    throw new Error(
      "Library Core transition declarations must have unique ASCII-sorted activation IDs.",
    );
  }
  return normalized;
}

function emptyActivationManifest() {
  return {
    schemaVersion: LIBRARY_CORE_ACTIVATION_MANIFEST_SCHEMA_VERSION,
    transitions: [],
  };
}

function parseActivationManifest(contents, { allowAbsent, label }) {
  if (contents === null || contents === undefined) {
    if (allowAbsent) {
      return emptyActivationManifest();
    }
    throw new Error(`${label} is missing.`);
  }
  if (typeof contents !== "string") {
    throw new Error(`${label} must be JSON text.`);
  }
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  exactKeys(
    value,
    ["schemaVersion", "transitions"],
    "Library Core activation manifest",
  );
  if (value.schemaVersion !== LIBRARY_CORE_ACTIVATION_MANIFEST_SCHEMA_VERSION) {
    throw new Error("Library Core activation manifest schema is invalid.");
  }
  if (
    !Array.isArray(value.transitions) ||
    value.transitions.length > MAX_MANIFEST_TRANSITIONS
  ) {
    throw new Error(
      `Library Core activation manifest transitions must contain at most ${MAX_MANIFEST_TRANSITIONS.toLocaleString()} entries.`,
    );
  }
  const transitions = value.transitions.map(validateTransition);
  const activationIds = new Set();
  for (const transition of transitions) {
    if (activationIds.has(transition.activationId)) {
      throw new Error(
        "Library Core activation manifest IDs must be globally unique.",
      );
    }
    activationIds.add(transition.activationId);
  }
  return {
    schemaVersion: LIBRARY_CORE_ACTIVATION_MANIFEST_SCHEMA_VERSION,
    transitions,
  };
}

function inspectionDigest(body) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(body))
    .digest("hex")}`;
}

export function libraryCoreReleaseArtifactProposalDigest({
  artifact,
  expectedTag = null,
}) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(
      "Library Core release artifact proposal must be an object.",
    );
  }
  const tag = requireCanonicalText(
    artifact.tag,
    "Library Core release artifact tag",
  );
  if (
    !RELEASE_TAG_PATTERN.test(tag) ||
    (expectedTag !== null && tag !== expectedTag)
  ) {
    throw new Error("Library Core release artifact tag is invalid.");
  }
  if (artifact.approved !== true) {
    throw new Error(
      "Library Core owner approval requires an approved release artifact.",
    );
  }
  if (
    !artifact.source ||
    typeof artifact.source !== "object" ||
    Array.isArray(artifact.source) ||
    !artifact.source.libraryCoreActivation ||
    typeof artifact.source.libraryCoreActivation !== "object" ||
    Array.isArray(artifact.source.libraryCoreActivation)
  ) {
    throw new Error(
      "Library Core release artifact proposal is missing its activation inspection.",
    );
  }
  const projection = JSON.parse(JSON.stringify(artifact));
  projection.source.libraryCoreActivation.decision = {
    state: "owner_approval_projection",
  };
  return inspectionDigest({
    schemaVersion: LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION,
    releaseArtifact: projection,
  });
}

function validateManifestEvidence(value) {
  exactKeys(
    value,
    ["path", "previousPresent", "previousDigest", "currentDigest"],
    "Library Core activation manifest evidence",
  );
  if (value.path !== LIBRARY_CORE_ACTIVATION_MANIFEST_PATH) {
    throw new Error("Library Core activation manifest path is invalid.");
  }
  if (typeof value.previousPresent !== "boolean") {
    throw new Error(
      "Library Core activation manifest previous presence is invalid.",
    );
  }
  for (const [label, digest] of [
    ["previous", value.previousDigest],
    ["current", value.currentDigest],
  ]) {
    if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
      throw new Error(
        `Library Core activation manifest ${label} digest is invalid.`,
      );
    }
  }
  return {
    path: value.path,
    previousPresent: value.previousPresent,
    previousDigest: value.previousDigest,
    currentDigest: value.currentDigest,
  };
}

function validateManifestInspection(value) {
  exactKeys(
    value,
    ["manifest", "transitions"],
    "Library Core activation manifest inspection",
  );
  return {
    manifest: validateManifestEvidence(value.manifest),
    transitions: validateTransitions(value.transitions),
  };
}

export function inspectLibraryCoreActivationManifest({
  previousContents = null,
  currentContents,
}) {
  const previousPresent =
    previousContents !== null && previousContents !== undefined;
  const previous = parseActivationManifest(previousContents, {
    allowAbsent: true,
    label: "Previous Library Core activation manifest",
  });
  const current = parseActivationManifest(currentContents, {
    allowAbsent: false,
    label: "Current Library Core activation manifest",
  });

  if (current.transitions.length < previous.transitions.length) {
    throw new Error(
      "Library Core activation manifest history cannot delete transitions.",
    );
  }
  for (let index = 0; index < previous.transitions.length; index += 1) {
    if (
      canonicalJson(previous.transitions[index]) !==
      canonicalJson(current.transitions[index])
    ) {
      throw new Error(
        "Library Core activation manifest history cannot modify or reorder prior transitions.",
      );
    }
  }

  const transitions = current.transitions
    .slice(previous.transitions.length)
    .sort((left, right) => compareAscii(left.activationId, right.activationId));
  if (transitions.length > 64) {
    throw new Error(
      "One release may introduce at most 64 Library Core transitions.",
    );
  }
  return {
    manifest: {
      path: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
      previousPresent,
      previousDigest: inspectionDigest(previous),
      currentDigest: inspectionDigest(current),
    },
    transitions,
  };
}

export function inspectPreviousLibraryCoreActivationWitness({
  releaseArtifact,
  tag,
  manifestRead,
}) {
  if (!Object.hasOwn(releaseArtifact?.source ?? {}, "libraryCoreActivation")) {
    return null;
  }
  if (manifestRead?.state !== "present") {
    throw new Error(
      `Previous published release ${tag} records Library Core activation evidence, but its immutable manifest path is absent.`,
    );
  }

  const recordedDigest =
    releaseArtifact.source.libraryCoreActivation?.manifest?.currentDigest;
  const immutableInspection = inspectLibraryCoreActivationManifest({
    previousContents: manifestRead.contents,
    currentContents: manifestRead.contents,
  });
  const immutableDigest = immutableInspection.manifest.currentDigest;
  if (recordedDigest !== immutableDigest) {
    throw new Error(
      `Previous published release ${tag} Library Core manifest digest does not match its immutable tag contents.`,
    );
  }
  return {
    tag,
    currentDigest: immutableDigest,
  };
}

export function validatePreviousLibraryCoreActivationContinuity({
  witness,
  manifestInspection,
}) {
  if (witness === null) {
    return;
  }
  if (
    manifestInspection?.manifest?.previousPresent !== true ||
    manifestInspection.manifest.previousDigest !== witness.currentDigest
  ) {
    throw new Error(
      `Library Core activation history does not continue from previous published release ${witness.tag}.`,
    );
  }
}

function transitionSetDigest(transitions) {
  return inspectionDigest({
    schemaVersion: LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION,
    transitions,
  });
}

export function libraryCoreOwnerApprovalIntent({ artifact }) {
  const activation = artifact?.source?.libraryCoreActivation;
  if (
    !activation ||
    typeof activation !== "object" ||
    Array.isArray(activation) ||
    activation.decision?.state !==
      LIBRARY_CORE_ACTIVATION_DECISION_STATES.REVIEW_REQUIRED
  ) {
    throw new Error(
      "Library Core owner confirmation requires one review_required release artifact.",
    );
  }
  const releaseTag = requireCanonicalText(
    artifact?.tag,
    "Library Core release artifact tag",
  );
  if (!RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw new Error("Library Core release artifact tag is invalid.");
  }
  const taskId = `release-${releaseTag.slice(1).replaceAll(".", "-")}`;
  const releaseArtifactPath = `release-notes/releases/${releaseTag}.json`;
  const intent = {
    schemaVersion: 1,
    action: "library-core.release-activation.approve",
    taskId,
    parameters: {
      channel: activation.range.channel,
      inspectionDigest: activation.inspectionDigest,
      manifestCurrentDigest: activation.manifest.currentDigest,
      productCommitSha: activation.range.toInclusiveProductCommitSha,
      releaseArtifactPath,
      releaseArtifactProposalDigest: libraryCoreReleaseArtifactProposalDigest({
        artifact,
        expectedTag: releaseTag,
      }),
      releaseTag,
      transitionSetDigest: transitionSetDigest(activation.transitions),
    },
  };
  return {
    taskId,
    intent,
    intentDigest: createHash("sha256")
      .update(canonicalJson(intent), "utf8")
      .digest("hex"),
  };
}

export function currentTaskLibraryCoreApprovalReference({
  taskId,
  confirmationDigest,
}) {
  if (
    typeof taskId !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(taskId) ||
    typeof confirmationDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(confirmationDigest)
  ) {
    throw new Error("Library Core current-task approval reference is invalid.");
  }
  return `current-task:${taskId}#sha256:${confirmationDigest}`;
}

function activationInspectionProjection(value) {
  return {
    schemaVersion: value?.schemaVersion,
    range: value?.range,
    manifest: value?.manifest,
    transitions: value?.transitions,
    inspectionDigest: value?.inspectionDigest,
  };
}

function releaseArtifactBinding({
  artifact,
  pullNumber,
  activationInspection,
}) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    throw new Error(
      "Library Core owner approval requires the exact release pull request number.",
    );
  }
  const releaseTag = requireCanonicalText(
    artifact?.tag,
    "Library Core release artifact tag",
  );
  if (!RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw new Error("Library Core release artifact tag is invalid.");
  }
  const expectedChannel = activationInspection?.range?.channel;
  const expectedProductCommitSha =
    activationInspection?.range?.toInclusiveProductCommitSha;
  if (
    artifact.channel !== expectedChannel ||
    artifact.source?.channel !== expectedChannel ||
    artifact.source?.productCommitSha !== expectedProductCommitSha ||
    (expectedChannel === "dev") !== releaseTag.endsWith("-dev") ||
    canonicalJson(
      activationInspectionProjection(artifact.source?.libraryCoreActivation),
    ) !== canonicalJson(activationInspectionProjection(activationInspection))
  ) {
    throw new Error(
      "Library Core release artifact does not contain the exact activation inspection and product identity.",
    );
  }
  return {
    repository: LIBRARY_CORE_APPROVAL_REPOSITORY,
    pullNumber,
    releaseTag,
    releaseArtifactPath: `release-notes/releases/${releaseTag}.json`,
    releaseArtifactProposalDigest: libraryCoreReleaseArtifactProposalDigest({
      artifact,
      expectedTag: releaseTag,
    }),
  };
}

function ownerApprovalCommentBody({
  digest,
  range,
  manifest,
  transitions,
  releaseBinding,
}) {
  const marker = `<!-- freed-library-core-activation-approval:${canonicalJson({
    inspectionDigest: digest,
    manifestCurrentDigest: manifest.currentDigest,
    manifestPath: manifest.path,
    productCommitSha: range.toInclusiveProductCommitSha,
    pullNumber: releaseBinding.pullNumber,
    releaseArtifactPath: releaseBinding.releaseArtifactPath,
    releaseArtifactProposalDigest: releaseBinding.releaseArtifactProposalDigest,
    releaseTag: releaseBinding.releaseTag,
    repository: releaseBinding.repository,
    schemaVersion: LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION,
    transitionSetDigest: transitionSetDigest(transitions),
  })} -->`;
  return [
    "(AI Generated).",
    "",
    marker,
    "",
    "I approve this exact Library Core release activation.",
  ].join("\n");
}

function parseOwnerApprovalReference(reference) {
  requireCanonicalText(reference, "Library Core owner approval reference");
  const currentTaskMatch =
    CURRENT_TASK_APPROVAL_REFERENCE_PATTERN.exec(reference);
  if (currentTaskMatch) {
    return {
      kind: "current-task",
      taskId: currentTaskMatch[1],
      confirmationDigest: currentTaskMatch[2],
      reference,
    };
  }
  const match = GITHUB_APPROVAL_REFERENCE_PATTERN.exec(reference);
  if (!match) {
    throw new Error(
      "Library Core owner approval reference must identify one current-task confirmation or canonical Freed GitHub pull request comment.",
    );
  }
  const pullNumber = Number(match[1]);
  const commentId = Number(match[2]);
  if (!Number.isSafeInteger(pullNumber) || !Number.isSafeInteger(commentId)) {
    throw new Error("Library Core owner approval reference is out of range.");
  }
  return {
    kind: "github-comment",
    repository: LIBRARY_CORE_APPROVAL_REPOSITORY,
    pullNumber,
    commentId,
    reference,
  };
}

export function fetchGithubJson(
  apiPath,
  { resolveToken = resolveGithubReadToken, execFile = execFileSync } = {},
) {
  const token = resolveToken();
  const args = [
    "--disable",
    "--fail",
    "--silent",
    "--show-error",
    "--proto",
    "=https",
    "--tlsv1.2",
    "--config",
    "-",
    "--connect-timeout",
    "10",
    "--max-time",
    "30",
    "--retry",
    "2",
    "--retry-all-errors",
    "--header",
    "Accept: application/vnd.github+json",
    "--header",
    "X-GitHub-Api-Version: 2022-11-28",
    "--header",
    "User-Agent: Freed-release-identity",
  ];
  args.push(`https://api.github.com/${apiPath}`);
  let output;
  try {
    output = execFile("/usr/bin/curl", args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      input: `header = "Authorization: Bearer ${token}"\n`,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 35_000,
    });
  } catch (error) {
    throw new Error(
      `GitHub approval evidence could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("GitHub approval evidence is not valid JSON.");
  }
}

export function libraryCoreOwnerApprovalCommentBody({
  value,
  expectedRange,
  expectedManifestInspection,
  releaseArtifact,
  pullNumber,
}) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "range",
      "manifest",
      "transitions",
      "inspectionDigest",
      "decision",
    ],
    "Library Core release activation",
  );
  if (value.schemaVersion !== LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION) {
    throw new Error(
      "Library Core release activation schema version is invalid.",
    );
  }
  const range = validateRange(value.range);
  const normalizedExpectedRange = validateRange(expectedRange);
  if (canonicalJson(range) !== canonicalJson(normalizedExpectedRange)) {
    throw new Error(
      "Library Core activation range does not match the exact release range.",
    );
  }
  const manifest = validateManifestEvidence(value.manifest);
  const normalizedExpectedManifest = validateManifestInspection(
    expectedManifestInspection,
  );
  if (
    canonicalJson(manifest) !==
    canonicalJson(normalizedExpectedManifest.manifest)
  ) {
    throw new Error(
      "Library Core activation manifest evidence does not match the exact release range.",
    );
  }
  const transitions = validateTransitions(value.transitions);
  if (
    canonicalJson(transitions) !==
    canonicalJson(normalizedExpectedManifest.transitions)
  ) {
    throw new Error(
      "Library Core activation declarations do not match the exact manifest delta.",
    );
  }
  if (transitions.length === 0) {
    throw new Error(
      "A Library Core owner approval comment requires a transition declaration.",
    );
  }
  const body = {
    schemaVersion: LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION,
    range,
    manifest,
    transitions,
  };
  const digest = inspectionDigest(body);
  if (value.inspectionDigest !== digest) {
    throw new Error("Library Core activation inspection digest is invalid.");
  }
  return ownerApprovalCommentBody({
    digest,
    range,
    manifest,
    transitions,
    releaseBinding: releaseArtifactBinding({
      artifact: releaseArtifact,
      pullNumber,
      activationInspection: value,
    }),
  });
}

export function buildOwnerApprovedLibraryCoreReleaseArtifact({
  artifact,
  ownerApprovalReference,
  loadOwnerApprovalEvidence,
}) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(
      "Library Core owner approval requires one release artifact object.",
    );
  }
  const activation = artifact.source?.libraryCoreActivation;
  if (
    !activation ||
    typeof activation !== "object" ||
    Array.isArray(activation) ||
    activation.decision?.state !==
      LIBRARY_CORE_ACTIVATION_DECISION_STATES.REVIEW_REQUIRED
  ) {
    throw new Error(
      "Library Core owner approval can record only a review_required activation.",
    );
  }
  const approvedArtifact = JSON.parse(JSON.stringify(artifact));
  approvedArtifact.source.libraryCoreActivation.decision = {
    state: LIBRARY_CORE_ACTIVATION_DECISION_STATES.OWNER_APPROVED,
    ownerApprovalReference,
    approvedInspectionDigest: activation.inspectionDigest,
    approvedReleaseArtifactDigest: libraryCoreReleaseArtifactProposalDigest({
      artifact,
    }),
  };
  validateLibraryCoreReleaseActivation({
    value: approvedArtifact.source.libraryCoreActivation,
    expectedRange: activation.range,
    expectedManifestInspection: {
      manifest: activation.manifest,
      transitions: activation.transitions,
    },
    releaseArtifact: approvedArtifact,
    requireReviewed: true,
    loadOwnerApprovalEvidence,
  });
  return approvedArtifact;
}

function loadGithubOwnerApprovalEvidence(
  { repository, pullNumber, commentId },
  { releaseArtifactPath },
) {
  const pull = fetchGithubJson(`repos/${repository}/pulls/${pullNumber}`);
  const encodedPath = releaseArtifactPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const encodedRef = encodeURIComponent(String(pull?.head?.sha ?? ""));
  const content = fetchGithubJson(
    `repos/${repository}/contents/${encodedPath}?ref=${encodedRef}`,
  );
  if (content?.encoding !== "base64" || typeof content?.content !== "string") {
    throw new Error(
      "Library Core owner approval release artifact content is malformed.",
    );
  }
  let releaseArtifact;
  try {
    releaseArtifact = JSON.parse(
      Buffer.from(content.content.replace(/\s/g, ""), "base64").toString(
        "utf8",
      ),
    );
  } catch {
    throw new Error(
      "Library Core owner approval release artifact is not valid JSON.",
    );
  }
  const comment = fetchGithubJson(
    `repos/${repository}/issues/comments/${commentId}`,
  );
  const pullReadback = fetchGithubJson(
    `repos/${repository}/pulls/${pullNumber}`,
  );
  assertStableOwnerApprovalPull({ before: pull, after: pullReadback });
  return { pull: pullReadback, comment, releaseArtifact };
}

function ownerApprovalPullSnapshot(pull) {
  return {
    baseRef: pull?.base?.ref ?? null,
    baseRepository: pull?.base?.repo?.full_name ?? null,
    baseSha: pull?.base?.sha ?? null,
    draft: pull?.draft ?? null,
    headRepository: pull?.head?.repo?.full_name ?? null,
    headSha: pull?.head?.sha ?? null,
    mergedAt: pull?.merged_at ?? null,
    number: pull?.number ?? null,
    state: pull?.state ?? null,
  };
}

export function assertStableOwnerApprovalPull({ before, after }) {
  if (
    canonicalJson(ownerApprovalPullSnapshot(before)) !==
    canonicalJson(ownerApprovalPullSnapshot(after))
  ) {
    throw new Error(
      "Library Core owner approval pull request changed while its evidence was being read.",
    );
  }
}

function verifyAuthenticatedOwnerApproval({
  reference,
  range,
  manifest,
  transitions,
  digest,
  releaseArtifact,
  loadOwnerApprovalEvidence = loadGithubOwnerApprovalEvidence,
}) {
  const parsedReference = parseOwnerApprovalReference(reference);
  if (parsedReference.kind === "current-task") {
    return;
  }
  const releaseBinding = releaseArtifactBinding({
    artifact: releaseArtifact,
    pullNumber: parsedReference.pullNumber,
    activationInspection: {
      schemaVersion: LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION,
      range,
      manifest,
      transitions,
      inspectionDigest: digest,
    },
  });
  if (typeof loadOwnerApprovalEvidence !== "function") {
    throw new Error(
      "Library Core owner approval requires an authenticated evidence loader.",
    );
  }
  let evidence;
  try {
    evidence = loadOwnerApprovalEvidence(parsedReference, releaseBinding);
  } catch (error) {
    throw new Error(
      `Library Core owner approval evidence is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    !evidence.comment ||
    typeof evidence.comment !== "object" ||
    Array.isArray(evidence.comment) ||
    Number(evidence.pull?.number) !== parsedReference.pullNumber ||
    !evidence.releaseArtifact ||
    typeof evidence.releaseArtifact !== "object" ||
    Array.isArray(evidence.releaseArtifact)
  ) {
    throw new Error("Library Core owner approval evidence is malformed.");
  }

  const expectedBase = range.channel === "dev" ? "dev" : "main";
  const expectedIssueUrl = `https://api.github.com/repos/${parsedReference.repository}/issues/${parsedReference.pullNumber}`;
  const commenter = String(evidence.comment?.user?.login ?? "").toLowerCase();
  const pullStateIsAdmissible =
    evidence.pull?.state === "open" ||
    (evidence.pull?.state === "closed" &&
      typeof evidence.pull?.merged_at === "string" &&
      evidence.pull.merged_at.length > 0);
  if (
    evidence.pull?.base?.ref !== expectedBase ||
    !FULL_COMMIT_SHA_PATTERN.test(String(evidence.pull?.base?.sha ?? "")) ||
    evidence.pull?.base?.repo?.full_name !== parsedReference.repository ||
    evidence.pull?.head?.repo?.full_name !== parsedReference.repository ||
    !FULL_COMMIT_SHA_PATTERN.test(String(evidence.pull?.head?.sha ?? "")) ||
    !pullStateIsAdmissible ||
    Number(evidence.comment?.id) !== parsedReference.commentId ||
    evidence.comment?.html_url !== parsedReference.reference ||
    evidence.comment?.issue_url !== expectedIssueUrl ||
    commenter !== LIBRARY_CORE_APPROVAL_REVIEWER.toLowerCase() ||
    evidence.comment?.user?.type !== "User"
  ) {
    throw new Error(
      "Library Core owner approval is not an authenticated owner comment on the exact release pull request and lane.",
    );
  }

  const remoteProposalDigest = libraryCoreReleaseArtifactProposalDigest({
    artifact: evidence.releaseArtifact,
    expectedTag: releaseBinding.releaseTag,
  });
  if (remoteProposalDigest !== releaseBinding.releaseArtifactProposalDigest) {
    throw new Error(
      "Library Core owner approval is not bound to the release artifact at the exact pull request head.",
    );
  }

  const expectedBody = ownerApprovalCommentBody({
    digest,
    range,
    manifest,
    transitions,
    releaseBinding,
  });
  if (evidence.comment?.body !== expectedBody) {
    throw new Error(
      `Library Core owner approval comment is not bound to the exact inspection, product commit, and transition set. Expected body:\n${expectedBody}`,
    );
  }
}

function validateDecision(
  decision,
  {
    range,
    manifest,
    transitions,
    digest,
    requireReviewed,
    releaseArtifact,
    loadOwnerApprovalEvidence,
  },
) {
  exactKeys(
    decision,
    [
      "state",
      "ownerApprovalReference",
      "approvedInspectionDigest",
      "approvedReleaseArtifactDigest",
    ],
    "Library Core activation decision",
  );
  const states = new Set(
    Object.values(LIBRARY_CORE_ACTIVATION_DECISION_STATES),
  );
  if (!states.has(decision.state)) {
    throw new Error("Library Core activation decision state is invalid.");
  }

  if (
    decision.state === LIBRARY_CORE_ACTIVATION_DECISION_STATES.REVIEW_REQUIRED
  ) {
    if (
      decision.ownerApprovalReference !== null ||
      decision.approvedInspectionDigest !== null ||
      decision.approvedReleaseArtifactDigest !== null
    ) {
      throw new Error(
        "An unreviewed Library Core activation decision cannot carry approval.",
      );
    }
    if (requireReviewed) {
      throw new Error(
        "Library Core activation inspection remains review_required.",
      );
    }
  } else if (
    decision.state ===
    LIBRARY_CORE_ACTIVATION_DECISION_STATES.NO_ACTIVATION_DECLARED
  ) {
    if (transitions.length !== 0) {
      throw new Error(
        "A no-activation decision cannot contain transition declarations.",
      );
    }
    if (
      decision.ownerApprovalReference !== null ||
      decision.approvedInspectionDigest !== null ||
      decision.approvedReleaseArtifactDigest !== null
    ) {
      throw new Error(
        "A no-activation decision cannot carry owner approval fields.",
      );
    }
  } else {
    if (transitions.length === 0) {
      throw new Error(
        "An owner-approved activation decision requires a transition declaration.",
      );
    }
    const ownerApprovalReference = requireCanonicalText(
      decision.ownerApprovalReference,
      "Library Core owner approval reference",
    );
    if (
      typeof decision.approvedInspectionDigest !== "string" ||
      !DIGEST_PATTERN.test(decision.approvedInspectionDigest) ||
      decision.approvedInspectionDigest !== digest
    ) {
      throw new Error(
        "Library Core owner approval is not bound to the current inspection digest.",
      );
    }
    const proposalDigest = libraryCoreReleaseArtifactProposalDigest({
      artifact: releaseArtifact,
    });
    if (
      typeof decision.approvedReleaseArtifactDigest !== "string" ||
      !DIGEST_PATTERN.test(decision.approvedReleaseArtifactDigest) ||
      decision.approvedReleaseArtifactDigest !== proposalDigest
    ) {
      throw new Error(
        "Library Core owner approval is not bound to the current release artifact proposal.",
      );
    }
    verifyAuthenticatedOwnerApproval({
      reference: ownerApprovalReference,
      range,
      manifest,
      transitions,
      digest,
      releaseArtifact,
      loadOwnerApprovalEvidence,
    });
  }

  return {
    state: decision.state,
    ownerApprovalReference: decision.ownerApprovalReference,
    approvedInspectionDigest: decision.approvedInspectionDigest,
    approvedReleaseArtifactDigest: decision.approvedReleaseArtifactDigest,
  };
}

export function createLibraryCoreReleaseActivation({
  range,
  manifestInspection,
  decisionState = null,
  ownerApprovalReference = null,
  approvedInspectionDigest = null,
  approvedReleaseArtifactDigest = null,
  releaseArtifact = null,
  loadOwnerApprovalEvidence,
}) {
  const normalizedRange = validateRange(range);
  const normalizedManifestInspection =
    validateManifestInspection(manifestInspection);
  const normalizedTransitions = normalizedManifestInspection.transitions;
  const body = {
    schemaVersion: LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION,
    range: normalizedRange,
    manifest: normalizedManifestInspection.manifest,
    transitions: normalizedTransitions,
  };
  const digest = inspectionDigest(body);
  const resolvedDecisionState =
    decisionState ??
    (normalizedTransitions.length === 0
      ? LIBRARY_CORE_ACTIVATION_DECISION_STATES.NO_ACTIVATION_DECLARED
      : LIBRARY_CORE_ACTIVATION_DECISION_STATES.REVIEW_REQUIRED);
  const decision = validateDecision(
    {
      state: resolvedDecisionState,
      ownerApprovalReference,
      approvedInspectionDigest,
      approvedReleaseArtifactDigest,
    },
    {
      range: normalizedRange,
      manifest: normalizedManifestInspection.manifest,
      transitions: normalizedTransitions,
      digest,
      requireReviewed: false,
      releaseArtifact,
      loadOwnerApprovalEvidence,
    },
  );
  return {
    ...body,
    inspectionDigest: digest,
    decision,
  };
}

export function validateLibraryCoreReleaseActivation({
  value,
  expectedRange,
  expectedManifestInspection,
  releaseArtifact = null,
  requireReviewed = true,
  loadOwnerApprovalEvidence,
}) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "range",
      "manifest",
      "transitions",
      "inspectionDigest",
      "decision",
    ],
    "Library Core release activation",
  );
  if (value.schemaVersion !== LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION) {
    throw new Error(
      "Library Core release activation schema version is invalid.",
    );
  }
  const range = validateRange(value.range);
  const normalizedExpectedRange = validateRange(expectedRange);
  if (canonicalJson(range) !== canonicalJson(normalizedExpectedRange)) {
    throw new Error(
      "Library Core activation range does not match the exact release range.",
    );
  }
  const manifest = validateManifestEvidence(value.manifest);
  const normalizedExpectedManifest = validateManifestInspection(
    expectedManifestInspection,
  );
  if (
    canonicalJson(manifest) !==
    canonicalJson(normalizedExpectedManifest.manifest)
  ) {
    throw new Error(
      "Library Core activation manifest evidence does not match the exact release range.",
    );
  }
  const transitions = validateTransitions(value.transitions);
  if (
    canonicalJson(transitions) !==
    canonicalJson(normalizedExpectedManifest.transitions)
  ) {
    throw new Error(
      "Library Core activation declarations do not match the exact manifest delta.",
    );
  }
  const body = {
    schemaVersion: LIBRARY_CORE_RELEASE_ACTIVATION_SCHEMA_VERSION,
    range,
    manifest,
    transitions,
  };
  const digest = inspectionDigest(body);
  if (
    typeof value.inspectionDigest !== "string" ||
    !DIGEST_PATTERN.test(value.inspectionDigest) ||
    value.inspectionDigest !== digest
  ) {
    throw new Error("Library Core activation inspection digest is invalid.");
  }
  const decision = validateDecision(value.decision, {
    range,
    manifest,
    transitions,
    digest,
    requireReviewed,
    releaseArtifact,
    loadOwnerApprovalEvidence,
  });
  return {
    ...body,
    inspectionDigest: digest,
    decision,
  };
}

export function prepareLibraryCoreReleaseActivation({
  range,
  manifestInspection,
  existingValue = null,
  releaseArtifact = null,
  loadOwnerApprovalEvidence,
}) {
  if (existingValue !== null && existingValue !== undefined) {
    try {
      return validateLibraryCoreReleaseActivation({
        value: existingValue,
        expectedRange: range,
        expectedManifestInspection: manifestInspection,
        releaseArtifact,
        requireReviewed: false,
        loadOwnerApprovalEvidence,
      });
    } catch {
      // A changed source or malformed prior decision must be reviewed again.
    }
  }
  return createLibraryCoreReleaseActivation({ range, manifestInspection });
}
