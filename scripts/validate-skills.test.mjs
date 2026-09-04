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

import {
  MAX_SKILL_BYTES,
  validateSkillDirectory,
  validateSkills,
} from "./validate-skills.mjs";

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
    "freed-ui-polish",
  ]) {
    assert.ok(skillNames.has(requiredName), requiredName);
  }
});

test("feature tasks refresh policy before owner authorization", () => {
  const agentInstructions = readFileSync(
    new URL("../AGENTS.md", import.meta.url),
    "utf8",
  );
  const featureSkill = readFileSync(
    new URL("../.agents/skills/freed-build-feature/SKILL.md", import.meta.url),
    "utf8",
  );

  assert.ok(
    agentInstructions.indexOf("## Task startup freshness") <
      agentInstructions.indexOf("## Authorization levels"),
    "startup freshness must precede the authorization policy",
  );
  assert.match(agentInstructions, /git show <remote-ref>:AGENTS\.md/);
  assert.match(
    agentInstructions,
    /Internal (?:actor )?labels[\s\S]*never replace/,
  );
  assert.ok(
    featureSkill.indexOf("## Start from current policy") <
      featureSkill.indexOf("## Establish the contract"),
    "the feature skill must refresh policy before establishing authority",
  );
  assert.match(featureSkill, /git show origin\/dev:AGENTS\.md/);
  assert.match(
    featureSkill,
    /must never be presented as owner authorization choices/,
  );
});

test("skill validation requires the supported implicit invocation policy", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-skill-validator-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skillDir = path.join(root, ".agents", "skills", "unsafe-skill");
  mkdirSync(path.join(skillDir, "agents"), { recursive: true });
  writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: unsafe-skill\ndescription: Unsafe fixture\ndisable-model-invocation: true\n---\n\nRun \`node scripts/missing.mjs\`.\n`,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Unsafe"\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n\npolicy:\n  allow_implicit_invocation: true\n`,
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /remove legacy disable-model-invocation/,
  );
  const skillText = readFileSync(
    path.join(skillDir, "SKILL.md"),
    "utf8",
  ).replace("disable-model-invocation: true\n", "");
  writeFileSync(
    path.join(skillDir, "SKILL.md"),
    skillText.replace(
      "description: Unsafe fixture\n",
      "description: Unsafe fixture\nallow-implicit-invocation: true\n",
    ),
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /frontmatter allows only name and description/,
  );
  writeFileSync(
    path.join(skillDir, "SKILL.md"),
    skillText.replace(
      "description: Unsafe fixture",
      "description:\n  nested: value",
    ),
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /name and description must be strings/,
  );
  writeFileSync(path.join(skillDir, "SKILL.md"), skillText);
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Unsafe"\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n`,
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /one top-level policy block is required/,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `display_name: "Misplaced"\ninterface:\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n\npolicy:\n  allow_implicit_invocation: true\n`,
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /interface\.display_name is required/,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Unclosed\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n\npolicy:\n  allow_implicit_invocation: true\n`,
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /invalid configuration YAML/,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Unsafe"\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n\npolicy:\n  allow_implicit_invocation: true\npolicy: { allow_implicit_invocation: false }\n`,
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /invalid configuration YAML/,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Unsafe"\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n\npolicy:\n  allow_implicit_invocation: false\n`,
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /policy\.allow_implicit_invocation must be explicitly true/,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Unsafe"\n  short_description: "Fixture"\n  default_prompt: "Use $unsafe-skill."\n\npolicy:\n  allow_implicit_invocation: true\n`,
  );
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

test("skill entrypoints may reach but not exceed 16 KiB", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-skill-size-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skillDir = path.join(root, ".agents", "skills", "bounded-skill");
  mkdirSync(path.join(skillDir, "agents"), { recursive: true });
  const skillPrefix =
    "---\nname: bounded-skill\ndescription: Boundary fixture\n---\n\n";
  const exactLimit =
    skillPrefix +
    "x".repeat(MAX_SKILL_BYTES - Buffer.byteLength(skillPrefix, "utf8"));
  writeFileSync(path.join(skillDir, "SKILL.md"), exactLimit);
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Bounded"\n  short_description: "Fixture"\n  default_prompt: "Use $bounded-skill."\n\npolicy:\n  allow_implicit_invocation: true\n`,
  );

  assert.doesNotThrow(() =>
    validateSkillDirectory(skillDir, { repoRoot: root }),
  );
  writeFileSync(path.join(skillDir, "SKILL.md"), `${exactLimit}x`);
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /entrypoints must be at most .* bytes/,
  );
});

test("direct Markdown references receive portable content and link checks", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-skill-reference-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skillDir = path.join(root, ".agents", "skills", "reference-skill");
  const referencesDir = path.join(skillDir, "references");
  const referenceFile = path.join(referencesDir, "detail.md");
  mkdirSync(path.join(skillDir, "agents"), { recursive: true });
  mkdirSync(referencesDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: reference-skill\ndescription: Reference fixture\n---\n\nRead [the detail](references/detail.md).\n`,
  );
  writeFileSync(
    path.join(skillDir, "agents", "openai.yaml"),
    `interface:\n  display_name: "Reference"\n  short_description: "Fixture"\n  default_prompt: "Use $reference-skill."\n\npolicy:\n  allow_implicit_invocation: true\n`,
  );
  writeFileSync(
    referenceFile,
    `# Detail\n\n[Existing file](../SKILL.md)\n\n${"x".repeat(MAX_SKILL_BYTES + 1)}\n`,
  );

  const validated = validateSkillDirectory(skillDir, { repoRoot: root });
  assert.deepEqual(validated.referenceFiles, [referenceFile]);

  const orphanedReference = path.join(referencesDir, "orphaned.md");
  writeFileSync(orphanedReference, "# Orphaned\n");
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /every Markdown file under references\/ must be linked directly from SKILL\.md/,
  );
  rmSync(orphanedReference);

  writeFileSync(
    referenceFile,
    "# Detail\n\nThis contains an em dash \u2014 here.\n",
  );
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /use standard punctuation instead of em or en dashes/,
  );
  writeFileSync(referenceFile, "# Detail\n\nVisit freed.wtf/app.\n");
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /the PWA URL must be app\.freed\.wtf/,
  );
  writeFileSync(referenceFile, "# Detail\n\n[Missing](missing.md)\n");
  assert.throws(
    () => validateSkillDirectory(skillDir, { repoRoot: root }),
    /unresolved checked-in link missing\.md/,
  );
});
