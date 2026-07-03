#!/usr/bin/env node

// Installed-build soak collector.
//
// Samples the installed Freed Desktop app on an interval into a versioned
// TSV/JSONL schema under a soak directory, and points the active-soak pointer
// (~/.freed-automation/current-soak-dir) at it so the nightly planner and
// scripts/soak-assert.mjs can find the evidence.
//
// What it records per sample:
//   metrics.tsv            one row per sample (see COLUMNS below)
//   webkit-processes.tsv   machine-wide WebKit XPC process table
//   health-offsets.jsonl   byte/line offsets of the app's runtime-health.jsonl
//   soak-info.json         schema version + config, written once at start
//
// WebKit attribution caveat: WebKit XPC processes are children of launchd
// (ppid 1), so plain `ps` cannot attribute them to Freed (stability finding
// F27). The webkit* columns are machine-wide totals; the app's own attributed
// view lives in runtime-health.jsonl, which soak-assert reads alongside this.
//
// Usage:
//   node scripts/soak-collect.mjs                    # sample every 60s until killed
//   node scripts/soak-collect.mjs --detach           # survive terminal close
//   node scripts/soak-collect.mjs --once             # single sample (smoke test)
//   node scripts/soak-collect.mjs --interval-seconds 30 --duration-minutes 600

import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

export const SOAK_SCHEMA_VERSION = 1;
export const METRICS_COLUMNS = [
  "tsMs", // sample wall-clock epoch ms
  "iso", // same instant, ISO-8601, for humans
  "appPid", // Freed Desktop main process pid, 0 when not running
  "appRssKb", // main process resident set, KiB (ps rss)
  "webkitWebContentCount", // machine-wide WebContent process count
  "webkitWebContentRssKb", // machine-wide WebContent resident total, KiB
  "webkitLargestRssKb", // largest single WebContent resident, KiB
  "webkitOtherRssKb", // machine-wide GPU+Networking resident total, KiB
  "healthFileBytes", // runtime-health.jsonl size at sample time
  "healthFileLines", // runtime-health.jsonl line count at sample time
];

const DEFAULT_APP_DATA_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "wtf.freed.desktop",
);
const AUTOMATION_STATE_DIR = path.join(os.homedir(), ".freed-automation");

function usage() {
  return `Usage:
  node scripts/soak-collect.mjs [options]

Options:
  --soak-dir <path>          Soak directory. Defaults to ~/.freed-automation/soaks/<timestamp>.
  --pointer <path>           Active-soak pointer file. Defaults to ~/.freed-automation/current-soak-dir.
  --app-data <path>          App data dir holding runtime-health.jsonl. Defaults to the installed Freed Desktop dir.
  --app-binary <substring>   Main process match. Defaults to "Freed.app/Contents/MacOS".
  --interval-seconds <n>     Sample interval. Defaults to 60.
  --duration-minutes <n>     Stop after this long. Defaults to 0 (run until killed).
  --once                     Take a single sample and exit.
  --detach                   Re-spawn detached from the terminal and exit.
  --help                     Show this help.
`;
}

export function parseArgs(argv, now = new Date()) {
  const args = {
    soakDir: "",
    pointer: path.join(AUTOMATION_STATE_DIR, "current-soak-dir"),
    appData: DEFAULT_APP_DATA_DIR,
    appBinary: "Freed.app/Contents/MacOS",
    intervalSeconds: 60,
    durationMinutes: 0,
    once: false,
    detach: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--soak-dir":
        args.soakDir = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--pointer":
        args.pointer = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--app-data":
        args.appData = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--app-binary":
        args.appBinary = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--interval-seconds":
        args.intervalSeconds = Number(argv[index + 1]);
        index += 1;
        break;
      case "--duration-minutes":
        args.durationMinutes = Number(argv[index + 1]);
        index += 1;
        break;
      case "--once":
        args.once = true;
        break;
      case "--detach":
        args.detach = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.help) {
    return args;
  }
  if (!Number.isFinite(args.intervalSeconds) || args.intervalSeconds < 5) {
    throw new Error("interval-seconds must be at least 5.");
  }
  if (!Number.isFinite(args.durationMinutes) || args.durationMinutes < 0) {
    throw new Error("duration-minutes must be 0 or more.");
  }
  if (!args.pointer) {
    throw new Error("pointer requires a path.");
  }
  args.soakDir =
    args.soakDir ||
    path.join(
      AUTOMATION_STATE_DIR,
      "soaks",
      now.toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15),
    );
  args.soakDir = path.resolve(args.soakDir);
  args.pointer = path.resolve(args.pointer);
  args.appData = path.resolve(args.appData);

  return args;
}

// Parses `ps axo pid=,ppid=,rss=,command=` output into rows.
export function parsePsTable(psOutput) {
  return String(psOutput ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssKb: Number(match[3]),
        command: match[4],
      };
    })
    .filter(Boolean);
}

// Builds one metrics row (plus the WebKit process sub-table) from a ps table.
export function buildSample(psRows, { appBinary, tsMs }) {
  const appRow = psRows.find((row) => row.command.includes(appBinary)) ?? null;
  const webContent = psRows.filter((row) => row.command.includes("com.apple.WebKit.WebContent"));
  const otherWebKit = psRows.filter(
    (row) =>
      row.command.includes("com.apple.WebKit.") &&
      !row.command.includes("com.apple.WebKit.WebContent"),
  );

  return {
    tsMs,
    iso: new Date(tsMs).toISOString(),
    appPid: appRow?.pid ?? 0,
    appRssKb: appRow?.rssKb ?? 0,
    webkitWebContentCount: webContent.length,
    webkitWebContentRssKb: webContent.reduce((sum, row) => sum + row.rssKb, 0),
    webkitLargestRssKb: webContent.reduce((max, row) => Math.max(max, row.rssKb), 0),
    webkitOtherRssKb: otherWebKit.reduce((sum, row) => sum + row.rssKb, 0),
    webkitRows: [...webContent, ...otherWebKit],
  };
}

export function metricsRowToTsv(sample) {
  return `${METRICS_COLUMNS.map((column) => String(sample[column] ?? "")).join("\t")}\n`;
}

function readHealthOffsets(appData) {
  const healthPath = path.join(appData, "runtime-health.jsonl");
  if (!existsSync(healthPath)) {
    return { bytes: 0, lines: 0 };
  }
  try {
    const stat = statSync(healthPath);
    // The app rotates this file (5 MiB cap today), so a full read per sample
    // is cheap.
    const content = readFileSync(healthPath, "utf8");
    return { bytes: stat.size, lines: content.split("\n").filter(Boolean).length };
  } catch {
    return { bytes: 0, lines: 0 };
  }
}

function takeSample(args, now = Date.now()) {
  let psOutput = "";
  try {
    psOutput = execFileSync("ps", ["axo", "pid=,ppid=,rss=,command="], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    psOutput = "";
  }
  const sample = buildSample(parsePsTable(psOutput), {
    appBinary: args.appBinary,
    tsMs: now,
  });
  const offsets = readHealthOffsets(args.appData);
  sample.healthFileBytes = offsets.bytes;
  sample.healthFileLines = offsets.lines;

  appendFileSync(path.join(args.soakDir, "metrics.tsv"), metricsRowToTsv(sample));
  for (const row of sample.webkitRows) {
    appendFileSync(
      path.join(args.soakDir, "webkit-processes.tsv"),
      `${sample.tsMs}\t${row.pid}\t${row.ppid}\t${row.rssKb}\t${row.command.slice(0, 200)}\n`,
    );
  }
  appendFileSync(
    path.join(args.soakDir, "health-offsets.jsonl"),
    `${JSON.stringify({ tsMs: sample.tsMs, ...offsets })}\n`,
  );
  return sample;
}

function initSoakDir(args) {
  mkdirSync(args.soakDir, { recursive: true });
  const infoPath = path.join(args.soakDir, "soak-info.json");
  if (!existsSync(infoPath)) {
    writeFileSync(
      infoPath,
      `${JSON.stringify(
        {
          schemaVersion: SOAK_SCHEMA_VERSION,
          startedAt: new Date().toISOString(),
          intervalSeconds: args.intervalSeconds,
          durationMinutes: args.durationMinutes,
          appData: args.appData,
          appBinary: args.appBinary,
          collectorPid: process.pid,
          metricsColumns: METRICS_COLUMNS,
          webkitProcessesColumns: ["tsMs", "pid", "ppid", "rssKb", "command"],
          notes:
            "webkit* metrics are machine-wide: WebKit XPC processes cannot be attributed to Freed from ps (ppid 1, finding F27). App-attributed telemetry lives in runtime-health.jsonl.",
        },
        null,
        2,
      )}\n`,
    );
  }
  const metricsPath = path.join(args.soakDir, "metrics.tsv");
  if (!existsSync(metricsPath)) {
    writeFileSync(metricsPath, `${METRICS_COLUMNS.join("\t")}\n`);
  }
  mkdirSync(path.dirname(args.pointer), { recursive: true });
  writeFileSync(args.pointer, `${args.soakDir}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  if (args.detach) {
    const childArgs = process.argv.slice(1).filter((arg) => arg !== "--detach");
    // Pin the soak dir so the parent can report where the detached child writes.
    if (!childArgs.includes("--soak-dir")) {
      childArgs.push("--soak-dir", args.soakDir);
    }
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    process.stdout.write(`Detached collector pid ${child.pid}, soak dir ${args.soakDir}\n`);
    return;
  }

  initSoakDir(args);
  const startedAt = Date.now();
  const sample = takeSample(args);
  process.stdout.write(
    `Soak dir ${args.soakDir}: sampling every ${args.intervalSeconds}s (app pid ${sample.appPid || "not running"}).\n`,
  );
  if (args.once) {
    return;
  }

  const timer = setInterval(() => {
    takeSample(args);
    if (args.durationMinutes > 0 && Date.now() - startedAt >= args.durationMinutes * 60_000) {
      clearInterval(timer);
      process.stdout.write("Soak duration reached; collector exiting.\n");
    }
  }, args.intervalSeconds * 1_000);
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
