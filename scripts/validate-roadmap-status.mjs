#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const ROADMAP_STATUS_PATH = path.join(
  REPO_ROOT,
  "docs",
  "roadmap-status.json",
);

export function phaseStatusFromMarkdown(markdown) {
  const header = markdown.split(/\r?\n/).slice(0, 6).join("\n");
  const match = header.match(/>\s*\*\*Status:\*\*\s*([^\n]+)/i);
  if (!match) {
    throw new Error(
      "Phase document has no Status header in its first six lines.",
    );
  }
  const status = match[1];
  if (/complete/i.test(status)) return "complete";
  if (/in progress|\bcurrent\b/i.test(status)) return "current";
  return "upcoming";
}

export function validateRoadmapStatus({
  repoRoot = REPO_ROOT,
  manifestPath = ROADMAP_STATUS_PATH,
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.phases)) {
    throw new Error(
      "docs/roadmap-status.json must use schemaVersion 1 with a phases array.",
    );
  }
  const seenIds = new Set();
  const seenSources = new Set();
  for (const phase of manifest.phases) {
    if (!Number.isInteger(phase.id) || seenIds.has(phase.id)) {
      throw new Error(
        `Roadmap phase id must be a unique integer: ${phase.id}.`,
      );
    }
    seenIds.add(phase.id);
    const expectedSource = `docs/PHASE-${phase.id}-`;
    if (
      typeof phase.source !== "string" ||
      !phase.source.startsWith(expectedSource) ||
      !/^docs\/PHASE-\d+-[A-Z0-9-]+\.md$/.test(phase.source) ||
      seenSources.has(phase.source)
    ) {
      throw new Error(
        `Phase ${phase.id.toLocaleString()} has an invalid source path.`,
      );
    }
    seenSources.add(phase.source);
    const markdown = readFileSync(path.join(repoRoot, phase.source), "utf8");
    const expectedStatus = phaseStatusFromMarkdown(markdown);
    if (phase.status !== expectedStatus) {
      throw new Error(
        `Phase ${phase.id.toLocaleString()} is ${expectedStatus} in ${phase.source} but ${phase.status} in docs/roadmap-status.json.`,
      );
    }
  }

  const phaseDocuments = readdirSync(path.join(repoRoot, "docs"))
    .filter((name) => /^PHASE-\d+-[A-Z0-9-]+\.md$/.test(name))
    .map((name) => `docs/${name}`)
    .sort();
  const manifestSources = [...seenSources].sort();
  if (JSON.stringify(manifestSources) !== JSON.stringify(phaseDocuments)) {
    const missing = phaseDocuments.filter((source) => !seenSources.has(source));
    const unknown = manifestSources.filter(
      (source) => !phaseDocuments.includes(source),
    );
    throw new Error(
      `Roadmap manifest must contain every phase document exactly once. Missing: ${missing.join(", ") || "none"}. Unknown: ${unknown.join(", ") || "none"}.`,
    );
  }
  return manifest;
}

function main() {
  const manifest = validateRoadmapStatus();
  process.stdout.write(
    `Validated ${manifest.phases.length.toLocaleString()} roadmap phase statuses.\n`,
  );
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
