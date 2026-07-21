#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import {
  AutomationControlError,
  AUTOMATION_CONTROL_SCHEMA_VERSION,
  AUTOMATION_OUTCOME_STATES,
  automationActorCanRecordOutcome,
  automationControlPaths,
  CONTROL_EVENT_HISTORY_MAX_BYTES,
  CONTROL_EVENT_HISTORY_MAX_RECORDS,
  CONTROL_EVENT_MAX_LINE_BYTES,
  installedOutcomeIdentityMatches,
  inspectExactOutcomeControlHistory,
  inspectLeaseTransactionEventHistory,
  isTaskTransitionAllowed,
  normalizeInstalledBuildIdentity,
  outcomeRecordedEventId,
  outcomeRecordOwnerIntent,
  outcomeReservationEventId,
  ownerGovernanceIntentDigest,
  readAutomationPlanningAdmission,
  readAutomationAuthorityFileSnapshot,
  readTaskManifest,
  validateTaskManifest,
  validateOutcomeLedgerRepairEvent,
  withAutomationPlanningReadBundle,
  withAutomationOutcomeLedgerWriterGuard,
  withMutationLeaseAuthority,
  withOutcomeRecordingGuards,
  writeAutomationAuthorityFile,
} from "./lib/automation-control.mjs";
import {
  canonicalOutcomeDelta,
  canonicalOutcomeNumber,
  OUTCOME_VERDICT_SCHEMA_VERSION as CONVERTER_OUTCOME_VERDICT_SCHEMA_VERSION,
  validateEvidenceFingerprint,
  validateOutcomeVerdictProvenance,
} from "./build-outcome-verdict.mjs";
import { isProviderVisiblePath } from "./lib/provider-visible-paths.mjs";
import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_DECISION_FORMAT,
  OUTCOME_LEDGER_REPAIR_DECISION_REASON_DESCRIPTIONS,
  OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  OUTCOME_LEDGER_REPAIR_MAX_BYTES as OUTCOME_LEDGER_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINES,
  OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
  OUTCOME_LEDGER_REPAIR_PHASES,
  OUTCOME_LEDGER_REPAIR_POLICY,
  OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
  OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
  outcomeLedgerRepairEventId,
  outcomeLedgerRepairOperationSeed,
  prepareOutcomeLedgerAppend,
  requireOutcomeLedgerPhysicalBoundary,
  stableOutcomeRepairJson,
} from "./lib/outcome-ledger-repair-contract.mjs";
import { validateOutcomeLedgerRepairTransactionsFromPlanningBundle } from "./lib/outcome-ledger-repair-validation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_DAILY_BUG_MEMORY =
  "/Users/aubreyfalconer/.codex/automations/daily-bug-scan/memory.md";
const DEFAULT_CRASH_AUTOMATION =
  "/Users/aubreyfalconer/.codex/automations/crash-watch/automation.toml";
const DEFAULT_DEV_BOT_MEMORY =
  "/Users/aubreyfalconer/.codex/automations/hourly-dev-bot/memory.md";
// Planner learning state lives under the home directory so it survives
// reboots; macOS periodically clears /tmp, which made the active-soak pointer
// amnesiac. Its legacy pointer remains copyable for one release. Outcome
// ledgers require an explicit governed migration because they are authority.
export const AUTOMATION_STATE_DIR = path.join(
  os.homedir(),
  ".freed",
  "automation",
);
export const OUTCOME_SCHEMA_VERSION = 3;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OUTCOME_CONTROL_EVENT_APPEND_RESERVATION = 3;
const OUTCOME_REPAIR_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const outcomeRepairDecoder = new TextDecoder("utf-8", { fatal: true });
export const OUTCOME_STATUSES = AUTOMATION_OUTCOME_STATES;
const MEASURED_OUTCOME_STATUSES = new Set([
  "verified_effective",
  "verified_neutral",
  "regressed",
]);
const VERIFICATION_OUTCOME_STATUSES = new Set([
  ...MEASURED_OUTCOME_STATUSES,
  "inconclusive",
]);
const FRESHNESS_GATED_OUTCOME_STATUSES = new Set([
  ...VERIFICATION_OUTCOME_STATUSES,
  "governance_blocked",
  "superseded",
]);
const OUTCOME_EVIDENCE_DIGEST_PATTERN = /^[0-9a-f]{40,64}$/i;
const OUTCOME_CONTROL_EVENT_TYPE = "outcome_recorded";
const AUTHORITY_RETIREMENT_DIRECTORY = ".authority-retirements";
export const OUTCOME_VERDICT_SCHEMA_VERSION =
  CONVERTER_OUTCOME_VERDICT_SCHEMA_VERSION;

const OUTCOME_VERDICT_STATUS = Object.freeze({
  verified_effective: "pass",
  verified_neutral: "pass",
  regressed: "fail",
  inconclusive: "inconclusive",
});
const ACTIVE_BEHAVIOR_TASK_STATES = new Set([
  "approved_for_pr",
  "implemented",
  "validated",
  "merged",
  "installed",
  "soaking",
  "inconclusive",
  "governance_blocked",
]);
const COMPLETED_BEHAVIOR_OUTCOME_STATES = new Set([
  "verified_effective",
  "verified_neutral",
  "regressed",
]);
const RUNNABLE_NIGHTLY_TASK_STATES = new Set([
  "approved_for_pr",
  "implemented",
  "validated",
]);
const NIGHTLY_SUCCESS_PATH_CONTROL_EVENT_NEEDS = Object.freeze({
  approved_for_pr: 5,
  implemented: 4,
  validated: 3,
});
export const DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY = "installed-build-product";
const LEGACY_OUTCOME_ALIASES = {
  shipped: "merged",
  validated: "merged",
  blocked: "governance_blocked",
  failed: "implementation_failed",
};
const LEGACY_SOAK_POINTER = "/tmp/freed-perf-soak/current-soak-dir";
const LEGACY_OUTCOME_LEDGER = "/tmp/freed-nightly-self-improve/outcomes.jsonl";
const DEFAULT_SOAK_POINTER = path.join(
  AUTOMATION_STATE_DIR,
  "current-soak-dir",
);
const DEFAULT_OUTCOME_LEDGER = path.join(
  AUTOMATION_STATE_DIR,
  "outcomes.jsonl",
);
const LEGACY_SOAK_ROOT = "/tmp/freed-perf-soak";
// Ranked task files emitted by scripts/triage.mjs (stability W2-02).
export const DEFAULT_TRIAGE_CANDIDATE_DIR = path.join(
  AUTOMATION_STATE_DIR,
  "triage",
  "candidates",
);
// Triage evidence older than this no longer outranks roadmap work.
const TRIAGE_FRESH_MS = 48 * 60 * 60 * 1000;

export function resolveStatePathWithLegacyFallback(
  preferredPath,
  legacyPath,
  fsOps = {},
) {
  const ops = { existsSync, mkdirSync, copyFileSync, ...fsOps };
  if (ops.existsSync(preferredPath)) {
    return preferredPath;
  }
  if (legacyPath && ops.existsSync(legacyPath)) {
    try {
      ops.mkdirSync(path.dirname(preferredPath), { recursive: true });
      ops.copyFileSync(legacyPath, preferredPath);
      return preferredPath;
    } catch {
      return legacyPath;
    }
  }
  return preferredPath;
}

export function resolveOutcomeLedgerPathWithoutLegacyCopy(
  preferredPath,
  legacyPath,
  fsOps = {},
) {
  const ops = { existsSync, ...fsOps };
  if (ops.existsSync(preferredPath)) return preferredPath;
  if (legacyPath && ops.existsSync(legacyPath)) {
    throw new Error(
      "Legacy outcome ledger migration requires the governed outcome-ledger repair path. Automatic copy is disabled.",
    );
  }
  return preferredPath;
}
const MAX_PEER_EVIDENCE_FILES = 12;
const STALE_SOAK_MS = 2 * 60 * 60 * 1000;
const MIN_PERFORMANCE_SOAK_SAMPLES = 3;
const DEFAULT_MAX_TARGETS = 6;
const DEFAULT_MINIMUM_NIGHT_MINUTES = 180;
const UNATTENDED_APP_INTERACTION_RULES = [
  "Do not stop an unattended run because the next useful validation or testing step needs a Freed Desktop button press.",
  "Use terminal diagnostics and shipped triggers first, including `node scripts/dev-sync-trigger.mjs <provider>` for installed dev-channel provider sync soaks.",
  "If a foreground app click is truly the fastest way to test properly, ask for permission with a 10 minute response window. If the user is unavailable, continue only with already authorized local work. The timeout never grants provider approval or permission for a new external action.",
  "When the same app action is likely to recur, build and ship a terminal trigger instead of depending on System Events, coordinate clicks, Computer Use, or browser automation.",
];
const KNOWN_GENERATED_ARTIFACT_PATHS = [
  "packages/desktop/playwright-report",
  "packages/desktop/test-results",
  "packages/desktop/.playwright-mcp",
];

const GIB = 1024 * 1024 * 1024;
const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function usage() {
  return `Usage:
  node scripts/nightly-self-improve.mjs [options]

Options:
  --repo <path>                 Repo to inspect. Defaults to the current Freed checkout.
  --run-dir <path>              Directory for generated nightly plan files.
  --soak-dir <path>             Installed-build soak directory to inspect.
  --soak-pointer <path>         Pointer file for the active installed-build soak.
  --repair-soak-pointer         Point an empty or unreadable active soak at the newest readable soak.
  --daily-bug-memory <path>     Daily bug scan memory file to fold into target selection.
  --peer-worktree <path>        Extra local worktree to compare and rank as a peer target.
  --no-peer-scan                Skip automatic git worktree discovery.
  --expected-branch <name>      Branch expected for nightly planning. Defaults to dev.
  --no-expected-branch          Disable branch expectation checks for deliberate diagnostics.
  --outcome-ledger <path>       Canonical JSONL ledger. Must equal <automation-state-root>/outcomes.jsonl.
  --automation-state-root <path>  Canonical control root. Defaults to ~/.freed/automation.
  --record-outcome <id>         Append a finished target outcome to the outcome ledger.
  --record-task-id <id>         Canonical control task for --record-outcome.
  --record-kind <kind>          Target kind for --record-outcome.
  --record-status <status>      Outcome state from the versioned outcome contract.
  --record-notes <text>         Notes for --record-outcome.
  --record-pr <number>          Pull request number or URL for --record-outcome.
  --record-build <version>      Installed build version for an installed outcome.
  --record-build-commit-sha <sha>  Installed build's full commit SHA.
  --record-build-channel <channel> Installed build channel, dev or production.
  --record-artifact-digest <sha256> Optional installed artifact digest.
  --record-actor <actor>        Authenticated automation actor for --record-outcome.
  --record-lease-name <name>    Canonical live lease for --record-outcome.
  --record-lease-token <token>  Token for the canonical live lease.
  --record-evidence-digest <d>  Git or SHA-256 digest for the outcome evidence.
  --record-verdict-reference <r>  JSON verdict path required for verification outcomes.
  --record-evidence-window-end <iso>  Evidence window used for freshness.
  --max-targets <count>         Maximum targets to select. Defaults to 6.
  --duration-minutes <count>    Planning budget for one night. Defaults to 480.
  --minimum-night-minutes <n>   Keep batching safe work until at least this many machine minutes are queued. Defaults to 180.
  --memory-gib <count>          WebKit RSS budget before memory work wins. Defaults to 2.5.
  Provider-visible targets are never executable in the unattended nightly lane.
  --dry-run                     Print the plan without writing files.
  --json                        Print JSON instead of a text summary.
  --help                        Show this help.
`;
}

export function parseArgs(argv) {
  let outcomeLedgerProvided = false;
  const args = {
    repo: process.cwd(),
    runDir: "",
    runDirProvided: false,
    soakDir: "",
    soakPointer: DEFAULT_SOAK_POINTER,
    repairSoakPointer: false,
    dailyBugMemory: DEFAULT_DAILY_BUG_MEMORY,
    crashAutomation: DEFAULT_CRASH_AUTOMATION,
    devBotMemory: DEFAULT_DEV_BOT_MEMORY,
    outcomeLedger: "",
    automationStateRoot:
      process.env.FREED_AUTOMATION_STATE_ROOT ?? AUTOMATION_STATE_DIR,
    recordOutcome: "",
    recordTaskId: "",
    recordKind: "",
    recordStatus: "merged",
    recordNotes: "",
    recordPr: "",
    recordBuild: "",
    recordBuildCommitSha: "",
    recordBuildChannel: "",
    recordArtifactDigest: "",
    recordActor: "",
    recordLeaseName: "",
    recordLeaseToken: "",
    recordEvidenceDigest: "",
    recordVerdictReference: "",
    recordEvidenceWindowEnd: "",
    peerWorktrees: [],
    peerScan: true,
    expectedBranch: "dev",
    maxTargets: DEFAULT_MAX_TARGETS,
    durationMinutes: 480,
    minimumNightMinutes: DEFAULT_MINIMUM_NIGHT_MINUTES,
    memoryGib: 2.5,
    allowProviderVisible: false,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--repo":
        args.repo = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--run-dir":
        args.runDir = argv[index + 1] ?? "";
        args.runDirProvided = true;
        index += 1;
        break;
      case "--soak-dir":
        args.soakDir = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--soak-pointer":
        args.soakPointer = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--repair-soak-pointer":
        args.repairSoakPointer = true;
        break;
      case "--daily-bug-memory":
        args.dailyBugMemory = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--peer-worktree":
        args.peerWorktrees.push(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--no-peer-scan":
        args.peerScan = false;
        break;
      case "--expected-branch":
        args.expectedBranch = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--no-expected-branch":
        args.expectedBranch = "";
        break;
      case "--outcome-ledger":
        args.outcomeLedger = argv[index + 1] ?? "";
        outcomeLedgerProvided = true;
        index += 1;
        break;
      case "--automation-state-root":
        args.automationStateRoot = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-outcome":
        args.recordOutcome = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-kind":
        args.recordKind = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-task-id":
        args.recordTaskId = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-status":
        args.recordStatus = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-notes":
        args.recordNotes = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-pr":
        args.recordPr = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-build":
        args.recordBuild = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-build-commit-sha":
        args.recordBuildCommitSha = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-build-channel":
        args.recordBuildChannel = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-artifact-digest":
        args.recordArtifactDigest = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-actor":
        args.recordActor = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-lease-name":
        args.recordLeaseName = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-lease-token":
        args.recordLeaseToken = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-evidence-digest":
        args.recordEvidenceDigest = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-verdict-reference":
        args.recordVerdictReference = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--record-evidence-window-end":
        args.recordEvidenceWindowEnd = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--max-targets":
        args.maxTargets = Number.parseInt(argv[index + 1] ?? "", 10);
        index += 1;
        break;
      case "--duration-minutes":
        args.durationMinutes = Number.parseInt(argv[index + 1] ?? "", 10);
        index += 1;
        break;
      case "--minimum-night-minutes":
        args.minimumNightMinutes = Number.parseInt(argv[index + 1] ?? "", 10);
        index += 1;
        break;
      case "--memory-gib":
        args.memoryGib = Number.parseFloat(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--allow-provider-visible":
        throw new Error(
          "--allow-provider-visible was removed. Use the authenticated provider review lane.",
        );
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unexpected argument '${arg}'.\n\n${usage()}`);
    }
  }

  if (args.help) {
    return args;
  }

  if (!args.repo) {
    throw new Error("A repo path is required.");
  }
  if (!args.soakPointer) {
    throw new Error("A soak pointer path is required.");
  }
  if (!args.automationStateRoot) {
    throw new Error("An automation state root is required.");
  }
  if (args.expectedBranch && /\s/.test(args.expectedBranch)) {
    throw new Error("expected-branch must not contain whitespace.");
  }
  if (args.repairSoakPointer && args.soakDir) {
    throw new Error(
      "repair-soak-pointer cannot be combined with an explicit soak-dir.",
    );
  }
  if (args.recordOutcome) {
    if (!args.recordKind) {
      throw new Error("record-kind is required when record-outcome is set.");
    }
    if (!OUTCOME_STATUSES.includes(args.recordStatus)) {
      throw new Error(
        `record-status must be one of: ${OUTCOME_STATUSES.join(", ")}.`,
      );
    }
    if (!args.recordActor || !args.recordLeaseName || !args.recordLeaseToken) {
      throw new Error(
        "record-outcome requires record-actor, record-lease-name, and record-lease-token.",
      );
    }
    if (!args.recordTaskId && args.recordKind === "task") {
      args.recordTaskId = args.recordOutcome;
    }
    if (!args.recordTaskId) {
      throw new Error("record-task-id is required for non-task outcome ids.");
    }
    if (!args.recordEvidenceDigest && !args.recordVerdictReference) {
      throw new Error(
        "record-outcome requires record-evidence-digest or record-verdict-reference.",
      );
    }
    const buildIdentityProvided =
      args.recordBuild ||
      args.recordBuildCommitSha ||
      args.recordBuildChannel ||
      args.recordArtifactDigest;
    if (args.recordStatus === "installed") {
      if (
        !args.recordBuild ||
        !args.recordBuildCommitSha ||
        !args.recordBuildChannel
      ) {
        throw new Error(
          "installed recording requires record-build, record-build-commit-sha, and record-build-channel.",
        );
      }
    } else if (buildIdentityProvided) {
      throw new Error(
        "record-build identity flags are valid only for installed outcomes.",
      );
    }
  }
  if (!Number.isFinite(args.maxTargets) || args.maxTargets < 1) {
    throw new Error("maxTargets must be at least 1.");
  }
  if (!Number.isFinite(args.durationMinutes) || args.durationMinutes < 30) {
    throw new Error("durationMinutes must be at least 30.");
  }
  if (
    !Number.isFinite(args.minimumNightMinutes) ||
    args.minimumNightMinutes < 30
  ) {
    throw new Error("minimumNightMinutes must be at least 30.");
  }
  if (args.minimumNightMinutes > args.durationMinutes) {
    throw new Error(
      "minimumNightMinutes must be less than or equal to durationMinutes.",
    );
  }
  if (!Number.isFinite(args.memoryGib) || args.memoryGib <= 0) {
    throw new Error("memoryGib must be greater than 0.");
  }

  args.repo = path.resolve(args.repo);
  args.automationStateRoot = path.resolve(args.automationStateRoot);
  if (args.soakPointer === DEFAULT_SOAK_POINTER) {
    args.soakPointer = resolveStatePathWithLegacyFallback(
      DEFAULT_SOAK_POINTER,
      LEGACY_SOAK_POINTER,
    );
  }
  const canonicalOutcomeLedger = automationControlPaths(
    args.automationStateRoot,
  ).outcomes;
  if (!outcomeLedgerProvided) {
    args.outcomeLedger =
      canonicalOutcomeLedger === DEFAULT_OUTCOME_LEDGER
        ? resolveOutcomeLedgerPathWithoutLegacyCopy(
            DEFAULT_OUTCOME_LEDGER,
            LEGACY_OUTCOME_LEDGER,
          )
        : canonicalOutcomeLedger;
  }
  args.soakPointer = path.resolve(args.soakPointer);
  args.outcomeLedger = path.resolve(args.outcomeLedger);
  if (args.outcomeLedger !== canonicalOutcomeLedger) {
    throw new Error(
      `outcome-ledger must equal the canonical state-root ledger at ${canonicalOutcomeLedger}.`,
    );
  }
  args.peerWorktrees = args.peerWorktrees
    .filter(Boolean)
    .map((item) => path.resolve(item));
  args.runDir =
    args.runDir ||
    path.join(
      AUTOMATION_STATE_DIR,
      "runs",
      new Date().toISOString().replace(/[:.]/g, ""),
    );

  return args;
}

function readText(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return "";
  }
  return readFileSync(filePath, "utf8");
}

function parseJsonLinesWithHealth(text, { exists }) {
  const entries = [];
  const records = [];
  const malformedLines = [];
  if (!exists) {
    return {
      entries,
      records,
      exists: false,
      healthy: false,
      malformedLines,
    };
  }
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      const allowedEmptyFile = text.length === 0 && index === 0;
      const allowedFinalNewline =
        line === "" && index === lines.length - 1 && /\r?\n$/.test(text);
      if (!allowedEmptyFile && !allowedFinalNewline) {
        malformedLines.push(index + 1);
        records.push({ lineNumber: index + 1, entry: null, malformed: true });
      }
      continue;
    }
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
      records.push({ lineNumber: index + 1, entry, malformed: false });
    } catch {
      malformedLines.push(index + 1);
      records.push({ lineNumber: index + 1, entry: null, malformed: true });
    }
  }
  return {
    entries,
    records,
    exists: true,
    healthy: malformedLines.length === 0,
    malformedLines,
  };
}

function readJsonLinesWithHealth(filePath) {
  const exists = Boolean(filePath && existsSync(filePath));
  return parseJsonLinesWithHealth(exists ? readText(filePath) : "", {
    exists,
  });
}

function readJsonLines(filePath) {
  return readJsonLinesWithHealth(filePath).entries;
}

function countFiles(dirPath, limit = 500) {
  if (!dirPath || !existsSync(dirPath)) {
    return 0;
  }

  let count = 0;
  const pending = [dirPath];
  while (pending.length > 0 && count < limit) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        pending.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        count += 1;
      }
      if (count >= limit) {
        break;
      }
    }
  }
  return count;
}

function parseTimestampMs(value) {
  if (!value) {
    return null;
  }
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function readAutomationStatus(filePath) {
  const text = readText(filePath);
  const match = text.match(/^\s*status\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? "";
}

function outcomeEvidence(entry) {
  const digest = String(entry?.evidence?.digest ?? entry?.evidenceDigest ?? "")
    .trim()
    .toLowerCase();
  const verdictReference = String(
    entry?.evidence?.verdictReference ?? entry?.verdictReference ?? "",
  ).trim();
  const verdictFingerprint = String(
    entry?.evidence?.verdictFingerprint ?? entry?.verdictFingerprint ?? "",
  )
    .trim()
    .toLowerCase();
  if (!digest && !verdictReference) {
    throw new Error(
      "Outcome recording requires an evidence digest or verdict reference.",
    );
  }
  if (digest && !OUTCOME_EVIDENCE_DIGEST_PATTERN.test(digest)) {
    throw new Error(
      "Outcome evidence digest must be a 40 to 64 character hexadecimal digest.",
    );
  }
  if (verdictFingerprint && !/^[0-9a-f]{64}$/.test(verdictFingerprint)) {
    throw new Error(
      "Outcome verdict fingerprint must be a 64 character hexadecimal digest.",
    );
  }
  return {
    ...(digest ? { digest } : {}),
    ...(verdictReference ? { verdictReference } : {}),
    ...(verdictFingerprint ? { verdictFingerprint } : {}),
  };
}

function normalizeOutcomeEffect(effect, field = "Outcome effect") {
  if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
    throw new Error(
      `${field} requires metric, before, after, delta, and unit.`,
    );
  }
  const metric = String(effect.metric ?? "").trim();
  const before = canonicalOutcomeNumber(effect.before);
  const after = canonicalOutcomeNumber(effect.after);
  const delta = canonicalOutcomeNumber(
    effect.delta ?? canonicalOutcomeDelta(before, after),
  );
  const derivedDelta = canonicalOutcomeDelta(before, after);
  const unit = String(effect.unit ?? "").trim();
  if (
    !metric ||
    !Number.isFinite(before) ||
    !Number.isFinite(after) ||
    !Number.isFinite(delta) ||
    delta !== derivedDelta ||
    !unit
  ) {
    throw new Error(
      `${field} requires exact finite values and delta must equal after minus before.`,
    );
  }
  return { metric, before, after, delta, unit };
}

function resolveOutcomeEvidence(entry) {
  const normalized = outcomeEvidence(entry);
  if (!VERIFICATION_OUTCOME_STATUSES.has(entry.outcome)) {
    if (entry.effect !== undefined) {
      throw new Error(
        "Only measured verification outcomes may record an effect.",
      );
    }
    return { evidence: normalized, verdict: null, effect: null };
  }
  if (!normalized.verdictReference) {
    throw new Error(
      "A verification outcome requires a resolvable verdict file reference.",
    );
  }
  let verdictPath;
  try {
    verdictPath = realpathSync(path.resolve(normalized.verdictReference));
  } catch {
    throw new Error(
      `Outcome verdict reference does not resolve: ${normalized.verdictReference}`,
    );
  }
  const verdictText = readFileSync(verdictPath, "utf8");
  const verdictDigest = createHash("sha256").update(verdictText).digest("hex");
  if (normalized.digest && normalized.digest !== verdictDigest) {
    throw new Error(
      "Outcome evidence digest does not match the referenced verdict file.",
    );
  }
  let verdict;
  try {
    verdict = JSON.parse(verdictText);
  } catch {
    throw new Error("Outcome verdict reference must contain valid JSON.");
  }
  const expectedStatus = OUTCOME_VERDICT_STATUS[entry.outcome];
  if (
    verdict?.schemaVersion !== OUTCOME_VERDICT_SCHEMA_VERSION ||
    verdict?.outcome !== entry.outcome ||
    verdict?.status !== expectedStatus ||
    verdict?.pass !== (expectedStatus === "pass") ||
    verdict?.taskId !== entry.taskId
  ) {
    throw new Error(
      "Outcome verdict schema, task, status, and outcome must exactly match the recorded outcome.",
    );
  }
  validateOutcomeVerdictProvenance(verdict);
  const verdictWindowStartMs = Date.parse(String(verdict?.windowStart ?? ""));
  const verdictWindowEndMs = Date.parse(String(verdict?.windowEnd ?? ""));
  const evidenceWindowEndMs = Date.parse(String(entry.evidenceWindowEnd ?? ""));
  if (
    !Number.isFinite(verdictWindowStartMs) ||
    !Number.isFinite(verdictWindowEndMs) ||
    verdictWindowStartMs >= verdictWindowEndMs ||
    !Number.isFinite(evidenceWindowEndMs) ||
    verdictWindowEndMs !== evidenceWindowEndMs
  ) {
    throw new Error(
      "Outcome evidence window end must match the referenced verdict.",
    );
  }
  const observedBuildIdentity = normalizeInstalledBuildIdentity(
    verdict?.buildIdentity,
    "verdict.buildIdentity",
  );
  const observedBuild = observedBuildIdentity.version;
  const verdictFingerprint = validateEvidenceFingerprint(
    verdict?.evidenceFingerprint,
    "Outcome verdict",
  ).digest;
  if (
    MEASURED_OUTCOME_STATUSES.has(entry.outcome) &&
    (verdict?.sourceHealth?.healthy !== true ||
      verdict?.sourceHealth?.status !== "healthy")
  ) {
    throw new Error(
      "A measured verification outcome requires a healthy verdict source.",
    );
  }
  let effect = null;
  if (MEASURED_OUTCOME_STATUSES.has(entry.outcome)) {
    effect = normalizeOutcomeEffect(verdict.effect, "Outcome verdict effect");
    if (entry.effect !== undefined) {
      throw new Error(
        "Recorded effects are derived from the referenced verdict, not caller input.",
      );
    }
  } else if (entry.effect !== undefined || verdict.effect !== undefined) {
    throw new Error("Inconclusive outcomes must not claim a measured effect.");
  }
  return {
    evidence: {
      digest: verdictDigest,
      verdictReference: verdictPath,
      verdictFingerprint,
    },
    verdict: {
      windowStartMs: verdictWindowStartMs,
      windowEndMs: verdictWindowEndMs,
      build: observedBuild,
      buildIdentity: observedBuildIdentity,
      status: verdict.status,
      outcome: verdict.outcome,
    },
    effect,
  };
}

function outcomeEntryDigest(entry) {
  const { authentication: _authentication, ...digestible } = entry;
  return createHash("sha256").update(JSON.stringify(digestible)).digest("hex");
}

function isOutcomeReservationEvent(event) {
  return (
    event?.type === "outcome_reservation_created" &&
    event?.data?.outcomeBackfill === true &&
    event?.data?.outcomeRequired === true &&
    typeof event?.data?.legacyTransitionEventId === "string"
  );
}

function isOutcomeTransitionEvent(event) {
  return (
    event?.type === "task_transitioned" || isOutcomeReservationEvent(event)
  );
}

function trustedOutcomeEventHistoryFromSource(
  source,
  ledgerPath,
  stateRoot = path.dirname(path.resolve(ledgerPath)),
  controlEventPhysicalBoundaryIssue = null,
  admittedLeaseTransactions = null,
) {
  const physicalLineIssues =
    controlEventPhysicalBoundaryIssue === null
      ? []
      : [controlEventPhysicalBoundaryIssue];
  const entries = source.records.map((record, index) => {
    const expectedLineNumber = index + 1;
    if (record.lineNumber !== expectedLineNumber) {
      physicalLineIssues.push(
        `control event parser record ${expectedLineNumber.toLocaleString()} reports physical line ${Number(record.lineNumber).toLocaleString()}`,
      );
    }
    return record.malformed ? null : record.entry;
  });
  const inspection = inspectExactOutcomeControlHistory(entries, { ledgerPath });
  const leaseTransactions =
    admittedLeaseTransactions ??
    inspectLeaseTransactionEventHistory({
      stateRoot,
      events: entries,
    });
  const identityIssues = [
    ...physicalLineIssues,
    ...inspection.issues,
    ...leaseTransactions.issues,
  ];
  const trustedSource = {
    ...source,
    healthy:
      source.healthy &&
      inspection.healthy &&
      leaseTransactions.healthy &&
      identityIssues.length === 0,
    identityIssues,
    leaseTransactionsHealthy: leaseTransactions.healthy,
    leaseTransactionIssues: leaseTransactions.issues,
    retainedLeaseReceiptCount: leaseTransactions.retainedReceiptCount,
    pendingLeaseTransactionArtifactCount:
      leaseTransactions.pendingTransactionArtifactCount,
  };
  const requiredPinnedLegacyOutcomeEventIds = new Set(
    inspection.requiredPinnedLegacyOutcomeEventIds,
  );
  const pinnedLegacyOutcomeEventsByTransitionId = new Map();
  for (const eventId of requiredPinnedLegacyOutcomeEventIds) {
    const event = inspection.outcomes.get(eventId);
    const transitionEventId = event?.data?.transitionEventId;
    if (typeof transitionEventId !== "string") continue;
    pinnedLegacyOutcomeEventsByTransitionId.set(transitionEventId, {
      controlEventId: eventId,
      outcomeDigest: event.data.outcomeDigest,
      taskId: event.taskId,
      taskRevision: event.data.taskRevision,
    });
  }
  return {
    source: trustedSource,
    recordsByEventId: inspection.recordsByEventId,
    outcomes: inspection.outcomes,
    transitions: inspection.transitions,
    requiredPinnedLegacyOutcomeEventIds,
    pinnedLegacyOutcomeEventsByTransitionId,
  };
}

function readOutcomeControlBytes(
  filePath,
  maxBytes = 1024 * 1024,
  { allowReadonlyGroupWorld = false } = {},
) {
  const authoritySnapshot = readAutomationAuthorityFileSnapshot(filePath, {
    allowMissing: true,
    allowEmpty: true,
    privateRoot: path.dirname(filePath),
    maxBytes,
    allowedModes: allowReadonlyGroupWorld ? [0o600, 0o640, 0o644] : [0o600],
    label: "Outcome control file",
  });
  if (authoritySnapshot.missing) {
    return {
      bytes: Buffer.alloc(0),
      stats: null,
      authoritySnapshot,
      missing: true,
    };
  }
  return {
    bytes: authoritySnapshot.bytes,
    stats: { ...authoritySnapshot.identity },
    authoritySnapshot,
    missing: false,
  };
}

function readOutcomeJsonLinesSnapshot(
  filePath,
  {
    sourceText = undefined,
    sourceStats = null,
    maxBytes,
    allowReadonlyGroupWorld = false,
    label,
  },
) {
  let bytes;
  let stats = sourceStats;
  let authoritySnapshot = null;
  if (sourceText !== undefined) {
    bytes = Buffer.isBuffer(sourceText)
      ? Buffer.from(sourceText)
      : Buffer.from(String(sourceText), "utf8");
  } else {
    try {
      const snapshot = readOutcomeControlBytes(filePath, maxBytes, {
        allowReadonlyGroupWorld,
      });
      if (snapshot.missing) {
        return {
          bytes: Buffer.alloc(0),
          stats: null,
          authoritySnapshot: snapshot.authoritySnapshot,
          source: parseJsonLinesWithHealth("", { exists: false }),
          missing: true,
          issue: `${label} is unavailable.`,
        };
      }
      bytes = snapshot.bytes;
      stats = snapshot.stats;
      authoritySnapshot = snapshot.authoritySnapshot;
    } catch (error) {
      return {
        bytes: Buffer.alloc(0),
        stats: null,
        authoritySnapshot: null,
        source: parseJsonLinesWithHealth("{", { exists: true }),
        missing: false,
        issue: `${label} safe read failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  try {
    return {
      bytes,
      stats,
      authoritySnapshot,
      source: parseJsonLinesWithHealth(outcomeRepairDecoder.decode(bytes), {
        exists: true,
      }),
      missing: false,
      issue: null,
    };
  } catch {
    return {
      bytes,
      stats,
      authoritySnapshot,
      source: parseJsonLinesWithHealth("{", { exists: true }),
      missing: false,
      issue: `${label} is not valid UTF-8.`,
    };
  }
}

function readCanonicalOutcomeEventSnapshot(stateRoot, sourceText = undefined) {
  const root = path.resolve(stateRoot);
  const paths = automationControlPaths(root);
  try {
    requireOutcomeRepairPrivateDescendants(root, paths.controlRoot);
  } catch (error) {
    return rejectedOutcomeJsonLinesSnapshot("Control event history", error);
  }
  return readOutcomeJsonLinesSnapshot(paths.events, {
    sourceText,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
    label: "Control event history",
  });
}

function rejectedOutcomeJsonLinesSnapshot(label, error) {
  return {
    bytes: Buffer.alloc(0),
    stats: null,
    authoritySnapshot: null,
    source: parseJsonLinesWithHealth("{", { exists: true }),
    missing: false,
    issue: `${label} safe read failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

function readCanonicalOutcomeSnapshots(
  stateRoot,
  ledgerPath,
  {
    ledgerText = undefined,
    ledgerStats = null,
    eventHistoryText = undefined,
    eventHistoryStats = null,
  } = {},
) {
  const root = path.resolve(stateRoot);
  const paths = automationControlPaths(root);
  try {
    if (path.resolve(ledgerPath) !== paths.outcomes) {
      throw new Error(
        "Outcome ledger path is not canonical for the state root.",
      );
    }
    requireOutcomeRepairPrivateDescendants(root, paths.controlRoot);
  } catch (error) {
    return {
      ledger: rejectedOutcomeJsonLinesSnapshot("Outcome ledger", error),
      events: rejectedOutcomeJsonLinesSnapshot("Control event history", error),
    };
  }
  return {
    ledger: readOutcomeJsonLinesSnapshot(paths.outcomes, {
      sourceText: ledgerText,
      sourceStats: ledgerStats,
      maxBytes: OUTCOME_LEDGER_MAX_BYTES,
      allowReadonlyGroupWorld: true,
      label: "Outcome ledger",
    }),
    events: readOutcomeJsonLinesSnapshot(paths.events, {
      sourceText: eventHistoryText,
      sourceStats: eventHistoryStats,
      maxBytes: 128 * 1024 * 1024,
      label: "Control event history",
    }),
  };
}

function outcomePlanningSnapshot(filePath, admission, label) {
  if (admission.missing) {
    return {
      bytes: Buffer.alloc(0),
      stats: null,
      authoritySnapshot: null,
      source: parseJsonLinesWithHealth("", { exists: false }),
      missing: true,
      issue: `${label} is unavailable.`,
    };
  }
  return readOutcomeJsonLinesSnapshot(filePath, {
    sourceText: admission.text,
    sourceStats: admission.identity,
    maxBytes:
      label === "Outcome ledger"
        ? OUTCOME_LEDGER_MAX_BYTES
        : CONTROL_EVENT_HISTORY_MAX_BYTES,
    allowReadonlyGroupWorld: label === "Outcome ledger",
    label,
  });
}

function outcomeSnapshotsFromPlanningBundle(bundle) {
  const paths = automationControlPaths(bundle.stateRoot);
  if (paths.outcomes !== bundle.ledgerPath) {
    throw new Error(
      "Automation planning bundle has a noncanonical outcome ledger path.",
    );
  }
  return {
    ledger: outcomePlanningSnapshot(
      paths.outcomes,
      bundle.outcomeLedger,
      "Outcome ledger",
    ),
    events: outcomePlanningSnapshot(
      paths.events,
      bundle.controlEventHistory,
      "Control event history",
    ),
  };
}

function requireOutcomeRepairPrivateDescendants(stateRoot, targetPath) {
  const relative = path.relative(stateRoot, targetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Outcome ledger repair artifact path escapes state root.");
  }
  const expectedUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  const rootStats = lstatSync(stateRoot);
  if (
    !rootStats.isDirectory() ||
    rootStats.isSymbolicLink() ||
    (expectedUid !== null && rootStats.uid !== expectedUid) ||
    (rootStats.mode & 0o777) !== 0o700 ||
    realpathSync(stateRoot) !== stateRoot
  ) {
    throw new Error("Outcome ledger repair state root is unsafe.");
  }
  let current = stateRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stats = lstatSync(current);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (expectedUid !== null && stats.uid !== expectedUid) ||
      (stats.mode & 0o777) !== 0o700 ||
      realpathSync(current) !== current
    ) {
      throw new Error(
        `Outcome ledger repair artifact directory is unsafe: ${current}`,
      );
    }
  }
}

function exactOutcomeControlEventMatchesEntry({
  entry,
  ledgerPath,
  event,
  evidence,
  authentication,
  outcomeDigest,
}) {
  if (!event || typeof event !== "object") return false;
  const expected = {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId: event.eventId,
    type: OUTCOME_CONTROL_EVENT_TYPE,
    ts: event.ts,
    actor: authentication.actor,
    taskId: entry.taskId,
    data: outcomeRecordedEventData({
      cleanEntry: entry,
      taskId: entry.taskId,
      taskRevision: authentication.taskRevision,
      taskState: entry.outcome,
      ledgerPath,
      leaseName: authentication.leaseName,
      evidence,
      outcomeDigest,
      transitionEventId: authentication.transitionEventId,
    }),
  };
  return stableOutcomeRepairJson(event) === stableOutcomeRepairJson(expected);
}

function authenticateOutcomeEntry(
  entry,
  ledgerPath,
  eventHistory,
  consumedEventIds,
  consumedOutcomeKeys,
) {
  const authentication = entry?.authentication;
  if (
    entry?.schemaVersion !== OUTCOME_SCHEMA_VERSION ||
    !authentication ||
    typeof authentication !== "object" ||
    typeof authentication.controlEventId !== "string" ||
    typeof authentication.actor !== "string" ||
    typeof authentication.leaseName !== "string" ||
    typeof authentication.outcomeDigest !== "string" ||
    typeof authentication.transitionEventId !== "string" ||
    !Number.isInteger(authentication.taskRevision) ||
    typeof entry?.taskId !== "string" ||
    !OUTCOME_STATUSES.includes(entry?.outcome) ||
    !automationActorCanRecordOutcome(authentication.actor, entry?.outcome)
  ) {
    return {
      trusted: false,
      reason: "missing authenticated outcome provenance",
    };
  }
  if (!eventHistory.source.healthy) {
    return {
      trusted: false,
      reason: "control event history is missing or malformed",
    };
  }
  if (consumedEventIds.has(authentication.controlEventId)) {
    return { trusted: false, reason: "replayed outcome control event" };
  }
  let evidence;
  try {
    evidence = outcomeEvidence(entry);
  } catch (error) {
    return {
      trusted: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const outcomeKey = JSON.stringify({
    taskId: entry.taskId,
    outcome: entry.outcome,
    evidence,
  });
  if (consumedOutcomeKeys.has(outcomeKey)) {
    return { trusted: false, reason: "replayed task outcome evidence" };
  }
  const event = eventHistory.outcomes.get(authentication.controlEventId);
  const transitionEvent = eventHistory.transitions.get(
    authentication.transitionEventId,
  );
  const pinnedLegacyOutcome =
    eventHistory.pinnedLegacyOutcomeEventsByTransitionId.get(
      authentication.transitionEventId,
    );
  const reservationEvent = isOutcomeReservationEvent(transitionEvent);
  const legacyReservationRecords = reservationEvent
    ? (eventHistory.recordsByEventId.get(
        transitionEvent.data.legacyTransitionEventId,
      ) ?? [])
    : [];
  const legacyReservationTransition = legacyReservationRecords[0]?.entry;
  let validLegacyReservationEdge = false;
  if (
    typeof legacyReservationTransition?.data?.fromState === "string" &&
    typeof legacyReservationTransition?.data?.toState === "string"
  ) {
    try {
      validLegacyReservationEdge = isTaskTransitionAllowed(
        legacyReservationTransition.data.fromState,
        legacyReservationTransition.data.toState,
      );
    } catch {
      validLegacyReservationEdge = false;
    }
  }
  const validLegacyReservation =
    !reservationEvent ||
    (legacyReservationRecords.length === 1 &&
      legacyReservationTransition?.type === "task_transitioned" &&
      legacyReservationTransition.taskId === entry.taskId &&
      legacyReservationTransition.taskRevision + 1 ===
      authentication.taskRevision &&
      legacyReservationTransition.data?.toState === entry.outcome &&
      validLegacyReservationEdge &&
      legacyReservationTransition.data?.outcomeDigest === undefined &&
      legacyReservationTransition.data?.outcomeRequired === undefined);
  const validInstalledTransitionIdentity = installedOutcomeIdentityMatches({
    outcome: entry.outcome,
    build: entry.build,
    buildIdentity: entry.buildIdentity,
    transitionEvent,
  });
  const validLegacyInstalledIdentity =
    !reservationEvent ||
    (installedOutcomeIdentityMatches({
      outcome: entry.outcome,
      build: entry.build,
      buildIdentity: entry.buildIdentity,
      transitionEvent: legacyReservationTransition,
    }) &&
      (entry.outcome !== "installed" ||
        legacyReservationTransition?.data?.installedAt ===
          transitionEvent.data?.installedAt));
  const digest = outcomeEntryDigest(entry);
  const requiresDeterministicControlEvent =
    pinnedLegacyOutcome !== undefined ||
    reservationEvent ||
    transitionEvent?.data?.outcomeRequired === true;
  const deterministicControlEventId = outcomeRecordedEventId({
    taskId: entry.taskId,
    taskRevision: authentication.taskRevision,
    outcomeDigest: digest,
    transitionEventId: authentication.transitionEventId,
  });
  const exactOutcomeEvent = exactOutcomeControlEventMatchesEntry({
    entry,
    ledgerPath,
    event,
    evidence,
    authentication,
    outcomeDigest: digest,
  });
  const canonicalReservationLink =
    !reservationEvent ||
    (transitionEvent.observerAuthority ===
        legacyReservationTransition?.observerAuthority &&
      transitionEvent.providerAuthority ===
        legacyReservationTransition?.providerAuthority &&
      transitionEvent.providerApprovalReference ===
        legacyReservationTransition?.providerApprovalReference &&
      transitionEvent.manifestRevision >
        legacyReservationTransition?.manifestRevision &&
      (entry.outcome !== "merged" ||
        transitionEvent.data?.mergedAt ===
          legacyReservationTransition?.data?.mergedAt));
  if (
    !event ||
    (pinnedLegacyOutcome !== undefined &&
      (authentication.controlEventId !==
        pinnedLegacyOutcome.controlEventId ||
        authentication.outcomeDigest !== pinnedLegacyOutcome.outcomeDigest ||
        authentication.taskRevision !== pinnedLegacyOutcome.taskRevision ||
        entry.taskId !== pinnedLegacyOutcome.taskId)) ||
    (requiresDeterministicControlEvent &&
      event.eventId !== deterministicControlEventId) ||
    !exactOutcomeEvent ||
    event.actor !== authentication.actor ||
    event.data?.leaseName !== authentication.leaseName ||
    event.data?.ledgerPath !== ledgerPath ||
    event.data?.outcomeDigest !== digest ||
    authentication.outcomeDigest !== digest ||
    event.data?.id !== entry.id ||
    event.taskId !== entry.taskId ||
    event.data?.taskId !== entry.taskId ||
    event.data?.taskRevision !== authentication.taskRevision ||
    event.data?.taskState !== entry.outcome ||
    event.data?.kind !== entry.kind ||
    event.data?.outcome !== entry.outcome ||
    event.data?.transitionEventId !== authentication.transitionEventId ||
    JSON.stringify(event.data?.evidence ?? {}) !== JSON.stringify(evidence) ||
    !transitionEvent ||
    !validLegacyReservation ||
    !canonicalReservationLink ||
    !validInstalledTransitionIdentity ||
    !validLegacyInstalledIdentity ||
    transitionEvent.actor !== authentication.actor ||
    transitionEvent.taskId !== entry.taskId ||
    transitionEvent.taskRevision !== authentication.taskRevision ||
    transitionEvent.data?.toState !== entry.outcome ||
    transitionEvent.data?.outcomeDigest !== digest ||
    ((VERIFICATION_OUTCOME_STATUSES.has(entry.outcome) || reservationEvent) &&
      transitionEvent.data?.outcomeRequired !== true)
  ) {
    return {
      trusted: false,
      reason: "outcome does not match its authenticated control event",
    };
  }
  consumedEventIds.add(authentication.controlEventId);
  consumedOutcomeKeys.add(outcomeKey);
  return { trusted: true };
}

export function summarizeOutcomeLedger(
  filePath,
  {
    stateRoot = path.dirname(path.resolve(filePath)),
    ledgerText = undefined,
    ledgerStats = null,
    eventHistoryText = undefined,
    eventHistoryStats = null,
    allowedPendingRepairOperationId = null,
    planningBundle = null,
    writerGuardContext = null,
    analysisLedgerAdmission = null,
  } = {},
) {
  const ledgerPath = path.resolve(filePath);
  if (
    ledgerText !== undefined ||
    ledgerStats !== null ||
    eventHistoryText !== undefined ||
    eventHistoryStats !== null
  ) {
    throw new Error(
      "Outcome ledger summary authority overrides are unsupported. Use one coherent planning bundle admission.",
    );
  }
  if (planningBundle === null) {
    if (analysisLedgerAdmission !== null) {
      throw new Error(
        "Outcome ledger analysis admissions require their active planning bundle.",
      );
    }
    return withAutomationPlanningReadBundle(
      {
        stateRoot,
        ledgerPath,
        writerGuardContext,
      },
      (bundle) =>
        summarizeOutcomeLedger(ledgerPath, {
          stateRoot,
          allowedPendingRepairOperationId,
          planningBundle: bundle,
        }),
    );
  }
  const snapshots = outcomeSnapshotsFromPlanningBundle(planningBundle);
  if (analysisLedgerAdmission !== null) {
    const admitted = readAutomationPlanningAdmission(
      planningBundle,
      analysisLedgerAdmission,
    );
    snapshots.ledger = outcomePlanningSnapshot(
      admitted.filePath,
      admitted,
      "Outcome ledger analysis source",
    );
  }
  const ledgerSnapshot = snapshots.ledger;
  const eventHistorySnapshot = snapshots.events;
  const ledgerSource = ledgerSnapshot.source;
  let ledgerPhysicalLineCount = 0;
  let ledgerPhysicalBoundaryIssue = null;
  try {
    ledgerPhysicalLineCount = requireOutcomeLedgerPhysicalBoundary(
      ledgerSnapshot.bytes,
    );
  } catch (error) {
    ledgerPhysicalBoundaryIssue =
      error instanceof Error ? error.message : String(error);
  }
  let controlEventPhysicalLineCount = 0;
  let controlEventPhysicalBoundaryIssue = null;
  try {
    controlEventPhysicalLineCount = requireControlEventPhysicalBoundary(
      eventHistorySnapshot.bytes,
    );
  } catch (error) {
    controlEventPhysicalBoundaryIssue =
      error instanceof Error ? error.message : String(error);
  }
  const outcomeSeparatorBytes =
    ledgerSnapshot.bytes.length > 0 &&
    ledgerSnapshot.bytes[ledgerSnapshot.bytes.length - 1] !== 0x0a
      ? 1
      : 0;
  const outcomeAppendCapacity =
    ledgerPhysicalBoundaryIssue === null
      ? Math.max(
          0,
          Math.min(
            OUTCOME_LEDGER_REPAIR_MAX_LINES - ledgerPhysicalLineCount,
            Math.floor(
              Math.max(
                0,
                OUTCOME_LEDGER_MAX_BYTES -
                  ledgerSnapshot.bytes.length -
                  outcomeSeparatorBytes,
              ) / OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES,
            ),
          ),
        )
      : 0;
  const controlEventSeparatorBytes =
    eventHistorySnapshot.bytes.length > 0 &&
    eventHistorySnapshot.bytes[eventHistorySnapshot.bytes.length - 1] !== 0x0a
      ? 1
      : 0;
  const controlEventAppendCapacity =
    controlEventPhysicalBoundaryIssue === null
      ? Math.max(
          0,
          Math.min(
            CONTROL_EVENT_HISTORY_MAX_RECORDS -
              controlEventPhysicalLineCount,
            Math.floor(
              Math.max(
                0,
                CONTROL_EVENT_HISTORY_MAX_BYTES -
                  eventHistorySnapshot.bytes.length -
                  controlEventSeparatorBytes,
              ) / CONTROL_EVENT_MAX_LINE_BYTES,
            ),
          ),
        )
      : 0;
  const outcomeAppendReady = outcomeAppendCapacity >= 1;
  const controlEventAppendReady =
    controlEventAppendCapacity >= OUTCOME_CONTROL_EVENT_APPEND_RESERVATION;
  const eventHistory = trustedOutcomeEventHistoryFromSource(
    eventHistorySnapshot.source,
    ledgerPath,
    stateRoot,
    controlEventPhysicalBoundaryIssue,
    planningBundle?.leaseTransactionHistory ?? null,
  );
  const repairInputIssues = [
    ledgerSnapshot.issue,
    eventHistorySnapshot.issue,
  ].filter(Boolean);
  const admitted = validateOutcomeLedgerRepairTransactionsFromPlanningBundle(
    planningBundle,
  );
  const repairTransactions = {
    ...admitted,
    healthy: admitted.healthy && repairInputIssues.length === 0,
    issues: [...repairInputIssues, ...admitted.issues],
  };
  const consumedEventIds = new Set();
  const consumedOutcomeKeys = new Set();
  const pinnedLegacyOutcomeReferenceCounts = new Map(
    [...eventHistory.requiredPinnedLegacyOutcomeEventIds].map((eventId) => [
      eventId,
      0,
    ]),
  );
  const entries = [];
  const rejectedEntries = [];
  const lineDecisions = [];
  for (const record of ledgerSource.records) {
    if (record.malformed) {
      const reason = `malformed outcome ledger line ${record.lineNumber.toLocaleString()}`;
      rejectedEntries.push({
        lineNumber: record.lineNumber,
        entry: null,
        reason,
      });
      lineDecisions.push({
        lineNumber: record.lineNumber,
        disposition: "rejected",
        reason,
      });
      continue;
    }
    const entry = record.entry;
    const controlEventId = entry?.authentication?.controlEventId;
    if (pinnedLegacyOutcomeReferenceCounts.has(controlEventId)) {
      pinnedLegacyOutcomeReferenceCounts.set(
        controlEventId,
        pinnedLegacyOutcomeReferenceCounts.get(controlEventId) + 1,
      );
    }
    const authentication = authenticateOutcomeEntry(
      entry,
      ledgerPath,
      eventHistory,
      consumedEventIds,
      consumedOutcomeKeys,
    );
    if (authentication.trusted) {
      entries.push(entry);
      lineDecisions.push({
        lineNumber: record.lineNumber,
        disposition: "trusted",
        reason: "authenticated outcome provenance",
      });
    } else {
      rejectedEntries.push({
        lineNumber: record.lineNumber,
        entry,
        reason: authentication.reason,
      });
      lineDecisions.push({
        lineNumber: record.lineNumber,
        disposition: "rejected",
        reason: authentication.reason,
      });
    }
  }
  const pinnedLegacyOutcomeBundleIssues = [];
  for (const [eventId, referenceCount] of pinnedLegacyOutcomeReferenceCounts) {
    if (referenceCount === 1 && consumedEventIds.has(eventId)) continue;
    pinnedLegacyOutcomeBundleIssues.push(
      `required pinned legacy outcome ${eventId} has ${referenceCount.toLocaleString()} ledger references and ${
        consumedEventIds.has(eventId) ? "one" : "no"
      } trusted row`,
    );
  }
  const pinnedLegacyOutcomeBundlesHealthy =
    pinnedLegacyOutcomeBundleIssues.length === 0;
  const byKind = new Map();
  const byId = new Map();

  for (const entry of entries) {
    const kind = String(entry.kind ?? "");
    const id = String(entry.id ?? "");
    const rawOutcome = String(entry.outcome ?? "");
    const outcome = LEGACY_OUTCOME_ALIASES[rawOutcome] ?? rawOutcome;
    if (!kind || !id) {
      continue;
    }
    for (const [key, map] of [
      [kind, byKind],
      [id, byId],
    ]) {
      const current = map.get(key) ?? {
        key,
        attempts: 0,
        merged: 0,
        installed: 0,
        verifiedEffective: 0,
        verifiedNeutral: 0,
        regressed: 0,
        inconclusive: 0,
        governanceBlocked: 0,
        superseded: 0,
        implementationFailed: 0,
        latestOutcome: null,
        latestTsMs: null,
        latestEvidenceWindowEndMs: null,
      };
      current.attempts += 1;
      if (outcome === "merged") current.merged += 1;
      else if (outcome === "installed") current.installed += 1;
      else if (outcome === "verified_effective") current.verifiedEffective += 1;
      else if (outcome === "verified_neutral") current.verifiedNeutral += 1;
      else if (outcome === "regressed") current.regressed += 1;
      else if (outcome === "inconclusive") current.inconclusive += 1;
      else if (outcome === "governance_blocked") current.governanceBlocked += 1;
      else if (outcome === "superseded") current.superseded += 1;
      else if (outcome === "implementation_failed")
        current.implementationFailed += 1;
      const entryTsMs = parseTimestampMs(entry.ts);
      if (
        entryTsMs !== null &&
        (current.latestTsMs === null || entryTsMs >= current.latestTsMs)
      ) {
        current.latestTsMs = entryTsMs;
        current.latestOutcome = outcome;
        current.latestEvidenceWindowEndMs = parseTimestampMs(
          entry.evidenceWindowEnd,
        );
      }
      map.set(key, current);
    }
  }

  return {
    path: ledgerPath,
    exists: entries.length > 0,
    entries,
    pendingOutcomeTransitions: findPendingOutcomeTransitionsFromTrustedHistory(
      entries,
      eventHistory,
    ),
    rejectedEntries,
    lineDecisions,
    sourceHealth: {
      ledgerHealthy:
        ledgerSource.healthy &&
        ledgerPhysicalBoundaryIssue === null &&
        eventHistory.source.healthy &&
        pinnedLegacyOutcomeBundlesHealthy &&
        rejectedEntries.length === 0 &&
        repairTransactions.healthy &&
        repairTransactions.pending.length === 0,
      ledgerSyntaxHealthy: ledgerSource.healthy,
      ledgerPhysicalBoundaryHealthy: ledgerPhysicalBoundaryIssue === null,
      ledgerPhysicalBoundaryIssue,
      ledgerPhysicalLineCount,
      outcomeAppendCapacity,
      outcomeAppendReady,
      controlEventPhysicalBoundaryHealthy:
        controlEventPhysicalBoundaryIssue === null,
      controlEventPhysicalBoundaryIssue,
      controlEventPhysicalLineCount,
      controlEventAppendCapacity,
      controlEventAppendReady,
      ledgerExists: ledgerSource.exists,
      malformedLedgerLines: ledgerSource.malformedLines,
      controlEventsHealthy: eventHistory.source.healthy,
      controlEventsExist: eventHistory.source.exists,
      malformedControlEventLines: eventHistory.source.malformedLines,
      controlEventIdentityIssues: eventHistory.source.identityIssues,
      leaseTransactionsHealthy:
        eventHistory.source.leaseTransactionsHealthy,
      leaseTransactionIssues: eventHistory.source.leaseTransactionIssues,
      retainedLeaseReceiptCount:
        eventHistory.source.retainedLeaseReceiptCount,
      pendingLeaseTransactionArtifactCount:
        eventHistory.source.pendingLeaseTransactionArtifactCount,
      pinnedLegacyOutcomeBundlesHealthy,
      pinnedLegacyOutcomeBundleIssues,
      outcomeLedgerTransactionsHealthy: repairTransactions.healthy,
      pendingOutcomeLedgerRepairs: repairTransactions.pending,
      outcomeLedgerTransactionIssues: repairTransactions.issues,
    },
    byKind: Object.fromEntries(byKind),
    byId: Object.fromEntries(byId),
  };
}

function waitForOutcomeLedgerLock(ms) {
  const signal = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );
  Atomics.wait(signal, 0, 0, ms);
}

function outcomeLedgerBootstrapAdmissionReady(summary) {
  const health = summary.sourceHealth;
  return (
    health.ledgerExists === false &&
    health.ledgerSyntaxHealthy === false &&
    health.ledgerPhysicalBoundaryHealthy === true &&
    health.outcomeAppendReady === true &&
    health.controlEventsHealthy === true &&
    health.controlEventPhysicalBoundaryHealthy === true &&
    health.controlEventAppendReady === true &&
    health.leaseTransactionsHealthy === true &&
    health.pinnedLegacyOutcomeBundlesHealthy === true &&
    health.pendingOutcomeLedgerRepairs.length === 0 &&
    health.outcomeLedgerTransactionIssues.length === 1 &&
    health.outcomeLedgerTransactionIssues[0] ===
      "Outcome ledger is unavailable." &&
    health.malformedLedgerLines.length === 0 &&
    summary.entries.length === 0 &&
    summary.rejectedEntries.length === 0 &&
    summary.lineDecisions.length === 0
  );
}

function requireOutcomeLedgerAppendAdmission(
  ledgerPath,
  stateRoot,
  { writerGuardContext = null } = {},
) {
  const admitted = withAutomationPlanningReadBundle(
    { stateRoot, ledgerPath, writerGuardContext },
    (planningBundle) => {
      const ledgerSummary = summarizeOutcomeLedger(ledgerPath, {
        stateRoot,
        planningBundle,
      });
      if (
        !ledgerSummary.sourceHealth.ledgerHealthy &&
        !outcomeLedgerBootstrapAdmissionReady(ledgerSummary)
      ) {
        throw new Error(
          "Outcome recording requires a fully authenticated, healthy outcome ledger within the supported repair boundary.",
        );
      }
      return {
        ledger: planningBundle.outcomeLedger,
        events: planningBundle.controlEventHistory,
        taskManifestValue: planningBundle.taskManifest,
        taskManifest: planningBundle.taskManifestSnapshot,
        leaseTransactionHistory: planningBundle.leaseTransactionHistory,
        ledgerSummary,
      };
    },
  );
  const ledgerSnapshot = outcomePlanningSnapshot(
    ledgerPath,
    admitted.ledger,
    "Outcome ledger",
  );
  const eventHistorySnapshot = outcomePlanningSnapshot(
    automationControlPaths(stateRoot).events,
    admitted.events,
    "Control event history",
  );
  let controlEventPhysicalBoundaryIssue = null;
  try {
    requireControlEventPhysicalBoundary(eventHistorySnapshot.bytes);
  } catch (error) {
    controlEventPhysicalBoundaryIssue =
      error instanceof Error ? error.message : String(error);
  }
  const eventHistory = trustedOutcomeEventHistoryFromSource(
    eventHistorySnapshot.source,
    ledgerPath,
    stateRoot,
    controlEventPhysicalBoundaryIssue,
    admitted.leaseTransactionHistory,
  );
  return {
    ledgerSnapshot,
    eventHistorySnapshot,
    eventHistory,
    taskManifest: admitted.taskManifestValue,
    ledgerSummary: admitted.ledgerSummary,
    leaseTransactionHistory: admitted.leaseTransactionHistory,
    generationReceipt: Object.freeze({
      ledger: admitted.ledger,
      events: admitted.events,
      taskManifest: admitted.taskManifest,
    }),
  };
}

function requireOutcomePlanningGeneration(snapshot, admitted, label) {
  const identity = snapshot.stats ?? snapshot.identity;
  const expected = admitted.identity;
  const currentDirectoryIdentity =
    snapshot.authoritySnapshot?.directoryIdentity ??
    snapshot.directoryIdentity;
  const expectedDirectoryIdentity = admitted.directoryIdentity;
  const matchesDirectoryIdentity =
    expectedDirectoryIdentity === undefined ||
    (currentDirectoryIdentity !== null &&
      currentDirectoryIdentity !== undefined &&
      String(currentDirectoryIdentity.dev) ===
        String(expectedDirectoryIdentity.dev) &&
      String(currentDirectoryIdentity.ino) ===
        String(expectedDirectoryIdentity.ino) &&
      (Number(currentDirectoryIdentity.mode) & 0o7777) ===
        (Number(expectedDirectoryIdentity.mode) & 0o7777) &&
      Number(currentDirectoryIdentity.uid) ===
        Number(expectedDirectoryIdentity.uid));
  const matchesIdentity =
    matchesDirectoryIdentity &&
    snapshot.missing === admitted.missing &&
    (snapshot.missing ||
      (identity !== null &&
        expected !== null &&
        String(identity.dev) === String(expected.dev) &&
        String(identity.ino) === String(expected.ino) &&
        (Number(identity.mode) & 0o7777) ===
          (Number(expected.mode) & 0o7777) &&
        Number(identity.nlink) === Number(expected.nlink) &&
        Number(identity.uid) === Number(expected.uid) &&
        Number(identity.gid) === Number(expected.gid) &&
        Number(identity.size) === Number(expected.size)));
  if (
    !matchesIdentity ||
    snapshot.bytes.length !== admitted.size ||
    createHash("sha256").update(snapshot.bytes).digest("hex") !==
      admitted.digest
  ) {
    throw new Error(
      `${label} changed after coherent repair admission: ${JSON.stringify({
        admitted: {
          missing: admitted.missing,
          digest: admitted.digest,
          size: admitted.size,
          identity: admitted.identity,
          directoryIdentity: admitted.directoryIdentity,
        },
        current: {
          missing: snapshot.missing,
          digest: createHash("sha256").update(snapshot.bytes).digest("hex"),
          size: snapshot.bytes.length,
          identity,
          directoryIdentity: currentDirectoryIdentity,
        },
      })}`,
    );
  }
}

function materializeOutcomeLedgerAppendAdmission(
  admitted,
  ledgerPath,
  stateRoot,
) {
  const snapshots = readCanonicalOutcomeSnapshots(stateRoot, ledgerPath);
  const taskManifestSnapshot = readAutomationAuthorityFileSnapshot(
    automationControlPaths(stateRoot).taskManifest,
    {
      allowMissing: true,
      allowEmpty: true,
      privateRoot: automationControlPaths(stateRoot).controlRoot,
      maxBytes: OUTCOME_LEDGER_MAX_BYTES,
      allowedModes: [0o600],
      label: "Current task manifest",
    },
  );
  requireOutcomePlanningGeneration(
    snapshots.ledger,
    admitted.generationReceipt.ledger,
    "Outcome ledger",
  );
  requireOutcomePlanningGeneration(
    snapshots.events,
    admitted.generationReceipt.events,
    "Control event history",
  );
  requireOutcomePlanningGeneration(
    taskManifestSnapshot,
    admitted.generationReceipt.taskManifest,
    "Current task manifest",
  );
  let controlEventPhysicalBoundaryIssue = null;
  try {
    requireControlEventPhysicalBoundary(snapshots.events.bytes);
  } catch (error) {
    controlEventPhysicalBoundaryIssue =
      error instanceof Error ? error.message : String(error);
  }
  const eventHistory = trustedOutcomeEventHistoryFromSource(
    snapshots.events.source,
    ledgerPath,
    stateRoot,
    controlEventPhysicalBoundaryIssue,
  );
  if (!eventHistory.source.healthy) {
    throw new Error(
      "Outcome recording requires complete, well-formed control event history.",
    );
  }
  return {
    ...admitted,
    ledgerSnapshot: snapshots.ledger,
    eventHistorySnapshot: snapshots.events,
    eventHistory,
  };
}

function requireControlEventPhysicalBoundary(bytes) {
  let lineCount = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    const physicalLineBytes =
      newline === -1 ? bytes.length - offset : newline + 1 - offset;
    if (physicalLineBytes > CONTROL_EVENT_MAX_LINE_BYTES) {
      throw new Error(
        "Control event history contains a physical line beyond the supported byte boundary.",
      );
    }
    lineCount += 1;
    offset = newline === -1 ? bytes.length : newline + 1;
  }
  return lineCount;
}

function requireOutcomeControlEventHeadroom(
  eventHistoryBytes,
  prospectiveEventCount,
) {
  const existingRecordCount =
    requireControlEventPhysicalBoundary(eventHistoryBytes);
  const separatorBytes =
    prospectiveEventCount > 0 &&
    eventHistoryBytes.length > 0 &&
    eventHistoryBytes[eventHistoryBytes.length - 1] !== 0x0a
      ? 1
      : 0;
  if (
    !Number.isSafeInteger(prospectiveEventCount) ||
    prospectiveEventCount < 0 ||
    existingRecordCount + prospectiveEventCount >
      CONTROL_EVENT_HISTORY_MAX_RECORDS ||
    eventHistoryBytes.length +
      separatorBytes +
      prospectiveEventCount * CONTROL_EVENT_MAX_LINE_BYTES >
      CONTROL_EVENT_HISTORY_MAX_BYTES
  ) {
    throw new Error(
      "Outcome recording would exceed the supported control event history boundary.",
    );
  }
}

function buildCleanOutcomeEntry({
  entry,
  taskId,
  resolvedOutcome,
  recordedAt,
}) {
  const outcomeBuildIdentity =
    entry.outcome === "installed"
      ? normalizeInstalledBuildIdentity(entry.installedIdentity)
      : (resolvedOutcome.verdict?.buildIdentity ?? null);
  const cleanEntry = {
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    ts: recordedAt,
    id: String(entry.id),
    taskId,
    kind: String(entry.kind),
    outcome: String(entry.outcome),
    notes: String(entry.notes ?? ""),
    evidence: structuredClone(resolvedOutcome.evidence),
  };
  if (entry.pr) cleanEntry.pr = String(entry.pr);
  if (outcomeBuildIdentity) {
    cleanEntry.buildIdentity = outcomeBuildIdentity;
    cleanEntry.build = outcomeBuildIdentity.version;
  }
  if (entry.runDir) cleanEntry.runDir = String(entry.runDir);
  if (entry.evidenceWindowEnd) {
    cleanEntry.evidenceWindowEnd = String(entry.evidenceWindowEnd);
  }
  if (resolvedOutcome.effect) cleanEntry.effect = resolvedOutcome.effect;
  return cleanEntry;
}

function requireOutcomeRecordRequest(entry, now) {
  if (!entry?.id || !entry?.kind || !entry?.outcome) {
    throw new Error("Outcome ledger entries require id, kind, and outcome.");
  }
  const taskId = String(
    entry.taskId ?? (entry.kind === "task" ? entry.id : ""),
  ).trim();
  if (!taskId) {
    throw new Error("Outcome ledger entries require a canonical taskId.");
  }
  if (!OUTCOME_STATUSES.includes(entry.outcome)) {
    throw new Error(`Outcome must be one of: ${OUTCOME_STATUSES.join(", ")}.`);
  }
  if (entry.outcome === "installed" && !entry.installedIdentity) {
    throw new Error(
      "An installed outcome requires version, commit, and channel identity.",
    );
  }
  if (
    VERIFICATION_OUTCOME_STATUSES.has(entry.outcome) &&
    (!entry.evidenceWindowEnd ||
      !Number.isFinite(Date.parse(String(entry.evidenceWindowEnd))))
  ) {
    throw new Error(
      "A verification outcome requires a valid evidence window end timestamp.",
    );
  }
  if (
    FRESHNESS_GATED_OUTCOME_STATUSES.has(entry.outcome) &&
    (!entry.evidenceWindowEnd ||
      !Number.isFinite(Date.parse(String(entry.evidenceWindowEnd))))
  ) {
    throw new Error(
      `${entry.outcome} requires a valid evidence window end timestamp.`,
    );
  }
  const evidenceWindowEndMs = parseTimestampMs(entry.evidenceWindowEnd);
  if (
    evidenceWindowEndMs !== null &&
    evidenceWindowEndMs > now.getTime() + 5 * 60 * 1_000
  ) {
    throw new Error("Outcome evidence window end cannot be in the future.");
  }
  return taskId;
}

function readOutcomeRecordPlanTask(manifest, taskId) {
  const admitted = validateTaskManifest(structuredClone(manifest));
  if (!Array.isArray(admitted?.tasks)) {
    throw new Error(
      "Outcome record planning requires a canonical task manifest.",
    );
  }
  const matches = admitted.tasks.filter((task) => task?.taskId === taskId);
  if (
    matches.length !== 1 ||
    !TASK_STATES_FOR_OUTCOME_PLAN.has(matches[0]?.state) ||
    !Number.isSafeInteger(matches[0]?.revision) ||
    matches[0].revision < 1
  ) {
    throw new Error(
      `Outcome task ${taskId} does not have one canonical lifecycle record.`,
    );
  }
  return structuredClone(matches[0]);
}

const TASK_STATES_FOR_OUTCOME_PLAN = new Set([
  "observed",
  "triaged",
  "approved_for_pr",
  "implemented",
  "validated",
  "merged",
  "installed",
  "soaking",
  ...OUTCOME_STATUSES,
  "closed",
]);

export function planOutcomeRecord(
  filePath,
  entry,
  { stateRoot = path.dirname(path.resolve(filePath)), now = new Date() } = {},
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Outcome record planning requires a valid timestamp.");
  }
  const canonicalStateRoot = realpathSync(path.resolve(stateRoot));
  const ledgerPath = path.resolve(filePath);
  const canonicalLedgerPath =
    automationControlPaths(canonicalStateRoot).outcomes;
  if (ledgerPath !== canonicalLedgerPath) {
    throw new Error(
      `Outcome recording requires the canonical ledger at ${canonicalLedgerPath}.`,
    );
  }
  requireOutcomeRepairPrivateDescendants(
    canonicalStateRoot,
    automationControlPaths(canonicalStateRoot).controlRoot,
  );
  const taskId = requireOutcomeRecordRequest(entry, now);
  const resolvedOutcome = resolveOutcomeEvidence({ ...entry, taskId });
  const admission = requireOutcomeLedgerAppendAdmission(
    ledgerPath,
    canonicalStateRoot,
  );
  if (!admission.eventHistory.source.healthy) {
    throw new Error(
      "Outcome record planning requires complete control event history.",
    );
  }
  const task = readOutcomeRecordPlanTask(admission.taskManifest, taskId);
  if (task.pendingOutcome !== undefined) {
    throw new Error(
      `Outcome task ${taskId} already has a pending reservation. Reuse its original plan.`,
    );
  }
  const cleanEntry = buildCleanOutcomeEntry({
    entry,
    taskId,
    resolvedOutcome,
    recordedAt: now.toISOString(),
  });
  const outcomeDigest = outcomeEntryDigest(cleanEntry);
  const legacyTransitions = admission.eventHistory.source.entries.filter(
    (event) =>
      event?.type === "task_transitioned" &&
      event.taskId === taskId &&
      event.taskRevision === task.revision &&
      event.data?.toState === cleanEntry.outcome &&
      event.data?.outcomeDigest === undefined &&
      event.data?.outcomeRequired === undefined,
  );
  const route =
    task.state === cleanEntry.outcome ? "legacy-backfill" : "transition";
  if (
    (route === "legacy-backfill" &&
      (legacyTransitions.length !== 1 ||
        task.details?.latestOutcome !== undefined)) ||
    (route === "transition" &&
      !isTaskTransitionAllowed(task.state, cleanEntry.outcome))
  ) {
    throw new Error(
      `Outcome task ${taskId} cannot plan ${cleanEntry.outcome} from ${task.state}.`,
    );
  }
  if (route === "legacy-backfill" && cleanEntry.outcome === "installed") {
    let taskIdentity;
    let legacyIdentity;
    try {
      taskIdentity = normalizeInstalledBuildIdentity(task.installedIdentity);
      legacyIdentity = normalizeInstalledBuildIdentity(
        legacyTransitions[0].data?.installedIdentity,
      );
    } catch {
      throw new Error(
        `Outcome task ${taskId} installed history has no canonical build identity.`,
      );
    }
    if (
      JSON.stringify(taskIdentity) !==
        JSON.stringify(cleanEntry.buildIdentity) ||
      JSON.stringify(legacyIdentity) !== JSON.stringify(taskIdentity) ||
      legacyTransitions[0].data?.installedBuild !== taskIdentity.version ||
      legacyTransitions[0].data?.installedAt !== task.installedAt
    ) {
      throw new Error(
        `Outcome task ${taskId} installed identity does not match canonical control history.`,
      );
    }
  }
  const planned = outcomeRecordOwnerIntent({
    stateRoot: canonicalStateRoot,
    taskId,
    parameters: {
      schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
      policy: "freed-outcome-record-v1",
      stateRoot: canonicalStateRoot,
      ledgerPath,
      sourceTask: structuredClone(task),
      sourceTaskState: task.state,
      sourceTaskDetails: structuredClone(task.details ?? {}),
      sourceTaskRevision: task.revision,
      route,
      legacyTransition:
        route === "legacy-backfill"
          ? structuredClone(legacyTransitions[0])
          : null,
      legacyTransitionEventId:
        route === "legacy-backfill" ? legacyTransitions[0].eventId : null,
      cleanEntry,
      outcomeDigest,
    },
  });
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    intent: planned.intent,
    intentDigest: planned.intentDigest,
    taskId,
    cleanEntry,
    outcomeDigest,
  };
}

function normalizeOutcomeRecordPlan(value, { stateRoot, ledgerPath, taskId }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("freed-owner outcome recording requires an exact plan.");
  }
  const expectedKeys = [
    "cleanEntry",
    "intent",
    "intentDigest",
    "outcomeDigest",
    "schemaVersion",
    "taskId",
  ];
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      "Outcome record plan must contain the exact canonical field set.",
    );
  }
  if (
    value.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    value.taskId !== taskId ||
    value.intent?.taskId !== taskId
  ) {
    throw new Error("Outcome record plan does not match the requested task.");
  }
  const planned = outcomeRecordOwnerIntent({
    stateRoot,
    taskId,
    parameters: value.intent?.parameters,
  });
  if (
    planned.parameters.ledgerPath !== ledgerPath ||
    value.intentDigest !== planned.intentDigest ||
    JSON.stringify(value.intent) !== JSON.stringify(planned.intent) ||
    value.outcomeDigest !== planned.parameters.outcomeDigest ||
    JSON.stringify(value.cleanEntry) !==
      JSON.stringify(planned.parameters.cleanEntry)
  ) {
    throw new Error(
      "Outcome record plan does not match its canonical owner intent.",
    );
  }
  return planned;
}

function requireOutcomeControlEventLineCapacity(event) {
  const eventBytes = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  if (eventBytes.length > CONTROL_EVENT_MAX_LINE_BYTES) {
    throw new Error(
      "Outcome control event would exceed the supported line boundary.",
    );
  }
}

function outcomeRecordedEventData({
  cleanEntry,
  taskId,
  taskRevision,
  taskState,
  ledgerPath,
  leaseName,
  evidence,
  outcomeDigest,
  transitionEventId,
}) {
  return {
    id: cleanEntry.id,
    taskId,
    taskRevision,
    taskState,
    kind: cleanEntry.kind,
    outcome: cleanEntry.outcome,
    ledgerPath,
    leaseName,
    evidence,
    outcomeDigest,
    transitionEventId,
  };
}

function requireExistingOutcomeControlEvent(
  events,
  { eventId, actor, taskId, data },
) {
  const matches = events.filter((event) => event?.eventId === eventId);
  if (matches.length > 1) {
    throw new Error(
      `Control event history contains duplicate event ${eventId}.`,
    );
  }
  if (matches.length === 0) return null;
  const existing = matches[0];
  const expected = {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId,
    type: "outcome_recorded",
    ts: existing.ts,
    actor,
    taskId,
    data,
  };
  if (stableOutcomeRepairJson(existing) !== stableOutcomeRepairJson(expected)) {
    throw new Error(`Control event ${eventId} conflicts with the outcome.`);
  }
  return existing;
}

function authenticatedOutcomeEntry(
  cleanEntry,
  {
    actor,
    leaseName,
    controlEventId,
    transitionEventId,
    outcomeDigest,
    taskRevision,
  },
) {
  return {
    ...cleanEntry,
    authentication: {
      actor,
      leaseName,
      controlEventId,
      transitionEventId,
      outcomeDigest,
      taskRevision,
    },
  };
}

function appendOutcomeEntryUnlocked(
  ledgerPath,
  entry,
  admittedLedgerSnapshot,
  { beforePublish = () => {} } = {},
) {
  if (
    admittedLedgerSnapshot?.authoritySnapshot === null ||
    admittedLedgerSnapshot?.authoritySnapshot === undefined
  ) {
    throw new Error(
      "Outcome ledger append requires an exact live authority snapshot.",
    );
  }
  const { separator, entryBytes } = prepareOutcomeLedgerAppend(
    admittedLedgerSnapshot.bytes,
    entry,
  );
  writeAutomationAuthorityFile({
    filePath: ledgerPath,
    bytes: Buffer.concat([
      admittedLedgerSnapshot.bytes,
      separator,
      entryBytes,
    ]),
    previousSnapshot: admittedLedgerSnapshot.authoritySnapshot,
    operationId: `outcome-ledger:${
      entry?.authentication?.controlEventId ?? entry?.id ?? randomUUID()
    }`,
    privateRoot: path.dirname(ledgerPath),
    maxBytes: OUTCOME_LEDGER_MAX_BYTES,
    allowedModes: [0o600, 0o640, 0o644],
    label: "Canonical outcome ledger",
    beforePublish,
  });
}

export function withOutcomeLedgerWriterLock(
  ledgerPath,
  operation,
  { timeoutMs = 5_000, wait = waitForOutcomeLedgerLock } = {},
) {
  if (typeof operation !== "function") {
    throw new Error("Outcome ledger writer lock requires an operation.");
  }
  return withAutomationOutcomeLedgerWriterGuard(ledgerPath, operation, {
    stateRoot: path.dirname(path.resolve(ledgerPath)),
    timeoutMs,
    wait,
  });
}

function appendOutcomeLedgerLocked({
  ledgerPath,
  stateRoot,
  entry,
  taskId,
  actor,
  leaseName,
  leaseToken,
  now,
  resolvedOutcome,
  checkpoint,
  initialAdmission,
  control,
  ownerPlan,
}) {
  const admission = materializeOutcomeLedgerAppendAdmission(
    initialAdmission,
    ledgerPath,
    stateRoot,
  );
  const task = control.readTask(taskId);
  if (!task) {
    throw new Error(
      `Outcome task ${taskId} does not exist in canonical control state.`,
    );
  }
  const eventHistoryBeforeWrite = admission.eventHistory;
  if (!eventHistoryBeforeWrite.source.healthy) {
    throw new Error(
      "Outcome recording requires complete, well-formed control event history.",
    );
  }
  const evidence = resolvedOutcome.evidence;
  if (VERIFICATION_OUTCOME_STATUSES.has(entry.outcome)) {
    let installedIdentity;
    try {
      installedIdentity = normalizeInstalledBuildIdentity(
        task.installedIdentity,
      );
    } catch {
      throw new Error(
        "Verification outcome requires canonical installed version, commit, and channel identity.",
      );
    }
    const installedAtMs = Date.parse(String(task.installedAt ?? ""));
    const soakStartedAtMs = Date.parse(String(task.soakStartedAt ?? ""));
    if (
      JSON.stringify(installedIdentity) !==
        JSON.stringify(resolvedOutcome.verdict?.buildIdentity) ||
      !Number.isFinite(installedAtMs) ||
      !Number.isFinite(soakStartedAtMs) ||
      soakStartedAtMs < installedAtMs
    ) {
      throw new Error(
        "Verification outcome requires the task's canonical installed build and soak timestamps.",
      );
    }
    if (
      resolvedOutcome.verdict.windowStartMs < soakStartedAtMs ||
      resolvedOutcome.verdict.windowEndMs <= soakStartedAtMs
    ) {
      throw new Error(
        "Outcome verdict window must begin after the task entered soaking.",
      );
    }
  }
  const ledgerBeforeWrite = admission.ledgerSnapshot;
  if (
    (!ledgerBeforeWrite.missing && ledgerBeforeWrite.issue) ||
    (ledgerBeforeWrite.source.exists && !ledgerBeforeWrite.source.healthy)
  ) {
    throw new Error("Outcome recording requires a well-formed outcome ledger.");
  }
  const priorOutcome = task.details?.latestOutcome;
  const priorRecordedAt = Date.parse(String(priorOutcome?.recordedAt ?? ""));
  const recordedAt = ownerPlan
    ? ownerPlan.parameters.cleanEntry.ts
    : task.state === entry.outcome &&
        priorOutcome?.outcome === entry.outcome &&
        Number.isFinite(priorRecordedAt)
      ? String(priorOutcome.recordedAt)
      : now.toISOString();
  const cleanEntry = buildCleanOutcomeEntry({
    entry,
    taskId,
    resolvedOutcome,
    recordedAt,
  });
  if (
    entry.outcome === "installed" &&
    task.state === "installed" &&
    JSON.stringify(normalizeInstalledBuildIdentity(task.installedIdentity)) !==
      JSON.stringify(cleanEntry.buildIdentity)
  ) {
    throw new Error(
      `Outcome task ${taskId} installed identity does not match canonical control state.`,
    );
  }
  const outcomeDigest = outcomeEntryDigest(cleanEntry);
  const latestOutcome = {
    outcome: cleanEntry.outcome,
    evidence,
    evidenceWindowEnd: cleanEntry.evidenceWindowEnd ?? null,
    build: cleanEntry.build ?? null,
    buildIdentity: cleanEntry.buildIdentity ?? null,
    installedIdentity:
      cleanEntry.outcome === "installed" ? cleanEntry.buildIdentity : null,
    outcomeDigest,
    recordedAt,
  };
  const plannedTaskDetails = ownerPlan
    ? {
        ...structuredClone(ownerPlan.parameters.sourceTaskDetails),
        ...(cleanEntry.outcome === "installed"
          ? { installedIdentity: structuredClone(cleanEntry.buildIdentity) }
          : {}),
        latestOutcome,
      }
    : null;
  if (
    ownerPlan &&
    (JSON.stringify(cleanEntry) !==
      JSON.stringify(ownerPlan.parameters.cleanEntry) ||
      outcomeDigest !== ownerPlan.parameters.outcomeDigest)
  ) {
    throw new Error(
      `Outcome task ${taskId} request does not match its exact owner plan.`,
    );
  }
  if (ownerPlan) {
    const parameters = ownerPlan.parameters;
    const atPlannedSource =
      JSON.stringify(task) === JSON.stringify(parameters.sourceTask);
    const atPlannedOutcome =
      task.state === parameters.cleanEntry.outcome &&
      task.revision === parameters.sourceTaskRevision + 1 &&
      JSON.stringify(task.details ?? {}) ===
        JSON.stringify(plannedTaskDetails) &&
      (task.pendingOutcome === undefined ||
        JSON.stringify(task.pendingOutcome) ===
          JSON.stringify({
            outcome: parameters.cleanEntry.outcome,
            outcomeDigest: parameters.outcomeDigest,
            taskRevision: parameters.sourceTaskRevision + 1,
          }));
    if (!atPlannedSource && !atPlannedOutcome) {
      throw new Error(
        `Outcome task ${taskId} lifecycle state has drifted from its owner plan.`,
      );
    }
  }
  const taskWillTransition = task.state !== cleanEntry.outcome;
  const matchingTransitions = taskWillTransition
    ? []
    : eventHistoryBeforeWrite.source.entries.filter(
        (event) =>
          isOutcomeTransitionEvent(event) &&
          event.taskId === taskId &&
          event.actor === actor &&
          event.taskRevision === task.revision &&
          event.data?.toState === cleanEntry.outcome &&
          event.data?.outcomeDigest === outcomeDigest &&
          event.data?.outcomeRequired === true,
      );
  const legacyLifecycleTransitions = taskWillTransition
    ? []
    : eventHistoryBeforeWrite.source.entries.filter(
        (event) =>
          event?.type === "task_transitioned" &&
          event.taskId === taskId &&
          event.taskRevision === task.revision &&
          event.data?.toState === cleanEntry.outcome &&
          event.data?.outcomeDigest === undefined &&
          event.data?.outcomeRequired === undefined,
      );
  const taskNeedsOutcomeBackfill =
    !taskWillTransition &&
    matchingTransitions.length === 0 &&
    legacyLifecycleTransitions.length === 1 &&
    task.pendingOutcome === undefined &&
    task.details?.latestOutcome === undefined;
  if (ownerPlan) {
    const parameters = ownerPlan.parameters;
    const matchingOwnerReservation = matchingTransitions[0];
    const plannedLegacyMatches = eventHistoryBeforeWrite.source.entries.filter(
      (event) => event?.eventId === parameters.legacyTransitionEventId,
    );
    const ownerLegacyTransitionMatches =
      parameters.route === "transition" ||
      (plannedLegacyMatches.length === 1 &&
        JSON.stringify(plannedLegacyMatches[0]) ===
          JSON.stringify(parameters.legacyTransition));
    const ownerRouteMatches =
      ownerLegacyTransitionMatches &&
      ((taskWillTransition && parameters.route === "transition") ||
      (taskNeedsOutcomeBackfill &&
        parameters.route === "legacy-backfill" &&
        legacyLifecycleTransitions[0]?.eventId ===
          parameters.legacyTransitionEventId) ||
      (!taskWillTransition &&
        !taskNeedsOutcomeBackfill &&
        matchingTransitions.length === 1 &&
        ((parameters.route === "transition" &&
          matchingOwnerReservation?.type === "task_transitioned" &&
          matchingOwnerReservation?.data?.fromState ===
            parameters.sourceTaskState) ||
          (parameters.route === "legacy-backfill" &&
            matchingOwnerReservation?.type ===
              "outcome_reservation_created" &&
            matchingOwnerReservation?.data?.legacyTransitionEventId ===
              parameters.legacyTransitionEventId))));
    if (!ownerRouteMatches) {
      throw new Error(
        `Outcome task ${taskId} lifecycle route does not match its owner plan.`,
      );
    }
  }
  if (
    !taskWillTransition &&
    !taskNeedsOutcomeBackfill &&
    matchingTransitions.length !== 1
  ) {
    throw new Error(
      `Outcome task ${taskId} requires exactly one matching lifecycle transition for ${cleanEntry.outcome}.`,
    );
  }
  const taskWillMutate = taskWillTransition || taskNeedsOutcomeBackfill;
  const predictedTaskRevision = task.revision + (taskWillMutate ? 1 : 0);
  if (
    ownerPlan &&
    predictedTaskRevision !== ownerPlan.parameters.sourceTaskRevision + 1
  ) {
    throw new Error(
      `Outcome task ${taskId} revision does not match its owner plan.`,
    );
  }
  const placeholderTransitionEventId = "00000000-0000-4000-8000-000000000000";
  const predictedTransitionEventId = taskWillTransition
    ? placeholderTransitionEventId
    : taskNeedsOutcomeBackfill
      ? outcomeReservationEventId({
          taskId,
          outcome: cleanEntry.outcome,
          outcomeDigest,
          taskRevision: predictedTaskRevision,
          legacyTransitionEventId: legacyLifecycleTransitions[0].eventId,
        })
      : matchingTransitions[0].eventId;
  const predictedControlEventId = outcomeRecordedEventId({
    taskId,
    taskRevision: predictedTaskRevision,
    outcomeDigest,
    transitionEventId: predictedTransitionEventId,
  });
  const predictedControlEventData = outcomeRecordedEventData({
    cleanEntry,
    taskId,
    taskRevision: predictedTaskRevision,
    taskState: cleanEntry.outcome,
    ledgerPath,
    leaseName,
    evidence,
    outcomeDigest,
    transitionEventId: predictedTransitionEventId,
  });
  const existingControlEvent = taskWillMutate
    ? null
    : requireExistingOutcomeControlEvent(
        eventHistoryBeforeWrite.source.entries,
        {
          eventId: predictedControlEventId,
          actor,
          taskId,
          data: predictedControlEventData,
        },
      );
  if (!existingControlEvent) {
    requireOutcomeControlEventLineCapacity({
      schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
      eventId: predictedControlEventId,
      type: "outcome_recorded",
      ts: now.toISOString(),
      actor,
      taskId,
      data: predictedControlEventData,
    });
  }
  const predictedAuthenticatedEntry = authenticatedOutcomeEntry(cleanEntry, {
    actor,
    leaseName,
    controlEventId: predictedControlEventId,
    transitionEventId: predictedTransitionEventId,
    outcomeDigest,
    taskRevision: predictedTaskRevision,
  });
  const ledgerSummary = admission.ledgerSummary;
  const existingEntry = ledgerSummary.entries.find(
    (candidate) =>
      candidate.authentication?.outcomeDigest === outcomeDigest &&
      candidate.authentication?.transitionEventId ===
        predictedTransitionEventId,
  );
  const rejectedExistingEntry = ledgerSummary.rejectedEntries.find(
    (record) =>
      record.entry?.authentication?.outcomeDigest === outcomeDigest &&
      record.entry?.authentication?.transitionEventId ===
        predictedTransitionEventId,
  );
  if (rejectedExistingEntry) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `Outcome task ${taskId} has a matching ledger row with invalid durable provenance.`,
      { taskId, outcome: cleanEntry.outcome, outcomeDigest },
    );
  }
  if (!existingEntry) {
    prepareOutcomeLedgerAppend(
      admission.ledgerSnapshot.bytes,
      predictedAuthenticatedEntry,
    );
  }
  const finalizationWillAppend =
    taskWillMutate || task.pendingOutcome !== undefined;
  requireOutcomeControlEventHeadroom(
    admission.eventHistorySnapshot.bytes,
    (taskWillMutate ? 1 : 0) +
      (existingControlEvent ? 0 : 1) +
      (finalizationWillAppend ? 1 : 0),
  );

  const taskTransition = taskWillTransition
    ? control.transitionTask({
          stateRoot,
          taskId,
          actor,
          leaseName,
          leaseToken,
          toState: cleanEntry.outcome,
          expectedRevision: task.revision,
        details: plannedTaskDetails ?? {
              ...task.details,
              ...(cleanEntry.outcome === "installed"
                ? { installedIdentity: cleanEntry.buildIdentity }
                : {}),
              latestOutcome,
            },
          nowMs: now.getTime(),
        })
    : taskNeedsOutcomeBackfill
      ? control.reserveCurrentTaskOutcome({
          stateRoot,
          taskId,
          actor,
          leaseName,
          leaseToken,
          outcome: cleanEntry.outcome,
          legacyTransitionEventId: legacyLifecycleTransitions[0].eventId,
          expectedRevision: task.revision,
          details: plannedTaskDetails ?? {
              ...task.details,
              ...(cleanEntry.outcome === "installed"
                ? { installedIdentity: cleanEntry.buildIdentity }
                : {}),
              latestOutcome,
            },
          nowMs: now.getTime(),
        })
      : { changed: false, task };
  checkpoint("outcome-transition-resolved");
  if (taskTransition.task.state !== cleanEntry.outcome) {
    throw new Error(
      `Outcome task ${taskId} is ${taskTransition.task.state}, not ${cleanEntry.outcome}.`,
    );
  }
  const transitionEvent = taskTransition.event ?? matchingTransitions[0];
  if (!transitionEvent) {
    throw new Error(
      `Outcome task ${taskId} has no matching lifecycle transition for ${cleanEntry.outcome}.`,
    );
  }
  if (existingEntry) {
    control.appendOutcomeControlEvent({
      stateRoot,
      actor,
      leaseName,
      leaseToken,
      taskId,
      eventId: predictedControlEventId,
      nowMs: now.getTime(),
      data: predictedControlEventData,
    });
    control.finalizeTaskOutcome({
      stateRoot,
      taskId,
      actor,
      leaseName,
      leaseToken,
      outcome: cleanEntry.outcome,
      outcomeDigest,
      taskRevision: taskTransition.task.revision,
      nowMs: now.getTime(),
    });
    checkpoint("outcome-finalized");
    return existingEntry;
  }

  const controlEventId = outcomeRecordedEventId({
    taskId,
    taskRevision: taskTransition.task.revision,
    outcomeDigest,
    transitionEventId: transitionEvent.eventId,
  });
  const controlEventData = outcomeRecordedEventData({
    cleanEntry,
    taskId,
    taskRevision: taskTransition.task.revision,
    taskState: taskTransition.task.state,
    ledgerPath,
    leaseName,
    evidence,
    outcomeDigest,
    transitionEventId: transitionEvent.eventId,
  });
  const controlEvent = control.appendOutcomeControlEvent({
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    eventId: controlEventId,
    nowMs: now.getTime(),
    data: controlEventData,
  });
  checkpoint("outcome-control-event-appended");
  control.appendOutcomeControlEvent({
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    eventId: controlEventId,
    nowMs: now.getTime(),
    data: controlEventData,
  });
  const authenticatedEntry = authenticatedOutcomeEntry(cleanEntry, {
    actor,
    leaseName,
    controlEventId: controlEvent.eventId,
    transitionEventId: transitionEvent.eventId,
    outcomeDigest,
    taskRevision: taskTransition.task.revision,
  });
  appendOutcomeEntryUnlocked(
    ledgerPath,
    authenticatedEntry,
    admission.ledgerSnapshot,
    {
      beforePublish: () => {
        checkpoint("outcome-ledger-before-publication");
        control.reauthorize();
      },
    },
  );
  checkpoint("outcome-ledger-appended");
  control.finalizeTaskOutcome({
    stateRoot,
    taskId,
    actor,
    leaseName,
    leaseToken,
    outcome: cleanEntry.outcome,
    outcomeDigest,
    taskRevision: taskTransition.task.revision,
    nowMs: now.getTime(),
  });
  checkpoint("outcome-finalized");
  return authenticatedEntry;
}

export function appendOutcomeLedger(filePath, entry, options = {}) {
  const normalizedOptions =
    options instanceof Date ? { now: options } : options;
  const now = normalizedOptions.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Outcome recording requires a valid timestamp.");
  }
  const stateRoot = path.resolve(
    normalizedOptions.stateRoot ?? path.dirname(path.resolve(filePath)),
  );
  const authentication = normalizedOptions.authentication ?? {};
  const taskId = requireOutcomeRecordRequest(entry, now);
  const actor = String(authentication.actor ?? "").trim();
  const leaseName = String(authentication.leaseName ?? "").trim();
  const leaseToken = String(authentication.leaseToken ?? "").trim();
  if (!actor || !leaseName || !leaseToken) {
    throw new Error(
      "Outcome recording requires an authenticated actor, lease name, and lease token.",
    );
  }
  if (!automationActorCanRecordOutcome(actor, entry.outcome)) {
    throw new Error(
      `Actor ${actor || "unknown"} cannot record ${entry.outcome} outcomes.`,
    );
  }

  const resolvedOutcome = resolveOutcomeEvidence({ ...entry, taskId });

  const ledgerPath = path.resolve(filePath);
  const canonicalLedgerPath = automationControlPaths(stateRoot).outcomes;
  if (ledgerPath !== canonicalLedgerPath) {
    throw new Error(
      `Outcome recording requires the canonical ledger at ${canonicalLedgerPath}.`,
    );
  }
  requireOutcomeRepairPrivateDescendants(
    stateRoot,
    automationControlPaths(stateRoot).controlRoot,
  );
  const ownerPlan =
    actor === "freed-owner"
      ? normalizeOutcomeRecordPlan(normalizedOptions.ownerPlan, {
          stateRoot,
          ledgerPath,
          taskId,
        })
      : null;
  if (actor === "freed-owner" && leaseName !== "owner-governance") {
    throw new Error(
      "freed-owner outcome recording requires the owner-governance lease.",
    );
  }
  if (actor !== "freed-owner" && normalizedOptions.ownerPlan !== undefined) {
    throw new Error("Only freed-owner may apply an owner outcome plan.");
  }
  requireOutcomeLedgerAppendAdmission(ledgerPath, stateRoot);
  return withMutationLeaseAuthority(
    {
      stateRoot,
      actor,
      leaseName,
      leaseToken,
      taskId,
      ownerIntentDigest: ownerPlan?.intentDigest,
    },
    (authorityContext) =>
      withOutcomeLedgerWriterLock(ledgerPath, (writerGuardContext) => {
        withOutcomeRecordingGuards(
          {
            stateRoot,
            nowMs: now.getTime(),
            ownerIntent: ownerPlan?.intent ?? null,
            authorityContext,
          },
          () => null,
        );
        const initialAdmission = requireOutcomeLedgerAppendAdmission(
          ledgerPath,
          stateRoot,
          { writerGuardContext },
        );
        (normalizedOptions.checkpoint ?? (() => {}))(
          "outcome-admitted-before-final-guards",
        );
        return withOutcomeRecordingGuards(
          {
            stateRoot,
            nowMs: now.getTime(),
            ownerIntent: ownerPlan?.intent ?? null,
            authorityContext,
          },
          (control) =>
            appendOutcomeLedgerLocked({
              ledgerPath,
              stateRoot,
              entry,
              taskId,
              actor,
              leaseName,
              leaseToken,
              now,
              resolvedOutcome,
              checkpoint: normalizedOptions.checkpoint ?? (() => {}),
              initialAdmission,
              control,
              ownerPlan,
            }),
        );
      }),
  );
}

export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines.shift()?.split("\t") ?? [];
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

export function parseGitWorktreePorcelain(text) {
  const entries = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") {
      if (current) {
        entries.push(current);
      }
      current = { path: value, head: "", branch: "", detached: false };
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === "HEAD") {
      current.head = value;
    } else if (key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (key === "detached") {
      current.detached = true;
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxNumber(rows, field) {
  let max = null;
  for (const row of rows) {
    const value = numeric(row[field]);
    if (value === null) {
      continue;
    }
    max = max === null ? value : Math.max(max, value);
  }
  return max;
}

function lastValue(rows, field) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index]?.[field];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}

export function resolveCurrentSoakDir(pointerPath = DEFAULT_SOAK_POINTER) {
  const pointed = readText(pointerPath).trim();
  if (!pointed) {
    return "";
  }
  try {
    return realpathSync(pointed);
  } catch {
    return pointed;
  }
}

export function summarizeSoak(soakDir) {
  if (!soakDir || !existsSync(soakDir)) {
    return {
      exists: false,
      soakDir,
      fallbackFrom: "",
      sampleCount: 0,
      maxWebKitResidentBytes: null,
      maxEventLoopLagMs: null,
      maxDomNodes: null,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "",
      firstTimestamp: "",
      lastTimestamp: "",
    };
  }

  const metricsPath = path.join(soakDir, "metrics.tsv");
  const healthPath = path.join(soakDir, "runtime-health.jsonl");
  const rows = parseTsv(readText(metricsPath));
  const healthRows = readJsonLines(healthPath);

  const healthMaxWebKit = healthRows.reduce((max, row) => {
    const value = numeric(
      row.webkitResidentBytes ?? row.webkitLargestResidentBytes,
    );
    return value === null ? max : Math.max(max ?? value, value);
  }, null);

  const healthMaxLag = healthRows.reduce((max, row) => {
    const value = numeric(row.eventLoopLagMs);
    return value === null ? max : Math.max(max ?? value, value);
  }, null);

  const metricsMaxWebKitKb = maxNumber(rows, "health_webkit_rss_bytes");
  const fallbackWebKitKb = maxNumber(rows, "webkit_rss_kb_all");
  const metricsMaxWebKit =
    metricsMaxWebKitKb !== null
      ? metricsMaxWebKitKb
      : fallbackWebKitKb !== null
        ? fallbackWebKitKb * 1024
        : null;

  const staleHeartbeatCount =
    rows.filter((row) => row.health_event === "renderer_heartbeat_stale")
      .length +
    healthRows.filter((row) => row.event === "renderer_heartbeat_stale").length;
  const throttledHeartbeatCount =
    rows.filter((row) => row.health_hidden_timer_throttled === "true").length +
    healthRows.filter((row) => row.hiddenTimerThrottled === true).length;

  return {
    exists: true,
    soakDir,
    fallbackFrom: "",
    sampleCount: Math.max(rows.length, healthRows.length),
    maxWebKitResidentBytes: Math.max(
      healthMaxWebKit ?? 0,
      metricsMaxWebKit ?? 0,
    ),
    maxEventLoopLagMs: Math.max(
      healthMaxLag ?? 0,
      maxNumber(rows, "health_event_loop_lag_ms") ?? 0,
    ),
    maxDomNodes: Math.max(
      maxNumber(rows, "health_dom_nodes") ?? 0,
      healthRows.reduce(
        (max, row) => Math.max(max, numeric(row.domNodeCount) ?? 0),
        0,
      ),
    ),
    staleHeartbeatCount,
    throttledHeartbeatCount,
    lastEvent:
      lastValue(rows, "health_event") || String(healthRows.at(-1)?.event ?? ""),
    firstTimestamp: rows[0]?.ts ?? String(healthRows[0]?.tsMs ?? ""),
    lastTimestamp: rows.at(-1)?.ts ?? String(healthRows.at(-1)?.tsMs ?? ""),
  };
}

export function assessSoakEvidenceQuality(soak, nowMs = Date.now()) {
  const reasons = [];
  if (!soak.exists) {
    reasons.push("missing");
  }
  if ((soak.sampleCount ?? 0) <= 0) {
    reasons.push("empty");
  } else if ((soak.sampleCount ?? 0) < MIN_PERFORMANCE_SOAK_SAMPLES) {
    reasons.push("insufficient-samples");
  }

  const lastSoakMs = parseTimestampMs(soak.lastTimestamp);
  if (lastSoakMs !== null && nowMs - lastSoakMs > STALE_SOAK_MS) {
    reasons.push("stale");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    minSamples: MIN_PERFORMANCE_SOAK_SAMPLES,
  };
}

export function findLatestReadableSoakDir(rootDir, ignoredDir = "") {
  if (!rootDir || !existsSync(rootDir)) {
    return "";
  }

  let ignored = ignoredDir;
  try {
    ignored = ignoredDir ? realpathSync(ignoredDir) : "";
  } catch {
    ignored = ignoredDir;
  }

  let entries = [];
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return "";
  }

  return (
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const candidatePath = path.join(rootDir, entry.name);
        let resolved = candidatePath;
        try {
          resolved = realpathSync(candidatePath);
        } catch {
          resolved = candidatePath;
        }
        if (ignored && resolved === ignored) {
          return null;
        }
        const summary = summarizeSoak(candidatePath);
        if (summary.sampleCount <= 0) {
          return null;
        }
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(candidatePath).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return {
          path: candidatePath,
          mtimeMs,
          sampleCount: summary.sampleCount,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.mtimeMs !== left.mtimeMs) {
          return right.mtimeMs - left.mtimeMs;
        }
        return right.sampleCount - left.sampleCount;
      })[0]?.path ?? ""
  );
}

export function resolveReadableSoak(
  soakDir = "",
  pointerPath = DEFAULT_SOAK_POINTER,
) {
  const preferredDir = soakDir || resolveCurrentSoakDir(pointerPath);
  const preferred = summarizeSoak(preferredDir);
  if (preferred.sampleCount > 0) {
    return preferred;
  }

  // Only default invocations may widen the search to the machine-global soak
  // roots (including the legacy /tmp root, kept readable for one release).
  // Explicit --soak-dir/--soak-pointer callers stay scoped to their own root.
  const usingDefaults = !soakDir && pointerPath === DEFAULT_SOAK_POINTER;
  const fallbackDir =
    findLatestReadableSoakDir(
      path.dirname(preferredDir || pointerPath),
      preferredDir,
    ) ||
    (usingDefaults
      ? findLatestReadableSoakDir(
          path.join(AUTOMATION_STATE_DIR, "soaks"),
          preferredDir,
        ) || findLatestReadableSoakDir(LEGACY_SOAK_ROOT, preferredDir)
      : "");
  if (!fallbackDir) {
    return preferred;
  }
  return {
    ...summarizeSoak(fallbackDir),
    fallbackFrom: preferredDir,
  };
}

export function repairSoakPointer(
  pointerPath = DEFAULT_SOAK_POINTER,
  options = {},
) {
  const currentDir = resolveCurrentSoakDir(pointerPath);
  const current = summarizeSoak(currentDir);
  if (current.sampleCount > 0) {
    return {
      repaired: false,
      reason: "current-readable",
      pointerPath,
      previousDir: currentDir,
      readableDir: currentDir,
      sampleCount: current.sampleCount,
      dryRun: Boolean(options.dryRun),
    };
  }

  const rootDir = path.dirname(currentDir || pointerPath);
  const readableDir =
    findLatestReadableSoakDir(rootDir, currentDir) ||
    (pointerPath === DEFAULT_SOAK_POINTER
      ? findLatestReadableSoakDir(
          path.join(AUTOMATION_STATE_DIR, "soaks"),
          currentDir,
        ) || findLatestReadableSoakDir(LEGACY_SOAK_ROOT, currentDir)
      : "");
  if (!readableDir) {
    return {
      repaired: false,
      reason: "no-readable-soak",
      pointerPath,
      previousDir: currentDir,
      readableDir: "",
      sampleCount: 0,
      dryRun: Boolean(options.dryRun),
    };
  }

  const readable = summarizeSoak(readableDir);
  if (!options.dryRun) {
    mkdirSync(path.dirname(pointerPath), { recursive: true });
    writeFileSync(pointerPath, `${readableDir}\n`);
  }

  return {
    repaired: !options.dryRun,
    reason: options.dryRun ? "dry-run" : "repaired",
    pointerPath,
    previousDir: currentDir,
    readableDir,
    sampleCount: readable.sampleCount,
    dryRun: Boolean(options.dryRun),
  };
}

function latestDatedSection(markdown) {
  const matches = [...markdown.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/gm)];
  if (matches.length === 0) {
    return { date: "", text: "" };
  }
  const match = matches.at(-1);
  const start = match.index ?? 0;
  const next = markdown.indexOf("\n## ", start + 1);
  return {
    date: match[1],
    text: markdown.slice(start, next === -1 ? markdown.length : next).trim(),
  };
}

export function summarizeDailyBugMemory(memoryPath) {
  const text = readText(memoryPath);
  const latest = latestDatedSection(text);
  const latestHadNoFix =
    /no\s+(evidence-backed\s+)?(bug|fix)|no fix applied/i.test(latest.text);
  return {
    exists: Boolean(text),
    path: memoryPath,
    latestDate: latest.date,
    latestSection: latest.text,
    latestHadNoNewCommits:
      /(?:^|[^\d])`?0`?\s+(?:additional\s+)?commits\b|no new repo (?:evidence|commits)\b/i.test(
        latest.text,
      ),
    latestHadFix:
      !latestHadNoFix &&
      /outcome:\s+.*(?:fix applied|implemented|\bmerged\b)|fix\s+(?:applied|shipped|published)\b/i.test(
        latest.text,
      ),
  };
}

function git(repo, args) {
  try {
    return execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return "";
  }
}

function gh(repo, args) {
  try {
    return execFileSync("gh", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return "";
  }
}

function collectMergedPullRequestHeads(repo) {
  const output = gh(repo, [
    "pr",
    "list",
    "--state",
    "merged",
    "--base",
    "dev",
    "--limit",
    "200",
    "--json",
    "headRefName,headRefOid",
  ]);
  if (!output) {
    return new Map();
  }

  try {
    const pullRequests = JSON.parse(output);
    const mergedHeads = new Map();
    for (const pullRequest of pullRequests) {
      const branch = String(pullRequest.headRefName ?? "");
      const headOid = String(pullRequest.headRefOid ?? "");
      if (!branch || !headOid) {
        continue;
      }
      const branchHeads = mergedHeads.get(branch) ?? new Set();
      branchHeads.add(headOid);
      mergedHeads.set(branch, branchHeads);
    }
    return mergedHeads;
  } catch {
    return new Map();
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function shortStatusPaths(statusText) {
  return statusText
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .map((filePath) => filePath.replace(/^.* -> /, ""))
    .filter(Boolean);
}

function normalizeRepoFilePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/\/+$/u, "");
}

function isKnownGeneratedArtifactPath(filePath) {
  const normalizedPath = normalizeRepoFilePath(filePath);
  return KNOWN_GENERATED_ARTIFACT_PATHS.some(
    (artifactPath) =>
      normalizedPath === artifactPath ||
      normalizedPath.startsWith(`${artifactPath}/`),
  );
}

function filterGeneratedArtifactStatus(statusText) {
  return statusText
    .split(/\r?\n/)
    .filter(
      (line) =>
        !isKnownGeneratedArtifactPath(
          line
            .slice(3)
            .trim()
            .replace(/^.* -> /, ""),
        ),
    )
    .filter(Boolean)
    .join("\n");
}

// Provider-visible classification is single-sourced in
// scripts/lib/provider-visible-paths.mjs (stability task W1-06). The old
// substring heuristic here diverged from validate-worktree's classification.
const providerVisiblePath = isProviderVisiblePath;

function peerWorktreeScore(peer) {
  let score = 46;
  if (peer.explicit) {
    score += 12;
  }
  if (peer.branch.includes("scraper-recycle-verification")) {
    score += 42;
  }
  if (peer.touchesNightlyRunner) {
    score += 48;
  }
  if (peer.touchesMemoryTelemetry) {
    score += 28;
  }
  if (peer.changedFileCount >= 6) {
    score += 8;
  }
  if (peer.providerVisible) {
    score -= 15;
  }
  if (peer.aheadCount === 0 && peer.changedFileCount > 0) {
    score -= 16;
    if (peer.behindCount >= 25) {
      score -= 24;
    }
  }
  if (peer.aheadCount > 0 && peer.behindCount >= 25) {
    score -= 8;
  }
  return Math.min(99, Math.max(1, score));
}

export function shouldRetainPeerWorktree(peer) {
  if (peer.explicit) {
    return true;
  }
  if (/nightly|self|runner|automation|scraper-recycle/i.test(peer.branch)) {
    return true;
  }
  if (peer.providerVisible && peer.behindCount <= 25) {
    return true;
  }
  return false;
}

export function summarizePeerWorktree(worktreePath, currentRepo) {
  if (!worktreePath || !existsSync(worktreePath)) {
    return null;
  }

  let resolved = worktreePath;
  let current = currentRepo;
  try {
    resolved = realpathSync(worktreePath);
    current = realpathSync(currentRepo);
  } catch {
    return null;
  }

  if (resolved === current) {
    return null;
  }

  const branch =
    git(resolved, ["branch", "--show-current"]) ||
    git(resolved, ["rev-parse", "--abbrev-ref", "HEAD"]) ||
    "unknown";
  const headOid = git(resolved, ["rev-parse", "HEAD"]);
  const head = headOid
    ? headOid.slice(0, 8)
    : git(resolved, ["rev-parse", "--short", "HEAD"]);
  const status = filterGeneratedArtifactStatus(
    git(resolved, ["status", "--short", "--untracked-files=all"]),
  );
  const committedFiles = git(resolved, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "origin/dev...HEAD",
  ]);
  const workingFiles = unique([
    ...shortStatusPaths(status),
    ...committedFiles.split(/\r?\n/),
  ]).sort();
  const aheadCount = Number.parseInt(
    git(resolved, ["rev-list", "--count", "origin/dev..HEAD"]) || "0",
    10,
  );
  const behindCount = Number.parseInt(
    git(resolved, ["rev-list", "--count", "HEAD..origin/dev"]) || "0",
    10,
  );

  const touchesMemoryTelemetry = workingFiles.some(
    (filePath) =>
      filePath.includes("memory-monitor") ||
      filePath.includes("runtime-health") ||
      filePath.includes("src-tauri/src/lib.rs") ||
      filePath.includes("perf-") ||
      filePath.includes("playwright.config"),
  );
  const touchesNightlyRunner = workingFiles.some(
    (filePath) =>
      filePath.includes("nightly-self-improve") ||
      filePath.includes("automation") ||
      filePath.includes("self-improve"),
  );
  const providerVisible = workingFiles.some(providerVisiblePath);

  return {
    path: resolved,
    branch,
    head,
    headOid,
    status,
    aheadCount: Number.isFinite(aheadCount) ? aheadCount : 0,
    behindCount: Number.isFinite(behindCount) ? behindCount : 0,
    changedFiles: workingFiles,
    changedFileCount: workingFiles.length,
    touchesMemoryTelemetry,
    touchesNightlyRunner,
    providerVisible,
    explicit: false,
    score: 0,
  };
}

function matchesMergedPullRequestHead(peer, mergedPullRequestHeads) {
  if (!peer?.branch || !peer?.headOid) {
    return false;
  }
  return mergedPullRequestHeads.get(peer.branch)?.has(peer.headOid) ?? false;
}

export function collectPeerWorktrees(
  repo,
  explicitWorktrees = [],
  scan = true,
  mergedPullRequestHeads = null,
) {
  const explicitPaths = new Set(
    explicitWorktrees.flatMap((worktreePath) => {
      try {
        return [realpathSync(worktreePath)];
      } catch {
        return [];
      }
    }),
  );
  const mergedHeads =
    mergedPullRequestHeads ?? collectMergedPullRequestHeads(repo);
  const worktreePaths = [...explicitWorktrees];
  if (scan) {
    const worktreeList = git(repo, ["worktree", "list", "--porcelain"]);
    for (const entry of parseGitWorktreePorcelain(worktreeList)) {
      worktreePaths.push(entry.path);
    }
  }

  return unique(worktreePaths)
    .map((worktreePath) => summarizePeerWorktree(worktreePath, repo))
    .filter(Boolean)
    .map((peer) => ({
      ...peer,
      explicit: explicitPaths.has(peer.path),
      mergedToDev: matchesMergedPullRequestHead(peer, mergedHeads),
    }))
    .filter((peer) => peer.explicit || !peer.mergedToDev)
    .filter(shouldRetainPeerWorktree)
    .filter((peer) => peer.changedFileCount > 0 || peer.aheadCount > 0)
    .map((peer) => ({ ...peer, score: peerWorktreeScore(peer) }))
    .sort((left, right) => right.score - left.score);
}

function peerWorkTags(peer) {
  const tags = [];
  if (peer.touchesNightlyRunner) {
    tags.push("nightly-runner");
  }
  if (peer.touchesMemoryTelemetry) {
    tags.push("memory-telemetry");
  }
  if (peer.providerVisible) {
    tags.push("provider-visible");
  }
  for (const filePath of peer.changedFiles ?? []) {
    if (filePath.startsWith("packages/desktop/")) {
      tags.push("desktop");
    } else if (filePath.startsWith("packages/ui/")) {
      tags.push("ui");
    } else if (filePath.startsWith("packages/shared/")) {
      tags.push("shared");
    } else if (filePath.startsWith("website/")) {
      tags.push("website");
    } else if (filePath.startsWith("scripts/")) {
      tags.push("scripts");
    }
  }
  return unique(tags);
}

export function collectDuplicateWork(peerWorktrees = []) {
  const findings = [];
  const peers = peerWorktrees.map((peer) => ({
    ...peer,
    tags: peerWorkTags(peer),
  }));
  const fileOwners = new Map();
  const tagOwners = new Map();

  for (const peer of peers) {
    for (const filePath of peer.changedFiles ?? []) {
      const owners = fileOwners.get(filePath) ?? [];
      owners.push(peer);
      fileOwners.set(filePath, owners);
    }
    for (const tag of peer.tags) {
      const owners = tagOwners.get(tag) ?? [];
      owners.push(peer);
      tagOwners.set(tag, owners);
    }
  }

  for (const [filePath, owners] of fileOwners) {
    if (owners.length < 2) {
      continue;
    }
    findings.push({
      id: `file-${filePath
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()}`,
      kind: "file-overlap",
      severity: "blocker",
      title: `Multiple peer worktrees changed ${filePath}`,
      key: filePath,
      peers: owners.map((peer) => ({
        branch: peer.branch,
        path: peer.path,
        head: peer.head,
      })),
    });
  }

  for (const [tag, owners] of tagOwners) {
    if (owners.length < 2) {
      continue;
    }
    findings.push({
      id: `tag-${tag}`,
      kind: "surface-overlap",
      severity: tag === "provider-visible" ? "blocker" : "warning",
      title: `Multiple peer worktrees are touching ${tag}`,
      key: tag,
      peers: owners.map((peer) => ({
        branch: peer.branch,
        path: peer.path,
        head: peer.head,
      })),
    });
  }

  return {
    findingCount: findings.length,
    blockerCount: findings.filter((finding) => finding.severity === "blocker")
      .length,
    warningCount: findings.filter((finding) => finding.severity === "warning")
      .length,
    findings,
  };
}

export function collectRepoSnapshot(repo) {
  return {
    branch:
      git(repo, ["branch", "--show-current"]) ||
      git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(repo, ["rev-parse", "--short", "HEAD"]),
    originDev: git(repo, ["rev-parse", "--short", "origin/dev"]),
    originMain: git(repo, ["rev-parse", "--short", "origin/main"]),
    status: git(repo, ["status", "--short"]),
  };
}

function riskAction({
  id,
  kind,
  title,
  safety = "manual",
  command = "",
  automationId = "",
  notes = "",
}) {
  return { id, kind, title, safety, command, automationId, notes };
}

function riskItem({
  id,
  severity,
  title,
  evidence,
  remediation,
  actions = [],
}) {
  return { id, severity, title, evidence, remediation, actions };
}

function expectedBranchHead(repo, expectedBranch) {
  if (expectedBranch === "dev") return repo.originDev || "";
  if (expectedBranch === "main") return repo.originMain || "";
  return "";
}

function matchesExpectedBranch(repo, expectedBranch) {
  if (!expectedBranch) return true;
  if (repo.branch === expectedBranch) return true;
  const expectedHead = expectedBranchHead(repo, expectedBranch);
  return (
    repo.branch === "HEAD" &&
    Boolean(repo.head) &&
    Boolean(expectedHead) &&
    repo.head === expectedHead
  );
}

export function collectRiskSnapshot({
  repoPath,
  repo,
  soak,
  peerWorktrees = [],
  duplicateWork,
  crashAutomation,
  dailyBugMemory,
  devBotMemory,
  expectedBranch = "dev",
  nowMs = Date.now(),
}) {
  const risks = [];
  if (!matchesExpectedBranch(repo, expectedBranch)) {
    risks.push(
      riskItem({
        id: "unexpected-repo-branch",
        severity: "blocker",
        title: `Nightly planning is running from ${repo.branch || "an unknown branch"} instead of ${expectedBranch}`,
        evidence: [
          repoPath,
          `branch ${repo.branch || "unknown"}`,
          `HEAD ${repo.head || "unknown"}`,
          `origin/dev ${repo.originDev || "unknown"}`,
        ],
        remediation:
          "Run the nightly planner from a current dev worktree or pass --repo with the intended dev checkout. Use --no-expected-branch only for deliberate diagnostics.",
        actions: [
          riskAction({
            id: "rerun-from-dev-worktree",
            kind: "manual",
            title: "Rerun the nightly planner from dev",
            notes:
              "The all-night runner targets dev product work, so running it from main can distort release and target selection.",
          }),
        ],
      }),
    );
  } else if (
    expectedBranch === "dev" &&
    repo.head &&
    repo.originDev &&
    repo.head !== repo.originDev
  ) {
    risks.push(
      riskItem({
        id: "stale-dev-worktree",
        severity: "warning",
        title: "Nightly planning dev worktree is not at origin/dev",
        evidence: [
          repoPath,
          `HEAD ${repo.head}`,
          `origin/dev ${repo.originDev}`,
        ],
        remediation:
          "Refresh the dev worktree before choosing overnight work so target selection uses the current branch tip.",
        actions: [
          riskAction({
            id: "refresh-dev-worktree",
            kind: "manual",
            title: "Refresh the dev worktree",
            notes:
              "Use the repo worktree flow to create or update a clean dev-based checkout before planning.",
          }),
        ],
      }),
    );
  }

  const repoStatusPaths = shortStatusPaths(repo.status ?? "");
  if (repoStatusPaths.length > 0) {
    risks.push(
      riskItem({
        id: "dirty-current-worktree",
        severity: "blocker",
        title: "Current worktree has uncommitted changes",
        evidence: repoStatusPaths.slice(0, 12),
        remediation:
          "Inspect the current worktree before starting autonomous edits so generated files or user changes do not get mixed into the next fix.",
        actions: [
          riskAction({
            id: "inspect-current-worktree",
            kind: "manual",
            title: "Inspect current worktree changes before editing",
            notes:
              "Do not auto-clean a dirty worktree because the changes may belong to another agent or the user.",
          }),
        ],
      }),
    );
  }

  for (const relativePath of KNOWN_GENERATED_ARTIFACT_PATHS) {
    const absolutePath = path.join(repoPath, relativePath);
    const fileCount = countFiles(absolutePath);
    if (fileCount > 0) {
      risks.push(
        riskItem({
          id: `generated-artifacts-${relativePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          severity: "warning",
          title: `Generated artifacts exist in ${relativePath}`,
          evidence: [
            absolutePath,
            `${numberFormatter.format(fileCount)} files`,
          ],
          remediation:
            "Remove generated reports or intentionally stage them before publishing so validation leftovers do not pollute the branch.",
          actions: [
            riskAction({
              id: `remove-generated-${relativePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
              kind: "local-command",
              title: `Remove generated artifacts from ${relativePath}`,
              safety: "safe-local",
              command: `rm -rf ${JSON.stringify(relativePath)}`,
              notes:
                "Only removes known generated validation artifacts inside the current worktree.",
            }),
          ],
        }),
      );
    }
  }

  if (!existsSync(path.join(repoPath, "node_modules"))) {
    risks.push(
      riskItem({
        id: "missing-root-node-modules",
        severity: "warning",
        title: "Root dependencies are not installed",
        evidence: [path.join(repoPath, "node_modules")],
        remediation:
          "Keep bug scanning and planning moving, then bootstrap the worktree before any validation or fix path that depends on repo packages.",
        actions: [
          riskAction({
            id: "bootstrap-root-dependencies",
            kind: "local-command",
            title: "Install root dependencies",
            safety: "safe-local",
            command: "corepack npm ci",
          }),
        ],
      }),
    );
  }

  if (soak.exists && soak.lastTimestamp) {
    const lastSoakMs = parseTimestampMs(soak.lastTimestamp);
    if (lastSoakMs !== null && nowMs - lastSoakMs > STALE_SOAK_MS) {
      risks.push(
        riskItem({
          id: "stale-soak-evidence",
          severity: "warning",
          title: "Installed-build soak evidence is stale",
          evidence: [
            soak.soakDir,
            `Last sample ${soak.lastTimestamp}`,
            `Age ${numberFormatter.format(Math.round((nowMs - lastSoakMs) / 60000))} min`,
          ],
          remediation:
            "Restart the installed-build soak before using its memory, lag, or heartbeat data to pick the next performance fix.",
          actions: [
            riskAction({
              id: "restart-installed-build-soak",
              kind: "manual",
              title: "Restart the installed-build soak",
              notes:
                "This runner can identify stale soak evidence, but the soak loop itself is environment-specific and should be restarted by the active soak workflow.",
            }),
          ],
        }),
      );
    }
  }

  if (soak.exists && soak.sampleCount === 0) {
    risks.push(
      riskItem({
        id: "empty-soak-evidence",
        severity: "warning",
        title: "Installed-build soak directory has no readable samples",
        evidence: [soak.soakDir],
        remediation:
          "Inspect the soak loop and restart it before treating soak-backed performance targets as measured evidence.",
        actions: [
          riskAction({
            id: "repair-soak-pointer",
            kind: "local-command",
            title: "Try repairing the active soak pointer",
            safety: "safe-local",
            command:
              "node scripts/nightly-self-improve.mjs --repair-soak-pointer",
            notes:
              "Repairs only when a newer readable soak exists under the same soak root.",
          }),
        ],
      }),
    );
  }

  if (
    soak.exists &&
    soak.sampleCount > 0 &&
    soak.sampleCount < MIN_PERFORMANCE_SOAK_SAMPLES
  ) {
    risks.push(
      riskItem({
        id: "thin-soak-evidence",
        severity: "warning",
        title:
          "Installed-build soak has too few samples for performance targeting",
        evidence: [
          soak.soakDir,
          `${numberFormatter.format(soak.sampleCount)} samples`,
          `Need at least ${numberFormatter.format(MIN_PERFORMANCE_SOAK_SAMPLES)} samples`,
        ],
        remediation:
          "Restart or continue the installed-build soak before using memory, lag, or heartbeat data to select a performance fix.",
        actions: [
          riskAction({
            id: "continue-installed-build-soak",
            kind: "manual",
            title: "Continue or restart the installed-build soak",
            notes:
              "The runner needs more fresh samples before treating performance evidence as a target.",
          }),
        ],
      }),
    );
  }

  if (soak.exists && soak.fallbackFrom) {
    risks.push(
      riskItem({
        id: "soak-fallback-evidence",
        severity: "info",
        title:
          "Planner used the newest readable soak instead of the current pointer",
        evidence: [
          `Pointer ${soak.fallbackFrom}`,
          `Readable soak ${soak.soakDir}`,
          `${numberFormatter.format(soak.sampleCount)} samples`,
        ],
        remediation:
          "Refresh the current soak pointer after the soak loop restarts so future runs use the active installed-build evidence directly.",
        actions: [
          riskAction({
            id: "repair-soak-pointer",
            kind: "local-command",
            title: "Repair the active soak pointer",
            safety: "safe-local",
            command:
              "node scripts/nightly-self-improve.mjs --repair-soak-pointer",
            notes:
              "Updates the pointer to the newest readable soak without contacting providers or launching the app.",
          }),
        ],
      }),
    );
  }

  for (const peer of peerWorktrees) {
    if (peer.providerVisible) {
      risks.push(
        riskItem({
          id: `provider-visible-peer-${peer.branch.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          severity: "warning",
          title: `Peer worktree ${peer.branch} touches provider-visible code`,
          evidence: [
            peer.path,
            ...peer.changedFiles.filter(providerVisiblePath).slice(0, 8),
          ],
          remediation:
            "Do not merge, cherry-pick, or reimplement this peer work unless the provider fingerprinting risk has explicit approval.",
          actions: [
            riskAction({
              id: "request-provider-visible-approval",
              kind: "manual",
              title: "Request explicit provider-visible approval",
              notes:
                "Name the provider, describe the observable behavior change, explain the fingerprinting risk, and offer a lower-profile alternative before continuing.",
            }),
          ],
        }),
      );
    }
    if (peer.status) {
      risks.push(
        riskItem({
          id: `dirty-peer-${peer.branch.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          severity: "warning",
          title: `Peer worktree ${peer.branch} has uncommitted changes`,
          evidence: [peer.path, ...shortStatusPaths(peer.status).slice(0, 8)],
          remediation:
            "Treat the peer as active work. Compare it read-only and do not cherry-pick from it until its state is understood.",
          actions: [
            riskAction({
              id: "inspect-dirty-peer",
              kind: "manual",
              title: "Inspect dirty peer worktree",
              notes:
                "Peer changes may belong to another active agent, so the runner should not auto-clean them.",
            }),
          ],
        }),
      );
    }
    if (peer.behindCount > 25) {
      risks.push(
        riskItem({
          id: `stale-peer-${peer.branch.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          severity: "warning",
          title: `Peer worktree ${peer.branch} is far behind origin/dev`,
          evidence: [
            peer.path,
            `Behind ${numberFormatter.format(peer.behindCount)} commits`,
          ],
          remediation:
            "Prefer reimplementing the useful idea on current dev over merging or cherry-picking stale work directly.",
          actions: [
            riskAction({
              id: "review-stale-peer",
              kind: "manual",
              title: "Review stale peer worktree before reuse",
              notes:
                "Use the peer only as read-only evidence unless it is rebased and revalidated.",
            }),
          ],
        }),
      );
    }
  }

  for (const finding of duplicateWork?.findings ?? []) {
    risks.push(
      riskItem({
        id: `duplicate-work-${finding.id}`,
        severity: finding.severity,
        title: finding.title,
        evidence: finding.peers.flatMap((peer) => [
          `Branch ${peer.branch}`,
          peer.path,
        ]),
        remediation:
          "Pick one owner or merge the safer subset before continuing so parallel agents do not publish competing fixes for the same surface.",
        actions: [
          riskAction({
            id: "dedupe-peer-work",
            kind: "manual",
            title: "Assign a single owner for overlapping peer work",
            notes:
              "Duplicate code ownership needs a human or active agent decision before publishing.",
          }),
        ],
      }),
    );
  }

  const automationStatuses = [
    ["crash-watch", crashAutomation],
    ["daily-bug-memory", dailyBugMemory],
    ["hourly-dev-bot-memory", devBotMemory],
  ]
    .filter(([, filePath]) => filePath)
    .map(([name, filePath]) => ({
      name,
      path: filePath,
      exists: existsSync(filePath),
      status: readAutomationStatus(filePath),
    }));

  for (const automation of automationStatuses) {
    if (!automation.exists) {
      risks.push(
        riskItem({
          id: `missing-${automation.name}`,
          severity: automation.name === "crash-watch" ? "warning" : "info",
          title: `${automation.name} evidence file is missing`,
          evidence: [automation.path],
          remediation:
            "Continue only if this evidence source is optional for the selected target, otherwise recreate or refresh it first.",
          actions: [
            riskAction({
              id: `refresh-${automation.name}`,
              kind: "manual",
              title: `Refresh ${automation.name} evidence`,
              notes:
                "The runner records the missing evidence but does not guess how to recreate this source.",
            }),
          ],
        }),
      );
    } else if (/paused/i.test(automation.status)) {
      risks.push(
        riskItem({
          id: `paused-${automation.name}`,
          severity: "warning",
          title: `${automation.name} automation is paused`,
          evidence: [automation.path, `status ${automation.status}`],
          remediation:
            "Resume or account for the paused automation before trusting overnight health or bug-scan coverage.",
          actions: [
            riskAction({
              id: `resume-${automation.name}`,
              kind: "automation-update",
              title: `Resume ${automation.name} automation`,
              safety: "agent-tool",
              automationId: automation.name,
              notes:
                "Requires the Codex automation tool because this is not a repo-local file edit.",
            }),
          ],
        }),
      );
    }
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    repoPath,
    blockerCount: risks.filter((risk) => risk.severity === "blocker").length,
    warningCount: risks.filter((risk) => risk.severity === "warning").length,
    infoCount: risks.filter((risk) => risk.severity === "info").length,
    automationStatuses,
    actionCount: risks.reduce(
      (count, risk) => count + (risk.actions?.length ?? 0),
      0,
    ),
    risks,
  };
}

/**
 * Read ranked triage task files (scripts/triage.mjs, stability W2-02). New
 * writers atomically point current.json at an immutable generation directory.
 * Legacy top-level T-<rank>-<bucket>.md files remain readable. Evidence older
 * than TRIAGE_FRESH_MS still loads but is marked stale so ranking can drop it
 * below roadmap work.
 */
export function loadTriageCandidates(
  dirPath = DEFAULT_TRIAGE_CANDIDATE_DIR,
  nowMs = Date.now(),
) {
  if (!existsSync(dirPath)) return [];
  let sourceDir = dirPath;
  let manifest = null;
  const currentPath = path.join(dirPath, "current.json");
  if (existsSync(currentPath)) {
    try {
      const parsed = JSON.parse(readFileSync(currentPath, "utf8"));
      const candidateSource = path.resolve(dirPath, parsed.generationDir ?? "");
      const candidateRoot = `${path.resolve(dirPath)}${path.sep}`;
      if (
        candidateSource.startsWith(candidateRoot) &&
        existsSync(candidateSource)
      ) {
        sourceDir = candidateSource;
        manifest = parsed;
      }
    } catch {
      // Fall through to the legacy top-level directory.
    }
  }
  const candidates = [];
  for (const name of readdirSync(sourceDir).sort()) {
    const match = name.match(/^T-(\d{2})-(.+)\.md$/);
    if (!match) continue;
    const filePath = path.join(sourceDir, name);
    let text;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (text.startsWith("# stale:")) continue;
    const titleMatch = text.match(/^# T-\d+: (.+)$/m);
    const programTaskMatch = text.match(/^Program task: (.+)$/m);
    const generatedAtMatch = text.match(/^Generated at: (.+)$/m);
    const evidenceWindowEndMatch = text.match(/^Evidence window end: (.+)$/m);
    const evidence = [...text.matchAll(/^- (.+)$/gm)]
      .map((m) => m[1])
      .slice(0, 6);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      /* treat as stale */
    }
    const generatedAt = generatedAtMatch?.[1] ?? manifest?.generatedAt ?? null;
    const evidenceWindowEnd =
      evidenceWindowEndMatch?.[1] ?? manifest?.evidenceWindowEnd ?? generatedAt;
    const programTask = programTaskMatch?.[1] ?? null;
    const programTaskContract = readProgramTaskContract(programTask);
    const manifestCandidate = manifest?.candidates?.find(
      (candidate) => candidate.file === name || candidate.id === match[2],
    );
    if (
      manifestCandidate &&
      (manifestCandidate.sourceHealth !== "healthy" ||
        !/^[0-9a-f]{64}$/.test(
          String(manifestCandidate.evidenceFingerprint ?? ""),
        ))
    ) {
      continue;
    }
    const evidenceWindowEndMs = Date.parse(evidenceWindowEnd ?? "");
    const freshnessReferenceMs = Number.isFinite(evidenceWindowEndMs)
      ? evidenceWindowEndMs
      : mtimeMs;
    candidates.push({
      rank: Number(match[1]),
      bucketId: match[2],
      title: titleMatch?.[1] ?? match[2],
      taskId: manifestCandidate?.taskId ?? null,
      programTask,
      providerVisible:
        manifestCandidate?.providerVisible ??
        programTaskContract.providerVisible,
      behavioral:
        manifestCandidate?.behavioral ?? programTaskContract.behavioral,
      soakExclusivityKey:
        manifestCandidate?.soakExclusivityKey ??
        programTaskContract.soakExclusivityKey,
      evidenceFingerprint: manifestCandidate?.evidenceFingerprint ?? null,
      sourceHealth: manifestCandidate?.sourceHealth ?? null,
      observerAuthority: manifestCandidate?.observerAuthority ?? null,
      evidence,
      filePath,
      generation: manifest?.generation ?? null,
      generatedAt,
      evidenceWindowEnd,
      fresh: nowMs - freshnessReferenceMs <= TRIAGE_FRESH_MS,
    });
  }
  return candidates.sort((left, right) => left.rank - right.rank);
}

function readProgramTaskContract(programTask) {
  const taskFileName = String(programTask ?? "").match(
    /([A-Za-z0-9-]+\.md)\b/,
  )?.[1];
  if (!taskFileName) {
    return {
      providerVisible: true,
      behavioral: true,
      soakExclusivityKey: DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY,
    };
  }
  const taskText = readText(
    path.join(REPO_ROOT, "docs", "stability-tasks", taskFileName),
  );
  const contractLine =
    taskText
      .split(/\r?\n/)
      .find((line) => /provider-visible:|soak-gated:/i.test(line)) ?? "";
  const providerVisible = /provider-visible:\s*true\b/i.test(contractLine);
  const behavioral = contractLine
    ? /soak-gated:\s*yes\b/i.test(contractLine)
    : true;
  const explicitKey =
    contractLine.match(/soak-exclusivity-key:\s*([A-Za-z0-9._:-]+)/i)?.[1] ??
    null;
  return {
    providerVisible,
    behavioral,
    soakExclusivityKey: behavioral
      ? (explicitKey ?? DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY)
      : null,
  };
}

function peerMayContainBehavior(peer) {
  return (peer.changedFiles ?? []).some(
    (filePath) =>
      filePath.startsWith("packages/") &&
      !/(?:^|\/)(?:tests?|fixtures?)\//i.test(filePath) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(filePath),
  );
}

function target({
  id,
  taskId = id,
  kind,
  title,
  score,
  confidence,
  estimatedMinutes,
  rationale,
  evidence,
  prompt,
  validation,
  providerVisible = false,
  canModify = true,
  evidenceWindowEnd = null,
  behavioral = false,
  soakExclusivityKey = null,
}) {
  const normalizedSoakExclusivityKey = behavioral
    ? (soakExclusivityKey ?? DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY)
    : null;
  return {
    id,
    taskId,
    kind,
    title,
    score,
    confidence,
    estimatedMinutes,
    providerVisible,
    canModify,
    evidenceWindowEnd,
    behavioral,
    soakExclusivityKey: normalizedSoakExclusivityKey,
    rationale,
    evidence,
    prompt,
    validation,
  };
}

export function buildCandidates({
  soak,
  dailyBug,
  repo,
  riskSnapshot,
  duplicateWork,
  peerWorktrees = [],
  crashAutomationExists,
  devBotMemoryExists,
  memoryBudgetBytes,
  triageCandidates = [],
}) {
  const candidates = [];
  const soakEvidenceQuality = assessSoakEvidenceQuality(soak);

  // Triage loop output (stability W2-02): evidence-ranked task files from
  // scripts/triage.mjs. Fresh alarm/verdict/canary evidence ranks ABOVE
  // roadmap work (score 94 down by rank vs roadmap's 48); stale files sink
  // below it instead of silently vanishing.
  for (const triage of triageCandidates.slice(0, 3)) {
    candidates.push(
      target({
        id: `triage-${triage.bucketId}`,
        taskId: triage.taskId,
        kind: "stability",
        title: `Triage: ${triage.title}`,
        score: triage.fresh ? Math.max(60, 94 - (triage.rank - 1) * 4) : 40,
        confidence: 0.85,
        estimatedMinutes: 90,
        providerVisible: triage.providerVisible === true,
        behavioral: triage.behavioral === true,
        soakExclusivityKey: triage.soakExclusivityKey,
        rationale:
          "The triage loop folded live runtime-health alarms, the latest soak verdict, canary regressions, and CI state into this ranked bucket. Execute the mapped stability-program task instead of re-deriving the problem.",
        evidence: [
          `Triage file: ${triage.filePath}`,
          ...(triage.programTask
            ? [`Program task: ${triage.programTask}`]
            : []),
          ...triage.evidence,
        ],
        prompt:
          `Read ${triage.filePath} and the program task it maps to (${triage.programTask ?? "see file"}). ` +
          "Execute that task under its own runner-safe/provider-visible/soak-gated header rules. A runner-safe:false task means open the PR and stop for owner review. Attach the triage evidence to the PR body.",
        validation: [
          "The mapped program task's counter-based verification governs; cite the counters that must move.",
          "Respect docs/STABILITY-PROGRAM.md rules: watchdog freeze, one behavioral change per soak cycle, provider-visible approval lane.",
        ],
        evidenceWindowEnd: triage.evidenceWindowEnd,
      }),
    );
  }

  if (
    (riskSnapshot?.blockerCount ?? 0) > 0 ||
    (riskSnapshot?.warningCount ?? 0) > 0
  ) {
    candidates.push(
      target({
        id: "nightly-preflight-risk",
        kind: "stability",
        title: "Resolve nightly preflight risks before autonomous work",
        score: (riskSnapshot?.blockerCount ?? 0) > 0 ? 99 : 73,
        confidence: (riskSnapshot?.blockerCount ?? 0) > 0 ? 0.94 : 0.78,
        estimatedMinutes: (riskSnapshot?.blockerCount ?? 0) > 0 ? 45 : 25,
        rationale:
          (riskSnapshot?.blockerCount ?? 0) > 0
            ? `Preflight found ${numberFormatter.format(riskSnapshot.blockerCount)} blocker risk before the run can safely edit or ship.`
            : `Preflight found ${numberFormatter.format(riskSnapshot.warningCount)} warning risks that may make overnight evidence stale or noisy.`,
        evidence: (riskSnapshot?.risks ?? [])
          .slice(0, 8)
          .flatMap((risk) => [
            `${risk.severity}: ${risk.title}`,
            ...risk.evidence.slice(0, 3),
          ]),
        prompt:
          "Read risk-snapshot.md first. Clear blocker risks before editing, refresh stale evidence when the selected target depends on it, and keep unrelated user changes out of the branch. If a risk is informational only, record why it is safe to proceed.",
        validation: [
          "Regenerate the nightly plan and confirm blockerCount is 0 before publishing.",
          "Run the focused validation for any cleanup or script change.",
          "Run validate:feature before publishing code changes.",
        ],
      }),
    );
  }

  if ((duplicateWork?.findingCount ?? 0) > 0) {
    candidates.push(
      target({
        id: "nightly-duplicate-work",
        kind: "stability",
        title: "Deduplicate overlapping overnight work before publishing",
        score: (duplicateWork?.blockerCount ?? 0) > 0 ? 96 : 76,
        confidence: (duplicateWork?.blockerCount ?? 0) > 0 ? 0.88 : 0.74,
        estimatedMinutes: 35,
        behavioral: true,
        rationale:
          (duplicateWork?.blockerCount ?? 0) > 0
            ? `Duplicate work detection found ${numberFormatter.format(duplicateWork.blockerCount)} blocker overlap across peer worktrees.`
            : `Duplicate work detection found ${numberFormatter.format(duplicateWork.warningCount)} warning overlap across peer worktrees.`,
        evidence: (duplicateWork?.findings ?? [])
          .slice(0, 6)
          .flatMap((finding) => [
            `${finding.severity}: ${finding.title}`,
            ...finding.peers.map((peer) => `${peer.branch} at ${peer.path}`),
          ]),
        prompt:
          "Read duplicate-work.md before publishing. Decide which branch owns each overlapped file or surface, absorb only the safer validated subset, and record skipped duplicate work in the morning report.",
        validation: [
          "Regenerate duplicate-work.md after any peer branch changes.",
          "Run focused validation for whichever branch absorbs the overlap.",
          "Run validate:feature before publishing.",
        ],
      }),
    );
  }

  for (const peer of peerWorktrees) {
    candidates.push(
      target({
        id: `peer-${peer.branch
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase()}`,
        kind: "peer-worktree",
        title: `Review and incorporate peer worktree ${peer.branch}`,
        score: peer.score,
        confidence: peer.branch.includes("scraper-recycle-verification")
          ? 0.88
          : 0.72,
        estimatedMinutes: peer.touchesNightlyRunner ? 75 : 55,
        providerVisible: peer.providerVisible,
        behavioral: peerMayContainBehavior(peer),
        rationale: peer.touchesMemoryTelemetry
          ? "A local peer worktree has memory or performance diagnostics changes that should be compared before selecting overnight fixes."
          : "A local peer worktree has unmerged changes that may overlap the nightly improvement path.",
        evidence: [
          peer.path,
          `Branch ${peer.branch}`,
          `Changed files ${numberFormatter.format(peer.changedFileCount)}`,
          `Ahead ${numberFormatter.format(peer.aheadCount)}, behind ${numberFormatter.format(peer.behindCount)}`,
          ...peer.changedFiles.slice(0, MAX_PEER_EVIDENCE_FILES),
        ],
        prompt:
          "Compare the peer worktree diff against this runner branch. Reimplement or cherry-pick safe measurement and orchestration ideas only after checking for active work, validation coverage, and provider-visible behavior. Do not modify the peer worktree.",
        validation: [
          "Run focused tests for any imported script, native, or desktop changes.",
          "Run validate:feature before publishing.",
          "Call out any peer changes that were intentionally not absorbed.",
        ],
      }),
    );
  }

  if (
    soakEvidenceQuality.ready &&
    soak.exists &&
    (soak.maxWebKitResidentBytes ?? 0) > memoryBudgetBytes
  ) {
    candidates.push(
      target({
        id: "webkit-memory-pressure",
        kind: "performance",
        title: "Reduce installed-build WebKit memory growth",
        score: 98,
        confidence: 0.9,
        estimatedMinutes: 150,
        behavioral: true,
        rationale: `The active soak observed WebKit RSS at ${formatBytes(soak.maxWebKitResidentBytes)}, above the ${formatBytes(memoryBudgetBytes)} budget.`,
        evidence: [
          soak.soakDir,
          `${numberFormatter.format(soak.sampleCount)} runtime samples`,
          `Max event loop lag ${numberFormatter.format(soak.maxEventLoopLagMs ?? 0)} ms`,
        ],
        prompt:
          "Inspect the active soak evidence and current desktop memory instrumentation. Find the largest retained WebKit memory source that can be fixed without changing provider-visible scraping behavior. Prefer cache disposal, virtualized UI retention, image lifecycle, or worker cleanup fixes with focused regression coverage.",
        validation: [
          "Run the focused unit or desktop perf test that covers the touched surface.",
          "Run npm run validate:feature before publishing.",
          "Start an installed-build soak after merge and compare max WebKit RSS to the prior run.",
        ],
      }),
    );
  }

  if (
    soakEvidenceQuality.ready &&
    soak.exists &&
    soak.staleHeartbeatCount > 0
  ) {
    candidates.push(
      target({
        id: "renderer-heartbeat-stale",
        kind: "stability",
        title: "Diagnose stale renderer heartbeat cycles",
        score: 88,
        confidence: 0.82,
        estimatedMinutes: 90,
        behavioral: true,
        rationale: `The active soak recorded ${numberFormatter.format(soak.staleHeartbeatCount)} stale heartbeat events.`,
        evidence: [
          soak.soakDir,
          `Last health event ${soak.lastEvent || "unknown"}`,
        ],
        prompt:
          "Preserve runtime-health and native logs, then distinguish real renderer stalls from hidden timer throttling. Patch the state machine or telemetry only when evidence proves a false positive or missed recovery path.",
        validation: [
          "Add state-machine coverage for stale, throttled, recovered, and visible heartbeat paths.",
          "Run the focused renderer health test plus validate:feature.",
        ],
      }),
    );
  }

  if (dailyBug.exists) {
    candidates.push(
      target({
        id: "daily-bug-fix-scan",
        kind: "bug-fix",
        title: "Run evidence-backed nightly bug fix scan",
        score: dailyBug.latestHadNoNewCommits ? 58 : 82,
        confidence: dailyBug.latestHadNoNewCommits ? 0.65 : 0.86,
        estimatedMinutes: dailyBug.latestHadNoNewCommits ? 25 : 90,
        behavioral: true,
        rationale: dailyBug.latestHadNoNewCommits
          ? "The last bug scan found no new commits, but bug fixing remains an executable nightly target once the commit window moves."
          : "The daily bug scan memory has fresh repo evidence that should be reviewed before choosing speculative work.",
        evidence: [
          dailyBug.path,
          dailyBug.latestDate
            ? `Latest scan ${dailyBug.latestDate}`
            : "No dated scan section found",
        ],
        prompt:
          "Read the daily bug scan memory first, use the last completed cutoff, fetch origin dev, main, and www, inspect only new non-release product commits, and implement the smallest evidence-backed fix if one survives targeted validation. If evidence is weak, report no evidence-backed bug found.",
        validation: [
          "Run the focused test for the touched code path.",
          "Append the scan outcome to daily bug scan memory.",
          "Run validate:feature before publishing any code fix.",
        ],
      }),
    );
  }

  if (crashAutomationExists) {
    candidates.push(
      target({
        id: "crash-watch-triage",
        kind: "stability",
        title: "Review crash watch signals before shipping",
        score: 64,
        confidence: 0.7,
        estimatedMinutes: 45,
        behavioral: true,
        rationale:
          "Crash watch exists as a separate heartbeat. Nightly runs should inspect it before choosing polish work.",
        evidence: [DEFAULT_CRASH_AUTOMATION],
        prompt:
          "Inspect the crash-watch automation state, recent macOS crash reports, and Freed logs. Only implement a fix if there is concrete evidence of a Freed-owned crash, blank window, or renderer stall.",
        validation: [
          "Add diagnostics or regression coverage for the exact failure state.",
          "Run the focused native or desktop test that proves the recovery path.",
        ],
      }),
    );
  }

  if (devBotMemoryExists) {
    candidates.push(
      target({
        id: "roadmap-autonomous-task",
        kind: "roadmap",
        title: "Choose the next small roadmap task after evidence targets",
        score: 48,
        confidence: 0.6,
        estimatedMinutes: 120,
        behavioral: true,
        rationale:
          "The paused hourly dev bot already records autonomous roadmap selection. It should be a fallback target after performance, crashes, and bugs.",
        evidence: [DEFAULT_DEV_BOT_MEMORY],
        prompt:
          "Compare current repo state to docs/PHASE files and choose one small, validation-friendly product task. Do not touch provider-visible scraping, auth, cookies, timing, or background navigation without explicit approval.",
        validation: [
          "Update affected docs/PHASE files and roadmap status or copy.",
          "Run focused tests for the changed product surface.",
          "Run validate:feature before publishing.",
        ],
      }),
    );
  }

  if (!repo.status) {
    candidates.push(
      target({
        id: "release-readiness-check",
        kind: "release",
        title: "Check whether validated fixes should ship as a dev build",
        score: 52,
        confidence: 0.62,
        estimatedMinutes: 40,
        rationale:
          "A clean worktree can safely decide whether merged fixes deserve a dev prerelease, but release shipping should happen after actual fixes land.",
        evidence: [
          `branch ${repo.branch || "unknown"}`,
          `HEAD ${repo.head || "unknown"}`,
          `origin/dev ${repo.originDev || "unknown"}`,
        ],
        prompt:
          "If one or more fixes merged into dev during the night, use the Freed release workflow to prepare, review, publish, and verify a dev build. Do not ship a release when only planning artifacts changed.",
        validation: [
          "Use the existing release note validator.",
          "Verify the GitHub release workflow and updater manifest.",
        ],
      }),
    );
  }

  candidates.push(
    target({
      id: "provider-visible-backlog",
      kind: "blocked",
      title: "List provider-visible optimizations that need explicit approval",
      score: 35,
      confidence: 0.95,
      estimatedMinutes: 20,
      providerVisible: true,
      canModify: false,
      rationale:
        "Some tempting performance wins involve changing how Freed touches third-party providers. Those must stay out of autonomous execution until approved.",
      evidence: ["Provider fingerprinting guardrail"],
      prompt:
        "Prepare a short approval request before changing authenticated WebView loads, provider navigation, background API calls, scripted scrolling, cookie behavior, headers, or provider contact frequency.",
      validation: [
        "No code changes are allowed for this target without approval.",
      ],
    }),
  );

  return candidates.sort((left, right) => right.score - left.score);
}

export function applyOutcomeFeedback(candidates, outcomeLedger) {
  return candidates
    .map((candidate) => {
      const kindStats = outcomeLedger.byKind?.[candidate.kind];
      const idStats = outcomeLedger.byId?.[candidate.id];
      const verifiedEffective = kindStats?.verifiedEffective ?? 0;
      const regressed = kindStats?.regressed ?? 0;
      const implementationFailed = kindStats?.implementationFailed ?? 0;
      const evidenceWindowEndMs = parseTimestampMs(candidate.evidenceWindowEnd);
      const latestIdOutcome = idStats?.latestOutcome ?? null;
      const latestIdTsMs = idStats?.latestTsMs ?? null;
      const latestIdEvidenceWindowEndMs =
        idStats?.latestEvidenceWindowEndMs ?? null;
      const hasNewerEvidence =
        evidenceWindowEndMs !== null &&
        latestIdEvidenceWindowEndMs !== null &&
        evidenceWindowEndMs > latestIdEvidenceWindowEndMs;
      const suppressed =
        !hasNewerEvidence &&
        latestIdTsMs !== null &&
        latestIdEvidenceWindowEndMs !== null &&
        (latestIdOutcome === "verified_effective" ||
          latestIdOutcome === "superseded");
      const governanceBlocked =
        !hasNewerEvidence &&
        latestIdTsMs !== null &&
        latestIdEvidenceWindowEndMs !== null &&
        latestIdOutcome === "governance_blocked";
      const exactRegressionBoost = latestIdOutcome === "regressed" ? 8 : 0;
      const adjustment = Math.max(
        -12,
        Math.min(
          12,
          regressed * 3 - implementationFailed * 4 + exactRegressionBoost,
        ),
      );
      return {
        ...candidate,
        canModify: governanceBlocked ? false : candidate.canModify,
        score: suppressed
          ? 1
          : Math.max(1, Math.min(99, candidate.score + adjustment)),
        outcomeFeedback: {
          verifiedEffective,
          regressed,
          implementationFailed,
          latestIdOutcome,
          latestIdTsMs,
          latestIdEvidenceWindowEndMs,
          hasNewerEvidence,
          suppressed,
          governanceBlocked,
          adjustment,
        },
      };
    })
    .sort((left, right) => right.score - left.score);
}

export function selectTargets(candidates, options) {
  const budget = options.durationMinutes;
  const minimumNightMinutes = Math.min(
    options.minimumNightMinutes ?? DEFAULT_MINIMUM_NIGHT_MINUTES,
    budget,
  );
  const behaviorGate =
    options.behaviorGate ?? buildBehavioralTaskGate(options.controlTasks ?? []);
  if (
    ["outcome-history-unhealthy", "control-history-unhealthy"].includes(
      behaviorGate.status,
    )
  ) {
    return [];
  }
  const authorizedTaskIds = options.authorizedTaskIds
    ? new Set(options.authorizedTaskIds)
    : null;
  const canonicalTaskPolicies = options.canonicalTaskPolicies
    ? new Map(
        options.canonicalTaskPolicies.map((policy) => [policy.taskId, policy]),
      )
    : null;
  const normalizeCapacity = (value) => {
    if (value === undefined) return Number.POSITIVE_INFINITY;
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  };
  const outcomeAppendCapacity = normalizeCapacity(
    options.outcomeAppendCapacity,
  );
  const controlEventAppendCapacity = normalizeCapacity(
    options.controlEventAppendCapacity,
  );
  const selected = [];
  let behavioralSelected = false;
  let used = 0;
  let reservedOutcomeAppends = 0;
  let reservedControlEventAppends = 0;

  for (const candidate of candidates) {
    const taskId = candidate.taskId ?? candidate.id;
    const canonicalPolicy = canonicalTaskPolicies?.get(taskId) ?? null;
    if (canonicalTaskPolicies && !canonicalPolicy) {
      continue;
    }
    if (authorizedTaskIds && !authorizedTaskIds.has(taskId)) {
      continue;
    }
    if (
      canonicalPolicy &&
      candidate.behavioral !== canonicalPolicy.behavioral
    ) {
      continue;
    }
    if (
      candidate.outcomeFeedback?.suppressed ||
      candidate.canModify === false
    ) {
      continue;
    }
    if (
      candidate.providerVisible ||
      (canonicalPolicy && canonicalPolicy.providerAuthority !== "forbidden")
    ) {
      continue;
    }
    const behavioral = canonicalPolicy
      ? canonicalPolicy.behavioral
      : candidate.behavioral;
    const soakExclusivityKey = behavioral
      ? (candidate.soakExclusivityKey ?? DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY)
      : null;
    if (soakExclusivityKey && taskId !== behaviorGate.authorizedTaskId) {
      continue;
    }
    if (soakExclusivityKey && behavioralSelected) {
      continue;
    }
    if (selected.length > 0 && used >= minimumNightMinutes) {
      break;
    }
    if (selected.length >= options.maxTargets) {
      break;
    }
    if (used + candidate.estimatedMinutes > budget && selected.length > 0) {
      continue;
    }
    const candidateState = canonicalPolicy?.state ?? candidate.taskState;
    const requiredControlEvents =
      NIGHTLY_SUCCESS_PATH_CONTROL_EVENT_NEEDS[candidateState];
    if (
      reservedOutcomeAppends + 1 > outcomeAppendCapacity ||
      (Number.isFinite(controlEventAppendCapacity) &&
        (!Number.isSafeInteger(requiredControlEvents) ||
          reservedControlEventAppends + requiredControlEvents >
            controlEventAppendCapacity))
    ) {
      continue;
    }
    selected.push(candidate);
    if (soakExclusivityKey) {
      behavioralSelected = true;
    }
    used += candidate.estimatedMinutes;
    reservedOutcomeAppends += 1;
    if (Number.isSafeInteger(requiredControlEvents)) {
      reservedControlEventAppends += requiredControlEvents;
    }
  }

  return selected;
}

function findPendingOutcomeTransitionsFromTrustedHistory(
  outcomeEntries = [],
  eventHistory,
) {
  const transitionIdentity = ({
    taskId,
    outcome,
    taskRevision,
    transitionEventId,
    outcomeDigest,
  }) =>
    JSON.stringify({
      taskId,
      outcome,
      taskRevision,
      transitionEventId,
      outcomeDigest,
    });
  const recordedTransitions = new Set(
    outcomeEntries.map((entry) =>
      transitionIdentity({
        taskId: entry?.taskId,
        outcome: entry?.outcome,
        taskRevision: entry?.authentication?.taskRevision,
        transitionEventId: entry?.authentication?.transitionEventId,
        outcomeDigest: entry?.authentication?.outcomeDigest,
      }),
    ),
  );
  const source = eventHistory.source;
  const outcomeTransitions = source.entries.filter(
    (event) =>
      isOutcomeTransitionEvent(event) &&
      OUTCOME_STATUSES.includes(event?.data?.toState) &&
      event?.data?.outcomeRequired === true &&
      Number.isInteger(event?.taskRevision),
  );
  const transitionsByTaskRevision = new Map();
  for (const event of outcomeTransitions) {
    const key = JSON.stringify({
      taskId: event.taskId,
      outcome: event.data.toState,
      taskRevision: event.taskRevision,
    });
    const matching = transitionsByTaskRevision.get(key) ?? [];
    matching.push(event);
    transitionsByTaskRevision.set(key, matching);
  }
  const reservationConflicts = [];
  for (const events of transitionsByTaskRevision.values()) {
    if (events.length < 2) continue;
    const first = events[0];
    const identities = new Set(
      events.map((event) =>
        transitionIdentity({
          taskId: event.taskId,
          outcome: event.data.toState,
          taskRevision: event.taskRevision,
          transitionEventId: event.eventId,
          outcomeDigest: event.data?.outcomeDigest,
        }),
      ),
    );
    reservationConflicts.push({
      taskId: first.taskId,
      state: first.data.toState,
      revision: first.taskRevision,
      kind: identities.size === 1 ? "duplicate" : "conflict",
    });
  }
  const pending = outcomeTransitions
    .filter(
      (event) =>
        !recordedTransitions.has(
          transitionIdentity({
            taskId: event.taskId,
            outcome: event.data.toState,
            taskRevision: event.taskRevision,
            transitionEventId: event.eventId,
            outcomeDigest: event.data?.outcomeDigest,
          }),
        ),
    )
    .map((event) => ({
      taskId: event.taskId,
      state: event.data.toState,
      revision: event.taskRevision,
    }));
  Object.defineProperties(pending, {
    sourceHealthy: {
      value: source.healthy && reservationConflicts.length === 0,
      enumerable: false,
    },
    sourceExists: { value: source.exists, enumerable: false },
    malformedLines: { value: source.malformedLines, enumerable: false },
    eventIdentityIssues: {
      value: source.identityIssues,
      enumerable: false,
    },
    reservationConflicts: { value: reservationConflicts, enumerable: false },
  });
  return pending;
}

function taskBehavioralClassification(task) {
  return typeof task?.behavioral === "boolean"
    ? task.behavioral
    : task?.details?.behavioral;
}

export function buildBehavioralTaskGate(
  controlTasks = [],
  {
    behavioralTaskIds = [],
    outcomeEntries = [],
    pendingOutcomeTransitions = null,
    outcomeLedgerHealthy = true,
  } = {},
) {
  const knownBehavioralTaskIds = new Set(behavioralTaskIds);
  const hasTrustedOutcome = (task) =>
    outcomeEntries.some(
      (entry) =>
        entry?.taskId === task.taskId &&
        entry?.outcome === task.state &&
        entry?.authentication?.taskRevision === task.revision,
    );
  if (outcomeLedgerHealthy === false && controlTasks.length > 0) {
    return {
      status: "outcome-history-unhealthy",
      authorizedTaskId: null,
      activeTasks: controlTasks.filter(
        (task) => taskBehavioralClassification(task) === true,
      ),
    };
  }
  if (
    pendingOutcomeTransitions?.sourceHealthy === false &&
    controlTasks.length > 0
  ) {
    return {
      status: "control-history-unhealthy",
      authorizedTaskId: null,
      activeTasks: controlTasks.filter(
        (task) => taskBehavioralClassification(task) === true,
      ),
    };
  }
  const pendingByKey = new Map();
  for (const task of [
    ...(pendingOutcomeTransitions ?? []),
    ...controlTasks.filter(
      (task) =>
        task?.pendingOutcome !== undefined ||
        (COMPLETED_BEHAVIOR_OUTCOME_STATES.has(task?.state) &&
          !hasTrustedOutcome(task)),
    ),
  ]) {
    pendingByKey.set(`${task.taskId}:${task.state}:${task.revision}`, task);
  }
  const pendingOutcomeTasks = [...pendingByKey.values()];
  if (pendingOutcomeTasks.length > 0) {
    return {
      status: "outcome-record-pending",
      authorizedTaskId: null,
      activeTasks: pendingOutcomeTasks,
    };
  }

  const liveTasks = controlTasks.filter((task) =>
    ACTIVE_BEHAVIOR_TASK_STATES.has(task?.state),
  );
  const classificationIssues = liveTasks.filter((task) => {
    const declaredBehavioral = taskBehavioralClassification(task);
    return (
      typeof declaredBehavioral !== "boolean" ||
      (knownBehavioralTaskIds.has(task.taskId) && declaredBehavioral === false)
    );
  });
  if (classificationIssues.length > 0) {
    return {
      status: "classification-required",
      authorizedTaskId: null,
      activeTasks: classificationIssues,
    };
  }

  const activeTasks = liveTasks.filter(
    (task) =>
      taskBehavioralClassification(task) === true ||
      knownBehavioralTaskIds.has(task.taskId),
  );
  if (activeTasks.length === 0) {
    return {
      status: "unreserved",
      authorizedTaskId: null,
      activeTasks: [],
    };
  }
  if (activeTasks.length > 1) {
    return {
      status: "conflict",
      authorizedTaskId: null,
      activeTasks,
    };
  }
  const [task] = activeTasks;
  const resumable = ["approved_for_pr", "implemented", "validated"].includes(
    task.state,
  );
  return {
    status: resumable ? "reserved" : "awaiting-soak-outcome",
    authorizedTaskId: resumable ? task.taskId : null,
    activeTasks,
  };
}

export function findPendingOutcomeTransitions(stateRoot, outcomeEntries = []) {
  const eventSnapshot = readCanonicalOutcomeEventSnapshot(stateRoot);
  let controlEventPhysicalBoundaryIssue = null;
  try {
    requireControlEventPhysicalBoundary(eventSnapshot.bytes);
  } catch (error) {
    controlEventPhysicalBoundaryIssue =
      error instanceof Error ? error.message : String(error);
  }
  const eventHistory = trustedOutcomeEventHistoryFromSource(
    eventSnapshot.source,
    automationControlPaths(path.resolve(stateRoot)).outcomes,
    stateRoot,
    controlEventPhysicalBoundaryIssue,
  );
  return findPendingOutcomeTransitionsFromTrustedHistory(
    outcomeEntries,
    eventHistory,
  );
}

function summarizeBehaviorGate(behaviorGate = {}) {
  return {
    status: String(behaviorGate.status ?? "unreserved"),
    authorizedTaskId: behaviorGate.authorizedTaskId
      ? String(behaviorGate.authorizedTaskId)
      : null,
    activeTasks: (behaviorGate.activeTasks ?? []).map((task) => ({
      taskId: String(task.taskId ?? "unknown"),
      state: String(task.state ?? "unknown"),
      ...(Number.isInteger(task.revision) ? { revision: task.revision } : {}),
    })),
  };
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "unknown";
  }
  return `${numberFormatter.format(bytes / GIB)} GiB`;
}

function formatCandidate(candidate, index) {
  return [
    `# ${index + 1}. ${candidate.title}`,
    "",
    `Kind: ${candidate.kind}`,
    `Score: ${numberFormatter.format(candidate.score)}`,
    `Confidence: ${numberFormatter.format(candidate.confidence * 100)}%`,
    `Estimated machine time: ${numberFormatter.format(candidate.estimatedMinutes)} min`,
    `Provider-visible: ${candidate.providerVisible ? "yes" : "no"}`,
    `Behavioral: ${candidate.behavioral ? "yes" : "no"}`,
    `Soak exclusivity key: ${candidate.soakExclusivityKey ?? "none"}`,
    "",
    "## Rationale",
    "",
    candidate.rationale,
    "",
    "## Evidence",
    "",
    ...candidate.evidence.map((item) => `- ${item}`),
    "",
    "## Implementation Prompt",
    "",
    candidate.prompt,
    "",
    "## Unattended App Interaction",
    "",
    ...UNATTENDED_APP_INTERACTION_RULES.map((item) => `- ${item}`),
    "",
    "## Validation",
    "",
    ...candidate.validation.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function buildReport({
  repo,
  soak,
  riskSnapshot,
  duplicateWork,
  outcomeLedger,
  behaviorGate,
  candidates,
  selected,
  options,
}) {
  const blockedProvider = candidates.filter(
    (candidate) => candidate.providerVisible,
  );
  const phases = buildNightlyPhases(selected);
  const selectedMinutes = selected.reduce(
    (total, candidate) => total + (candidate.estimatedMinutes ?? 0),
    0,
  );
  const safeBehaviorGate = summarizeBehaviorGate(behaviorGate);
  return [
    "# Freed Nightly Improvement Plan",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Repo: ${repo.branch || "unknown"} at ${repo.head || "unknown"}`,
    `Budget: ${numberFormatter.format(options.durationMinutes)} min`,
    `Three-hour floor: ${numberFormatter.format(options.minimumNightMinutes ?? DEFAULT_MINIMUM_NIGHT_MINUTES)} min`,
    `Selected targets: ${numberFormatter.format(selected.length)}`,
    `Selected machine time: ${numberFormatter.format(selectedMinutes)} min`,
    "",
    "## Current Evidence",
    "",
    `- Soak directory: ${soak.soakDir || "none"}`,
    `- Soak fallback from: ${soak.fallbackFrom || "none"}`,
    `- Soak samples: ${numberFormatter.format(soak.sampleCount)}`,
    `- Max WebKit RSS: ${formatBytes(soak.maxWebKitResidentBytes)}`,
    `- Max event loop lag: ${numberFormatter.format(soak.maxEventLoopLagMs ?? 0)} ms`,
    `- Max DOM nodes: ${numberFormatter.format(soak.maxDomNodes ?? 0)}`,
    `- Stale heartbeat events: ${numberFormatter.format(soak.staleHeartbeatCount)}`,
    `- Hidden timer throttled events: ${numberFormatter.format(soak.throttledHeartbeatCount)}`,
    "",
    "## Preflight Risks",
    "",
    `- Blockers: ${numberFormatter.format(riskSnapshot?.blockerCount ?? 0)}`,
    `- Warnings: ${numberFormatter.format(riskSnapshot?.warningCount ?? 0)}`,
    `- Info: ${numberFormatter.format(riskSnapshot?.infoCount ?? 0)}`,
    `- Actions: ${numberFormatter.format(riskSnapshot?.actionCount ?? 0)}`,
    "",
    ...(riskSnapshot?.risks ?? [])
      .slice(0, 8)
      .map((risk) => `- ${risk.severity}: ${risk.title}`),
    "",
    "## Duplicate Work",
    "",
    `- Findings: ${numberFormatter.format(duplicateWork?.findingCount ?? 0)}`,
    `- Blockers: ${numberFormatter.format(duplicateWork?.blockerCount ?? 0)}`,
    `- Warnings: ${numberFormatter.format(duplicateWork?.warningCount ?? 0)}`,
    "",
    ...(duplicateWork?.findings ?? [])
      .slice(0, 8)
      .map((finding) => `- ${finding.severity}: ${finding.title}`),
    "",
    "## Learning Signals",
    "",
    `- Outcome ledger: ${outcomeLedger?.path ?? "none"}`,
    `- Prior outcomes loaded: ${numberFormatter.format(outcomeLedger?.entries?.length ?? 0)}`,
    `- Rejected unsigned or mismatched outcomes: ${numberFormatter.format(outcomeLedger?.rejectedEntries?.length ?? 0)}`,
    "",
    "## Behavioral Soak Gate",
    "",
    `- Status: ${safeBehaviorGate.status}`,
    `- Authorized task: ${safeBehaviorGate.authorizedTaskId ?? "none"}`,
    ...(safeBehaviorGate.activeTasks.length > 0
      ? safeBehaviorGate.activeTasks.map(
          (task) => `- Active task: ${task.taskId} in ${task.state}`,
        )
      : ["- Active task: none"]),
    "",
    "## Selected Queue",
    "",
    ...selected.flatMap((candidate, index) => [
      `${index + 1}. ${candidate.title}`,
      `   Kind: ${candidate.kind}. Score: ${numberFormatter.format(candidate.score)}. Machine time: ${numberFormatter.format(candidate.estimatedMinutes)} min.`,
    ]),
    "",
    "## Unattended App Interaction",
    "",
    ...UNATTENDED_APP_INTERACTION_RULES.map((item) => `- ${item}`),
    "",
    "## Execution Phases",
    "",
    ...phases.map((phase, index) => `${index + 1}. ${phase}`),
    "",
    "## Provider Visibility Gate",
    "",
    blockedProvider.length > 0
      ? "Provider-visible candidates were detected and excluded unless the run was started with explicit approval."
      : "No provider-visible candidates were detected.",
    "",
    ...blockedProvider.map((candidate) => `- ${candidate.title}`),
    "",
    "## Next Ideas",
    "",
    "- Add a learned target scorer that compares each night's fix outcome against the previous run budget.",
    "- Keep a small local knowledge base of recurring failure signatures and the focused tests that proved prior fixes.",
    "- Teach the runner to split one night into planning, fix, validation, dev build, install, and soak phases with stop conditions.",
    "- Promote peer worktree comparison into an automatic import step before any new task starts.",
    "- Require evidence snapshots before every rare crash or memory fix so the next failure has better diagnostics.",
    "- Add a morning digest that ranks shipped value, residual risk, and the single next highest leverage bottleneck.",
    "",
  ].join("\n");
}

function renderDuplicateWorkMarkdown(duplicateWork) {
  return [
    "# Nightly Duplicate Work",
    "",
    `Findings: ${numberFormatter.format(duplicateWork.findingCount)}`,
    `Blockers: ${numberFormatter.format(duplicateWork.blockerCount)}`,
    `Warnings: ${numberFormatter.format(duplicateWork.warningCount)}`,
    "",
    ...(duplicateWork.findings.length > 0
      ? duplicateWork.findings.flatMap((finding) => [
          `## ${finding.title}`,
          "",
          `Severity: ${finding.severity}`,
          `Kind: ${finding.kind}`,
          `Key: ${finding.key}`,
          "",
          "Peer worktrees:",
          "",
          ...finding.peers.map(
            (peer) =>
              `- ${peer.branch} at ${peer.path} (${peer.head || "unknown"})`,
          ),
          "",
        ])
      : ["No duplicate peer work detected.", ""]),
  ].join("\n");
}

function renderRiskSnapshotMarkdown(riskSnapshot) {
  return [
    "# Nightly Preflight Risk Snapshot",
    "",
    `Generated: ${riskSnapshot.generatedAt}`,
    `Repo: ${riskSnapshot.repoPath}`,
    `Blockers: ${numberFormatter.format(riskSnapshot.blockerCount)}`,
    `Warnings: ${numberFormatter.format(riskSnapshot.warningCount)}`,
    `Info: ${numberFormatter.format(riskSnapshot.infoCount)}`,
    "",
    "## Risks",
    "",
    ...(riskSnapshot.risks.length > 0
      ? riskSnapshot.risks.flatMap((risk) => [
          `### ${risk.title}`,
          "",
          `Severity: ${risk.severity}`,
          "",
          "Evidence:",
          "",
          ...risk.evidence.map((item) => `- ${item}`),
          "",
          "Remediation:",
          "",
          risk.remediation,
          "",
          ...(risk.actions?.length
            ? [
                "Actions:",
                "",
                ...risk.actions.map(
                  (action) =>
                    `- ${action.title} (${action.kind}, ${action.safety})${
                      action.command ? `: \`${action.command}\`` : ""
                    }`,
                ),
                "",
              ]
            : []),
        ])
      : ["No preflight risks detected.", ""]),
    "## Automation Statuses",
    "",
    ...(riskSnapshot.automationStatuses.length > 0
      ? riskSnapshot.automationStatuses.map(
          (automation) =>
            `- ${automation.name}: ${automation.exists ? automation.status || "present" : "missing"} (${automation.path})`,
        )
      : ["- No automation status files checked."]),
    "",
  ].join("\n");
}

function flattenRiskActions(riskSnapshot) {
  return (riskSnapshot.risks ?? []).flatMap((risk) =>
    (risk.actions ?? []).map((action) => ({
      ...action,
      riskId: risk.id,
      riskTitle: risk.title,
      severity: risk.severity,
    })),
  );
}

function renderPreflightActionsMarkdown(riskSnapshot) {
  const actions = flattenRiskActions(riskSnapshot);
  return [
    "# Nightly Preflight Actions",
    "",
    `Actions: ${numberFormatter.format(actions.length)}`,
    "",
    ...(actions.length > 0
      ? actions.flatMap((action) => [
          `## ${action.title}`,
          "",
          `Risk: ${action.riskTitle}`,
          `Severity: ${action.severity}`,
          `Kind: ${action.kind}`,
          `Safety: ${action.safety}`,
          ...(action.command ? [`Command: \`${action.command}\``] : []),
          ...(action.automationId
            ? [`Automation: ${action.automationId}`]
            : []),
          ...(action.notes ? ["", action.notes] : []),
          "",
        ])
      : ["No preflight actions available.", ""]),
  ].join("\n");
}

function buildNightlyPhases(selected) {
  const phases = [
    "Run node scripts/doctor.mjs --strict. Stop the run if strict machine preflight fails.",
    "Snapshot evidence from soak, logs, automations, git state, and peer worktrees.",
  ];
  if (selected.some((candidate) => candidate.kind === "peer-worktree")) {
    phases.push(
      "Compare peer worktrees and import safe measurement improvements.",
    );
  }
  phases.push(
    "Execute selected targets in score order while respecting provider visibility gates.",
  );
  phases.push("Run focused validation for each changed surface.");
  phases.push("Run validate:feature before publishing or updating a PR.");
  phases.push(
    "Ship a dev build only if real product fixes landed and checks are green.",
  );
  phases.push(
    "Install the new build, restart the soak, and write the morning digest.",
  );
  return phases;
}

const CONVENTIONAL_PR_TYPES = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
]);

const PR_TYPE_BY_CANDIDATE_KIND = Object.freeze({
  "bug-fix": "fix",
  performance: "perf",
  roadmap: "feat",
  release: "chore",
  stability: "fix",
  "peer-worktree": "chore",
  blocked: "chore",
});

function safePrTitleText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[^A-Za-z0-9 .,:()/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveCandidatePrTitle(candidate = {}) {
  const fallback = safePrTitleText(candidate.id) || "nightly maintenance";
  const rawTitle = safePrTitleText(candidate.title) || fallback;
  const conventional = rawTitle.match(
    /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([a-z0-9._/-]+\))?!?:\s*(.+)$/i,
  );
  const candidateType = String(candidate.kind ?? "").trim();
  const type =
    conventional && CONVENTIONAL_PR_TYPES.has(conventional[1].toLowerCase())
      ? conventional[1].toLowerCase()
      : (PR_TYPE_BY_CANDIDATE_KIND[candidateType] ?? "chore");
  let summary = safePrTitleText(conventional?.[2] ?? rawTitle)
    .replace(/^[:.\s]+/, "")
    .replace(/[:.\s]+$/, "");
  if (type === "fix") summary = summary.replace(/^fix\s+/i, "");
  if (type === "feat") summary = summary.replace(/^feat(?:ure)?\s+/i, "");
  if (type === "perf") summary = summary.replace(/^perf(?:ormance)?\s+/i, "");
  if (type === "chore") summary = summary.replace(/^chore\s+/i, "");
  if (!summary) summary = fallback;
  summary = summary.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
  const maximumSummaryLength = Math.max(1, 100 - type.length - 2);
  summary = summary.slice(0, maximumSummaryLength).replace(/[\s:.,/_-]+$/, "");
  return `${type}: ${summary || fallback}`;
}

function buildPublishCommand(selected) {
  const primary = selected[0] ?? {};
  const providerVisible = selected.some(
    (candidate) => candidate.providerVisible === true,
  );
  return {
    closeout: providerVisible ? "draft" : "ready",
    command: [
      "./scripts/worktree-publish.sh",
      `--title ${JSON.stringify(deriveCandidatePrTitle(primary))}`,
      '--summary "<summary>"',
      '--test "<tests>"',
      ...(providerVisible ? [] : ["--ready"]),
    ].join(" "),
  };
}

export function buildExecutionPlan(selected) {
  const strictPreflightId = "strict-machine-preflight";
  const afterStrictPreflight = (phase) => ({
    ...phase,
    requires: [strictPreflightId],
  });
  const phases = [
    {
      id: strictPreflightId,
      title: "Run strict machine preflight",
      stopGate:
        "Stop the entire run if strict doctor fails. No later mutation, validation, publish, release, or outcome phase may run.",
      commands: ["node scripts/doctor.mjs --strict"],
      requires: [],
      mutates: false,
    },
    afterStrictPreflight({
      id: "evidence-snapshot",
      title: "Snapshot evidence",
      stopGate:
        "Stop if the repo is dirty with unrelated user changes or required evidence files cannot be read.",
      commands: [
        "git fetch --all --prune",
        "git status --short",
        "node scripts/nightly-self-improve.mjs --dry-run --json",
        "# Read preflight-actions.md before manually fixing risk-snapshot warnings.",
      ],
      mutates: true,
    }),
  ];

  if (selected.some((candidate) => candidate.kind === "peer-worktree")) {
    phases.push(
      afterStrictPreflight({
        id: "peer-review",
        title: "Review peer worktrees",
        stopGate:
          "Stop before editing if the peer branch is still changing or the useful change is provider-visible.",
        commands: [
          "git worktree list --porcelain",
          "git diff --stat origin/dev HEAD",
          "git diff --name-only origin/dev HEAD",
        ],
        mutates: false,
      }),
    );
  }

  phases.push(
    afterStrictPreflight({
      id: "implementation",
      title: "Implement selected targets",
      stopGate:
        "Stop if a target requires provider-visible behavior changes without explicit approval.",
      commands: selected.map(
        (candidate) => `# ${candidate.id}: ${candidate.prompt}`,
      ),
      mutates: true,
    }),
    afterStrictPreflight({
      id: "focused-validation",
      title: "Run focused validation",
      stopGate: "Stop if the focused test for the touched code path fails.",
      commands: [
        "node --test scripts/nightly-self-improve.test.mjs",
        "# Add the focused product test for any non-runner changes.",
      ],
      mutates: true,
    }),
    afterStrictPreflight({
      id: "feature-validation",
      title: "Run feature validation",
      stopGate: "Stop if validate:feature fails.",
      commands: ["corepack npm run validate:feature"],
      mutates: true,
    }),
  );

  if (selected.length > 0) {
    const publish = buildPublishCommand(selected);
    phases.push(
      afterStrictPreflight({
        id: "publish",
        title:
          publish.closeout === "ready"
            ? "Publish ready PR after closeout"
            : "Publish draft PR for owner review",
        stopGate:
          publish.closeout === "ready"
            ? "Stop if implementation, focused validation, feature validation, or closeout evidence is incomplete."
            : "Keep provider-visible work in draft and stop for explicit owner review and provider-risk approval.",
        commands: [publish.command],
        closeout: publish.closeout,
        mutates: true,
      }),
    );
  }

  phases.push(
    afterStrictPreflight({
      id: "release-and-soak",
      title: "Ship and soak only after real fixes",
      stopGate: "Skip this phase when only planning artifacts changed.",
      commands: [
        "# Use freed-ship-build dev after fixes merge into dev.",
        "# Install the new dev build, restart the installed-build soak, and run the authenticated command in outcome-template.jsonl.",
        "# For installed provider sync soaks, prefer node scripts/dev-sync-trigger.mjs <provider> over foreground app clicks.",
        "# If a foreground app click is required, ask with a 10 minute response window. If the user is unavailable, continue only with already authorized local work. The timeout never grants provider approval or permission for a new external action.",
      ],
      mutates: true,
    }),
  );

  return phases;
}

function renderExecutionPlanMarkdown(phases) {
  return [
    "# Nightly Execution Plan",
    "",
    ...phases.flatMap((phase, index) => [
      `## ${index + 1}. ${phase.title}`,
      "",
      `Stop gate: ${phase.stopGate}`,
      `Requires passed: ${phase.requires.length > 0 ? phase.requires.join(", ") : "none"}`,
      "",
      "Commands:",
      "",
      ...phase.commands.map((command) => `- \`${command}\``),
      "",
    ]),
  ].join("\n");
}

function buildOutcomeCommand(
  candidate,
  outcomeLedger,
  automationStateRoot = AUTOMATION_STATE_DIR,
) {
  const taskId = candidate.taskId ?? candidate.id;
  return [
    "node scripts/record-outcome.mjs",
    `--ledger ${JSON.stringify(outcomeLedger)}`,
    `--state-root ${JSON.stringify(automationStateRoot)}`,
    `--id ${JSON.stringify(candidate.id)}`,
    `--task-id ${JSON.stringify(taskId)}`,
    `--kind ${JSON.stringify(candidate.kind)}`,
    "--status merged",
    "--actor freed-nightly-runner",
    "--lease-name nightly-writer",
    '--evidence-digest "<merged-head-or-diff-digest>"',
    '--notes "replace with closeout notes"',
  ].join(" ");
}

function renderOutcomeCloseoutMarkdown({
  selected,
  outcomeLedger,
  automationStateRoot,
  canonicalTaskIds = [],
}) {
  const canonicalTasks = new Set(canonicalTaskIds);
  return [
    "# Nightly Outcome Closeout",
    "",
    `Outcome ledger: ${outcomeLedger}`,
    "",
    "Record `merged` after merge and `installed` after installation. Record `verified_effective`, `verified_neutral`, `regressed`, or `inconclusive` only after a build-bounded evidence window measures the result.",
    "",
    "Unattended app interaction:",
    "",
    ...UNATTENDED_APP_INTERACTION_RULES.map((item) => `- ${item}`),
    "",
    ...selected.flatMap((candidate, index) => [
      `## ${index + 1}. ${candidate.title}`,
      "",
      `Target: ${candidate.id}`,
      `Canonical task: ${candidate.taskId ?? candidate.id}`,
      `Kind: ${candidate.kind}`,
      "",
      ...(canonicalTasks.has(candidate.taskId ?? candidate.id)
        ? [
            "Command:",
            "",
            `\`${buildOutcomeCommand(candidate, outcomeLedger, automationStateRoot)}\``,
          ]
        : [
            "Outcome command unavailable. The stability controller must register and authorize the canonical task before execution.",
          ]),
      "",
    ]),
  ].join("\n");
}

export function writeRunPlan({
  runDir,
  repo,
  soak,
  riskSnapshot,
  duplicateWork,
  peerWorktrees = [],
  candidates,
  selected,
  options,
}) {
  mkdirSync(runDir, { recursive: true });
  const tasksDir = path.join(runDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });

  const outcomeLedgerPath = options.outcomeLedger ?? DEFAULT_OUTCOME_LEDGER;
  const outcomeLedger = options.outcomeLedgerSummary ?? {
    path: outcomeLedgerPath,
    entries: [],
  };
  const behaviorGate = summarizeBehaviorGate(options.behaviorGate);
  const canonicalTaskIds = new Set(options.canonicalTaskIds ?? []);
  const safeRiskSnapshot = riskSnapshot ?? {
    generatedAt: new Date().toISOString(),
    repoPath: "",
    blockerCount: 0,
    warningCount: 0,
    infoCount: 0,
    actionCount: 0,
    automationStatuses: [],
    risks: [],
  };
  const safeDuplicateWork = duplicateWork ?? {
    findingCount: 0,
    blockerCount: 0,
    warningCount: 0,
    findings: [],
  };
  const executionPlan = buildExecutionPlan(selected);
  const report = buildReport({
    repo,
    soak,
    riskSnapshot: safeRiskSnapshot,
    duplicateWork: safeDuplicateWork,
    outcomeLedger,
    behaviorGate,
    candidates,
    selected,
    options,
  });
  const outcomeCloseout = renderOutcomeCloseoutMarkdown({
    selected,
    outcomeLedger: outcomeLedgerPath,
    automationStateRoot: options.automationStateRoot,
    canonicalTaskIds,
  });
  const outcomeTemplateLines = selected
    .filter((candidate) =>
      canonicalTaskIds.has(candidate.taskId ?? candidate.id),
    )
    .map((candidate) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        id: candidate.id,
        taskId: candidate.taskId ?? candidate.id,
        kind: candidate.kind,
        schemaVersion: OUTCOME_SCHEMA_VERSION,
        outcome: "merged",
        notes:
          "Advance this state only when merge, install, and measured verification milestones actually occur.",
        command: buildOutcomeCommand(
          candidate,
          outcomeLedgerPath,
          options.automationStateRoot,
        ),
      }),
    );
  writeFileSync(path.join(runDir, "report.md"), report);
  writeFileSync(
    path.join(runDir, "targets.json"),
    `${JSON.stringify({ repo, soak, riskSnapshot: safeRiskSnapshot, duplicateWork: safeDuplicateWork, peerWorktrees, outcomeLedger, behaviorGate, executionPlan, candidates, selected }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runDir, "risk-snapshot.json"),
    `${JSON.stringify(safeRiskSnapshot, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runDir, "risk-snapshot.md"),
    renderRiskSnapshotMarkdown(safeRiskSnapshot),
  );
  writeFileSync(
    path.join(runDir, "preflight-actions.json"),
    `${JSON.stringify(flattenRiskActions(safeRiskSnapshot), null, 2)}\n`,
  );
  writeFileSync(
    path.join(runDir, "preflight-actions.md"),
    renderPreflightActionsMarkdown(safeRiskSnapshot),
  );
  writeFileSync(
    path.join(runDir, "duplicate-work.json"),
    `${JSON.stringify(safeDuplicateWork, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runDir, "duplicate-work.md"),
    renderDuplicateWorkMarkdown(safeDuplicateWork),
  );
  writeFileSync(
    path.join(runDir, "execution-plan.json"),
    `${JSON.stringify(executionPlan, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runDir, "execution-plan.md"),
    renderExecutionPlanMarkdown(executionPlan),
  );
  writeFileSync(path.join(runDir, "outcome-closeout.md"), outcomeCloseout);
  writeFileSync(
    path.join(runDir, "outcome-template.jsonl"),
    outcomeTemplateLines.length > 0
      ? `${outcomeTemplateLines.join("\n")}\n`
      : "",
  );

  selected.forEach((candidate, index) => {
    const name = `${String(index + 1).padStart(2, "0")}-${candidate.id}.md`;
    writeFileSync(path.join(tasksDir, name), formatCandidate(candidate, index));
  });

  return {
    runDir,
    reportPath: path.join(runDir, "report.md"),
    tasksDir,
    riskSnapshotPath: path.join(runDir, "risk-snapshot.md"),
    preflightActionsPath: path.join(runDir, "preflight-actions.md"),
    duplicateWorkPath: path.join(runDir, "duplicate-work.md"),
    executionPlanPath: path.join(runDir, "execution-plan.md"),
    outcomeCloseoutPath: path.join(runDir, "outcome-closeout.md"),
    outcomeTemplatePath: path.join(runDir, "outcome-template.jsonl"),
  };
}

export function planNightlyRun(args) {
  const soak = resolveReadableSoak(args.soakDir, args.soakPointer);
  const dailyBug = summarizeDailyBugMemory(args.dailyBugMemory);
  const repo = collectRepoSnapshot(args.repo);
  const peerWorktrees = collectPeerWorktrees(
    args.repo,
    args.peerWorktrees,
    args.peerScan,
  );
  const duplicateWork = collectDuplicateWork(peerWorktrees);
  const riskSnapshot = collectRiskSnapshot({
    repoPath: args.repo,
    repo,
    soak,
    peerWorktrees,
    duplicateWork,
    crashAutomation: args.crashAutomation,
    dailyBugMemory: args.dailyBugMemory,
    devBotMemory: args.devBotMemory,
    expectedBranch: args.expectedBranch,
  });
  return withAutomationPlanningReadBundle(
    {
      stateRoot: args.automationStateRoot,
      ledgerPath: args.outcomeLedger,
    },
    (planningBundle) => {
  const controlTaskManifest = planningBundle.taskManifest;
  const outcomeLedger = summarizeOutcomeLedger(args.outcomeLedger, {
    stateRoot: args.automationStateRoot,
    planningBundle,
  });
  const baseCandidates = buildCandidates({
    soak,
    dailyBug,
    repo,
    riskSnapshot,
    duplicateWork,
    peerWorktrees,
    crashAutomationExists: existsSync(args.crashAutomation),
    devBotMemoryExists: existsSync(args.devBotMemory),
    memoryBudgetBytes: args.memoryGib * GIB,
    triageCandidates: loadTriageCandidates(),
  });
  const behavioralTaskIds = baseCandidates
    .filter((candidate) => candidate.behavioral === true)
    .map((candidate) => candidate.taskId ?? candidate.id)
    .concat(
      controlTaskManifest.tasks
        .filter((task) => taskBehavioralClassification(task) === true)
        .map((task) => task.taskId),
    );
  const pendingOutcomeTransitions = outcomeLedger.pendingOutcomeTransitions;
  const behaviorGate = buildBehavioralTaskGate(controlTaskManifest.tasks, {
    behavioralTaskIds,
    outcomeEntries: outcomeLedger.entries,
    pendingOutcomeTransitions,
    outcomeLedgerHealthy:
      (outcomeLedger.sourceHealth.ledgerHealthy &&
        outcomeLedger.sourceHealth.outcomeAppendReady &&
        outcomeLedger.sourceHealth.controlEventAppendReady) ||
      (!outcomeLedger.sourceHealth.ledgerExists &&
        outcomeLedger.sourceHealth.controlEventsHealthy &&
        outcomeLedger.sourceHealth.pinnedLegacyOutcomeBundlesHealthy &&
        outcomeLedger.sourceHealth.outcomeLedgerTransactionsHealthy &&
        outcomeLedger.sourceHealth.outcomeAppendReady &&
        outcomeLedger.sourceHealth.controlEventAppendReady &&
        outcomeLedger.sourceHealth.pendingOutcomeLedgerRepairs.length === 0),
  });
  const canonicalTaskPolicies = controlTaskManifest.tasks.map((task) => ({
    taskId: task.taskId,
    state: task.state,
    behavioral: taskBehavioralClassification(task),
    observerAuthority: task.observerAuthority,
    providerAuthority: task.providerAuthority,
  }));
  const runnableTaskIds = controlTaskManifest.tasks
    .filter(
      (task) =>
        RUNNABLE_NIGHTLY_TASK_STATES.has(task.state) &&
        task.observerAuthority === "merge-safe" &&
        task.providerAuthority === "forbidden" &&
        typeof taskBehavioralClassification(task) === "boolean",
    )
    .map((task) => task.taskId);
  const candidates = applyOutcomeFeedback(baseCandidates, outcomeLedger);
  const selected = selectTargets(candidates, {
    ...args,
    behaviorGate,
    authorizedTaskIds: runnableTaskIds,
    canonicalTaskPolicies,
    outcomeAppendCapacity:
      outcomeLedger.sourceHealth.outcomeAppendCapacity,
    controlEventAppendCapacity:
      outcomeLedger.sourceHealth.controlEventAppendCapacity,
  });
  return {
    repo,
    soak,
    dailyBug,
    riskSnapshot,
    duplicateWork,
    peerWorktrees,
    outcomeLedger,
    runnableTaskIds,
    behaviorGate: summarizeBehaviorGate(behaviorGate),
    candidates,
    selected,
  };
    },
  );
}

function textSummary(plan, writeResult, args) {
  const lines = [
    `Selected ${numberFormatter.format(plan.selected.length)} targets from ${numberFormatter.format(plan.candidates.length)} candidates.`,
    `Max WebKit RSS: ${formatBytes(plan.soak.maxWebKitResidentBytes)}.`,
    `Stale heartbeat events: ${numberFormatter.format(plan.soak.staleHeartbeatCount)}.`,
    `Preflight risks: ${numberFormatter.format(plan.riskSnapshot.blockerCount)} blockers, ${numberFormatter.format(plan.riskSnapshot.warningCount)} warnings.`,
    `Duplicate work: ${numberFormatter.format(plan.duplicateWork.findingCount)} findings.`,
    `Peer worktrees with changes: ${numberFormatter.format(plan.peerWorktrees.length)}.`,
    `Prior outcomes loaded: ${numberFormatter.format(plan.outcomeLedger.entries.length)}.`,
    `Rejected outcomes: ${numberFormatter.format(plan.outcomeLedger.rejectedEntries.length)}.`,
    `Behavior gate: ${plan.behaviorGate.status}. Active tasks: ${
      plan.behaviorGate.activeTasks.length > 0
        ? plan.behaviorGate.activeTasks
            .map((task) => `${task.taskId} in ${task.state}`)
            .join(", ")
        : "none"
    }.`,
  ];

  for (const [index, selected] of plan.selected.entries()) {
    lines.push(
      `${index + 1}. ${selected.title} (${selected.kind}, score ${numberFormatter.format(selected.score)})`,
    );
  }

  if (writeResult) {
    lines.push(`Report: ${writeResult.reportPath}`);
    lines.push(`Tasks: ${writeResult.tasksDir}`);
    lines.push(`Risk snapshot: ${writeResult.riskSnapshotPath}`);
    lines.push(`Preflight actions: ${writeResult.preflightActionsPath}`);
    lines.push(`Duplicate work: ${writeResult.duplicateWorkPath}`);
    lines.push(`Execution plan: ${writeResult.executionPlanPath}`);
    lines.push(`Outcome closeout: ${writeResult.outcomeCloseoutPath}`);
    lines.push(`Outcome template: ${writeResult.outcomeTemplatePath}`);
  }

  if (args.dryRun) {
    lines.push("Dry run only. No files were written.");
  }

  return `${lines.join("\n")}\n`;
}

export function runNightlyMachinePreflight({
  strict,
  exec = execFileSync,
} = {}) {
  try {
    exec(
      process.execPath,
      [path.join(__dirname, "doctor.mjs"), ...(strict ? ["--strict"] : [])],
      { stdio: ["ignore", 2, 2] },
    );
    return { ok: true, strict: strict === true };
  } catch (error) {
    if (strict) {
      throw new Error(
        "Strict machine preflight failed. No mutation phase was started.",
        {
          cause: error,
        },
      );
    }
    return { ok: false, strict: false };
  }
}

export function main(
  argv = process.argv.slice(2),
  { runPreflight = runNightlyMachinePreflight } = {},
) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  runPreflight({ strict: args.recordOutcome !== "" || !args.dryRun });

  if (args.recordOutcome) {
    const entry = appendOutcomeLedger(
      args.outcomeLedger,
      {
        id: args.recordOutcome,
        taskId: args.recordTaskId,
        kind: args.recordKind,
        outcome: args.recordStatus,
        notes: args.recordNotes,
        pr: args.recordPr,
        installedIdentity:
          args.recordStatus === "installed"
            ? {
                version: args.recordBuild,
                commitSha: args.recordBuildCommitSha,
                channel: args.recordBuildChannel,
                ...(args.recordArtifactDigest
                  ? { artifactDigest: args.recordArtifactDigest }
                  : {}),
              }
            : undefined,
        runDir: args.runDirProvided ? args.runDir : "",
        evidenceWindowEnd: args.recordEvidenceWindowEnd,
        evidenceDigest: args.recordEvidenceDigest,
        verdictReference: args.recordVerdictReference,
      },
      {
        stateRoot: args.automationStateRoot,
        authentication: {
          actor: args.recordActor,
          leaseName: args.recordLeaseName,
          leaseToken: args.recordLeaseToken,
        },
      },
    );
    if (args.json) {
      process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Recorded ${entry.outcome} outcome for ${entry.id} in ${args.outcomeLedger}.\n`,
      );
    }
    return;
  }

  if (args.repairSoakPointer) {
    const repair = repairSoakPointer(args.soakPointer, { dryRun: args.dryRun });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(repair, null, 2)}\n`);
    } else if (repair.repaired) {
      process.stdout.write(
        `Repaired soak pointer ${repair.pointerPath} from ${repair.previousDir || "none"} to ${repair.readableDir} with ${numberFormatter.format(repair.sampleCount)} samples.\n`,
      );
    } else {
      process.stdout.write(
        `Did not repair soak pointer ${repair.pointerPath}: ${repair.reason}.\n`,
      );
    }
    return;
  }

  if (!existsSync(args.repo) || !statSync(args.repo).isDirectory()) {
    throw new Error(`Repo path does not exist: ${args.repo}`);
  }

  const plan = planNightlyRun(args);
  const writeResult = args.dryRun
    ? null
    : writeRunPlan({
        runDir: args.runDir,
        repo: plan.repo,
        soak: plan.soak,
        riskSnapshot: plan.riskSnapshot,
        duplicateWork: plan.duplicateWork,
        peerWorktrees: plan.peerWorktrees,
        candidates: plan.candidates,
        selected: plan.selected,
        options: {
          ...args,
          outcomeLedgerSummary: plan.outcomeLedger,
          behaviorGate: plan.behaviorGate,
          canonicalTaskIds: plan.runnableTaskIds,
        },
      });

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ ...plan, writeResult }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(textSummary(plan, writeResult, args));
  }
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
