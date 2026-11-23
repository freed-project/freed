#!/usr/bin/env node
// Copies Vorton's generated theme reference into Freed and records where it came from.
//
// Vorton authors the six shared themes and generates web/design/theme-reference.json from its
// stylesheet. Freed vendors committed checkout bytes or an explicitly verified supplied file.
// The drift test in packages/ui/src/lib/theme-shell-css.test.ts compares Freed's palettes
// against the vendored copy and checks the copy against the recorded hash.
//
// Usage:
//   node scripts/sync-vorton-theme-reference.mjs --from <vorton-checkout> [--rev <commit-ish>]
//   node scripts/sync-vorton-theme-reference.mjs --file <reference.json> --commit <full-sha> --sha256 <expected-hash>
//
// --rev defaults to HEAD of the checkout. The file is read from the commit with `git show`, so a
// dirty working tree in Vorton never leaks into Freed.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REFERENCE_PATH = "web/design/theme-reference.json";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, "packages/ui/src/theme-reference");
export const REFERENCE_FILE = "vorton-theme-reference.json";
export const SOURCE_FILE = "vorton-theme-reference.source.json";
export const REQUIRED_THEMES = [
  "starship-light",
  "starship-dark",
  "scriptorium",
  "midas",
  "ember",
  "neon",
];

export function parseArgs(argv) {
  const options = { from: null, rev: "HEAD", to: DEFAULT_TARGET_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (["--from", "--rev", "--to", "--file", "--commit", "--sha256"].includes(arg)) {
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  validateInput(options);
  return options;
}

/** Supplied bytes require explicit provenance; never invent a source checkout. */
function validateInput({ from, file, commit, sha256: expectedHash, rev }) {
  if (Boolean(from) === Boolean(file)) throw new Error("Provide exactly one of --from or --file.");
  if (file) {
    if (rev && rev !== "HEAD") throw new Error("--rev is only supported with --from.");
    if (!/^[0-9a-f]{40}$/.test(commit ?? "")) throw new Error("--commit requires a full lowercase source commit SHA.");
    if (!/^[0-9a-f]{64}$/.test(expectedHash ?? "")) throw new Error("--sha256 requires the expected lowercase SHA-256.");
  } else if (commit !== undefined || expectedHash !== undefined) {
    throw new Error("--commit and --sha256 require --file.");
  }
}

/** Fails closed on anything that is not a schema 1 reference with all six themes. */
export function validateReference(text) {
  let reference;
  try {
    reference = JSON.parse(text);
  } catch (error) {
    throw new Error(`${REFERENCE_PATH} is not valid JSON: ${error.message}`);
  }
  if (reference?.schema !== 1) throw new Error(`Unsupported theme reference schema: ${reference?.schema}`);
  for (const theme of REQUIRED_THEMES) {
    const entry = reference.themes?.[theme];
    if (!entry?.roles || !entry?.palette) throw new Error(`Theme reference is missing ${theme}.`);
  }
  return reference;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function syncReference(options) {
  validateInput(options);
  const { from, rev = "HEAD", to, file, commit: suppliedCommit, sha256: expectedHash } = options;
  const git = (...args) =>
    execFileSync("git", ["-C", from, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const commit = file ? suppliedCommit : git("rev-parse", "--verify", `${rev}^{commit}`).trim();
  const text = file ? readFileSync(file) : git("show", `${commit}:${REFERENCE_PATH}`);
  const hash = sha256(text);
  if (file && hash !== expectedHash) throw new Error("Reference SHA-256 does not match --sha256.");
  validateReference(text);
  const record = {
    source: "vorton",
    path: REFERENCE_PATH,
    commit,
    sha256: hash,
  };
  mkdirSync(to, { recursive: true });
  writeFileSync(path.join(to, REFERENCE_FILE), text);
  writeFileSync(path.join(to, SOURCE_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const record = syncReference(parseArgs(process.argv.slice(2)));
    console.log(`Vendored Vorton theme reference ${record.commit.slice(0, 12)} (sha256 ${record.sha256.slice(0, 12)}).`);
    console.log("Run the theme drift test next: it names every Freed value the new reference changes.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
