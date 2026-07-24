import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  automationControlPaths,
  inspectLeaseTransactionEventHistory,
  readAutomationAuthorityFileSnapshot,
  validateTaskManifest,
} from "./automation-control.mjs";
import { readStabilityArtifactIndex } from "./stability-artifacts.mjs";
import { STABILITY_METRIC_REGISTRY_VERSION } from "./stability-metrics.mjs";
import {
  authenticateOutcomeHistorySnapshots,
  buildBehavioralTaskGate,
} from "../nightly-self-improve.mjs";
import { VERDICT_SCHEMA_VERSION } from "../soak-assert.mjs";
import { SOAK_SCHEMA_VERSION } from "../soak-collect.mjs";
import { validateAutomationSpecs } from "../validate-automation-specs.mjs";

export const STABILITY_STATUS_SCHEMA_VERSION = 1;
export const DEFAULT_STABILITY_STATUS_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const STATUS_FILE_MAX_BYTES = 128 * 1024 * 1024;
const ACTIVE_EXECUTION_STATES = new Set([
  "approved_for_pr",
  "implemented",
  "validated",
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sourceHealthFromTimestamp(
  timestamp,
  nowMs,
  staleAfterMs = DEFAULT_STABILITY_STATUS_STALE_AFTER_MS,
) {
  const timestampMs = Date.parse(String(timestamp ?? ""));
  if (!Number.isFinite(timestampMs)) return "malformed";
  return nowMs - timestampMs > staleAfterMs ? "stale" : "healthy";
}

function readRegularFile(
  filePath,
  { allowMissing = false, maxBytes = STATUS_FILE_MAX_BYTES } = {},
) {
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const before = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size < 0 ||
      before.size > maxBytes ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      throw new Error(`${filePath} is not a safe bounded regular file.`);
    }
    const text = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor);
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(`${filePath} changed while it was read.`);
    }
    return text;
  } finally {
    closeSync(descriptor);
  }
}

function parseJsonFile(filePath, options = {}) {
  const text = readRegularFile(filePath, options);
  return text === null ? null : JSON.parse(text);
}

function localGit(execFile, repoRoot, args, options = {}) {
  return String(
    execFile(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        ...args,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdio: ["ignore", "pipe", options.allowFailure ? "ignore" : "pipe"],
      },
    ),
  ).trim();
}

export function readRepositoryStatus({
  repoRoot,
  execFile = execFileSync,
} = {}) {
  const root = path.resolve(repoRoot);
  try {
    const commitSha = localGit(execFile, root, ["rev-parse", "HEAD"]);
    const topLevel = localGit(execFile, root, ["rev-parse", "--show-toplevel"]);
    let branch = null;
    try {
      branch =
        localGit(
          execFile,
          root,
          ["symbolic-ref", "--quiet", "--short", "HEAD"],
          { allowFailure: true },
        ) || null;
    } catch {
      branch = null;
    }
    let originUrl = null;
    try {
      originUrl =
        localGit(execFile, root, ["config", "--get", "remote.origin.url"], {
          allowFailure: true,
        }) || null;
    } catch {
      originUrl = null;
    }
    const porcelain = localGit(execFile, root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ]);
    return {
      health: "healthy",
      root: path.resolve(topLevel),
      commitSha,
      branch,
      detached: branch === null,
      dirty: porcelain !== "",
      originUrl,
    };
  } catch (error) {
    return {
      health: "malformed",
      root,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function taskTransactionHealth(paths) {
  let stats;
  try {
    stats = lstatSync(paths.taskTransactions);
  } catch (error) {
    if (error?.code === "ENOENT") return { health: "healthy", pendingCount: 0 };
    return {
      health: "malformed",
      pendingCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return {
      health: "malformed",
      pendingCount: 0,
      reason: "task transaction namespace is unsafe",
    };
  }
  const allEntries = readdirSync(paths.taskTransactions, {
    withFileTypes: true,
  });
  const retirementDirectory = allEntries.find(
    (entry) => entry.name === ".authority-retirements",
  );
  if (
    retirementDirectory &&
    (!retirementDirectory.isDirectory() || retirementDirectory.isSymbolicLink())
  ) {
    return {
      health: "malformed",
      pendingCount: 0,
      reason: "task transaction retirement namespace is unsafe",
    };
  }
  const entries = allEntries
    .filter((entry) => entry.name !== ".authority-retirements")
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const unsafe = entries.filter(
    (entry) =>
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/.test(entry.name),
  );
  if (unsafe.length > 0) {
    return {
      health: "malformed",
      pendingCount: entries.length,
      reason: "task transaction namespace contains an unsafe entry",
    };
  }
  return {
    health: entries.length > 0 ? "stale" : "healthy",
    pendingCount: entries.length,
  };
}

export function readControlStatus({ stateRoot } = {}) {
  const paths = automationControlPaths(stateRoot);
  try {
    const manifestSnapshot = readAutomationAuthorityFileSnapshot(
      paths.taskManifest,
      {
        allowMissing: true,
        allowEmpty: false,
        privateRoot: paths.controlRoot,
        maxBytes: STATUS_FILE_MAX_BYTES,
        allowedModes: [0o600],
        label: "Current task manifest",
        missingCode: "invalid_state",
        invalidCode: "invalid_state",
      },
    );
    if (manifestSnapshot.missing) {
      return {
        health: "unavailable",
        revision: null,
        updatedAt: null,
        taskCount: 0,
        pendingTransactionCount: 0,
        tasks: [],
      };
    }
    const manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestSnapshot.bytes),
    );
    const validated = validateTaskManifest(structuredClone(manifest));
    const transactions = taskTransactionHealth(paths);
    return {
      health: transactions.health,
      revision: validated.revision,
      updatedAt: validated.updatedAt,
      taskCount: validated.tasks.length,
      pendingTransactionCount: transactions.pendingCount,
      tasks: validated.tasks.map((task) => structuredClone(task)),
      ...(transactions.reason ? { reason: transactions.reason } : {}),
    };
  } catch (error) {
    return {
      health: "malformed",
      revision: null,
      updatedAt: null,
      taskCount: 0,
      pendingTransactionCount: 0,
      tasks: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readOutcomeStatus({ stateRoot } = {}) {
  const paths = automationControlPaths(stateRoot);
  const ledgerPath = paths.outcomes;
  try {
    const text = readRegularFile(ledgerPath, { allowMissing: true });
    const eventHistoryText = readRegularFile(paths.events, {
      allowMissing: true,
    });
    if (text === null) {
      return {
        health: "unavailable",
        entryCount: 0,
        canonicalCount: 0,
        legacyCount: 0,
        malformedCount: 0,
        sourceDigest: null,
        latest: null,
        canonicalEntries: [],
      };
    }
    const authenticated = authenticateOutcomeHistorySnapshots({
      stateRoot,
      ledgerPath,
      ledgerText: text,
      eventHistoryText,
      leaseTransactionHistory: inspectLeaseTransactionEventHistory({
        stateRoot,
        events: String(eventHistoryText ?? "")
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          }),
      }),
    });
    const entries = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const canonicalEntries = authenticated.trustedEntries;
    const latest = canonicalEntries.at(-1) ?? entries.at(-1) ?? null;
    return {
      health: authenticated.health,
      entryCount: entries.length,
      canonicalCount: canonicalEntries.length,
      legacyCount: authenticated.legacyCount,
      malformedCount: authenticated.rejectedEntries.length,
      sourceDigest: createHash("sha256").update(text).digest("hex"),
      controlHistoryHealthy: authenticated.sourceHealth.controlHistoryHealthy,
      pendingOutcomeTransitions: authenticated.pendingOutcomeTransitions,
      latest:
        latest === null
          ? null
          : {
              taskId: latest.taskId ?? latest.id ?? null,
              outcome: latest.outcome ?? null,
              ts: latest.ts ?? null,
            },
      canonicalEntries,
    };
  } catch (error) {
    return {
      health: "malformed",
      entryCount: 0,
      canonicalCount: 0,
      legacyCount: 0,
      malformedCount: 1,
      sourceDigest: null,
      latest: null,
      canonicalEntries: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readActorBindingStatus({ repoRoot } = {}) {
  try {
    const specs = validateAutomationSpecs({ repoRoot: path.resolve(repoRoot) });
    return {
      health: "healthy",
      checkedCount: specs.length,
      matchedCount: specs.length,
      actors: specs.map((spec) => ({
        id: spec.id,
        authority: spec.authority,
        providerAuthority: spec.providerBehavior,
        leaseName: spec.lease.name,
        maxLifetimeMs: spec.lease.maxLifetimeMs,
      })),
      drift: [],
    };
  } catch (error) {
    return {
      health: "malformed",
      checkedCount: 0,
      matchedCount: 0,
      actors: [],
      drift: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function safeSoakDirectory(stateRoot, pointerText) {
  const stateSoaks = path.join(path.resolve(stateRoot), "soaks");
  const candidate = path.resolve(pointerText.trim());
  if (
    candidate === stateSoaks ||
    !candidate.startsWith(`${stateSoaks}${path.sep}`)
  ) {
    throw new Error("current soak pointer escapes the canonical soak root");
  }
  const stats = lstatSync(candidate);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    realpathSync(candidate) !== candidate
  ) {
    throw new Error("current soak pointer does not name a real directory");
  }
  return candidate;
}

function captureDirectoryGeneration(directory) {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("expected a real directory generation");
  }
  return {
    dev: stats.dev,
    ino: stats.ino,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}

function directoryGenerationMatches(directory, expected) {
  try {
    const current = captureDirectoryGeneration(directory);
    return (
      current.dev === expected.dev &&
      current.ino === expected.ino &&
      current.mtimeMs === expected.mtimeMs &&
      current.ctimeMs === expected.ctimeMs
    );
  } catch {
    return false;
  }
}

function collectorLifecycle(soakDirectory) {
  const eventsPath = path.join(soakDirectory, "collector-events.jsonl");
  const text = readRegularFile(eventsPath, { allowMissing: true });
  if (text === null) return { status: "unavailable", stoppedAt: null };
  let openSession = false;
  let stoppedAt = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (
      event.event === "collector_session_started" ||
      event.event === "collector_session_restarted"
    ) {
      openSession = true;
    }
    if (event.event === "collector_session_stopped") {
      openSession = false;
      stoppedAt =
        typeof event.iso === "string"
          ? event.iso
          : new Date(Number(event.tsMs)).toISOString();
    }
  }
  return {
    status: openSession ? "collecting" : "stopped",
    stoppedAt,
  };
}

export function readSoakStatus({
  stateRoot,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STABILITY_STATUS_STALE_AFTER_MS,
} = {}) {
  const pointerPath = path.join(path.resolve(stateRoot), "current-soak-dir");
  try {
    const pointer = readRegularFile(pointerPath, { allowMissing: true });
    if (pointer === null || pointer.trim() === "") {
      return {
        model: {
          health: "unavailable",
          maturity: "unavailable",
          soakId: null,
          startedAt: null,
          stoppedAt: null,
          verdict: null,
        },
        directory: null,
      };
    }
    const directory = safeSoakDirectory(stateRoot, pointer);
    const soakRoot = path.join(path.resolve(stateRoot), "soaks");
    const soakRootGeneration = captureDirectoryGeneration(soakRoot);
    const soakGeneration = captureDirectoryGeneration(directory);
    const info = parseJsonFile(path.join(directory, "soak-info.json"));
    if (
      !Number.isFinite(Date.parse(String(info?.startedAt ?? ""))) ||
      info?.schemaVersion !== SOAK_SCHEMA_VERSION
    ) {
      throw new Error("soak-info.json has an unsupported shape");
    }
    const lifecycle = collectorLifecycle(directory);
    const verdict = parseJsonFile(path.join(directory, "soak-verdict.json"), {
      allowMissing: true,
    });
    if (
      verdict !== null &&
      (verdict.schemaVersion !== VERDICT_SCHEMA_VERSION ||
        verdict.metricRegistryVersion !== STABILITY_METRIC_REGISTRY_VERSION ||
        !Number.isFinite(Date.parse(String(verdict.generatedAt ?? ""))) ||
        !new Set(["pass", "fail", "inconclusive"]).has(verdict.status))
    ) {
      throw new Error("soak-verdict.json has an unsupported shape");
    }
    const latestTimestamp =
      lifecycle.stoppedAt ?? verdict?.generatedAt ?? info.startedAt;
    const maturity =
      lifecycle.status === "collecting"
        ? "collecting"
        : verdict === null
          ? "stopped-awaiting-verdict"
          : "verdict-ready";
    if (
      !directoryGenerationMatches(directory, soakGeneration) ||
      !directoryGenerationMatches(soakRoot, soakRootGeneration)
    ) {
      throw new Error("soak namespace changed during status collection");
    }
    return {
      model: {
        health: sourceHealthFromTimestamp(latestTimestamp, nowMs, staleAfterMs),
        maturity,
        soakId: path.basename(directory),
        startedAt: info.startedAt,
        stoppedAt: lifecycle.stoppedAt,
        verdict:
          verdict === null
            ? null
            : {
                status: verdict.status,
                generatedAt: verdict.generatedAt,
                windowStart: verdict.windowStart ?? null,
                windowEnd: verdict.windowEnd ?? null,
                evidenceDigest: verdict.evidenceFingerprint?.digest ?? null,
              },
      },
      directory,
    };
  } catch (error) {
    return {
      model: {
        health: "malformed",
        maturity: "unavailable",
        soakId: null,
        startedAt: null,
        stoppedAt: null,
        verdict: null,
        reason: error instanceof Error ? error.message : String(error),
      },
      directory: null,
    };
  }
}

export function readRuntimeStatus({
  soakDirectory,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STABILITY_STATUS_STALE_AFTER_MS,
} = {}) {
  if (!soakDirectory) {
    return { health: "unavailable", identity: null };
  }
  try {
    const text = readRegularFile(
      path.join(soakDirectory, "runtime-health.jsonl"),
      { allowMissing: true },
    );
    if (text === null) return { health: "unavailable", identity: null };
    const lines = text.split(/\r?\n/).filter(Boolean);
    let identity = null;
    let unattributedCount = 0;
    let mixedBuildIdentity = false;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const event = JSON.parse(lines[index]);
      const timestampMs = Number(event.tsMs);
      if (
        typeof event.appVersion === "string" &&
        /^\d{2}\.\d{1,2}\.\d{3,4}(?:-dev)?$/.test(event.appVersion) &&
        typeof event.buildCommitSha === "string" &&
        /^[0-9a-f]{40}$/.test(event.buildCommitSha) &&
        new Set(["dev", "production"]).has(event.channel) &&
        new Set(["release", "snapshot", "preview", "local"]).has(
          event.buildKind,
        ) &&
        typeof event.appSessionId === "string" &&
        event.appSessionId.trim() !== "" &&
        Number.isSafeInteger(timestampMs) &&
        timestampMs > 0 &&
        timestampMs <= nowMs + 5 * 60 * 1_000
      ) {
        const candidate = {
          version: event.appVersion,
          commitSha: event.buildCommitSha,
          channel: event.channel,
          buildKind: event.buildKind,
          nativeBootId: event.nativeBootId ?? null,
          appSessionId: event.appSessionId,
          observedAt: new Date(timestampMs).toISOString(),
        };
        if (identity === null) {
          identity = candidate;
        } else if (
          identity.version !== candidate.version ||
          identity.commitSha !== candidate.commitSha ||
          identity.channel !== candidate.channel ||
          identity.buildKind !== candidate.buildKind
        ) {
          mixedBuildIdentity = true;
        }
      } else {
        unattributedCount += 1;
      }
    }
    if (identity !== null && mixedBuildIdentity) {
      return {
        health: "malformed",
        identity,
        unattributedCount,
        reason: "runtime health mixes multiple build identities",
      };
    }
    if (identity !== null && unattributedCount > 0) {
      return {
        health: "malformed",
        identity,
        unattributedCount,
        reason:
          "runtime health mixes attributable and unattributed build evidence",
      };
    }
    if (identity === null) {
      return {
        health: "malformed",
        identity: null,
        reason: "runtime health has no complete build identity",
      };
    }
    return {
      health: sourceHealthFromTimestamp(
        identity.observedAt,
        nowMs,
        staleAfterMs,
      ),
      identity,
    };
  } catch (error) {
    return {
      health: "malformed",
      identity: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function selectedExecutionTask(tasks) {
  return tasks
    .filter(
      (task) =>
        ACTIVE_EXECUTION_STATES.has(task.state) &&
        Number.isSafeInteger(task.details?.githubIssue?.number) &&
        typeof task.details?.githubIssue?.url === "string",
    )
    .sort((left, right) => left.taskId.localeCompare(right.taskId, "en"))[0];
}

export function deriveStabilityNextAction(model) {
  if (model.control.health !== "healthy") {
    return {
      id: "repair_control_state",
      taskId: null,
      reason: "atomic task authority is not healthy",
    };
  }
  const selected = selectedExecutionTask(model.control.tasks);
  if (selected) {
    const nonbehavioralStatusRepair =
      selected.behavioral === false &&
      selected.details?.behavioral === false &&
      selected.providerAuthority === "forbidden" &&
      selected.state === "implemented" &&
      selected.taskId === "github-issue-1107";
    if (model.outcomes.health !== "healthy" && !nonbehavioralStatusRepair) {
      return {
        id: "repair_outcome_ledger",
        taskId: null,
        reason:
          "outcome authority must be repaired before executable work can advance",
      };
    }
    if (selected.providerAuthority !== "forbidden") {
      return {
        id: "prepare_provider_approval",
        taskId: selected.taskId,
        reason: "selected work is provider visible and cannot run unattended",
      };
    }
    if (
      selected.behavioral === true &&
      (model.behaviorSlot.status !== "reserved" ||
        model.behaviorSlot.authorizedTaskId !== selected.taskId)
    ) {
      return {
        id: "repair_behavior_authority",
        taskId: selected.taskId,
        reason: "the global behavior gate does not authorize the exact task",
      };
    }
    const actionByState = {
      approved_for_pr: "implement_selected_task",
      implemented: "validate_selected_task",
      validated: "merge_validated_task",
    };
    return {
      id: actionByState[selected.state],
      taskId: selected.taskId,
      issue: selected.details.githubIssue,
      reason: `controller selected task is ${selected.state}`,
    };
  }
  if (model.outcomes.health !== "healthy") {
    return {
      id: "repair_outcome_ledger",
      taskId: null,
      reason:
        "regenerate and approve outcome-ledger.repair, then separately approve the pending outcome.record backfill",
    };
  }
  if (model.behaviorSlot.status === "awaiting-soak-outcome") {
    return {
      id: "await_installed_soak_outcome",
      taskId: model.behaviorSlot.activeTasks[0]?.taskId ?? null,
      reason: "the global behavior slot awaits verifier evidence",
    };
  }
  if (model.artifacts.health === "malformed") {
    return {
      id: "repair_artifact_index",
      taskId: null,
      reason: "artifact namespace contains malformed evidence",
    };
  }
  if (model.actorBindings.health !== "healthy") {
    return {
      id: "repair_actor_binding_contract",
      taskId: null,
      reason: "checked-in actor bindings do not match runtime policy",
    };
  }
  return {
    id: "run_stability_controller",
    taskId: null,
    reason: "no controller-selected execution task is ready",
  };
}

function stableStatusProjection(model) {
  const projection = structuredClone(model);
  delete projection.observedAt;
  delete projection.stableDigest;
  const stripDiagnostics = (value) => {
    if (Array.isArray(value)) {
      value.forEach(stripDiagnostics);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (
        key === "reason" ||
        key === "root" ||
        key === "originUrl" ||
        key === "directory" ||
        key === "observedAt" ||
        key === "nativeBootId" ||
        key === "appSessionId"
      ) {
        delete value[key];
      } else {
        stripDiagnostics(value[key]);
      }
    }
  };
  stripDiagnostics(projection);
  return projection;
}

export function stabilityStatusDigest(model) {
  return createHash("sha256")
    .update(stableJson(stableStatusProjection(model)))
    .digest("hex");
}

export function buildStabilityStatus({
  repoRoot,
  stateRoot,
  artifactRoot = path.join(path.resolve(stateRoot), "artifacts"),
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STABILITY_STATUS_STALE_AFTER_MS,
  readers = {},
} = {}) {
  const repository = (readers.repository ?? readRepositoryStatus)({
    repoRoot,
  });
  const control = (readers.control ?? readControlStatus)({ stateRoot });
  const outcomeRead = (readers.outcomes ?? readOutcomeStatus)({ stateRoot });
  const canonicalOutcomeEntries = outcomeRead.canonicalEntries ?? [];
  const outcomes = { ...outcomeRead };
  delete outcomes.canonicalEntries;
  const actorBindings = (readers.actorBindings ?? readActorBindingStatus)({
    repoRoot,
  });
  const soakResult = (readers.soak ?? readSoakStatus)({
    stateRoot,
    nowMs,
    staleAfterMs,
  });
  const runtime = (readers.runtime ?? readRuntimeStatus)({
    soakDirectory: soakResult.directory,
    nowMs,
    staleAfterMs,
  });
  const artifacts = (
    readers.artifacts ?? ((options) => readStabilityArtifactIndex(options))
  )({ artifactRoot });
  const behaviorGate = buildBehavioralTaskGate(control.tasks, {
    outcomeEntries: canonicalOutcomeEntries,
    pendingOutcomeTransitions: outcomeRead.pendingOutcomeTransitions ?? null,
    outcomeLedgerHealthy: outcomes.health === "healthy",
  });
  const behaviorSlot = {
    status: behaviorGate.status,
    authorizedTaskId: behaviorGate.authorizedTaskId,
    activeTasks: behaviorGate.activeTasks.map((task) => ({
      taskId: task.taskId,
      state: task.state,
    })),
  };
  const model = {
    schemaVersion: STABILITY_STATUS_SCHEMA_VERSION,
    observedAt: new Date(nowMs).toISOString(),
    repository,
    runtime,
    control,
    outcomes,
    behaviorSlot,
    actorBindings,
    soak: soakResult.model,
    artifacts,
    nextAction: null,
  };
  model.nextAction = deriveStabilityNextAction(model);
  model.stableDigest = stabilityStatusDigest(model);
  return model;
}

export function formatStabilityStatus(model) {
  const runtime = model.runtime.identity
    ? `${model.runtime.identity.version} ${model.runtime.identity.channel} ${model.runtime.identity.commitSha.slice(0, 12)}`
    : "unavailable";
  const task = model.nextAction.taskId ? ` for ${model.nextAction.taskId}` : "";
  return [
    "Freed stability status",
    `Repository: ${model.repository.health} at ${model.repository.commitSha ?? "unknown"}`,
    `Runtime: ${model.runtime.health}, ${runtime}`,
    `Control: ${model.control.health}, ${model.control.taskCount.toLocaleString()} tasks`,
    `Outcomes: ${model.outcomes.health}, ${model.outcomes.canonicalCount.toLocaleString()} canonical and ${model.outcomes.legacyCount.toLocaleString()} legacy`,
    `Behavior slot: ${model.behaviorSlot.status}`,
    `Actors: ${model.actorBindings.health}, ${model.actorBindings.matchedCount.toLocaleString()} of ${model.actorBindings.checkedCount.toLocaleString()} matched`,
    `Soak: ${model.soak.health}, ${model.soak.maturity}`,
    `Artifacts: ${model.artifacts.health}, ${model.artifacts.counts.valid.toLocaleString()} valid and ${model.artifacts.counts.unsupported.toLocaleString()} unsupported`,
    `Next: ${model.nextAction.id}${task}`,
    `Stable digest: ${model.stableDigest}`,
  ].join("\n");
}
