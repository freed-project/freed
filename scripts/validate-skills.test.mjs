import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateSkillDirectory, validateSkills } from "./validate-skills.mjs";

test("checked-in Freed skills keep safe invocation and resolvable commands", () => {
  const skills = validateSkills();
  const skillNames = new Set(skills.map((skill) => skill.name));
  for (const requiredName of [
    "freed-build-feature",
    "freed-build-www",
    "freed-canary",
    "freed-evidence-capture",
    "freed-library-core",
    "freed-memory-profile",
    "freed-provider-risk-review",
    "freed-ship-build",
    "freed-ship-www",
    "freed-soak",
    "freed-stability-controller",
    "freed-sync-replay",
    "freed-triage",
  ]) {
    assert.ok(skillNames.has(requiredName), requiredName);
  }
});

test("skill validation rejects automatic invocation and missing commands", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-skill-validator-"));
  const skillDir = path.join(root, ".agents", "skills", "unsafe-skill");
  mkdirSync(path.join(skillDir, "agents"), { recursive: true });
  writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: unsafe-skill\ndescription: Unsafe fixture\ndisable-model-invocation: false\n---\n\nRun \`node scripts/missing.mjs\`.\n`,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Unsafe"\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n`,
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /disable-model-invocation must remain true/,
  );
  const skillText = readFileSync(
    path.join(skillDir, "SKILL.md"),
    "utf8",
  ).replace(
    "disable-model-invocation: false",
    "disable-model-invocation: true",
  );
  writeFileSync(path.join(skillDir, "SKILL.md"), skillText);
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /referenced command does not exist/,
  );
});

test("skill validation rejects top-level skill directories without SKILL.md", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-skill-directory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skillsDir = path.join(root, ".agents", "skills");
  const skillDir = path.join(skillsDir, "openai-only");
  mkdirSync(path.join(skillDir, "agents"), { recursive: true });
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Incomplete"\n  short_description: "Fixture"\n  default_prompt: "Use $openai-only."\n`,
  );

  assert.throws(
    () => validateSkills({ skillsDir, repoRoot: root }),
    /missing SKILL\.md/,
  );
});
