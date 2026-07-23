#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPT_DIRECTORY);
const SHARDED_TEST_FILES = Object.freeze({
  "automation-control": "scripts/automation-control.test.mjs",
  "kernel-guard-cutover": "scripts/automation-kernel-guard-cutover.test.mjs",
  "outcome-ledger-repair": "scripts/outcome-ledger-repair.test.mjs",
});

function fail(message) {
  throw new Error(message);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function parseToolingSmokeShardArgs(args) {
  const parsed = {
    plan: false,
    shardCount: null,
    shardIndex: null,
    suite: "",
  };
  for (const argument of args) {
    if (argument === "--plan") {
      parsed.plan = true;
    } else if (argument.startsWith("--suite=")) {
      parsed.suite = argument.slice("--suite=".length);
    } else if (argument.startsWith("--shard-index=")) {
      parsed.shardIndex = positiveInteger(
        argument.slice("--shard-index=".length),
        "Shard index",
      );
    } else if (argument.startsWith("--shard-count=")) {
      parsed.shardCount = positiveInteger(
        argument.slice("--shard-count=".length),
        "Shard count",
      );
    } else {
      fail(`Unknown tooling smoke shard argument: ${argument}`);
    }
  }
  if (
    parsed.suite !== "general" &&
    !Object.hasOwn(SHARDED_TEST_FILES, parsed.suite)
  ) {
    fail(`Unknown tooling smoke suite: ${parsed.suite || "missing"}`);
  }
  if (parsed.shardIndex === null || parsed.shardCount === null) {
    fail("Tooling smoke sharding requires an index and count.");
  }
  if (parsed.shardIndex > parsed.shardCount) {
    fail("Shard index cannot exceed shard count.");
  }
  return Object.freeze(parsed);
}

export function toolingSmokeShardFor(value, shardCount) {
  const digest = createHash("sha256").update(value, "utf8").digest();
  return (digest.readUInt32BE(0) % shardCount) + 1;
}

export function partitionToolingSmokeItems(items, shardIndex, shardCount) {
  const unique = new Set(items);
  if (unique.size !== items.length) {
    fail("Tooling smoke shard inputs must be unique.");
  }
  return items.filter(
    (item) => toolingSmokeShardFor(item, shardCount) === shardIndex,
  );
}

function formatParseDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
}

function directTestCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "test"
  );
}

function testNameDescriptor(nameNode, sourceFile, label) {
  if (
    ts.isStringLiteral(nameNode) ||
    ts.isNoSubstitutionTemplateLiteral(nameNode)
  ) {
    if (nameNode.text.length === 0) {
      fail(`${label} contains an empty top-level test name.`);
    }
    return Object.freeze({
      dynamic: false,
      name: nameNode.text,
      patternFragment: escapeRegExp(nameNode.text),
      prefix: nameNode.text,
      suffix: nameNode.text,
    });
  }
  if (ts.isTemplateExpression(nameNode)) {
    const fragments = [escapeRegExp(nameNode.head.text)];
    for (const span of nameNode.templateSpans) {
      fragments.push("[\\s\\S]*", escapeRegExp(span.literal.text));
    }
    if (nameNode.head.text.length === 0) {
      fail(
        `${label} contains a dynamic top-level test without a fixed prefix.`,
      );
    }
    return Object.freeze({
      dynamic: true,
      name: nameNode.getText(sourceFile),
      patternFragment: fragments.join(""),
      prefix: nameNode.head.text,
      suffix: nameNode.templateSpans.at(-1)?.literal.text ?? "",
    });
  }
  fail(
    `${label} contains a top-level test without one literal or deterministic template name.`,
  );
}

function topLevelArrayLengths(sourceFile) {
  const lengths = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        lengths.set(
          declaration.name.text,
          declaration.initializer.elements.length,
        );
      }
    }
  }
  return lengths;
}

function registrationMultiplier(call, sourceFile, arrayLengths) {
  let multiplier = 1;
  for (let node = call.parent; node !== sourceFile; node = node.parent) {
    if (!ts.isForOfStatement(node)) continue;
    if (ts.isArrayLiteralExpression(node.expression)) {
      multiplier *= Math.max(1, node.expression.elements.length);
    } else if (ts.isIdentifier(node.expression)) {
      multiplier *= Math.max(1, arrayLengths.get(node.expression.text) ?? 1);
    }
  }
  return multiplier;
}

function patternsCanOverlap(left, right) {
  if (!left.dynamic && !right.dynamic) return left.name === right.name;
  if (!left.dynamic || !right.dynamic) {
    const literal = left.dynamic ? right : left;
    const dynamic = left.dynamic ? left : right;
    return new RegExp(`^(?:${dynamic.patternFragment})$`, "u").test(
      literal.name,
    );
  }
  const prefixesCompatible =
    left.prefix.startsWith(right.prefix) ||
    right.prefix.startsWith(left.prefix);
  const suffixesCompatible =
    left.suffix.endsWith(right.suffix) || right.suffix.endsWith(left.suffix);
  return prefixesCompatible && suffixesCompatible;
}

export function extractTopLevelTestUnits(source, label = "test source") {
  const sourceFile = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = sourceFile.parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    fail(
      `${label} has invalid syntax: ${formatParseDiagnostic(parseDiagnostics[0])}`,
    );
  }

  const units = [];
  const arrayLengths = topLevelArrayLengths(sourceFile);
  const inspect = (node, functionDepth = 0) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "test"
    ) {
      fail(`${label} contains an unsupported top-level test modifier.`);
    }
    if (directTestCall(node)) {
      if (functionDepth > 0) {
        fail(`${label} contains an indirect top-level test registration.`);
      }
      const nameNode = node.arguments[0];
      if (!nameNode) {
        fail(`${label} contains a top-level test without a name.`);
      }
      const descriptor = testNameDescriptor(nameNode, sourceFile, label);
      units.push(
        Object.freeze({
          ...descriptor,
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          weight:
            (node.getEnd() - node.getStart(sourceFile)) *
            registrationMultiplier(node, sourceFile, arrayLengths),
        }),
      );
      return;
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "test" &&
      !(
        (ts.isImportClause(node.parent) && node.parent.name === node) ||
        (ts.isCallExpression(node.parent) && node.parent.expression === node) ||
        (ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node)
      )
    ) {
      fail(`${label} aliases or passes the top-level test registrar.`);
    }
    const nextFunctionDepth = ts.isFunctionLike(node)
      ? functionDepth + 1
      : functionDepth;
    ts.forEachChild(node, (child) => inspect(child, nextFunctionDepth));
  };
  inspect(sourceFile);

  const names = units.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    fail(`${label} contains duplicate top-level test names.`);
  }
  if (units.length === 0) {
    fail(`${label} contains no top-level tests.`);
  }
  for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < units.length;
      rightIndex += 1
    ) {
      if (patternsCanOverlap(units[leftIndex], units[rightIndex])) {
        fail(`${label} contains overlapping top-level test name patterns.`);
      }
    }
  }
  return units;
}

export function extractTopLevelTestNames(source, label = "test source") {
  return extractTopLevelTestUnits(source, label).map(({ name }) => name);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function exactTestNamePattern(names, allTopLevelNames = names) {
  if (names.length === 0 || allTopLevelNames.length === 0) {
    fail("A tooling smoke name shard cannot be empty.");
  }
  const allNames = new Set(allTopLevelNames);
  if (names.some((name) => !allNames.has(name))) {
    fail("A tooling smoke name shard must be a subset of the suite.");
  }
  return `^(?:${names.map(escapeRegExp).join("|")})$`;
}

export function exactTestUnitPattern(units) {
  if (units.length === 0) {
    fail("A tooling smoke name shard cannot be empty.");
  }
  return `^(?:${units.map(({ patternFragment }) => patternFragment).join("|")})$`;
}

export function partitionWeightedTestUnits(units, shardCount) {
  if (!Number.isSafeInteger(shardCount) || shardCount <= 0) {
    fail("Shard count must be a positive integer.");
  }
  if (units.length < shardCount) {
    fail("Every tooling smoke name shard must receive at least one test.");
  }
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    index,
    weight: 0,
    units: [],
  }));
  const ordered = [...units].sort(
    (left, right) =>
      right.weight - left.weight || left.name.localeCompare(right.name),
  );
  for (const unit of ordered) {
    const shard = [...shards].sort(
      (left, right) => left.weight - right.weight || left.index - right.index,
    )[0];
    shard.units.push(unit);
    shard.weight += unit.weight;
  }
  const assigned = shards.flatMap(({ units: assignedUnits }) => assignedUnits);
  if (
    assigned.length !== units.length ||
    new Set(assigned.map(({ name }) => name)).size !== units.length
  ) {
    fail("Tooling smoke name sharding did not preserve exact coverage.");
  }
  return shards.map(({ units: assignedUnits }) => Object.freeze(assignedUnits));
}

function generalTestFiles(repoRoot) {
  const specialFiles = new Set(Object.values(SHARDED_TEST_FILES));
  const visit = (relativeDirectory) =>
    readdirSync(path.join(repoRoot, relativeDirectory), {
      withFileTypes: true,
    }).flatMap((entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return visit(relativePath);
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".test.mjs") ||
        specialFiles.has(relativePath)
      ) {
        return [];
      }
      return [relativePath];
    });
  return visit("scripts").sort();
}

function shellFiles(repoRoot) {
  return ["scripts", path.join("scripts", "lib")]
    .flatMap((relativeDirectory) =>
      readdirSync(path.join(repoRoot, relativeDirectory), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sh"))
        .map((entry) =>
          path.posix.join(
            relativeDirectory.split(path.sep).join("/"),
            entry.name,
          ),
        ),
    )
    .sort();
}

export function buildToolingSmokeShardPlan(
  { suite, shardIndex, shardCount },
  { repoRoot = REPO_ROOT } = {},
) {
  if (suite === "general") {
    const generalUnits = generalTestFiles(repoRoot).map((testFile) => ({
      name: testFile,
      weight: readFileSync(path.join(repoRoot, testFile), "utf8").length,
    }));
    const files = partitionWeightedTestUnits(generalUnits, shardCount)[
      shardIndex - 1
    ].map(({ name }) => name);
    if (files.length === 0) {
      fail(
        `General tooling smoke shard ${shardIndex.toLocaleString()} is empty.`,
      );
    }
    return Object.freeze({
      schemaVersion: 1,
      suite,
      shardIndex,
      shardCount,
      shellFiles: shardIndex === 1 ? shellFiles(repoRoot) : [],
      testFiles: files,
      testNames: [],
      testNamePattern: null,
    });
  }
  const testFile = SHARDED_TEST_FILES[suite];
  const source = readFileSync(path.join(repoRoot, testFile), "utf8");
  const allUnits = extractTopLevelTestUnits(source, testFile);
  const selectedUnits = partitionWeightedTestUnits(allUnits, shardCount)[
    shardIndex - 1
  ];
  const testNames = selectedUnits.map(({ name }) => name);
  return Object.freeze({
    schemaVersion: 1,
    suite,
    shardIndex,
    shardCount,
    shellFiles: [],
    testFiles: [testFile],
    testNames,
    testNamePattern: exactTestUnitPattern(selectedUnits),
  });
}

function runChecked(command, args, repoRoot) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal !== null) {
    fail(`Tooling smoke shard stopped on signal ${result.signal}.`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function runToolingSmokeShard(plan, { repoRoot = REPO_ROOT } = {}) {
  if (plan.shellFiles.length > 0) {
    runChecked("bash", ["-n", ...plan.shellFiles], repoRoot);
  }
  const args = ["--test"];
  if (plan.testNamePattern !== null) {
    args.push(`--test-name-pattern=${plan.testNamePattern}`);
  }
  args.push(...plan.testFiles);
  runChecked(process.execPath, args, repoRoot);
}

function isMain() {
  return (
    typeof process.argv[1] === "string" &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  try {
    const options = parseToolingSmokeShardArgs(process.argv.slice(2));
    const plan = buildToolingSmokeShardPlan(options);
    if (options.plan) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } else {
      runToolingSmokeShard(plan);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
