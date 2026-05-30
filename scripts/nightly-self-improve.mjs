#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_DAILY_BUG_MEMORY =
  "/Users/aubreyfalconer/.codex/automations/daily-bug-scan/memory.md";
const DEFAULT_CRASH_AUTOMATION =
  "/Users/aubreyfalconer/.codex/automations/crash-watch/automation.toml";
const DEFAULT_DEV_BOT_MEMORY =
  "/Users/aubreyfalconer/.codex/automations/hourly-dev-bot/memory.md";
const DEFAULT_SOAK_POINTER = "/tmp/freed-perf-soak/current-soak-dir";
const DEFAULT_OUTCOME_LEDGER = "/tmp/freed-nightly-self-improve/outcomes.jsonl";
const MAX_PEER_EVIDENCE_FILES = 12;
const STALE_SOAK_MS = 2 * 60 * 60 * 1000;

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
  --daily-bug-memory <path>     Daily bug scan memory file to fold into target selection.
  --peer-worktree <path>        Extra local worktree to compare and rank as a peer target.
  --no-peer-scan                Skip automatic git worktree discovery.
  --outcome-ledger <path>       JSONL file with prior target outcomes.
  --max-targets <count>         Maximum targets to select. Defaults to 3.
  --duration-minutes <count>    Planning budget for one night. Defaults to 480.
  --memory-gib <count>          WebKit RSS budget before memory work wins. Defaults to 2.5.
  --allow-provider-visible      Permit targets that could touch third-party providers.
  --dry-run                     Print the plan without writing files.
  --json                        Print JSON instead of a text summary.
  --help                        Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    runDir: "",
    soakDir: "",
    dailyBugMemory: DEFAULT_DAILY_BUG_MEMORY,
    crashAutomation: DEFAULT_CRASH_AUTOMATION,
    devBotMemory: DEFAULT_DEV_BOT_MEMORY,
    outcomeLedger: DEFAULT_OUTCOME_LEDGER,
    peerWorktrees: [],
    peerScan: true,
    maxTargets: 3,
    durationMinutes: 480,
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
        index += 1;
        break;
      case "--soak-dir":
        args.soakDir = argv[index + 1] ?? "";
        index += 1;
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
      case "--outcome-ledger":
        args.outcomeLedger = argv[index + 1] ?? "";
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
      case "--memory-gib":
        args.memoryGib = Number.parseFloat(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--allow-provider-visible":
        args.allowProviderVisible = true;
        break;
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
  if (!Number.isFinite(args.maxTargets) || args.maxTargets < 1) {
    throw new Error("maxTargets must be at least 1.");
  }
  if (!Number.isFinite(args.durationMinutes) || args.durationMinutes < 30) {
    throw new Error("durationMinutes must be at least 30.");
  }
  if (!Number.isFinite(args.memoryGib) || args.memoryGib <= 0) {
    throw new Error("memoryGib must be greater than 0.");
  }

  args.repo = path.resolve(args.repo);
  args.outcomeLedger = path.resolve(args.outcomeLedger);
  args.peerWorktrees = args.peerWorktrees.filter(Boolean).map((item) => path.resolve(item));
  args.runDir =
    args.runDir ||
    path.join(
      os.tmpdir(),
      "freed-nightly-self-improve",
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

function readJsonLines(filePath) {
  return readText(filePath)
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
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

export function summarizeOutcomeLedger(filePath) {
  const entries = readJsonLines(filePath);
  const byKind = new Map();
  const byId = new Map();

  for (const entry of entries) {
    const kind = String(entry.kind ?? "");
    const id = String(entry.id ?? "");
    const outcome = String(entry.outcome ?? "");
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
        shipped: 0,
        validated: 0,
        failed: 0,
      };
      current.attempts += 1;
      if (outcome === "shipped") {
        current.shipped += 1;
      } else if (outcome === "validated") {
        current.validated += 1;
      } else if (outcome === "failed" || outcome === "blocked") {
        current.failed += 1;
      }
      map.set(key, current);
    }
  }

  return {
    path: filePath,
    exists: entries.length > 0,
    entries,
    byKind: Object.fromEntries(byKind),
    byId: Object.fromEntries(byId),
  };
}

export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines.shift()?.split("\t") ?? [];
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
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
    const value = numeric(row.webkitResidentBytes ?? row.webkitLargestResidentBytes);
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
    rows.filter((row) => row.health_event === "renderer_heartbeat_stale").length +
    healthRows.filter((row) => row.event === "renderer_heartbeat_stale").length;
  const throttledHeartbeatCount =
    rows.filter((row) => row.health_hidden_timer_throttled === "true").length +
    healthRows.filter((row) => row.hiddenTimerThrottled === true).length;

  return {
    exists: true,
    soakDir,
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
      healthRows.reduce((max, row) => Math.max(max, numeric(row.domNodeCount) ?? 0), 0),
    ),
    staleHeartbeatCount,
    throttledHeartbeatCount,
    lastEvent:
      lastValue(rows, "health_event") ||
      String(healthRows.at(-1)?.event ?? ""),
    firstTimestamp: rows[0]?.ts ?? String(healthRows[0]?.tsMs ?? ""),
    lastTimestamp: rows.at(-1)?.ts ?? String(healthRows.at(-1)?.tsMs ?? ""),
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
  const latestHadNoFix = /no\s+(evidence-backed\s+)?(bug|fix)|no fix applied/i.test(latest.text);
  return {
    exists: Boolean(text),
    path: memoryPath,
    latestDate: latest.date,
    latestSection: latest.text,
    latestHadNoNewCommits: /0`\s+commits|0 commits|no new repo evidence/i.test(latest.text),
    latestHadFix:
      !latestHadNoFix &&
      /outcome:\s+.*(fix applied|implemented|merged)|fix applied/i.test(latest.text),
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

function providerVisiblePath(filePath) {
  return (
    filePath.startsWith("packages/capture-") ||
    filePath.includes("/capture-") ||
    filePath.includes("facebook") ||
    filePath.includes("instagram") ||
    filePath.includes("linkedin") ||
    filePath.includes("x-capture") ||
    filePath.includes("li-capture") ||
    filePath.includes("scraper-prefs") ||
    filePath.includes("scraper-window")
  );
}

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
  return Math.min(99, Math.max(1, score));
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
  const head = git(resolved, ["rev-parse", "--short", "HEAD"]);
  const status = git(resolved, ["status", "--short"]);
  const committedFiles = git(resolved, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "origin/dev",
    "HEAD",
  ]);
  const workingFiles = unique([
    ...shortStatusPaths(status),
    ...committedFiles.split(/\r?\n/),
  ]).sort();
  const aheadCount = Number.parseInt(git(resolved, ["rev-list", "--count", "origin/dev..HEAD"]) || "0", 10);
  const behindCount = Number.parseInt(git(resolved, ["rev-list", "--count", "HEAD..origin/dev"]) || "0", 10);

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

export function collectPeerWorktrees(repo, explicitWorktrees = [], scan = true) {
  const explicitPaths = new Set(
    explicitWorktrees.flatMap((worktreePath) => {
      try {
        return [realpathSync(worktreePath)];
      } catch {
        return [];
      }
    }),
  );
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
    .map((peer) => ({ ...peer, explicit: explicitPaths.has(peer.path) }))
    .filter(
      (peer) =>
        peer.explicit ||
        /nightly|self|runner|automation|scraper-recycle/i.test(peer.branch),
    )
    .filter((peer) => peer.changedFileCount > 0 || peer.aheadCount > 0)
    .map((peer) => ({ ...peer, score: peerWorktreeScore(peer) }))
    .sort((left, right) => right.score - left.score);
}

export function collectRepoSnapshot(repo) {
  return {
    branch: git(repo, ["branch", "--show-current"]) || git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(repo, ["rev-parse", "--short", "HEAD"]),
    originDev: git(repo, ["rev-parse", "--short", "origin/dev"]),
    originMain: git(repo, ["rev-parse", "--short", "origin/main"]),
    status: git(repo, ["status", "--short"]),
  };
}

function riskItem({ id, severity, title, evidence, remediation }) {
  return { id, severity, title, evidence, remediation };
}

export function collectRiskSnapshot({
  repoPath,
  repo,
  soak,
  peerWorktrees = [],
  crashAutomation,
  dailyBugMemory,
  devBotMemory,
  nowMs = Date.now(),
}) {
  const risks = [];
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
      }),
    );
  }

  for (const relativePath of [
    "packages/desktop/playwright-report",
    "packages/desktop/test-results",
    "packages/desktop/.playwright-mcp",
  ]) {
    const absolutePath = path.join(repoPath, relativePath);
    const fileCount = countFiles(absolutePath);
    if (fileCount > 0) {
      risks.push(
        riskItem({
          id: `generated-artifacts-${relativePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          severity: "warning",
          title: `Generated artifacts exist in ${relativePath}`,
          evidence: [absolutePath, `${numberFormatter.format(fileCount)} files`],
          remediation:
            "Remove generated reports or intentionally stage them before publishing so validation leftovers do not pollute the branch.",
        }),
      );
    }
  }

  if (!existsSync(path.join(repoPath, "node_modules"))) {
    risks.push(
      riskItem({
        id: "missing-root-node-modules",
        severity: "blocker",
        title: "Root dependencies are not installed",
        evidence: [path.join(repoPath, "node_modules")],
        remediation:
          "Bootstrap the worktree before running validation or planning work that depends on repo scripts.",
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
      }),
    );
  }

  for (const peer of peerWorktrees) {
    if (peer.status) {
      risks.push(
        riskItem({
          id: `dirty-peer-${peer.branch.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          severity: "warning",
          title: `Peer worktree ${peer.branch} has uncommitted changes`,
          evidence: [peer.path, ...shortStatusPaths(peer.status).slice(0, 8)],
          remediation:
            "Treat the peer as active work. Compare it read-only and do not cherry-pick from it until its state is understood.",
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
        }),
      );
    }
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
    risks,
  };
}

function target({
  id,
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
}) {
  return {
    id,
    kind,
    title,
    score,
    confidence,
    estimatedMinutes,
    providerVisible,
    canModify,
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
  peerWorktrees = [],
  crashAutomationExists,
  devBotMemoryExists,
  memoryBudgetBytes,
}) {
  const candidates = [];

  if ((riskSnapshot?.blockerCount ?? 0) > 0 || (riskSnapshot?.warningCount ?? 0) > 0) {
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

  for (const peer of peerWorktrees) {
    candidates.push(
      target({
        id: `peer-${peer.branch.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`,
        kind: "peer-worktree",
        title: `Review and incorporate peer worktree ${peer.branch}`,
        score: peer.score,
        confidence: peer.branch.includes("scraper-recycle-verification") ? 0.88 : 0.72,
        estimatedMinutes: peer.touchesNightlyRunner ? 75 : 55,
        providerVisible: peer.providerVisible,
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

  if (soak.exists && (soak.maxWebKitResidentBytes ?? 0) > memoryBudgetBytes) {
    candidates.push(
      target({
        id: "webkit-memory-pressure",
        kind: "performance",
        title: "Reduce installed-build WebKit memory growth",
        score: 98,
        confidence: 0.9,
        estimatedMinutes: 150,
        rationale:
          `The active soak observed WebKit RSS at ${formatBytes(soak.maxWebKitResidentBytes)}, above the ${formatBytes(memoryBudgetBytes)} budget.`,
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

  if (soak.exists && soak.staleHeartbeatCount > 0) {
    candidates.push(
      target({
        id: "renderer-heartbeat-stale",
        kind: "stability",
        title: "Diagnose stale renderer heartbeat cycles",
        score: 88,
        confidence: 0.82,
        estimatedMinutes: 90,
        rationale:
          `The active soak recorded ${numberFormatter.format(soak.staleHeartbeatCount)} stale heartbeat events.`,
        evidence: [soak.soakDir, `Last health event ${soak.lastEvent || "unknown"}`],
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
        rationale: dailyBug.latestHadNoNewCommits
          ? "The last bug scan found no new commits, but bug fixing remains an executable nightly target once the commit window moves."
          : "The daily bug scan memory has fresh repo evidence that should be reviewed before choosing speculative work.",
        evidence: [
          dailyBug.path,
          dailyBug.latestDate ? `Latest scan ${dailyBug.latestDate}` : "No dated scan section found",
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
      validation: ["No code changes are allowed for this target without approval."],
    }),
  );

  return candidates.sort((left, right) => right.score - left.score);
}

export function applyOutcomeFeedback(candidates, outcomeLedger) {
  return candidates
    .map((candidate) => {
      const kindStats = outcomeLedger.byKind?.[candidate.kind];
      const idStats = outcomeLedger.byId?.[candidate.id];
      const shipped = (kindStats?.shipped ?? 0) + (idStats?.shipped ?? 0);
      const validated = (kindStats?.validated ?? 0) + (idStats?.validated ?? 0);
      const failed = (kindStats?.failed ?? 0) + (idStats?.failed ?? 0);
      const adjustment = Math.max(-12, Math.min(12, shipped * 3 + validated * 1.5 - failed * 4));
      return {
        ...candidate,
        score: Math.max(1, Math.min(99, candidate.score + adjustment)),
        outcomeFeedback: {
          shipped,
          validated,
          failed,
          adjustment,
        },
      };
    })
    .sort((left, right) => right.score - left.score);
}

export function selectTargets(candidates, options) {
  const budget = options.durationMinutes;
  const selected = [];
  let used = 0;

  for (const candidate of candidates) {
    if (selected.length >= options.maxTargets) {
      break;
    }
    if (candidate.providerVisible && !options.allowProviderVisible) {
      continue;
    }
    if (used + candidate.estimatedMinutes > budget && selected.length > 0) {
      continue;
    }
    selected.push(candidate);
    used += candidate.estimatedMinutes;
  }

  return selected;
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
    "## Validation",
    "",
    ...candidate.validation.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function buildReport({ repo, soak, riskSnapshot, outcomeLedger, candidates, selected, options }) {
  const blockedProvider = candidates.filter((candidate) => candidate.providerVisible);
  const phases = buildNightlyPhases(selected);
  return [
    "# Freed Nightly Improvement Plan",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Repo: ${repo.branch || "unknown"} at ${repo.head || "unknown"}`,
    `Budget: ${numberFormatter.format(options.durationMinutes)} min`,
    `Selected targets: ${numberFormatter.format(selected.length)}`,
    "",
    "## Current Evidence",
    "",
    `- Soak directory: ${soak.soakDir || "none"}`,
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
    "",
    ...(riskSnapshot?.risks ?? []).slice(0, 8).map(
      (risk) => `- ${risk.severity}: ${risk.title}`,
    ),
    "",
    "## Learning Signals",
    "",
    `- Outcome ledger: ${outcomeLedger?.path ?? "none"}`,
    `- Prior outcomes loaded: ${numberFormatter.format(outcomeLedger?.entries?.length ?? 0)}`,
    "",
    "## Selected Queue",
    "",
    ...selected.flatMap((candidate, index) => [
      `${index + 1}. ${candidate.title}`,
      `   Kind: ${candidate.kind}. Score: ${numberFormatter.format(candidate.score)}. Machine time: ${numberFormatter.format(candidate.estimatedMinutes)} min.`,
    ]),
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

function buildNightlyPhases(selected) {
  const phases = [
    "Snapshot evidence from soak, logs, automations, git state, and peer worktrees.",
  ];
  if (selected.some((candidate) => candidate.kind === "peer-worktree")) {
    phases.push("Compare peer worktrees and import safe measurement improvements.");
  }
  phases.push("Execute selected targets in score order while respecting provider visibility gates.");
  phases.push("Run focused validation for each changed surface.");
  phases.push("Run validate:feature before publishing or updating a PR.");
  phases.push("Ship a dev build only if real product fixes landed and checks are green.");
  phases.push("Install the new build, restart the soak, and write the morning digest.");
  return phases;
}

export function buildExecutionPlan(selected) {
  const phases = [
    {
      id: "evidence-snapshot",
      title: "Snapshot evidence",
      stopGate: "Stop if the repo is dirty with unrelated user changes or required evidence files cannot be read.",
      commands: [
        "git fetch --all --prune",
        "git status --short",
        "node scripts/nightly-self-improve.mjs --dry-run --json",
      ],
    },
  ];

  if (selected.some((candidate) => candidate.kind === "peer-worktree")) {
    phases.push({
      id: "peer-review",
      title: "Review peer worktrees",
      stopGate: "Stop before editing if the peer branch is still changing or the useful change is provider-visible.",
      commands: [
        "git worktree list --porcelain",
        "git diff --stat origin/dev HEAD",
        "git diff --name-only origin/dev HEAD",
      ],
    });
  }

  phases.push(
    {
      id: "implementation",
      title: "Implement selected targets",
      stopGate: "Stop if a target requires provider-visible behavior changes without explicit approval.",
      commands: selected.map((candidate) => `# ${candidate.id}: ${candidate.prompt}`),
    },
    {
      id: "focused-validation",
      title: "Run focused validation",
      stopGate: "Stop if the focused test for the touched code path fails.",
      commands: [
        "node --test scripts/nightly-self-improve.test.mjs",
        "# Add the focused product test for any non-runner changes.",
      ],
    },
    {
      id: "feature-validation",
      title: "Run feature validation",
      stopGate: "Stop if validate:feature fails.",
      commands: ["corepack npm run validate:feature"],
    },
    {
      id: "publish",
      title: "Publish or update draft PR",
      stopGate: "Stop if the branch has no product or tooling improvement beyond generated run artifacts.",
      commands: [
        './scripts/worktree-publish.sh --title "feat: improve nightly runner" --summary "<summary>" --test "<tests>"',
      ],
    },
    {
      id: "release-and-soak",
      title: "Ship and soak only after real fixes",
      stopGate: "Skip this phase when only planning artifacts changed.",
      commands: [
        "# Use freed-ship-build dev after fixes merge into dev.",
        "# Install the new dev build, restart the installed-build soak, and append outcome-template.jsonl to the outcome ledger.",
      ],
    },
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
      "",
      "Commands:",
      "",
      ...phase.commands.map((command) => `- \`${command}\``),
      "",
    ]),
  ].join("\n");
}

export function writeRunPlan({ runDir, repo, soak, riskSnapshot, peerWorktrees = [], candidates, selected, options }) {
  mkdirSync(runDir, { recursive: true });
  const tasksDir = path.join(runDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });

  const outcomeLedger = options.outcomeLedgerSummary ?? { path: options.outcomeLedger, entries: [] };
  const safeRiskSnapshot =
    riskSnapshot ??
    {
      generatedAt: new Date().toISOString(),
      repoPath: "",
      blockerCount: 0,
      warningCount: 0,
      infoCount: 0,
      automationStatuses: [],
      risks: [],
    };
  const executionPlan = buildExecutionPlan(selected);
  const report = buildReport({ repo, soak, riskSnapshot: safeRiskSnapshot, outcomeLedger, candidates, selected, options });
  writeFileSync(path.join(runDir, "report.md"), report);
  writeFileSync(path.join(runDir, "targets.json"), `${JSON.stringify({ repo, soak, riskSnapshot: safeRiskSnapshot, peerWorktrees, outcomeLedger, executionPlan, candidates, selected }, null, 2)}\n`);
  writeFileSync(path.join(runDir, "risk-snapshot.json"), `${JSON.stringify(safeRiskSnapshot, null, 2)}\n`);
  writeFileSync(path.join(runDir, "risk-snapshot.md"), renderRiskSnapshotMarkdown(safeRiskSnapshot));
  writeFileSync(path.join(runDir, "execution-plan.json"), `${JSON.stringify(executionPlan, null, 2)}\n`);
  writeFileSync(path.join(runDir, "execution-plan.md"), renderExecutionPlanMarkdown(executionPlan));
  writeFileSync(
    path.join(runDir, "outcome-template.jsonl"),
    selected
      .map((candidate) =>
        JSON.stringify({
          ts: new Date().toISOString(),
          id: candidate.id,
          kind: candidate.kind,
          outcome: "validated",
          notes: "Replace outcome with shipped, validated, blocked, or failed after the run.",
        }),
      )
      .join("\n") + "\n",
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
    executionPlanPath: path.join(runDir, "execution-plan.md"),
    outcomeTemplatePath: path.join(runDir, "outcome-template.jsonl"),
  };
}

export function planNightlyRun(args) {
  const soakDir = args.soakDir || resolveCurrentSoakDir();
  const soak = summarizeSoak(soakDir);
  const dailyBug = summarizeDailyBugMemory(args.dailyBugMemory);
  const repo = collectRepoSnapshot(args.repo);
  const peerWorktrees = collectPeerWorktrees(args.repo, args.peerWorktrees, args.peerScan);
  const outcomeLedger = summarizeOutcomeLedger(args.outcomeLedger);
  const riskSnapshot = collectRiskSnapshot({
    repoPath: args.repo,
    repo,
    soak,
    peerWorktrees,
    crashAutomation: args.crashAutomation,
    dailyBugMemory: args.dailyBugMemory,
    devBotMemory: args.devBotMemory,
  });
  const baseCandidates = buildCandidates({
    soak,
    dailyBug,
    repo,
    riskSnapshot,
    peerWorktrees,
    crashAutomationExists: existsSync(args.crashAutomation),
    devBotMemoryExists: existsSync(args.devBotMemory),
    memoryBudgetBytes: args.memoryGib * GIB,
  });
  const candidates = applyOutcomeFeedback(baseCandidates, outcomeLedger);
  const selected = selectTargets(candidates, args);
  return { repo, soak, dailyBug, riskSnapshot, peerWorktrees, outcomeLedger, candidates, selected };
}

function textSummary(plan, writeResult, args) {
  const lines = [
    `Selected ${numberFormatter.format(plan.selected.length)} targets from ${numberFormatter.format(plan.candidates.length)} candidates.`,
    `Max WebKit RSS: ${formatBytes(plan.soak.maxWebKitResidentBytes)}.`,
    `Stale heartbeat events: ${numberFormatter.format(plan.soak.staleHeartbeatCount)}.`,
    `Preflight risks: ${numberFormatter.format(plan.riskSnapshot.blockerCount)} blockers, ${numberFormatter.format(plan.riskSnapshot.warningCount)} warnings.`,
    `Peer worktrees with changes: ${numberFormatter.format(plan.peerWorktrees.length)}.`,
    `Prior outcomes loaded: ${numberFormatter.format(plan.outcomeLedger.entries.length)}.`,
  ];

  for (const [index, selected] of plan.selected.entries()) {
    lines.push(`${index + 1}. ${selected.title} (${selected.kind}, score ${numberFormatter.format(selected.score)})`);
  }

  if (writeResult) {
    lines.push(`Report: ${writeResult.reportPath}`);
    lines.push(`Tasks: ${writeResult.tasksDir}`);
    lines.push(`Risk snapshot: ${writeResult.riskSnapshotPath}`);
    lines.push(`Execution plan: ${writeResult.executionPlanPath}`);
    lines.push(`Outcome template: ${writeResult.outcomeTemplatePath}`);
  }

  if (args.dryRun) {
    lines.push("Dry run only. No files were written.");
  }

  return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
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
        peerWorktrees: plan.peerWorktrees,
        candidates: plan.candidates,
        selected: plan.selected,
        options: { ...args, outcomeLedgerSummary: plan.outcomeLedger },
      });

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...plan, writeResult }, null, 2)}\n`);
  } else {
    process.stdout.write(textSummary(plan, writeResult, args));
  }
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
