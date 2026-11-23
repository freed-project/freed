import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import test from "node:test";
import { reportInconclusive, summarizeInconclusive } from "./report-desktop-e2e-inconclusive.mjs";

const summaryPrefix = "(AI Generated)\n\n## Freed Desktop e2e inconclusive attempts\n\n";
const budget = (description = "frame p95: 50 ms >= 50 ms budget (requires <)") => ({
  type: "perf budget exceeded (report-only)", description,
});

// Playwright 1.62.0 JSON reporter shape, checked against a real synthetic retry run.
const attempt = (annotations = 0, overrides = {}) => ({
  status: "passed", workerIndex: 0, retry: 0,
  annotations: Array.from({ length: annotations }, () => ({ type: "inconclusive" })),
  ...overrides,
});
const spec = (results, { project = "chromium", file = "friends.spec.ts", title = "sample" } = {}) => ({
  title, file, tests: [{ projectName: project, annotations: [{ type: "inconclusive" }], results }],
});
const report = (...specs) => ({
  config: { version: "1.62.0" }, errors: [],
  suites: [{ title: "friends.spec.ts", specs: [], suites: [{ title: "Friends", specs }] }],
});

test("zero annotations uses result evidence, never the test aggregate", () => {
  const summary = summarizeInconclusive(report(spec([attempt()])));
  assert.equal(summary.slice(0, summaryPrefix.length), summaryPrefix);
  assert.match(summary, /0 inconclusive annotations across 0 affected executed attempts \/ 1 total/);
  assert.match(summary, /No inconclusive annotations were recorded/);
  assert.match(summary, /No report-only budget annotations were recorded/);
  assert.doesNotMatch(summary, /EVERY ATTEMPT|Reporting unavailable/);
});

test("multiple annotations and retry coverage have distinct counters", () => {
  const summary = summarizeInconclusive(report(spec([
    attempt(2, { status: "failed" }), attempt(0, { retry: 1 }),
  ])));
  assert.match(summary, /2 inconclusive annotations across 1 affected executed attempts \/ 2 total/);
  assert.match(summary, /\| chromium \| friends.spec.ts \| Friends › sample \| 2 \| 1 \| 2 \| {2}\|/);
  assert.doesNotMatch(summary, /EVERY ATTEMPT/);
});

test("every executed attempt inconclusive is informational regardless of verdict", () => {
  const summary = summarizeInconclusive(report(spec([
    attempt(2, { status: "timedOut" }), attempt(1, { retry: 1, status: "interrupted" }),
  ])));
  assert.match(summary, /3 inconclusive annotations across 2 affected executed attempts \/ 2 total/);
  assert.match(summary, /\| 3 \| 2 \| 2 \| EVERY ATTEMPT INCONCLUSIVE \|/);
  assert.match(summary, /Flags are informational; test verdicts are unchanged/);
});

test("project, file and nested full title identify groups, repeated cases aggregate", () => {
  const fixture = report(spec([attempt(1)]), spec([attempt()]),
    spec([attempt(1)], { project: "other" }), spec([attempt(1)], { file: "other.spec.ts" }));
  fixture.suites[0].suites.push({ title: "Other", specs: [spec([attempt(1)])] });
  const summary = summarizeInconclusive(fixture);
  assert.match(summary, /4 inconclusive annotations across 4 affected executed attempts \/ 5 total/);
  assert.match(summary, /\| chromium \| friends.spec.ts \| Friends › sample \| 1 \| 1 \| 2 \| {2}\|/);
  assert.equal(summary.match(/EVERY ATTEMPT INCONCLUSIVE/g).length, 3);
});

test("skipped and never-started results cannot dilute or satisfy every-attempt coverage", () => {
  const cases = [spec([attempt(3, { status: "skipped" })]), spec([]), spec([attempt(2, { status: "interrupted", workerIndex: -1 })])];
  const empty = summarizeInconclusive(report(...cases));
  assert.match(empty, /Reporting unavailable.*No executed attempts/);
  assert.doesNotMatch(empty, /EVERY ATTEMPT|0 inconclusive/);
  const mixed = summarizeInconclusive(report(...cases, spec([attempt(1)])));
  assert.match(mixed, /1 inconclusive annotations across 1 affected executed attempts \/ 1 total/);
  assert.match(mixed, /2 skipped or never-started results and 1 test cases without results excluded/);
  assert.match(mixed, /EVERY ATTEMPT INCONCLUSIVE/);
});

test("missing or unsupported evidence never becomes a zero-inconclusive result", () => {
  const mutations = [
    () => null, () => ({}), () => ({ ...report(), suites: [] }),
    (r) => { delete r.config; },
    (r) => { r.config.version = "2.0.0"; },
    (r) => { r.errors = [{ message: "worker failure" }]; },
    (r) => { delete r.errors; },
    (r) => { r.suites[0].suites = {}; },
    (r) => { delete r.suites[0].suites[0].specs[0].tests[0].results; },
    (r) => { delete r.suites[0].suites[0].specs[0].tests[0].results[0].annotations; },
    (r) => { r.suites[0].suites[0].specs[0].tests[0].results[0].annotations = [null]; },
    (r) => { r.suites[0].suites[0].specs[0].tests[0].results[0].status = "unknown"; },
    (r) => { r.suites[0].suites[0].specs[0].tests[0].results[0].retry = -1; },
    (r) => { delete r.suites[0].suites[0].specs[0].tests[0].results[0].workerIndex; },
  ];
  for (const mutate of mutations) {
    const input = report(spec([attempt()]));
    const changed = mutate(input);
    const summary = summarizeInconclusive(changed === undefined ? input : changed);
    assert.equal(summary.slice(0, summaryPrefix.length), summaryPrefix);
    assert.match(summary, /Reporting unavailable/);
    assert.doesNotMatch(summary, /0 inconclusive|No inconclusive annotations|EVERY ATTEMPT/);
  }
});

test("untrusted names cannot inject Markdown table cells or HTML", () => {
  for (const tag of ["script", "SCRIPT", "ScRiPt"]) {
    const summary = summarizeInconclusive(report(spec([attempt(1)], {
      project: "a|b", file: `<${tag}>&.ts`, title: "[link](x)*`\\\nnext",
    })));
    assert.equal(
      summary.split("\n").find((line) => line.startsWith("| a&#124;b |")),
      `| a&#124;b | &#60;${tag}&#62;&amp;.ts | Friends › &#91;link&#93;(x)&#42;&#96;&#92;<br>next | 1 | 1 | 1 | EVERY ATTEMPT INCONCLUSIVE |`,
    );
  }
});

test("budget annotations retain each executed attempt and do not affect inconclusive counters", () => {
  const fixture = report(spec([
    attempt(0, { status: "failed", annotations: [budget(), budget("dropped frames: 11 > 10 budget (requires <=)"), { type: "inconclusive" }] }),
    attempt(0, { retry: 1 }),
    attempt(0, { retry: 2, status: "timedOut", annotations: [budget("frame p95: 60 ms >= 50 ms budget (requires <)")] }),
    attempt(0, { retry: 3, status: "interrupted", annotations: [budget()] }),
  ], { project: "chromium-feed-perf", file: "perf-feed.spec.ts", title: "fast scroll" }));
  // Aggregate annotations describe only the final retry and must never be counted.
  fixture.suites[0].suites[0].specs[0].tests[0].annotations.push(budget("aggregate-only"));
  const summary = summarizeInconclusive(fixture);
  assert.match(summary, /1 inconclusive annotations across 1 affected executed attempts \/ 4 total/);
  assert.match(summary, /4 report-only budget annotations/);
  const rows = summary.split("\n").filter((line) => line.includes("ms budget") || line.includes("10 budget"));
  assert.deepEqual(rows, [
    "| chromium-feed-perf | perf-feed.spec.ts | Friends › fast scroll | 1 | frame p95: 50 ms &#62;= 50 ms budget (requires &#60;) |",
    "| chromium-feed-perf | perf-feed.spec.ts | Friends › fast scroll | 1 | dropped frames: 11 &#62; 10 budget (requires &#60;=) |",
    "| chromium-feed-perf | perf-feed.spec.ts | Friends › fast scroll | 3 | frame p95: 60 ms &#62;= 50 ms budget (requires &#60;) |",
    "| chromium-feed-perf | perf-feed.spec.ts | Friends › fast scroll | 4 | frame p95: 50 ms &#62;= 50 ms budget (requires &#60;) |",
  ]);
  assert.doesNotMatch(summary, /aggregate-only|EVERY ATTEMPT/);
});

test("budget annotations exclude skipped and never-started attempts", () => {
  const summary = summarizeInconclusive(report(spec([
    attempt(0, { status: "skipped", annotations: [budget("excluded skip")] }),
    attempt(0, { status: "interrupted", workerIndex: -1, annotations: [budget("excluded placeholder")] }),
    attempt(0, { retry: 2, annotations: [budget()] }),
  ]), spec([])));
  assert.match(summary, /0 inconclusive annotations across 0 affected executed attempts \/ 1 total/);
  assert.match(summary, /2 skipped or never-started results and 1 test cases without results excluded/);
  assert.match(summary, /1 report-only budget annotations/);
  assert.match(summary, /\| 3 \| frame p95:/);
  assert.doesNotMatch(summary, /excluded skip|excluded placeholder|Reporting unavailable/);
});

test("budget rows escape descriptions and identity fields", () => {
  const summary = summarizeInconclusive(report(spec([
    attempt(0, { annotations: [budget("<SCRIPT>&|`*_[]\\\nnext")] }),
  ], { project: "a|b", file: "<file>", title: "[title]" })));
  assert.ok(summary.includes("| a&#124;b | &#60;file&#62; | Friends › &#91;title&#93; | 1 | &#60;SCRIPT&#62;&amp;&#124;&#96;&#42;&#95;&#91;&#93;&#92;<br>next |"));
});

test("missing budget descriptions report unavailable instead of hiding measurements", () => {
  const summary = summarizeInconclusive(report(spec([
    attempt(0, { annotations: [{ type: "perf budget exceeded (report-only)" }] }),
  ])));
  assert.match(summary, /Reporting unavailable/);
  assert.doesNotMatch(summary, /No report-only budget annotations/);
});

test("CLI appends summaries, reports read failures and leaves informational runs successful", () => {
  const dir = mkdtempSync(join(tmpdir(), "freed-inconclusive-"));
  try {
    const input = join(dir, "report.json");
    const output = join(dir, "summary.md");
    writeFileSync(output, "Existing summary\n");
    writeFileSync(input, JSON.stringify(report(spec([attempt(0, { annotations: [{ type: "inconclusive" }, budget()] })]))));
    const result = spawnSync(process.execPath, ["scripts/report-desktop-e2e-inconclusive.mjs", input], {
      encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: output },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.slice(0, summaryPrefix.length), summaryPrefix);
    assert.match(result.stdout, /EVERY ATTEMPT INCONCLUSIVE/);
    assert.match(result.stdout, /1 report-only budget annotations/);
    assert.match(result.stdout, /frame p95: 50 ms &#62;= 50 ms budget/);
    assert.equal(readFileSync(output, "utf8"), `Existing summary\n\n${result.stdout}\n`);
    const writeFailure = reportInconclusive(input, dir);
    assert.equal(writeFailure.slice(0, summaryPrefix.length), summaryPrefix);
    assert.match(writeFailure, /Reporting unavailable.*Could not append/);
    writeFileSync(input, "{");
    for (const reportPath of [input, join(dir, "missing")]) {
      const unavailable = reportInconclusive(reportPath, output);
      assert.equal(unavailable.slice(0, summaryPrefix.length), summaryPrefix);
      assert.match(unavailable, /Reporting unavailable/);
    }
    assert.equal(readFileSync(output, "utf8").match(/Reporting unavailable/g).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nightly keeps reporters and artifacts and summarizes even after e2e failure", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tooling-nightly.yml", import.meta.url), "utf8");
  const desktop = workflow.slice(workflow.indexOf("\n  desktop-e2e:"));
  assert.match(desktop, /run: npm run test:e2e -- --reporter=html,list,\.\/tests\/e2e\/reporters\/perf-reporter\.ts,json\n/);
  assert.match(desktop, /working-directory: packages\/desktop/);
  assert.match(desktop, /FREED_FRIENDS_PERF_TELEMETRY: "1"/);
  assert.match(desktop, /PLAYWRIGHT_HTML_OUTPUT_DIR: playwright-report/);
  assert.match(desktop, /PLAYWRIGHT_JSON_OUTPUT_FILE: playwright-report\/results.json/);
  assert.match(desktop, /name: Summarize inconclusive desktop e2e attempts\n\s+if: always\(\)\n\s+run: node scripts\/report-desktop-e2e-inconclusive.mjs packages\/desktop\/playwright-report\/results.json/);
  assert.match(desktop, /name: Upload reports and telemetry\n\s+if: always\(\)/);
  assert.match(desktop, /packages\/desktop\/playwright-report\/\n\s+packages\/desktop\/test-results\//);
  assert.match(desktop, /retention-days: 14\n\s+if-no-files-found: ignore/);
  assert.doesNotMatch(desktop, /continue-on-error|\|\| true/);
});
