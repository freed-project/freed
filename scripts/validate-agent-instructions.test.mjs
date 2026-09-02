import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARCHITECTURE_GUIDE,
  CODEOWNERS_FILE,
  validateAgentInstructions,
} from "./validate-agent-instructions.mjs";

const VALID_GUIDE = `# Guide

\`\`\`yaml
policy:
  allow_implicit_invocation: true
\`\`\`
`;

const VALID_CODEOWNERS = `
/AGENTS.md @AubreyF
**/AGENTS.md @AubreyF
**/AGENTS.override.md @AubreyF
`;

function fixture(t) {
  const repoRoot = mkdtempSync(
    path.join(tmpdir(), "freed-agent-instructions-"),
  );
  t.after(() => rmSync(repoRoot, { force: true, recursive: true }));
  write(repoRoot, ARCHITECTURE_GUIDE, VALID_GUIDE);
  write(repoRoot, CODEOWNERS_FILE, VALID_CODEOWNERS);
  return repoRoot;
}

function write(repoRoot, relativeFile, text) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  mkdirSync(path.dirname(absoluteFile), { recursive: true });
  writeFileSync(absoluteFile, text);
}

function validate(repoRoot, overrides = {}) {
  return validateAgentInstructions({
    repoRoot,
    requiredFiles: [],
    maxRootBytes: 128,
    maxScopedBytes: 128,
    maxChainBytes: 256,
    ...overrides,
  });
}

test("accepts bounded root and scoped instructions at the exact chain limit", (t) => {
  const repoRoot = fixture(t);
  const root = "Root\n[UI](packages/ui/AGENTS.md)\n";
  const scoped = "UI rules\n";
  write(repoRoot, "AGENTS.md", root);
  write(repoRoot, "packages/ui/AGENTS.md", scoped);

  const result = validate(repoRoot, {
    requiredFiles: ["packages/ui/AGENTS.md"],
    maxRootBytes: Buffer.byteLength(root),
    maxScopedBytes: Buffer.byteLength(scoped),
    maxChainBytes: Buffer.byteLength(root) + Buffer.byteLength(scoped),
  });

  assert.equal(result.records.length, 2);
  assert.deepEqual(
    result.supplementalRecords.map((record) => record.relativeFile),
    [ARCHITECTURE_GUIDE, CODEOWNERS_FILE],
  );
  assert.deepEqual(result.largestChain, {
    relativeFile: "packages/ui/AGENTS.md",
    bytes: Buffer.byteLength(root) + Buffer.byteLength(scoped),
  });
});

test("rejects an oversized root", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "12345");
  assert.throws(
    () => validate(repoRoot, { maxRootBytes: 4 }),
    /exceeds the 4 byte root instruction limit/,
  );
});

test("rejects an oversized scoped file", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "Root\n");
  write(repoRoot, "packages/ui/AGENTS.md", "12345");
  assert.throws(
    () => validate(repoRoot, { maxScopedBytes: 4 }),
    /exceeds the 4 byte scoped instruction limit/,
  );
});

test("rejects an oversized nested instruction chain", (t) => {
  const repoRoot = fixture(t);
  const root = "root\n[packages](packages/AGENTS.md)\n";
  const packages = "packages\n[ui](ui/AGENTS.md)\n";
  const ui = "ui\n";
  const chainBytes =
    Buffer.byteLength(root) +
    Buffer.byteLength(packages) +
    Buffer.byteLength(ui);
  write(repoRoot, "AGENTS.md", root);
  write(repoRoot, "packages/AGENTS.md", packages);
  write(repoRoot, "packages/ui/AGENTS.md", ui);
  assert.throws(
    () => validate(repoRoot, { maxChainBytes: chainBytes - 1 }),
    new RegExp("instruction chain is " + chainBytes + " bytes"),
  );
});

test("rejects two instruction files in one directory", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "root\n");
  write(repoRoot, "AGENTS.override.md", "override\n");
  assert.throws(
    () => validate(repoRoot),
    /keep only one of AGENTS\.md or AGENTS\.override\.md/,
  );
});

test("requires root routing to every declared scoped file", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "root\n");
  write(repoRoot, "packages/ui/AGENTS.md", "ui\n");
  assert.throws(
    () =>
      validate(repoRoot, {
        requiredFiles: ["packages/ui/AGENTS.md"],
      }),
    /must link required scoped instructions packages\/ui\/AGENTS\.md/,
  );
});

test("rejects an orphaned scoped instruction file", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "root\n");
  write(repoRoot, "packages/ui/AGENTS.md", "ui\n");
  assert.throws(
    () => validate(repoRoot),
    /must be reachable from root AGENTS\.md: packages\/ui\/AGENTS\.md/,
  );
});

test("does not accept instruction routing through an unrelated sibling", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "[Docs](docs/AGENTS.md)\n");
  write(
    repoRoot,
    "docs/AGENTS.md",
    "[Unrelated UI scope](../packages/ui/AGENTS.md)\n",
  );
  write(repoRoot, "packages/ui/AGENTS.md", "ui\n");
  assert.throws(
    () => validate(repoRoot),
    /must be reachable from root AGENTS\.md: packages\/ui\/AGENTS\.md/,
  );
});

test("rejects symlinked instruction files and local link targets", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "root\n");
  write(repoRoot, "rules.md", "rules\n");
  mkdirSync(path.join(repoRoot, "packages", "ui"), { recursive: true });
  symlinkSync(
    path.join(repoRoot, "rules.md"),
    path.join(repoRoot, "packages", "ui", "AGENTS.md"),
  );
  assert.throws(
    () => validate(repoRoot),
    /instruction files cannot be symbolic links/,
  );

  rmSync(path.join(repoRoot, "packages", "ui", "AGENTS.md"));
  symlinkSync(
    path.join(repoRoot, "rules.md"),
    path.join(repoRoot, "linked-rules.md"),
  );
  write(repoRoot, "AGENTS.md", "[Rules](linked-rules.md)\n");
  assert.throws(
    () => validate(repoRoot),
    /local links cannot target a symbolic link/,
  );
});

test("rejects unresolved links and prohibited punctuation", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "[missing](docs/missing.md)\n");
  assert.throws(() => validate(repoRoot), /unresolved local link/);

  write(repoRoot, "AGENTS.md", "bad \u2014 punctuation\n");
  assert.throws(() => validate(repoRoot), /em or en dashes/);
});

test("validates the architecture guide links, punctuation, and policy example", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "root\n");
  write(
    repoRoot,
    ARCHITECTURE_GUIDE,
    VALID_GUIDE.replace("# Guide", "# Guide\n\n[Missing](missing.md)"),
  );
  assert.throws(() => validate(repoRoot), /unresolved local link/);

  write(
    repoRoot,
    ARCHITECTURE_GUIDE,
    VALID_GUIDE.replace("# Guide", "# Guide\n\nBad \u2014 punctuation."),
  );
  assert.throws(() => validate(repoRoot), /em or en dashes/);

  write(
    repoRoot,
    ARCHITECTURE_GUIDE,
    VALID_GUIDE.replace(
      "  allow_implicit_invocation",
      "allow_implicit_invocation",
    ),
  );
  assert.throws(
    () => validate(repoRoot),
    /allow_implicit_invocation indented two spaces under policy/,
  );
});

test("requires root and descendant instruction CODEOWNER rules", (t) => {
  const repoRoot = fixture(t);
  write(repoRoot, "AGENTS.md", "root\n");
  for (const missingRule of [
    "/AGENTS.md @AubreyF",
    "**/AGENTS.md @AubreyF",
    "**/AGENTS.override.md @AubreyF",
  ]) {
    write(
      repoRoot,
      CODEOWNERS_FILE,
      VALID_CODEOWNERS.replace(missingRule + "\n", ""),
    );
    assert.throws(
      () => validate(repoRoot),
      new RegExp(missingRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});
