#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const FIXTURES = "docs/instruction-routing-fixtures.json";

function readLocal(root, file) {
  const base = realpathSync(root);
  const resolved = realpathSync(path.resolve(root, file));
  if (!resolved.startsWith(base + path.sep))
    throw new Error("Route escapes repository: " + file);
  return readFileSync(resolved, "utf8");
}

export function localLinks(file, text) {
  return [...text.matchAll(/\]\(([^)]+)\)/g)].flatMap((match) => {
    const target = match[1].split(/[?#]/, 1)[0];
    if (!target || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) return [];
    return [
      path.posix.normalize(path.posix.join(path.posix.dirname(file), target)),
    ];
  });
}

/** Verify reviewer-selected bundles, not model invocation or semantic comprehension. */
export function validateRoutingFixtures({
  root = repoRoot,
  fixtures = JSON.parse(readLocal(root, FIXTURES)),
} = {}) {
  const ids = new Set();
  const reports = [];
  for (const fixture of fixtures.cases) {
    if (
      !fixture.id ||
      ids.has(fixture.id) ||
      !fixture.prompt ||
      !fixture.rationale
    )
      throw new Error("Invalid routing fixture identity or rationale");
    ids.add(fixture.id);
    const selected = new Set(fixture.files);
    if (selected.size !== fixture.files.length || !selected.has(fixture.entry))
      throw new Error(fixture.id + ": duplicate paths or missing entry");
    const texts = new Map(
      [...selected].map((file) => [file, readLocal(root, file)]),
    );
    const reachable = new Set([fixture.entry]);
    for (const file of reachable) {
      for (const link of localLinks(file, texts.get(file))) {
        if (selected.has(link)) reachable.add(link);
      }
    }
    for (const file of selected) {
      if (!reachable.has(file))
        throw new Error(
          fixture.id + ": selected reference is not reachable: " + file,
        );
    }
    for (const file of fixture.excluded ?? []) {
      if (selected.has(file))
        throw new Error(fixture.id + ": unrelated reference selected: " + file);
    }
    for (const { file, text } of fixture.required ?? []) {
      if (!texts.get(file)?.includes(text))
        throw new Error(fixture.id + ": missing required instruction: " + text);
    }
    const bytes = [...texts.values()].reduce(
      (total, text) => total + Buffer.byteLength(text),
      0,
    );
    if (
      !Number.isSafeInteger(fixture.maxBytes) ||
      fixture.maxBytes <= 0 ||
      bytes > fixture.maxBytes
    )
      throw new Error(
        fixture.id + ": bundle exceeds declared byte budget: " + bytes,
      );
    if (bytes > 32 * 1024 && !fixture.budgetReason)
      throw new Error(fixture.id + ": bundle over 32 KiB requires a reason");
    reports.push({ id: fixture.id, bytes, files: [...selected] });
  }
  return reports;
}

/** Every extracted chapter must have an inbound route, with no dangling local links. */
export function validateContractRoutes(root = repoRoot) {
  const index = "docs/LIBRARY-CORE-CONTRACT.md";
  const directory = "docs/library-core-contract";
  function collect(relative) {
    return readdirSync(path.join(root, relative), {
      withFileTypes: true,
    }).flatMap((entry) => {
      const file = relative + "/" + entry.name;
      return entry.isDirectory() ? collect(file) : [file];
    });
  }
  const all = new Set([index, ...collect(directory)]);
  const reached = new Set([index]);
  for (const file of reached) {
    for (const target of localLinks(file, readLocal(root, file))) {
      readLocal(root, target);
      if (all.has(target)) reached.add(target);
    }
  }
  for (const file of all)
    if (!reached.has(file))
      throw new Error("Unrouted contract chapter: " + file);
  return [...reached];
}

const COMMON_STOPS = [
  "Run the read-only `git fetch --all --prune` from the launcher checkout.",
  "Do not ask again for included actions.",
  "Scoped files add to this file and do not weaken it.",
  "Preserve user changes. Do not clean, reset, overwrite, or incorporate unrelated work.",
  "Use the Node toolchain pinned by `.nvmrc`. `node`, `npm`, and `npx` must come from the same installation.",
  "aubreyfs-projects",
];

function authorizationSection(text) {
  const section = text.match(
    /^## Authorization levels\n([\s\S]*?)(?=^## |$(?![\s\S]))/m,
  )?.[1];
  if (!section) throw new Error("Missing authorization section");
  return section.trim();
}

/** Compare universal rules only. Product and website routing intentionally differ. */
export function validateLaneParity(lanes) {
  const names = Object.keys(lanes).sort();
  if (JSON.stringify(names) !== JSON.stringify(["dev", "main", "www"]))
    throw new Error("Parity requires dev, main, and www");
  const authority = authorizationSection(lanes.dev);
  for (const [lane, text] of Object.entries(lanes)) {
    if (authorizationSection(text) !== authority)
      throw new Error(lane + ": authorization model drift");
    for (const stop of COMMON_STOPS)
      if (!text.includes(stop))
        throw new Error(lane + ": missing universal safety stop: " + stop);
    if (lane === "www") {
      if (
        !text.includes("It requires Level 6 or 7.") ||
        !text.includes(
          "Never base website work on `dev`, merge `dev` into `www`",
        )
      )
        throw new Error("www: missing production or lane separation gate");
    } else {
      if (
        !text.includes("### Provider fingerprinting stop sign") ||
        !text.includes("freed-library-core/SKILL.md")
      )
        throw new Error(lane + ": missing product authority routing");
    }
  }
  return names;
}

function main() {
  if (process.argv.length === 3 && process.argv[2] === "--lanes") {
    const lanes = {};
    for (const lane of ["dev", "main", "www"]) {
      const ref = "origin/" + lane;
      const sha = execFileSync(
        "git",
        ["rev-parse", "--verify", ref + "^{commit}"],
        { cwd: repoRoot, encoding: "utf8" },
      ).trim();
      lanes[lane] = execFileSync("git", ["show", sha + ":AGENTS.md"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      process.stdout.write(lane + ": " + sha + "\n");
    }
    validateLaneParity(lanes);
    process.stdout.write(
      "Universal lane parity verified against these local fetched refs.\n",
    );
    return;
  }
  if (process.argv.length !== 2)
    throw new Error(
      "Usage: node scripts/validate-instruction-routing.mjs [--lanes]",
    );
  validateContractRoutes();
  for (const report of validateRoutingFixtures())
    process.stdout.write(
      report.id + ": " + report.bytes.toLocaleString() + " bytes\n",
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
