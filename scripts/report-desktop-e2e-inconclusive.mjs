#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const heading = "## Freed Desktop e2e inconclusive attempts\n\n";
const count = (value) => value.toLocaleString("en-US");
const escapeCell = (value) => value
  .replace(/&/g, "&amp;")
  .replace(/[<>|`*_[\]\\]/g, (character) => `&#${character.codePointAt(0)};`)
  .replace(/[\r\n]+/g, "<br>");

function requireShape(condition) {
  if (!condition) throw new Error("Unsupported or malformed Playwright JSON report.");
}

/** Result annotations belong to attempts; test annotations only describe the final retry. */
export function summarizeInconclusive(report) {
  try {
    requireShape(typeof report?.config?.version === "string" && /^1\./.test(report.config.version));
    requireShape(Array.isArray(report.suites) && Array.isArray(report.errors));
    if (report.errors.length) throw new Error("Playwright reported run-level errors; coverage is incomplete.");
    const rows = new Map();
    let excluded = 0;
    let unexecuted = 0;
    function visit(suite, parents = [], root = false) {
      requireShape(typeof suite?.title === "string" && Array.isArray(suite.specs));
      requireShape(suite.suites === undefined || Array.isArray(suite.suites));
      const titles = root ? parents : [...parents, suite.title];
      for (const spec of suite.specs) {
        requireShape(typeof spec?.title === "string" && typeof spec.file === "string" && Array.isArray(spec.tests));
        for (const test of spec.tests) {
          requireShape(typeof test?.projectName === "string" && Array.isArray(test.results));
          const fullTitle = [...titles, spec.title];
          const key = JSON.stringify([test.projectName, spec.file, fullTitle]);
          const row = rows.get(key) ?? { project: test.projectName, file: spec.file, title: fullTitle.join(" › "), annotations: 0, affected: 0, attempts: 0 };
          if (!test.results.length) unexecuted++;
          for (const result of test.results) {
            requireShape(["passed", "failed", "timedOut", "interrupted", "skipped"].includes(result?.status));
            requireShape(Number.isInteger(result.retry) && result.retry >= 0 && Number.isInteger(result.workerIndex) && result.workerIndex >= -1);
            requireShape(Array.isArray(result.annotations) && result.annotations.every((annotation) => typeof annotation?.type === "string"));
            // Playwright also emits placeholders for skipped and never-started results.
            if (result.status === "skipped" || result.workerIndex === -1) {
              excluded++;
              continue;
            }
            const annotations = result.annotations.filter((annotation) => annotation.type === "inconclusive").length;
            row.annotations += annotations;
            row.affected += Number(annotations > 0);
            row.attempts++;
          }
          rows.set(key, row);
        }
      }
      for (const child of suite.suites ?? []) visit(child, titles);
    }
    for (const suite of report.suites) visit(suite, [], true);
    const values = [...rows.values()];
    const total = values.reduce((sum, row) => sum + row.attempts, 0);
    if (!total) throw new Error("No executed attempts were recorded; skipped or unexecuted tests provide no conclusive samples.");
    const affected = values.filter((row) => row.affected > 0);
    const annotations = affected.reduce((sum, row) => sum + row.annotations, 0);
    const attempts = affected.reduce((sum, row) => sum + row.affected, 0);
    let summary = heading + `${count(annotations)} inconclusive annotations across ${count(attempts)} affected executed attempts / ${count(total)} total executed attempts.\n\n`;
    summary += `${count(excluded)} skipped or never-started results and ${count(unexecuted)} test cases without results excluded. Flags are informational; test verdicts are unchanged.\n\n`;
    if (!affected.length) return summary + "No inconclusive annotations were recorded in executed attempts.\n";
    summary += "| Project | File | Full test title | Inconclusive annotations | Affected attempts | Executed attempts | Flag |\n| --- | --- | --- | ---: | ---: | ---: | --- |\n";
    for (const row of affected) {
      const flag = row.affected === row.attempts ? "EVERY ATTEMPT INCONCLUSIVE" : "";
      summary += `| ${escapeCell(row.project)} | ${escapeCell(row.file)} | ${escapeCell(row.title)} | ${count(row.annotations)} | ${count(row.affected)} | ${count(row.attempts)} | ${flag} |\n`;
    }
    return summary;
  } catch (error) {
    return heading + `**Reporting unavailable:** ${error.message}\n`;
  }
}

export function reportInconclusive(reportPath, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  let summary;
  try {
    summary = summarizeInconclusive(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch {
    summary = heading + "**Reporting unavailable:** Playwright JSON report is missing, unreadable or invalid JSON.\n";
  }
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, `\n${summary}\n`);
    } catch {
      // Keep reporting informational even when the Actions summary cannot be written.
      return heading + "**Reporting unavailable:** Could not append to the job summary.\n";
    }
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(reportInconclusive(process.argv[2]));
}
