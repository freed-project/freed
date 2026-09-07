#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const NAME = "TASK-DECISIONS.local.md";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function git(root, args, gitBin = "git", allowed = [0]) {
  const result = spawnSync(gitBin, ["-C", root, ...args], { encoding: "utf8" });
  if (!allowed.includes(result.status)) {
    // Git output can contain private paths or content. Report only the operation.
    throw new Error(`Decision log check failed: git ${args[0]}.`);
  }
  return result;
}

function readLog(root) {
  const file = path.join(root, NAME);
  if (!fs.existsSync(file) && !fs.lstatSync(file, { throwIfNoEntry: false })) return null;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) {
      throw new Error("Decision log must be a regular, bounded, unlinked file.");
    }
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Enforce privacy without printing or interpreting the owner's decision record. */
export function checkDecisions(root, { base, required = false, gitBin = "git" } = {}) {
  root = fs.realpathSync(root);
  if (git(root, ["ls-files", "--", NAME], gitBin).stdout.trim()) {
    throw new Error("Private decision log is tracked or staged. Remove it from the index before publication.");
  }
  if (base && git(root, ["rev-list", `${base}..HEAD`, "--", NAME], gitBin).stdout.trim()) {
    throw new Error("Outgoing history contains the private decision log. Remove it from outgoing commits before publication.");
  }
  const contents = readLog(root);
  if (contents !== null && git(root, ["check-ignore", "--quiet", "--", NAME], gitBin, [0, 1]).status !== 0) {
    throw new Error("Private decision log must be Git-ignored before publication.");
  }
  if (required && !contents?.toString("utf8").trim()) {
    throw new Error("Ready publication requires a nonempty TASK-DECISIONS.local.md. Initialize it and record the task's decisions or state that no material trade-offs arose.");
  }
  return contents;
}

/** Initialize only absent logs; never replace a task's existing decisions. */
export function initDecisions(root, { gitBin = "git" } = {}) {
  root = fs.realpathSync(root);
  checkDecisions(root, { gitBin });
  if (readLog(root) !== null) return path.join(root, NAME);
  if (git(root, ["check-ignore", "--quiet", "--", NAME], gitBin, [0, 1]).status !== 0) {
    throw new Error("Add TASK-DECISIONS.local.md to the repository ignore policy before initialization.");
  }
  const file = path.join(root, NAME);
  fs.writeFileSync(file, "# Task decisions\n\n## Review summary\nRecord meaningful choices and unresolved items as work proceeds.\n\n## Decisions\n\n## Validation and delivery\n", { flag: "wx", mode: 0o600 });
  return file;
}

function privateDirectory(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    if (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("Decision archive path must not contain symbolic links.");
    }
  }
  fs.chmodSync(absolute, 0o700);
  return absolute;
}

/** Preserve a verified private copy before the caller removes a worktree. */
export function preserveDecisions(root, { archiveRoot = path.join(os.homedir(), ".freed", "task-decisions"), gitBin = "git" } = {}) {
  root = fs.realpathSync(root);
  const contents = checkDecisions(root, { gitBin });
  if (contents === null) return null;
  const destination = path.resolve(archiveRoot);
  if (destination === root || destination.startsWith(root + path.sep)) {
    throw new Error("Decision archive must be outside the worktree.");
  }
  const directory = privateDirectory(destination);
  const file = path.join(directory, `${digest(root).slice(0, 12)}-${digest(contents)}.md`);
  try { fs.writeFileSync(file, contents, { flag: "wx", mode: 0o600 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || !fs.readFileSync(file).equals(contents)) {
    throw new Error("Decision archive verification failed; retain the worktree.");
  }
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let root = process.cwd();
    const options = {};
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "--required") { options.required = true; continue; }
      if (!["--worktree", "--base", "--archive-root", "--git-bin"].includes(arg) || !args[index + 1]) throw new Error("Invalid decision log argument.");
      const value = args[++index];
      if (arg === "--worktree") root = value;
      else options[{ "--base": "base", "--archive-root": "archiveRoot", "--git-bin": "gitBin" }[arg]] = value;
    }
    if (command === "init") console.log(`Decision log: ${initDecisions(root, options)}`);
    else if (command === "check") { checkDecisions(root, options); console.log("Decision log privacy check passed."); }
    else if (command === "preserve") console.log(preserveDecisions(root, options) ?? "No decision log to preserve.");
    else throw new Error("Use init, check, or preserve.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
