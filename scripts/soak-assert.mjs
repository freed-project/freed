#!/usr/bin/env node

// Machine-readable soak verdict.
//
// Reads a soak directory written by scripts/soak-collect.mjs plus the app's
// runtime-health.jsonl, evaluates named assertions, and writes
// soak-verdict.json into the soak dir. Loops gate on the verdict instead of
// reading soak evidence by eye.
//
// Assertions (each cites the violating file:line):
//   main_footprint_slope    idle main-process footprint slope < 25 MB/h over >= 4h
//   renderer_recoveries     renderer_recovery_restart_requested count == 0
//   stale_heartbeats        renderer_heartbeat_stale count == 0
//   webkit_returns_to_baseline  machine-wide WebContent count returns to its
//                           baseline between scrape cycles
//   uploads_unchanged_heads / preflight_kills / scrape_zero_persist
//                           P0-02/P0-03 counters; no-op (skipped) until the
//                           app emits them
//
// Usage:
//   node scripts/soak-assert.mjs                       # soak dir from the active pointer
//   node scripts/soak-assert.mjs --soak-dir <dir>
//   node scripts/soak-assert.mjs --json                # print the verdict JSON
// Exit code: 1 when any assertion fails (pass/skip exit 0).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

export const VERDICT_SCHEMA_VERSION = 1;
const MB = 1024 * 1024;
const SLOPE_LIMIT_MB_PER_HOUR = 25;
const SLOPE_MIN_HOURS = 4;

const DEFAULT_POINTER = path.join(os.homedir(), ".freed-automation", "current-soak-dir");
const DEFAULT_APP_DATA_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "wtf.freed.desktop",
);

function usage() {
  return `Usage:
  node scripts/soak-assert.mjs [options]

Options:
  --soak-dir <path>   Soak directory. Defaults to the active pointer (${DEFAULT_POINTER}).
  --pointer <path>    Pointer file used when --soak-dir is omitted.
  --app-data <path>   App data dir holding runtime-health.jsonl.
  --out <path>        Verdict output. Defaults to <soak-dir>/soak-verdict.json.
  --json              Also print the verdict JSON to stdout.
  --help              Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    soakDir: "",
    pointer: DEFAULT_POINTER,
    appData: DEFAULT_APP_DATA_DIR,
    out: "",
    json: false,
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
      case "--out":
        args.out = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export function parseMetricsTsv(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter(Boolean);
  const headers = lines.shift()?.split("\t") ?? [];
  return lines.map((line, index) => {
    const values = line.split("\t");
    const row = Object.fromEntries(
      headers.map((header, column) => [header, Number(values[column] ?? "")]),
    );
    row.iso = values[headers.indexOf("iso")] ?? "";
    row.line = index + 2; // 1-indexed, after the header row
    return row;
  });
}

export function readHealthLines(healthPath, { fromTsMs = 0, toTsMs = Number.POSITIVE_INFINITY } = {}) {
  if (!existsSync(healthPath)) {
    return [];
  }
  return readFileSync(healthPath, "utf8")
    .split(/\r?\n/)
    .map((raw, index) => {
      if (!raw.trim()) {
        return null;
      }
      try {
        const entry = JSON.parse(raw);
        return { entry, line: index + 1, raw };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(({ entry }) => {
      const ts = Number(entry.tsMs ?? 0);
      // Keep lines without timestamps: better to over-count than silently drop.
      return ts === 0 || (ts >= fromTsMs && ts <= toTsMs);
    });
}

// Least-squares slope in MB/h over [{tsMs, bytes}] points.
export function footprintSlopeMbPerHour(points) {
  const usable = points.filter((point) => point.bytes > 0 && point.tsMs > 0);
  if (usable.length < 2) {
    return null;
  }
  const t0 = usable[0].tsMs;
  const xs = usable.map((point) => (point.tsMs - t0) / 3_600_000); // hours
  const ys = usable.map((point) => point.bytes / MB);
  const n = usable.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (xs[index] - meanX) * (ys[index] - meanY);
    denominator += (xs[index] - meanX) ** 2;
  }
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function assertion(id, status, detail, violations = []) {
  return { id, status, detail, violations };
}

function cite(file, line, excerpt) {
  return { file, line, excerpt: String(excerpt).slice(0, 240) };
}

export function assertFootprintSlope(healthLines, metricsRows, metricsPath, healthPath) {
  // Prefer the app's own heartbeat footprint (attributed); fall back to the
  // collector's ps rss for the main process.
  const heartbeatPoints = healthLines
    .filter(({ entry }) => entry.event === "renderer_heartbeat")
    .map(({ entry }) => ({
      tsMs: Number(entry.tsMs ?? 0),
      bytes: Number(entry.nativeFootprintBytes ?? entry.nativeResidentBytes ?? 0),
    }));
  const psPoints = metricsRows.map((row) => ({
    tsMs: row.tsMs,
    bytes: row.appRssKb * 1024,
  }));
  const source = heartbeatPoints.filter((p) => p.bytes > 0).length >= 2 ? "renderer_heartbeat.nativeFootprintBytes" : `${path.basename(metricsPath)}.appRssKb`;
  const points = source.startsWith("renderer_heartbeat") ? heartbeatPoints : psPoints;

  const usable = points.filter((point) => point.bytes > 0 && point.tsMs > 0);
  if (usable.length < 2) {
    return assertion("main_footprint_slope", "skipped", "No footprint samples available.");
  }
  const spanHours = (usable.at(-1).tsMs - usable[0].tsMs) / 3_600_000;
  const slope = footprintSlopeMbPerHour(usable);
  if (spanHours < SLOPE_MIN_HOURS) {
    return assertion(
      "main_footprint_slope",
      "skipped",
      `Window is ${spanHours.toFixed(2)}h; slope needs >= ${SLOPE_MIN_HOURS}h. Measured ${slope?.toFixed(1) ?? "n/a"} MB/h over ${usable.length} samples from ${source} (informational).`,
    );
  }
  if (slope === null) {
    return assertion("main_footprint_slope", "skipped", "Slope could not be computed.");
  }
  if (slope >= SLOPE_LIMIT_MB_PER_HOUR) {
    return assertion(
      "main_footprint_slope",
      "fail",
      `${slope.toFixed(1)} MB/h over ${spanHours.toFixed(1)}h (${usable.length} samples from ${source}); limit ${SLOPE_LIMIT_MB_PER_HOUR} MB/h.`,
      [cite(source.startsWith("renderer_heartbeat") ? healthPath : metricsPath, 0, `first ${usable[0].bytes} bytes @ ${new Date(usable[0].tsMs).toISOString()}, last ${usable.at(-1).bytes} bytes @ ${new Date(usable.at(-1).tsMs).toISOString()}`)],
    );
  }
  return assertion(
    "main_footprint_slope",
    "pass",
    `${slope.toFixed(1)} MB/h over ${spanHours.toFixed(1)}h (${usable.length} samples from ${source}).`,
  );
}

export function assertEventCountZero(id, healthLines, healthPath, eventName) {
  const hits = healthLines.filter(({ entry }) => entry.event === eventName);
  if (hits.length === 0) {
    return assertion(id, "pass", `0 ${eventName} events in the soak window.`);
  }
  return assertion(
    id,
    "fail",
    `${hits.length} ${eventName} event${hits.length === 1 ? "" : "s"} in the soak window.`,
    hits.slice(0, 10).map(({ line, raw }) => cite(healthPath, line, raw)),
  );
}

export function assertWebkitReturnsToBaseline(metricsRows, metricsPath) {
  const rows = metricsRows.filter((row) => Number.isFinite(row.webkitWebContentCount));
  if (rows.length < 3) {
    return assertion(
      "webkit_returns_to_baseline",
      "skipped",
      "Not enough collector samples to judge WebContent count.",
    );
  }
  const baseline = Math.min(...rows.map((row) => row.webkitWebContentCount));
  const tail = rows.slice(-Math.max(3, Math.floor(rows.length * 0.1)));
  const tailMin = Math.min(...tail.map((row) => row.webkitWebContentCount));
  if (tailMin > baseline) {
    const worst = tail.find((row) => row.webkitWebContentCount === tailMin) ?? tail.at(-1);
    return assertion(
      "webkit_returns_to_baseline",
      "fail",
      `WebContent count never returned to its baseline of ${baseline} in the final samples (still ${tailMin}). Machine-wide count; app-attributed counts arrive with P0-02/P0-03.`,
      [cite(metricsPath, worst.line, `${worst.iso} webkitWebContentCount=${worst.webkitWebContentCount}`)],
    );
  }
  return assertion(
    "webkit_returns_to_baseline",
    "pass",
    `WebContent count returned to its baseline of ${baseline} by the end of the soak.`,
  );
}

// P0-02/P0-03 counters. Guarded: skipped until the app emits the fields.
export function assertGuardedCounters(healthLines, healthPath) {
  const results = [];

  const uploadLines = healthLines.filter(({ entry }) => typeof entry.headsUnchanged === "boolean");
  if (uploadLines.length === 0) {
    results.push(
      assertion("uploads_unchanged_heads", "skipped", "Counter not yet emitted (lands with P0-03)."),
    );
  } else {
    const unchanged = uploadLines.filter(({ entry }) => entry.headsUnchanged === true);
    results.push(
      unchanged.length === 0
        ? assertion("uploads_unchanged_heads", "pass", `0 of ${uploadLines.length} uploads had unchanged heads.`)
        : assertion(
            "uploads_unchanged_heads",
            "fail",
            `${unchanged.length} of ${uploadLines.length} uploads had unchanged heads (cloud loop signature, F01/F06).`,
            unchanged.slice(0, 10).map(({ line, raw }) => cite(healthPath, line, raw)),
          ),
    );
  }

  const killLines = healthLines.filter(({ entry }) => entry.event === "window_destroyed");
  if (killLines.length === 0) {
    results.push(
      assertion("preflight_kills", "skipped", "No window_destroyed records (lands with P0-02)."),
    );
  } else {
    const preflightKills = killLines.filter(
      ({ entry, raw }) => entry.sessionActive === true || raw.includes("preflight"),
    );
    results.push(
      preflightKills.length === 0
        ? assertion("preflight_kills", "pass", `0 of ${killLines.length} window_destroyed records killed an active session.`)
        : assertion(
            "preflight_kills",
            "fail",
            `${preflightKills.length} window_destroyed record${preflightKills.length === 1 ? "" : "s"} killed an active session or came from preflight (F04).`,
            preflightKills.slice(0, 10).map(({ line, raw }) => cite(healthPath, line, raw)),
          ),
    );
  }

  const scrapeLines = healthLines.filter(
    ({ entry }) => Number.isFinite(entry.itemsExtracted) && Number.isFinite(entry.itemsPersisted),
  );
  if (scrapeLines.length === 0) {
    results.push(
      assertion("scrape_zero_persist", "skipped", "Counter not yet emitted (lands with P0-03)."),
    );
  } else {
    const zeroPersist = scrapeLines.filter(
      ({ entry }) => entry.itemsExtracted >= 5 && entry.itemsPersisted === 0,
    );
    results.push(
      zeroPersist.length === 0
        ? assertion("scrape_zero_persist", "pass", `0 of ${scrapeLines.length} scrapes extracted items without persisting.`)
        : assertion(
            "scrape_zero_persist",
            "fail",
            `${zeroPersist.length} scrape${zeroPersist.length === 1 ? "" : "s"} extracted >= 5 items and persisted 0 (F03 signature).`,
            zeroPersist.slice(0, 10).map(({ line, raw }) => cite(healthPath, line, raw)),
          ),
    );
  }

  return results;
}

export function buildVerdict({ soakDir, metricsText, metricsPath, healthLines, healthPath }) {
  const metricsRows = parseMetricsTsv(metricsText);
  const windowStart = metricsRows[0]?.tsMs ?? healthLines[0]?.entry?.tsMs ?? 0;
  const windowEnd = metricsRows.at(-1)?.tsMs ?? healthLines.at(-1)?.entry?.tsMs ?? 0;

  const assertions = [
    assertFootprintSlope(healthLines, metricsRows, metricsPath, healthPath),
    assertEventCountZero("renderer_recoveries", healthLines, healthPath, "renderer_recovery_restart_requested"),
    assertEventCountZero("stale_heartbeats", healthLines, healthPath, "renderer_heartbeat_stale"),
    assertWebkitReturnsToBaseline(metricsRows, metricsPath),
    ...assertGuardedCounters(healthLines, healthPath),
  ];

  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    soakDir,
    generatedAt: new Date().toISOString(),
    windowStart: windowStart ? new Date(windowStart).toISOString() : "",
    windowEnd: windowEnd ? new Date(windowEnd).toISOString() : "",
    spanHours: windowStart && windowEnd ? (windowEnd - windowStart) / 3_600_000 : 0,
    sampleCount: metricsRows.length,
    healthLineCount: healthLines.length,
    assertions,
    failures: assertions.filter((item) => item.status === "fail").length,
    pass: assertions.every((item) => item.status !== "fail"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  let soakDir = args.soakDir;
  if (!soakDir) {
    if (!existsSync(args.pointer)) {
      throw new Error(`No --soak-dir given and no pointer at ${args.pointer}.`);
    }
    soakDir = readFileSync(args.pointer, "utf8").trim();
  }
  soakDir = path.resolve(soakDir);
  if (!existsSync(soakDir)) {
    throw new Error(`Soak dir does not exist: ${soakDir}`);
  }

  const metricsPath = path.join(soakDir, "metrics.tsv");
  const metricsText = existsSync(metricsPath) ? readFileSync(metricsPath, "utf8") : "";
  const metricsRows = parseMetricsTsv(metricsText);
  const windowStart = metricsRows[0]?.tsMs ?? 0;
  const windowEnd = metricsRows.at(-1)?.tsMs ?? Number.POSITIVE_INFINITY;

  // Prefer a runtime-health copy inside the soak dir (older soaks stored one);
  // otherwise read the app's live file sliced to the soak window.
  const soakHealthPath = path.join(soakDir, "runtime-health.jsonl");
  const healthPath = existsSync(soakHealthPath)
    ? soakHealthPath
    : path.join(args.appData, "runtime-health.jsonl");
  const healthLines = readHealthLines(healthPath, {
    fromTsMs: windowStart,
    toTsMs: windowEnd === 0 ? Number.POSITIVE_INFINITY : windowEnd,
  });

  const verdict = buildVerdict({ soakDir, metricsText, metricsPath, healthLines, healthPath });
  const outPath = args.out ? path.resolve(args.out) : path.join(soakDir, "soak-verdict.json");
  writeFileSync(outPath, `${JSON.stringify(verdict, null, 2)}\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  } else {
    for (const item of verdict.assertions) {
      process.stdout.write(`[${item.status.toUpperCase()}] ${item.id}: ${item.detail}\n`);
      for (const violation of item.violations) {
        process.stdout.write(`    ${violation.file}:${violation.line} ${violation.excerpt.slice(0, 120)}\n`);
      }
    }
    process.stdout.write(
      `Verdict: ${verdict.pass ? "PASS" : "FAIL"} (${verdict.failures} failing assertion${verdict.failures === 1 ? "" : "s"}) -> ${outPath}\n`,
    );
  }
  process.exitCode = verdict.pass ? 0 : 1;
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
