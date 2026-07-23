import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateSkillDirectory, validateSkills } from "./validate-skills.mjs";

test("checked-in Freed skills keep safe invocation and resolvable commands", () => {
  const skills = validateSkills();
  assert.equal(skills.length, 12);
  assert.ok(
    skills.some((skill) => skill.name === "freed-stability-controller"),
  );
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
