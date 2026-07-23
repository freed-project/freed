#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const SKILLS_DIR = path.join(REPO_ROOT, ".agents", "skills");

function parseFrontmatter(text, file) {
  const match = String(text).match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${file}: missing YAML frontmatter.`);
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-z0-9-]+):\s*(.*)$/i);
    if (!field)
      throw new Error(`${file}: unsupported frontmatter line ${line}.`);
    if (Object.hasOwn(fields, field[1])) {
      throw new Error(`${file}: duplicate frontmatter field ${field[1]}.`);
    }
    fields[field[1]] = field[2].trim();
  }
  return fields;
}

function checkedInPath(repoRoot, skillDir, reference) {
  const withoutAnchor = reference.split("#", 1)[0];
  if (!withoutAnchor || /^(?:https?:|mailto:)/.test(withoutAnchor)) return null;
  return path.resolve(skillDir, withoutAnchor);
}

export function validateSkillDirectory(
  skillDir,
  { repoRoot = REPO_ROOT } = {},
) {
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) throw new Error(`${skillDir}: missing SKILL.md.`);
  const text = readFileSync(skillFile, "utf8");
  const fields = parseFrontmatter(text, skillFile);
  const expectedName = path.basename(skillDir);
  if (fields.name !== expectedName) {
    throw new Error(`${skillFile}: name must match directory ${expectedName}.`);
  }
  if (!fields.description)
    throw new Error(`${skillFile}: description is required.`);
  if (fields["disable-model-invocation"] !== "true") {
    throw new Error(`${skillFile}: disable-model-invocation must remain true.`);
  }
  if (/[\u2013\u2014]/.test(text)) {
    throw new Error(
      `${skillFile}: use standard punctuation instead of em or en dashes.`,
    );
  }
  if (text.includes("freed.wtf/app")) {
    throw new Error(`${skillFile}: the PWA URL must be app.freed.wtf.`);
  }
  const agentFile = path.join(skillDir, "agents", "openai.yaml");
  if (!existsSync(agentFile))
    throw new Error(`${skillDir}: missing agents/openai.yaml.`);
  const agentText = readFileSync(agentFile, "utf8");
  for (const field of ["display_name", "short_description", "default_prompt"]) {
    if (!new RegExp(`^\\s*${field}:\\s*.+$`, "m").test(agentText)) {
      throw new Error(`${agentFile}: interface.${field} is required.`);
    }
  }
  if (!agentText.includes(`$${expectedName}`)) {
    throw new Error(
      `${agentFile}: default_prompt must invoke $${expectedName}.`,
    );
  }

  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const reference of links) {
    const resolved = checkedInPath(repoRoot, skillDir, reference);
    if (
      resolved &&
      (!resolved.startsWith(`${path.resolve(repoRoot)}${path.sep}`) ||
        !existsSync(resolved))
    ) {
      throw new Error(`${skillFile}: unresolved checked-in link ${reference}.`);
    }
  }
  const commands = [
    ...text.matchAll(/(?:node\s+|\.\/)(scripts\/[A-Za-z0-9._/-]+)/g),
  ].map((match) => match[1]);
  for (const command of commands) {
    if (!existsSync(path.join(repoRoot, command))) {
      throw new Error(
        `${skillFile}: referenced command does not exist: ${command}.`,
      );
    }
  }
  return { name: expectedName, skillFile, agentFile };
}

export function validateSkills({
  skillsDir = SKILLS_DIR,
  repoRoot = REPO_ROOT,
} = {}) {
  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsDir, entry.name))
    .filter((directory) => existsSync(path.join(directory, "SKILL.md")))
    .sort();
  if (skillDirs.length === 0)
    throw new Error(`No skills found in ${skillsDir}.`);
  return skillDirs.map((skillDir) =>
    validateSkillDirectory(skillDir, { repoRoot }),
  );
}

function main() {
  const skills = validateSkills();
  process.stdout.write(
    `Validated ${skills.length.toLocaleString()} Freed skills.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
