import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

if (
  typeof process.env.NODE_TEST_CONTEXT !== "string" ||
  process.env.NODE_TEST_CONTEXT === ""
) {
  throw new Error("The lease archive Python fixture is test-only.");
}

const sourceCandidates = [
  process.env.FREED_TEST_SOURCE_PYTHON_RUNTIME,
  "/usr/bin/python3",
  "/usr/local/bin/python3",
].filter((candidate) => typeof candidate === "string" && candidate !== "");
const source = sourceCandidates.find((candidate) => existsSync(candidate));
if (source === undefined) {
  throw new Error("A Python 3 runtime is required for lease archive tests.");
}

const root = realpathSync(
  mkdtempSync(path.join(os.tmpdir(), "freed-lease-python-runtime-")),
);
const bin = path.join(root, "bin");
const runtime = path.join(bin, "python3");
chmodSync(root, 0o700);
mkdirSync(bin, { mode: 0o755 });
const sourceRuntime = realpathSync(source);
const quotedSource = `'${sourceRuntime.replaceAll("'", `'\"'\"'`)}'`;
writeFileSync(runtime, `#!/bin/sh\nexec ${quotedSource} "$@"\n`, {
  mode: 0o755,
});

process.env.FREED_TEST_LEASE_ARCHIVE_PYTHON_RUNTIME = runtime;
process.env.FREED_TEST_LEASE_ARCHIVE_PYTHON_ROOT = root;
process.env.FREED_TEST_LEASE_ARCHIVE_PYTHON_UID = String(process.getuid());

process.once("exit", () => {
  rmSync(root, { recursive: true, force: true });
});
