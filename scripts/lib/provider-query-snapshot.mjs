// Snapshot the publication candidate into caller-owned temporary Git storage.
// No source index, object, ref, lease, or publication operation is written.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, openSync,
  readFileSync, readlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

const [base, includeUntracked, temporary] = process.argv.slice(2);
const git = (args, options = {}) => execFileSync(
  "git", ["-c", "core.fsmonitor=false", "-c", "core.splitIndex=false", ...args],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options },
);
const fail = (message) => { throw new Error(message); };
if (!temporary || process.env.GIT_OBJECT_DIRECTORY !== path.join(temporary, "objects")) {
  fail("The query requires caller-owned temporary object storage.");
}
const root = git(["rev-parse", "--show-toplevel"]).trim();
process.chdir(root);
const config = git(["config", "--list"]);
if (/^(extensions\.partialclone|remote\..*\.promisor)=/im.test(config)) {
  fail("Partial clones are not supported by this offline query.");
}
const baseRef = `refs/remotes/origin/${base}`;
let baseSha;
try {
  baseSha = git(["rev-parse", "--verify", `${baseRef}^{commit}`]).trim();
} catch {
  fail(`Missing local ${baseRef}; fetch the intended base explicitly before querying.`);
}
const head = git(["rev-parse", "HEAD"]).trim();
const mergeBases = git(["merge-base", "--all", baseSha, head]).trim().split("\n");
if (mergeBases.length !== 1) fail("Ambiguous merge base; query refused.");
const indexPath = git(["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim();
const index = readFileSync(indexPath);
if (git(["rev-parse", "--shared-index-path"]).trim()) fail("Split indexes are not supported by this read-only query.");
const entries = git(["ls-files", "--stage", "-z"]).split("\0").filter(Boolean);
if (entries.some((entry) => !/^\d+ [a-f0-9]+ 0\t/.test(entry) || entry.startsWith("160000 "))) {
  fail("Unmerged entries or submodules are ambiguous query candidates.");
}
if (git(["ls-files", "-v", "-z"]).split("\0").some((entry) => /^[a-zS]/.test(entry))) {
  fail("Sparse or assume-unchanged entries are not supported by this read-only query.");
}
const tracked = entries.map((entry) => entry.slice(entry.indexOf("\t") + 1));
const untracked = () => git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
const newFiles = untracked();
if (newFiles.length && includeUntracked !== "true") {
  fail("Untracked files are present. Stage intentional new files explicitly, ignore local junk, or re-run with --include-untracked.");
}
const files = [...new Set([...tracked, ...newFiles])].sort();
// The existing classifier and rename binder use newline-delimited paths.
const baseFiles = git(["ls-tree", "-r", "--name-only", "-z", mergeBases[0]]).split("\0").filter(Boolean);
if ([...files, ...baseFiles].some((file) => /[\r\n\t"\\\x80-\uffff]/.test(file) || file.trim() !== file)) {
  fail("Candidate paths cannot be represented unambiguously by the provider classifier.");
}
const attributes = git(["check-attr", "-z", "--stdin", "filter"], { input: `${files.join("\0")}\0` }).split("\0");
for (let i = 2; i < attributes.length; i += 3) {
  if (!["unspecified", "unset"].includes(attributes[i])) fail("External clean filters are not allowed in a read-only query.");
}
const metadata = (stat) =>
  `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const changed = (file) => fail(`Source changed during the read-only snapshot: ${file}`);
const requireSameFile = (before, after, file) => {
  if (metadata(before) !== metadata(after)) changed(file);
};
const readRegularFile = (file, expected) => {
  // Bind this leaf read to the checked regular inode. NONBLOCK prevents a
  // concurrent FIFO substitution from hanging before fstat can reject it.
  // NOFOLLOW covers only the leaf, not ancestors. This classification query
  // is not a filesystem sandbox or an atomic snapshot against hostile writers.
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) {
    fail("This platform cannot safely open candidate files without following leaf symlinks.");
  }
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) changed(file);
    requireSameFile(expected, opened, file);
    const content = readFileSync(fd);
    requireSameFile(opened, fstatSync(fd, { bigint: true }), file);
    requireSameFile(opened, lstatSync(file, { bigint: true }), file);
    return content;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};
const fingerprint = () => {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file}\0`);
    let stat;
    try {
      stat = lstatSync(file, { bigint: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("missing");
      continue;
    }
    hash.update(`${metadata(stat)}\0`);
    // Only an initially absent path is a deletion. Disappearance after the
    // initial inspection is a concurrent change, including in the last pass.
    if (stat.isSymbolicLink()) {
      hash.update(readlinkSync(file, { encoding: "buffer" }));
      requireSameFile(stat, lstatSync(file, { bigint: true }), file);
    } else if (stat.isFile()) {
      hash.update(readRegularFile(file, stat));
    } else {
      fail(`Unsupported candidate file type: ${file}`);
    }
  }
  return hash.digest("hex");
};
const before = fingerprint();
const privateIndex = path.join(temporary, "index");
writeFileSync(privateIndex, index, { mode: 0o600 });
const privateEnv = { ...process.env, GIT_INDEX_FILE: privateIndex };
// Git applies ordinary line-ending/attribute normalization, but external clean
// filters are rejected above. Writes go only to the private index/object store.
// Git reads the worktree independently; the second fingerprint detects tested
// intervening changes, but cannot make those separate reads an atomic snapshot.
git(["add", includeUntracked === "true" ? "-A" : "-u"], { env: privateEnv });
const tree = git(["write-tree"], { env: privateEnv }).trim();
if (before !== fingerprint() || !index.equals(readFileSync(indexPath)) ||
    JSON.stringify(newFiles) !== JSON.stringify(untracked()) ||
    head !== git(["rev-parse", "HEAD"]).trim() ||
    baseSha !== git(["rev-parse", "--verify", `${baseRef}^{commit}`]).trim()) {
  fail("Source changed during the read-only snapshot; retry against a stable candidate.");
}
process.stderr.write(`Local base ${baseRef}=${baseSha}; merge base ${mergeBases[0]}.\n`);
process.stdout.write(`${mergeBases[0]} ${tree}\n`);
