#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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

export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines.shift()?.split("\t") ?? [];
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
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
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
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
  crashAutomationExists,
  devBotMemoryExists,
  memoryBudgetBytes,
}) {
  const candidates = [];

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

export function buildReport({ repo, soak, candidates, selected, options }) {
  const blockedProvider = candidates.filter((candidate) => candidate.providerVisible);
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
    "## Selected Queue",
    "",
    ...selected.flatMap((candidate, index) => [
      `${index + 1}. ${candidate.title}`,
      `   Kind: ${candidate.kind}. Score: ${numberFormatter.format(candidate.score)}. Machine time: ${numberFormatter.format(candidate.estimatedMinutes)} min.`,
    ]),
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
    "- Require evidence snapshots before every rare crash or memory fix so the next failure has better diagnostics.",
    "- Add a morning digest that ranks shipped value, residual risk, and the single next highest leverage bottleneck.",
    "",
  ].join("\n");
}

export function writeRunPlan({ runDir, repo, soak, candidates, selected, options }) {
  mkdirSync(runDir, { recursive: true });
  const tasksDir = path.join(runDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });

  const report = buildReport({ repo, soak, candidates, selected, options });
  writeFileSync(path.join(runDir, "report.md"), report);
  writeFileSync(path.join(runDir, "targets.json"), `${JSON.stringify({ repo, soak, candidates, selected }, null, 2)}\n`);

  selected.forEach((candidate, index) => {
    const name = `${String(index + 1).padStart(2, "0")}-${candidate.id}.md`;
    writeFileSync(path.join(tasksDir, name), formatCandidate(candidate, index));
  });

  return { runDir, reportPath: path.join(runDir, "report.md"), tasksDir };
}

export function planNightlyRun(args) {
  const soakDir = args.soakDir || resolveCurrentSoakDir();
  const soak = summarizeSoak(soakDir);
  const dailyBug = summarizeDailyBugMemory(args.dailyBugMemory);
  const repo = collectRepoSnapshot(args.repo);
  const candidates = buildCandidates({
    soak,
    dailyBug,
    repo,
    crashAutomationExists: existsSync(args.crashAutomation),
    devBotMemoryExists: existsSync(args.devBotMemory),
    memoryBudgetBytes: args.memoryGib * GIB,
  });
  const selected = selectTargets(candidates, args);
  return { repo, soak, dailyBug, candidates, selected };
}

function textSummary(plan, writeResult, args) {
  const lines = [
    `Selected ${numberFormatter.format(plan.selected.length)} targets from ${numberFormatter.format(plan.candidates.length)} candidates.`,
    `Max WebKit RSS: ${formatBytes(plan.soak.maxWebKitResidentBytes)}.`,
    `Stale heartbeat events: ${numberFormatter.format(plan.soak.staleHeartbeatCount)}.`,
  ];

  for (const [index, selected] of plan.selected.entries()) {
    lines.push(`${index + 1}. ${selected.title} (${selected.kind}, score ${numberFormatter.format(selected.score)})`);
  }

  if (writeResult) {
    lines.push(`Report: ${writeResult.reportPath}`);
    lines.push(`Tasks: ${writeResult.tasksDir}`);
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
        candidates: plan.candidates,
        selected: plan.selected,
        options: args,
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
