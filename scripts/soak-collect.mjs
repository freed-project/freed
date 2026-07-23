#!/usr/bin/env node

// Installed-build soak collector.
//
// Samples the installed Freed Desktop app on an interval into a versioned
// TSV/JSONL schema under a soak directory, and points the active-soak pointer
// (~/.freed/automation/current-soak-dir) at it so the nightly planner and
// scripts/soak-assert.mjs can find the evidence.
//
// What it records per sample:
//   metrics.tsv            one row per sample (see COLUMNS below)
//   webkit-processes.tsv   machine-wide WebKit XPC process table
//   runtime-health.jsonl   incremental mirror of the app's runtime-health.jsonl,
//                          appended from the last recorded byte offset so daily
//                          rotation (P0-04) cannot shrink a long soak's evidence
//                          window; soak-assert prefers this copy
//   health-offsets.jsonl   byte/line cursor of the app's runtime-health.jsonl
//   collector-events.jsonl session lifecycle plus sample outage transitions
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
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const DETACHED_HANDOFF_TOKEN_ENV = "FREED_SOAK_COLLECTOR_HANDOFF_TOKEN";
const DETACHED_HANDOFF_PARENT_PID_ENV =
  "FREED_SOAK_COLLECTOR_HANDOFF_PARENT_PID";
const DETACHED_READY_TIMEOUT_MS = 10_000;
const DETACHED_ACCEPT_TIMEOUT_MS = 15_000;
const COLLECTOR_ENTRYPOINT = path.basename(__filename);
export const COLLECTOR_EVENTS_SCHEMA_VERSION = 2;
export const COLLECTOR_EVENTS_FILENAME = "collector-events.jsonl";
export const COLLECTOR_EVENTS_ARCHIVE_FILENAME = `${COLLECTOR_EVENTS_FILENAME}.1`;
const MAX_COLLECTOR_ERROR_MESSAGE_LENGTH = 1_000;
export const MAX_COLLECTOR_EVENTS_BYTES = 1024 * 1024;
const COLLECTOR_DIAGNOSTIC_ERROR_INTERVAL_MS = 5 * 60_000;

export const SOAK_SCHEMA_VERSION = 3;
export const HEALTH_CURSOR_SCHEMA_VERSION = 2;

export function collectorEventEvidenceDeclaration() {
  return {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    filename: COLLECTOR_EVENTS_FILENAME,
    archiveFilename: COLLECTOR_EVENTS_ARCHIVE_FILENAME,
    maxFileBytes: MAX_COLLECTOR_EVENTS_BYTES,
  };
}

export function hasCollectorEventEvidenceCapability(soakInfo) {
  const declaration = soakInfo?.collectorEvents;
  return (
    Number(soakInfo?.schemaVersion) >= SOAK_SCHEMA_VERSION &&
    declaration?.schemaVersion === COLLECTOR_EVENTS_SCHEMA_VERSION &&
    declaration?.filename === COLLECTOR_EVENTS_FILENAME &&
    declaration?.archiveFilename === COLLECTOR_EVENTS_ARCHIVE_FILENAME &&
    declaration?.maxFileBytes === MAX_COLLECTOR_EVENTS_BYTES
  );
}
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
const AUTOMATION_STATE_DIR = path.join(os.homedir(), ".freed", "automation");

function usage() {
  return `Usage:
  node scripts/soak-collect.mjs [options]

Options:
  --soak-dir <path>          Soak directory. Defaults to ~/.freed/automation/soaks/<timestamp>.
  --pointer <path>           Active-soak pointer file. Defaults to ~/.freed/automation/current-soak-dir.
  --app-data <path>          App data dir holding runtime-health.jsonl. Defaults to the installed Freed Desktop dir.
  --app-binary <substring>   Main process match. Defaults to "Freed.app/Contents/MacOS".
  --artifact-digest <sha256> Optional installed artifact digest to bind into evidence.
  --scenario <name>           Workload scenario for measured baseline comparability.
  --provider-cohort <id>      Provider cohort for measured baseline comparability.
  --document-size-bucket <b>  Document-size bucket for measured baseline comparability.
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
    artifactDigest: "",
    scenario: "",
    providerCohort: "",
    documentSizeBucket: "",
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
      case "--artifact-digest":
        args.artifactDigest = String(argv[index + 1] ?? "")
          .trim()
          .toLowerCase();
        index += 1;
        break;
      case "--scenario":
        args.scenario = String(argv[index + 1] ?? "").trim();
        index += 1;
        break;
      case "--provider-cohort":
        args.providerCohort = String(argv[index + 1] ?? "").trim();
        index += 1;
        break;
      case "--document-size-bucket":
        args.documentSizeBucket = String(argv[index + 1] ?? "").trim();
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
  if (args.artifactDigest && !/^[0-9a-f]{64}$/.test(args.artifactDigest)) {
    throw new Error("artifact-digest must be a 64 character SHA-256 digest.");
  }
  const workloadFields = [
    args.scenario,
    args.providerCohort,
    args.documentSizeBucket,
  ];
  if (workloadFields.some(Boolean) && !workloadFields.every(Boolean)) {
    throw new Error(
      "scenario, provider-cohort, and document-size-bucket must be supplied together.",
    );
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
  const webContent = psRows.filter((row) =>
    row.command.includes("com.apple.WebKit.WebContent"),
  );
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
    webkitLargestRssKb: webContent.reduce(
      (max, row) => Math.max(max, row.rssKb),
      0,
    ),
    webkitOtherRssKb: otherWebKit.reduce((sum, row) => sum + row.rssKb, 0),
    webkitRows: [...webContent, ...otherWebKit],
  };
}

export function metricsRowToTsv(sample) {
  return `${METRICS_COLUMNS.map((column) => String(sample[column] ?? "")).join("\t")}\n`;
}

function healthFileIdentity(stats) {
  return {
    device: Number(stats.dev),
    inode: Number(stats.ino),
    birthtimeMs: Number(stats.birthtimeMs),
  };
}

function validHealthFileIdentity(identity) {
  return Boolean(
    identity &&
    Number.isFinite(identity.device) &&
    Number.isFinite(identity.inode) &&
    Number.isFinite(identity.birthtimeMs),
  );
}

function healthFileIdentityMatches(left, right) {
  return (
    validHealthFileIdentity(left) &&
    validHealthFileIdentity(right) &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.birthtimeMs === right.birthtimeMs
  );
}

function healthPrefixDigest(buffer, bytes = buffer.length) {
  return createHash("sha256").update(buffer.subarray(0, bytes)).digest("hex");
}

function normalizedHealthCursor(cursor, lastBytes = undefined) {
  const bytes = Number(cursor?.bytes ?? lastBytes ?? 0);
  return {
    schemaVersion: HEALTH_CURSOR_SCHEMA_VERSION,
    bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : 0,
    fileIdentity: validHealthFileIdentity(cursor?.fileIdentity)
      ? { ...cursor.fileIdentity }
      : null,
    prefixSha256: /^[0-9a-f]{64}$/.test(String(cursor?.prefixSha256 ?? ""))
      ? String(cursor.prefixSha256)
      : null,
  };
}

function legacyMirrorPrefixDigest(mirrorPath, bytes) {
  if (bytes === 0) return healthPrefixDigest(Buffer.alloc(0));
  if (!existsSync(mirrorPath)) return null;
  try {
    const mirror = readFileSync(mirrorPath);
    if (mirror.length < bytes) return null;
    return createHash("sha256")
      .update(mirror.subarray(mirror.length - bytes))
      .digest("hex");
  } catch {
    return null;
  }
}

// Appends everything past the persisted cursor in runtime-health.jsonl to the
// soak mirror. The cursor binds both the physical file generation and a digest
// of every byte already copied. This catches replacement and truncate-regrow
// even when the new file is equal to or larger than the prior byte offset.
export function mirrorHealthDelta({
  healthPath,
  mirrorPath,
  cursor = undefined,
  lastBytes = undefined,
}) {
  const prior = normalizedHealthCursor(cursor, lastBytes);
  if (!existsSync(healthPath)) {
    return {
      ...prior,
      lines: 0,
      appendedBytes: 0,
      rotated: false,
      rotationReason: null,
      fileGenerationChanged: false,
      continuityVerified: false,
      missing: true,
    };
  }
  let buffer;
  let fileIdentity;
  let fileDescriptor;
  try {
    fileDescriptor = openSync(healthPath, "r");
    fileIdentity = healthFileIdentity(fstatSync(fileDescriptor));
    buffer = readFileSync(fileDescriptor);
  } catch {
    // Keep the cursor where it was so a transient read failure cannot cause a
    // duplicate append on the next sample.
    return {
      ...prior,
      lines: 0,
      appendedBytes: 0,
      rotated: false,
      rotationReason: null,
      fileGenerationChanged: false,
      continuityVerified: false,
      readFailed: true,
    };
  } finally {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }
  }
  const bytes = buffer.length;
  const generationChanged =
    prior.bytes > 0 &&
    prior.fileIdentity !== null &&
    !healthFileIdentityMatches(prior.fileIdentity, fileIdentity);
  const expectedPrefixDigest =
    prior.prefixSha256 ?? legacyMirrorPrefixDigest(mirrorPath, prior.bytes);
  const continuityVerified =
    prior.bytes === 0 ||
    (bytes >= prior.bytes &&
      expectedPrefixDigest !== null &&
      healthPrefixDigest(buffer, prior.bytes) === expectedPrefixDigest);
  const rotated =
    prior.bytes > 0 && (bytes < prior.bytes || !continuityVerified);
  const rotationReason = !rotated
    ? null
    : bytes < prior.bytes
      ? "size-shrank"
      : generationChanged
        ? "file-generation-changed"
        : "prefix-continuity-changed";
  const delta = buffer.subarray(rotated ? 0 : prior.bytes);
  if (delta.length > 0) {
    appendFileSync(mirrorPath, delta);
  }
  return {
    schemaVersion: HEALTH_CURSOR_SCHEMA_VERSION,
    bytes,
    fileIdentity,
    prefixSha256: healthPrefixDigest(buffer),
    lines: buffer.toString("utf8").split("\n").filter(Boolean).length,
    appendedBytes: delta.length,
    rotated,
    rotationReason,
    fileGenerationChanged: generationChanged,
    continuityVerified,
  };
}

// Restores the continuity-bound mirror cursor so a restarted collector can
// prove that its saved byte offset still names the same source prefix.
export function readLastHealthCursor(offsetsPath) {
  if (!existsSync(offsetsPath)) {
    return normalizedHealthCursor(null);
  }
  try {
    const lines = readFileSync(offsetsPath, "utf8").split("\n").filter(Boolean);
    return normalizedHealthCursor(JSON.parse(lines.at(-1) ?? "{}"));
  } catch {
    return normalizedHealthCursor(null);
  }
}

export function readLastHealthOffset(offsetsPath) {
  return readLastHealthCursor(offsetsPath).bytes;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function commandDigest(command) {
  return createHash("sha256").update(command).digest("hex");
}

function linuxProcessStartIdentity(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) {
    return "";
  }
  const fieldsAfterCommand = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/);
  const startTicks = fieldsAfterCommand[19] ?? "";
  return startTicks ? `linux:${startTicks}` : "";
}

function linuxProcessCommand(pid) {
  return readFileSync(`/proc/${pid}/cmdline`, "utf8")
    .split("\0")
    .filter(Boolean)
    .join(" ");
}

function darwinProcessField(pid, field) {
  return execFileSync("ps", ["-ww", "-p", String(pid), "-o", `${field}=`], {
    encoding: "utf8",
    timeout: 2_000,
  }).trim();
}

export function inspectCollectorProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    let startIdentity = "";
    let command = "";
    if (process.platform === "linux") {
      startIdentity = linuxProcessStartIdentity(pid);
      command = linuxProcessCommand(pid);
    } else if (process.platform === "darwin") {
      startIdentity = `darwin:${darwinProcessField(pid, "lstart")}`;
      command = darwinProcessField(pid, "command");
    } else {
      return null;
    }
    if (!startIdentity || !command) {
      return null;
    }
    return {
      schemaVersion: 1,
      platform: process.platform,
      startIdentity,
      commandDigest: commandDigest(command),
      collectorEntrypoint: command.includes(COLLECTOR_ENTRYPOINT)
        ? COLLECTOR_ENTRYPOINT
        : null,
    };
  } catch {
    return null;
  }
}

function validCollectorProcessIdentity(identity) {
  return (
    identity?.schemaVersion === 1 &&
    (identity.platform === "darwin" || identity.platform === "linux") &&
    typeof identity.startIdentity === "string" &&
    identity.startIdentity.length > 0 &&
    typeof identity.commandDigest === "string" &&
    /^[a-f0-9]{64}$/.test(identity.commandDigest) &&
    identity.collectorEntrypoint === COLLECTOR_ENTRYPOINT
  );
}

function collectorProcessIdentityMatches(recorded, current) {
  return (
    validCollectorProcessIdentity(recorded) &&
    validCollectorProcessIdentity(current) &&
    recorded.platform === current.platform &&
    recorded.startIdentity === current.startIdentity &&
    recorded.commandDigest === current.commandDigest
  );
}

function classifyCollectorLockOwner(existing, inspectProcessIdentity) {
  const pid = Number(existing?.pid);
  if (!processIsAlive(pid)) {
    return "stale";
  }
  const currentIdentity = inspectProcessIdentity(pid);
  if (!currentIdentity) {
    return "unverifiable";
  }
  if (!validCollectorProcessIdentity(currentIdentity)) {
    return "stale";
  }
  if (!validCollectorProcessIdentity(existing?.ownerProcessIdentity)) {
    return "unverifiable";
  }
  return collectorProcessIdentityMatches(
    existing.ownerProcessIdentity,
    currentIdentity,
  )
    ? "live"
    : "stale";
}

export function acquireCollectorLock({
  pointer,
  soakDir,
  pid = process.pid,
  inspectProcessIdentity = inspectCollectorProcessIdentity,
}) {
  const lockPath = `${pointer}.collector-lock`;
  const token = randomUUID();
  const ownerProcessIdentity = inspectProcessIdentity(pid);
  if (!validCollectorProcessIdentity(ownerProcessIdentity)) {
    throw new Error(
      `Could not bind ${lockPath} to the soak collector process identity.`,
    );
  }
  mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let fd;
    try {
      fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(
        fd,
        `${JSON.stringify({
          schemaVersion: 2,
          token,
          pid,
          soakDir,
          acquiredAt: new Date().toISOString(),
          ownerProcessIdentity,
        })}\n`,
      );
      closeSync(fd);
      return { lockPath, token };
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // The descriptor may already be closed after a partial write.
        }
      }
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    let existing;
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      existing = null;
    }
    const ownerState = existing
      ? classifyCollectorLockOwner(existing, inspectProcessIdentity)
      : "malformed";
    if (ownerState === "live") {
      throw new Error(
        `A soak collector already owns ${lockPath} with pid ${Number(existing.pid).toLocaleString()}.`,
      );
    }
    if (ownerState === "unverifiable") {
      throw new Error(
        `Could not verify the soak collector identity for live pid ${Number(existing.pid).toLocaleString()} at ${lockPath}; refusing stale recovery.`,
      );
    }
    if (!existing) {
      const lockAgeMs = Date.now() - statSync(lockPath).mtimeMs;
      if (lockAgeMs < 5 * 60_000) {
        throw new Error(
          `Soak collector lock ${lockPath} is initializing or malformed.`,
        );
      }
    }

    const stalePath = `${lockPath}.stale-${token}`;
    try {
      renameSync(lockPath, stalePath);
      unlinkSync(stalePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(`Could not acquire soak collector lock ${lockPath}.`);
}

export function releaseCollectorLock(lock) {
  if (!lock?.lockPath || !lock?.token || !existsSync(lock.lockPath)) {
    return false;
  }
  try {
    const current = JSON.parse(readFileSync(lock.lockPath, "utf8"));
    if (current.token !== lock.token) {
      return false;
    }
    unlinkSync(lock.lockPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function readCollectorLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function writeCollectorLockAtomically(lockPath, record) {
  const temporaryPath = `${lockPath}.handoff-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(record)}\n`);
    closeSync(fd);
    fd = undefined;
    renameSync(temporaryPath, lockPath);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The descriptor may already be closed after a partial write.
      }
    }
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

export function adoptCollectorLock({
  pointer,
  soakDir,
  parentPid,
  parentToken,
  pid = process.pid,
  inspectProcessIdentity = inspectCollectorProcessIdentity,
}) {
  const lockPath = `${pointer}.collector-lock`;
  const current = readCollectorLock(lockPath);
  if (
    !current ||
    current.token !== parentToken ||
    Number(current.pid) !== parentPid ||
    current.soakDir !== soakDir
  ) {
    throw new Error(`Detached soak collector could not adopt ${lockPath}.`);
  }
  if (classifyCollectorLockOwner(current, inspectProcessIdentity) !== "live") {
    throw new Error(
      `Detached soak collector could not verify the parent owner of ${lockPath}.`,
    );
  }

  const token = randomUUID();
  const ownerProcessIdentity = inspectProcessIdentity(pid);
  if (!validCollectorProcessIdentity(ownerProcessIdentity)) {
    throw new Error(
      `Detached soak collector could not bind its process identity to ${lockPath}.`,
    );
  }
  const replacement = {
    ...current,
    schemaVersion: 2,
    token,
    pid,
    handedOffAt: new Date().toISOString(),
    ownerProcessIdentity,
  };
  const latest = readCollectorLock(lockPath);
  if (latest?.token !== parentToken || Number(latest.pid) !== parentPid) {
    throw new Error(
      `Detached soak collector handoff changed before adoption for ${lockPath}.`,
    );
  }
  writeCollectorLockAtomically(lockPath, replacement);
  return { lockPath, token };
}

function consumeDetachedHandoff(args) {
  const parentToken = process.env[DETACHED_HANDOFF_TOKEN_ENV] ?? "";
  const rawParentPid = process.env[DETACHED_HANDOFF_PARENT_PID_ENV] ?? "";
  delete process.env[DETACHED_HANDOFF_TOKEN_ENV];
  delete process.env[DETACHED_HANDOFF_PARENT_PID_ENV];

  if (!parentToken && !rawParentPid) {
    return null;
  }
  const parentPid = Number(rawParentPid);
  if (
    !parentToken ||
    !Number.isSafeInteger(parentPid) ||
    parentPid <= 0 ||
    !process.send
  ) {
    throw new Error(
      "Detached soak collector received an invalid lock handoff.",
    );
  }
  return adoptCollectorLock({
    pointer: args.pointer,
    soakDir: args.soakDir,
    parentPid,
    parentToken,
  });
}

function detachedLockMatches({ lockPath, token, childPid, soakDir }) {
  const current = readCollectorLock(lockPath);
  return (
    current?.token === token &&
    Number(current.pid) === childPid &&
    current.soakDir === soakDir &&
    classifyCollectorLockOwner(current, inspectCollectorProcessIdentity) ===
      "live"
  );
}

function sendChildMessage(child, message) {
  return new Promise((resolve, reject) => {
    child.send(message, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function launchDetachedCollector(args) {
  const parentLock = acquireCollectorLock(args);
  const childArgs = process.argv.slice(1).filter((arg) => arg !== "--detach");
  if (!childArgs.includes("--soak-dir")) {
    childArgs.push("--soak-dir", args.soakDir);
  }

  let child;
  try {
    child = spawn(process.execPath, childArgs, {
      detached: true,
      env: {
        ...process.env,
        [DETACHED_HANDOFF_TOKEN_ENV]: parentLock.token,
        [DETACHED_HANDOFF_PARENT_PID_ENV]: String(process.pid),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  } catch (error) {
    releaseCollectorLock(parentLock);
    throw error;
  }

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        child.off("error", onError);
        child.off("exit", onExit);
        child.off("message", onMessage);
        callback(value);
      };
      const onError = (error) => finish(reject, error);
      const onExit = (code, signal) =>
        finish(
          reject,
          new Error(
            `Detached soak collector exited before readiness (${signal ?? `code ${Number(code).toLocaleString()}`}).`,
          ),
        );
      const onMessage = async (message) => {
        if (message?.type === "soak-collector-error") {
          finish(
            reject,
            new Error(
              message.message || "Detached soak collector failed to start.",
            ),
          );
          return;
        }
        if (message?.type !== "soak-collector-ready") {
          return;
        }
        if (
          Number(message.pid) !== child.pid ||
          message.lockPath !== parentLock.lockPath ||
          message.soakDir !== args.soakDir ||
          !detachedLockMatches({
            lockPath: parentLock.lockPath,
            token: message.token,
            childPid: child.pid,
            soakDir: args.soakDir,
          })
        ) {
          finish(
            reject,
            new Error(
              "Detached soak collector reported invalid lock ownership.",
            ),
          );
          return;
        }
        child.off("exit", onExit);
        try {
          await sendChildMessage(child, { type: "soak-collector-accepted" });
          finish(resolve);
        } catch (error) {
          finish(reject, error);
        }
      };
      const timeout = setTimeout(
        () =>
          finish(
            reject,
            new Error("Detached soak collector did not become ready in time."),
          ),
        DETACHED_READY_TIMEOUT_MS,
      );
      child.once("error", onError);
      child.once("exit", onExit);
      child.on("message", onMessage);
    });
  } catch (error) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    releaseCollectorLock(parentLock);
    if (child.connected) {
      child.disconnect();
    }
    child.unref();
    throw error;
  }

  if (child.connected) {
    child.disconnect();
  }
  child.unref();
  process.stdout.write(
    `Detached collector pid ${child.pid}, soak dir ${args.soakDir}\n`,
  );
}

function waitForDetachedAcceptance(collectorLock, args) {
  if (!process.send) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      process.off("message", onMessage);
      callback(value);
    };
    const onMessage = (message) => {
      if (message?.type === "soak-collector-accepted") {
        finish(resolve);
      }
    };
    const timeout = setTimeout(
      () =>
        finish(
          reject,
          new Error("Detached soak collector parent did not accept readiness."),
        ),
      DETACHED_ACCEPT_TIMEOUT_MS,
    );
    process.on("message", onMessage);
    process.send(
      {
        type: "soak-collector-ready",
        pid: process.pid,
        lockPath: collectorLock.lockPath,
        token: collectorLock.token,
        soakDir: args.soakDir,
      },
      (error) => {
        if (error) {
          finish(reject, error);
        }
      },
    );
  }).finally(() => {
    if (process.connected) {
      process.disconnect();
    }
  });
}

function takeSample(args, cursor, now = Date.now()) {
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
  const offsets = mirrorHealthDelta({
    healthPath: path.join(args.appData, "runtime-health.jsonl"),
    mirrorPath: path.join(args.soakDir, "runtime-health.jsonl"),
    cursor: cursor.health,
  });
  cursor.health = normalizedHealthCursor(offsets);
  sample.healthFileBytes = offsets.bytes;
  sample.healthFileLines = offsets.lines;

  appendFileSync(
    path.join(args.soakDir, "metrics.tsv"),
    metricsRowToTsv(sample),
  );
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

function collectorErrorFields(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : null;
  return {
    errorName: error instanceof Error ? error.name : "Error",
    ...(code ? { errorCode: code } : {}),
    errorMessage: message.slice(0, MAX_COLLECTOR_ERROR_MESSAGE_LENGTH),
  };
}

function collectorEventLine(event) {
  const tsMs = Number(event.tsMs);
  return `${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    ...event,
    tsMs,
    iso: new Date(tsMs).toISOString(),
    collectorPid: process.pid,
  })}\n`;
}

function removeTemporaryFile(filePath) {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function rotateCollectorEventsWithLifecycle({
  eventPath,
  archivedPath,
  eventLine,
  eventTsMs,
  lifecycle,
}) {
  const archiveTemp = `${archivedPath}.tmp-${process.pid}-${randomUUID()}`;
  const currentTemp = `${eventPath}.tmp-${process.pid}-${randomUUID()}`;
  const priorSessionStartedAtMs = lifecycle.sessionStartedAtMs;
  const nextSessionStartedAtMs = Number(eventTsMs);
  const archivedText = `${readFileSync(eventPath, "utf8")}${collectorEventLine({
    event: "collector_session_stopped",
    tsMs: nextSessionStartedAtMs,
    collectorRunId: lifecycle.collectorRunId,
    sessionStartedAtMs: priorSessionStartedAtMs,
    reason: "event_file_rotation",
  })}`;
  const currentText = `${collectorEventLine({
    event: "collector_session_started",
    tsMs: nextSessionStartedAtMs,
    collectorRunId: lifecycle.collectorRunId,
    continuation: "event_file_rotation",
  })}${eventLine}`;
  try {
    writeFileSync(archiveTemp, archivedText, { flag: "wx", mode: 0o600 });
    writeFileSync(currentTemp, currentText, { flag: "wx", mode: 0o600 });
    renameSync(archiveTemp, archivedPath);
    renameSync(currentTemp, eventPath);
    lifecycle.sessionStartedAtMs = nextSessionStartedAtMs;
  } finally {
    removeTemporaryFile(archiveTemp);
    removeTemporaryFile(currentTemp);
  }
}

export function appendCollectorEvent(soakDir, event, lifecycle = null) {
  const eventPath = path.join(soakDir, COLLECTOR_EVENTS_FILENAME);
  const archivedPath = path.join(soakDir, COLLECTOR_EVENTS_ARCHIVE_FILENAME);
  const line = collectorEventLine(event);
  if (
    event.event === "collector_sample_failed" &&
    existsSync(eventPath) &&
    statSync(eventPath).size + Buffer.byteLength(line, "utf8") >
      MAX_COLLECTOR_EVENTS_BYTES
  ) {
    if (lifecycle?.sessionStartedAtMs) {
      rotateCollectorEventsWithLifecycle({
        eventPath,
        archivedPath,
        eventLine: line,
        eventTsMs: event.tsMs,
        lifecycle,
      });
      return;
    }
    removeTemporaryFile(archivedPath);
    renameSync(eventPath, archivedPath);
  }
  appendFileSync(eventPath, line);
}

function readCollectorEventText(soakDir) {
  return [
    path.join(soakDir, COLLECTOR_EVENTS_ARCHIVE_FILENAME),
    path.join(soakDir, COLLECTOR_EVENTS_FILENAME),
  ]
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("");
}

function collectorEventEntries(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        return entry?.schemaVersion === COLLECTOR_EVENTS_SCHEMA_VERSION
          ? [entry]
          : [];
      } catch {
        return [];
      }
    });
}

function openCollectorSession(entries) {
  let openSession = null;
  for (const entry of entries) {
    if (entry.event === "collector_session_started") {
      openSession = entry;
      continue;
    }
    if (
      entry.event === "collector_session_restarted" &&
      openSession &&
      entry.priorCollectorRunId === openSession.collectorRunId &&
      Number(entry.priorSessionStartedAtMs) === Number(openSession.tsMs)
    ) {
      openSession = {
        ...entry,
        event: "collector_session_started",
      };
      continue;
    }
    if (
      entry.event === "collector_session_stopped" &&
      openSession &&
      entry.collectorRunId === openSession.collectorRunId &&
      Number(entry.sessionStartedAtMs) === Number(openSession.tsMs)
    ) {
      openSession = null;
    }
  }
  return openSession;
}

function tryAppendCollectorEvent(writeEvent, soakDir, event, state, now) {
  try {
    writeEvent(soakDir, event);
    return true;
  } catch (error) {
    if (
      state.lastDiagnosticWriteErrorTsMs === null ||
      now - state.lastDiagnosticWriteErrorTsMs >=
        COLLECTOR_DIAGNOSTIC_ERROR_INTERVAL_MS
    ) {
      process.stderr.write(
        `Could not persist collector event: ${collectorErrorFields(error).errorMessage}\n`,
      );
      state.lastDiagnosticWriteErrorTsMs = now;
    }
    return false;
  }
}

export function createCollectorTickState(openFailure = null) {
  const firstFailureTsMs = openFailure ? Number(openFailure.tsMs) : null;
  const errorFields = openFailure
    ? {
        errorName: String(openFailure.errorName ?? "Error"),
        ...(openFailure.errorCode
          ? { errorCode: String(openFailure.errorCode) }
          : {}),
        errorMessage: String(openFailure.errorMessage ?? "sample failed").slice(
          0,
          MAX_COLLECTOR_ERROR_MESSAGE_LENGTH,
        ),
      }
    : null;
  return {
    consecutiveFailures: openFailure ? 1 : 0,
    firstFailureTsMs,
    lastFailureTsMs: firstFailureTsMs,
    firstError: errorFields,
    lastError: errorFields,
    failureEvent: openFailure ? { ...openFailure } : null,
    recoveryEvent: null,
    failureRecorded: Boolean(openFailure),
    lastDiagnosticWriteErrorTsMs: null,
  };
}

export function hydrateCollectorTickStateFromEventsText(text) {
  let openFailure = null;
  for (const entry of collectorEventEntries(text)) {
    if (entry.event === "collector_sample_failed") {
      openFailure = entry;
    } else if (
      entry.event === "collector_sample_recovered" &&
      openFailure &&
      Number(entry.failureStartedAtMs) === Number(openFailure.tsMs)
    ) {
      openFailure = null;
    }
  }
  return createCollectorTickState(openFailure);
}

function persistPendingOutageEvents({ state, writeEventFn, soakDir, now }) {
  if (!state.failureEvent) return true;
  if (!state.failureRecorded) {
    state.failureRecorded = tryAppendCollectorEvent(
      writeEventFn,
      soakDir,
      state.failureEvent,
      state,
      now,
    );
    if (!state.failureRecorded) return false;
  }
  if (!state.recoveryEvent) return false;
  if (
    !tryAppendCollectorEvent(
      writeEventFn,
      soakDir,
      state.recoveryEvent,
      state,
      now,
    )
  ) {
    return false;
  }
  Object.assign(state, createCollectorTickState());
  return true;
}

export function runCollectorTick({
  args,
  cursor,
  state,
  now = Date.now(),
  takeSampleFn = takeSample,
  writeEventFn = appendCollectorEvent,
}) {
  if (state.recoveryEvent) {
    persistPendingOutageEvents({
      state,
      writeEventFn,
      soakDir: args.soakDir,
      now,
    });
  }
  try {
    const sample = takeSampleFn(args, cursor, now);
    if (state.consecutiveFailures > 0) {
      state.recoveryEvent ??= {
        event: "collector_sample_recovered",
        tsMs: now,
        failedSamples: state.consecutiveFailures,
        failureStartedAtMs: state.firstFailureTsMs,
        failureLastObservedAtMs: state.lastFailureTsMs,
        outageMs: Math.max(0, now - state.firstFailureTsMs),
        firstError: state.firstError,
        lastError: state.lastError,
      };
      persistPendingOutageEvents({
        state,
        writeEventFn,
        soakDir: args.soakDir,
        now,
      });
    }
    return { ok: true, sample };
  } catch (error) {
    const errorFields = collectorErrorFields(error);
    if (state.consecutiveFailures === 0) {
      state.firstFailureTsMs = now;
      state.firstError = errorFields;
      state.failureEvent = {
        event: "collector_sample_failed",
        tsMs: now,
        failedSamples: 1,
        sampleMayBePartial: true,
        ...errorFields,
      };
    } else if (state.recoveryEvent) {
      // The diagnostic sink was unavailable when a sample recovered, then the
      // next sample failed. Fold both into the still-pending outage pair. Raw
      // collector metrics remain the authority for exact successful samples.
      state.recoveryEvent = null;
    }
    state.consecutiveFailures += 1;
    state.lastFailureTsMs = now;
    state.lastError = errorFields;
    if (!state.failureRecorded) {
      state.failureRecorded = tryAppendCollectorEvent(
        writeEventFn,
        args.soakDir,
        state.failureEvent,
        state,
        now,
      );
    }
    return { ok: false, error };
  }
}

function initSoakDir(args) {
  mkdirSync(args.soakDir, { recursive: true });
  const infoPath = path.join(args.soakDir, "soak-info.json");
  const collectorEventsPath = path.join(
    args.soakDir,
    COLLECTOR_EVENTS_FILENAME,
  );
  if (!existsSync(infoPath)) {
    if (
      existsSync(collectorEventsPath) ||
      existsSync(path.join(args.soakDir, COLLECTOR_EVENTS_ARCHIVE_FILENAME))
    ) {
      throw new Error(
        "Refusing to attach new soak provenance to existing collector event evidence.",
      );
    }
    writeFileSync(collectorEventsPath, "", { flag: "wx" });
    try {
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
            ...(args.artifactDigest
              ? { artifactDigest: args.artifactDigest }
              : {}),
            ...(args.scenario
              ? {
                  comparisonContext: {
                    scenario: args.scenario,
                    providerCohort: args.providerCohort,
                    documentSizeBucket: args.documentSizeBucket,
                    host: {
                      platform: os.platform(),
                      architecture: os.arch(),
                      memoryTierGiB: Math.max(
                        1,
                        Math.round(os.totalmem() / 1024 ** 3),
                      ),
                    },
                  },
                }
              : {}),
            collectorPid: process.pid,
            collectorSessionId: randomUUID(),
            collectorEvents: collectorEventEvidenceDeclaration(),
            metricsColumns: METRICS_COLUMNS,
            webkitProcessesColumns: ["tsMs", "pid", "ppid", "rssKb", "command"],
            notes:
              "webkit* metrics are machine-wide: WebKit XPC processes cannot be attributed to Freed from ps (ppid 1, finding F27). App-attributed telemetry lives in runtime-health.jsonl.",
          },
          null,
          2,
        )}\n`,
      );
    } catch (error) {
      unlinkSync(collectorEventsPath);
      throw error;
    }
  } else {
    const soakInfo = JSON.parse(readFileSync(infoPath, "utf8"));
    if (
      hasCollectorEventEvidenceCapability(soakInfo) &&
      !existsSync(collectorEventsPath)
    ) {
      throw new Error(
        `Collector event evidence is missing from capability-bearing soak: ${collectorEventsPath}`,
      );
    }
  }
  const metricsPath = path.join(args.soakDir, "metrics.tsv");
  if (!existsSync(metricsPath)) {
    writeFileSync(metricsPath, `${METRICS_COLUMNS.join("\t")}\n`);
  }
  mkdirSync(path.dirname(args.pointer), { recursive: true });
  writeFileSync(args.pointer, `${args.soakDir}\n`);
}

export function beginCollectorSession(
  soakDir,
  lifecycle,
  existingEventsText,
  now,
  appendEventFn = appendCollectorEvent,
) {
  const priorSession = openCollectorSession(
    collectorEventEntries(existingEventsText),
  );
  if (priorSession) {
    appendEventFn(soakDir, {
      event: "collector_session_restarted",
      tsMs: now,
      collectorRunId: lifecycle.collectorRunId,
      priorCollectorRunId: priorSession.collectorRunId,
      priorSessionStartedAtMs: Number(priorSession.tsMs),
      reason: "collector_restarted_after_unclosed_session",
    });
  } else {
    appendEventFn(soakDir, {
      event: "collector_session_started",
      tsMs: now,
      collectorRunId: lifecycle.collectorRunId,
    });
  }
  lifecycle.sessionStartedAtMs = now;
}

export function stopCollectorSession(soakDir, lifecycle, reason, now) {
  if (!lifecycle?.sessionStartedAtMs) return;
  appendCollectorEvent(
    soakDir,
    {
      event: "collector_session_stopped",
      tsMs: now,
      collectorRunId: lifecycle.collectorRunId,
      sessionStartedAtMs: lifecycle.sessionStartedAtMs,
      reason,
    },
    lifecycle,
  );
  lifecycle.sessionStartedAtMs = null;
}

export function ensurePendingOutageEvidenceDurable({
  state,
  writeEventFn,
  soakDir,
  now,
}) {
  if (!state?.failureEvent) return;
  persistPendingOutageEvents({ state, writeEventFn, soakDir, now });
  if (state.failureEvent && !state.failureRecorded) {
    throw new Error(
      "Refusing to close collector evidence before the pending sample failure marker is durable.",
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  if (args.detach) {
    await launchDetachedCollector(args);
    return;
  }

  const handedOffLock = consumeDetachedHandoff(args);
  const collectorLock = handedOffLock ?? acquireCollectorLock(args);
  let lockReleased = false;
  let timer = null;
  let tickState = null;
  let lifecycle = null;
  let finalized = false;
  const releaseLock = () => {
    if (!lockReleased) {
      releaseCollectorLock(collectorLock);
      lockReleased = true;
    }
  };
  const finishCollector = (reason) => {
    if (finalized) return;
    finalized = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const now = Date.now();
    try {
      if (tickState?.failureEvent) {
        ensurePendingOutageEvidenceDurable({
          state: tickState,
          writeEventFn: (soakDir, event) =>
            appendCollectorEvent(soakDir, event, lifecycle),
          soakDir: args.soakDir,
          now,
        });
      }
      stopCollectorSession(args.soakDir, lifecycle, reason, now);
    } finally {
      releaseLock();
    }
  };
  process.once("exit", releaseLock);
  process.once("SIGINT", () => {
    try {
      finishCollector("signal_sigint");
    } catch (error) {
      process.stderr.write(
        `Could not close collector evidence: ${collectorErrorFields(error).errorMessage}\n`,
      );
    }
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    try {
      finishCollector("signal_sigterm");
    } catch (error) {
      process.stderr.write(
        `Could not close collector evidence: ${collectorErrorFields(error).errorMessage}\n`,
      );
    }
    process.exit(143);
  });

  let cursor;
  let startedAt;
  try {
    initSoakDir(args);
    const existingEventsText = readCollectorEventText(args.soakDir);
    tickState = hydrateCollectorTickStateFromEventsText(existingEventsText);
    lifecycle = {
      collectorRunId: randomUUID(),
      sessionStartedAtMs: null,
    };
    beginCollectorSession(
      args.soakDir,
      lifecycle,
      existingEventsText,
      Date.now(),
    );
    cursor = {
      health: readLastHealthCursor(
        path.join(args.soakDir, "health-offsets.jsonl"),
      ),
    };
    startedAt = Date.now();
    const initialTick = runCollectorTick({
      args,
      cursor,
      state: tickState,
      takeSampleFn: takeSample,
      writeEventFn: (soakDir, event) =>
        appendCollectorEvent(soakDir, event, lifecycle),
    });
    if (!initialTick.ok) {
      throw initialTick.error;
    }
    const sample = initialTick.sample;
    process.stdout.write(
      `Soak dir ${args.soakDir}: sampling every ${args.intervalSeconds}s (app pid ${sample.appPid || "not running"}).\n`,
    );
    if (handedOffLock) {
      await waitForDetachedAcceptance(collectorLock, args);
    }
    if (args.once) {
      finishCollector("once_complete");
      return;
    }
  } catch (error) {
    try {
      finishCollector("startup_error");
    } catch (closeError) {
      error.cause ??= closeError;
    }
    throw error;
  }

  timer = setInterval(() => {
    runCollectorTick({
      args,
      cursor,
      state: tickState,
      writeEventFn: (soakDir, event) =>
        appendCollectorEvent(soakDir, event, lifecycle),
    });
    if (
      args.durationMinutes > 0 &&
      Date.now() - startedAt >= args.durationMinutes * 60_000
    ) {
      try {
        finishCollector("duration_reached");
        process.stdout.write("Soak duration reached; collector exiting.\n");
      } catch (error) {
        process.stderr.write(
          `Could not close collector evidence: ${collectorErrorFields(error).errorMessage}\n`,
        );
        process.exitCode = 1;
      }
    }
  }, args.intervalSeconds * 1_000);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    if (process.send && process.connected) {
      try {
        process.send({
          type: "soak-collector-error",
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // The parent may already have closed the readiness channel.
      }
    }
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
