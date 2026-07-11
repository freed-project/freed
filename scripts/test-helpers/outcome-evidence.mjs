import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildOutcomeVerdictFromArtifacts } from "../build-outcome-verdict.mjs";
import { METRICS_COLUMNS } from "../soak-collect.mjs";
import { rebuildStoredSoakVerdict } from "../soak-assert.mjs";

const MB = 1024 * 1024;

function metricsText(rows) {
  return `${[
    METRICS_COLUMNS.join("\t"),
    ...rows.map((row) =>
      METRICS_COLUMNS.map((column) => row[column] ?? 0).join("\t"),
    ),
  ].join("\n")}\n`;
}

export function writeStoredSoakEvidence(
  root,
  {
    name,
    startMs,
    version,
    commitSha,
    channel = "dev",
    artifactDigest = "",
    slopeMbPerHour,
    conclusive = true,
    comparisonContext = {
      scenario: "idle",
      providerCohort: "social-authenticated-gdrive-connected",
      documentSizeBucket: "medium",
      host: { platform: "darwin", architecture: "arm64", memoryTierGiB: 64 },
    },
  },
) {
  const soakDir = path.join(root, `${name}-${randomUUID()}`);
  mkdirSync(soakDir, { recursive: true });
  const identity = {
    appVersion: version,
    buildCommitSha: commitSha,
    channel,
    appSessionId: `session-${name}-${randomUUID()}`,
  };
  const endMs = startMs + 5 * 60 * 60_000;
  const health = [
    ...Array.from({ length: 301 }, (_, index) => ({
      ...identity,
      event: "renderer_heartbeat",
      tsMs: startMs + index * 60_000,
      nativeFootprintBytes: (500 + slopeMbPerHour * (index / 60)) * MB,
    })),
    {
      ...identity,
      event: "cloud_sync_coverage",
      tsMs: endMs,
      connected: true,
      eligible: true,
      intervalStartMs: startMs,
      intervalEndMs: endMs,
    },
    ...(conclusive
      ? [
          {
            ...identity,
            event: "window_destroyed",
            tsMs: endMs - 2,
            reasonEnum: "job_complete",
            label: "facebook-scraper",
            scraperSessionHeld: false,
          },
          {
            ...identity,
            event: "scrape_outcome",
            tsMs: endMs - 1,
            itemsExtracted: 0,
            itemsNovel: 0,
            itemsPersisted: 0,
          },
        ]
      : []),
  ];
  const rows = Array.from({ length: 301 }, (_, index) => ({
    tsMs: startMs + index * 60_000,
    iso: new Date(startMs + index * 60_000).toISOString(),
    appPid: 123,
    appRssKb: 500 * 1024,
    webkitWebContentCount: 4,
    webkitWebContentRssKb: 400 * 1024,
    webkitLargestRssKb: 100 * 1024,
    webkitOtherRssKb: 20 * 1024,
    healthFileBytes: 1,
    healthFileLines: health.length,
  }));
  writeFileSync(path.join(soakDir, "metrics.tsv"), metricsText(rows));
  writeFileSync(
    path.join(soakDir, "runtime-health.jsonl"),
    `${health.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  writeFileSync(
    path.join(soakDir, "soak-info.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      collectorSessionId: `collector-${name}-${randomUUID()}`,
      intervalSeconds: 60,
      ...(artifactDigest ? { artifactDigest } : {}),
      comparisonContext,
    })}\n`,
  );
  const verdict = rebuildStoredSoakVerdict(soakDir);
  const verdictPath = path.join(soakDir, "soak-verdict.json");
  writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`);
  return { verdict, verdictPath, soakDir };
}

export function writeMeasuredOutcomeVerdict(
  root,
  {
    taskId,
    version,
    commitSha = "a".repeat(40),
    channel = "dev",
    artifactDigest = "",
    windowEnd,
    outcome = "verified_effective",
    before = outcome === "regressed" ? 4 : 30,
    after = outcome === "regressed"
      ? 30
      : outcome === "verified_neutral"
        ? before
        : 4,
    sourceStartMs = Date.parse(windowEnd) - 5 * 60 * 60_000,
  },
) {
  const source = writeStoredSoakEvidence(root, {
    name: `${taskId}-source`,
    startMs: sourceStartMs,
    version,
    commitSha,
    channel,
    artifactDigest,
    slopeMbPerHour: after,
    conclusive: outcome !== "inconclusive",
  });
  const baseline =
    outcome === "inconclusive"
      ? null
      : writeStoredSoakEvidence(root, {
          name: `${taskId}-baseline`,
          startMs: sourceStartMs - 6 * 60 * 60_000,
          version: `baseline-${version}`,
          commitSha:
            commitSha === "b".repeat(40) ? "c".repeat(40) : "b".repeat(40),
          channel,
          slopeMbPerHour: before,
        });
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: source.verdictPath,
    sourceKind: "soak",
    taskId,
    outcome,
    metric: outcome === "inconclusive" ? "" : "main-footprint-slope",
    baselineReference: baseline?.verdictPath ?? "",
  });
  const verdictPath = path.join(root, `${taskId}-${randomUUID()}-outcome.json`);
  writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`);
  return { verdict, verdictPath, source, baseline };
}
