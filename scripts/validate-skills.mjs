#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const SKILLS_DIR = path.join(REPO_ROOT, ".agents", "skills");
export const MAX_SKILL_BYTES = 16 * 1024;

function parseYamlMapping(text, file, label) {
  let value;
  try {
    value = yaml.load(text);
  } catch (error) {
    throw new Error(
      `${file}: invalid ${label} YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file}: ${label} must be a YAML mapping.`);
  }
  return value;
}

function parseFrontmatter(text, file) {
  const match = String(text).match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${file}: missing YAML frontmatter.`);
  return parseYamlMapping(match[1], file, "frontmatter");
}

function checkedInPath(sourceDir, reference) {
  const withoutFragment = reference.split(/[?#]/, 1)[0];
  if (!withoutFragment || /^[a-z][a-z0-9+.-]*:/i.test(withoutFragment)) {
    return null;
  }
  return path.resolve(sourceDir, withoutFragment);
}

function collectMarkdownFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(absolutePath));
    } else if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name)) {
      files.push(path.resolve(absolutePath));
    }
  }
  return files.sort();
}

function validatePortableMarkdown(text, file) {
  if (/[\u2013\u2014]/.test(text)) {
    throw new Error(
      `${file}: use standard punctuation instead of em or en dashes.`,
    );
  }
  if (text.includes("freed.wtf/app")) {
    throw new Error(`${file}: the PWA URL must be app.freed.wtf.`);
  }
}

function validateLocalLinks(text, file, repoRoot) {
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
  const resolvedLinks = [];
  for (const reference of links) {
    const resolved = checkedInPath(path.dirname(file), reference);
    if (
      resolved &&
      (!resolved.startsWith(`${path.resolve(repoRoot)}${path.sep}`) ||
        !existsSync(resolved))
    ) {
      throw new Error(`${file}: unresolved checked-in link ${reference}.`);
    }
    if (resolved) resolvedLinks.push(resolved);
  }
  return resolvedLinks;
}

export function validateSkillDirectory(
  skillDir,
  { repoRoot = REPO_ROOT } = {},
) {
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) throw new Error(`${skillDir}: missing SKILL.md.`);
  const text = readFileSync(skillFile, "utf8");
  const skillBytes = Buffer.byteLength(text, "utf8");
  if (skillBytes > MAX_SKILL_BYTES) {
    throw new Error(
      `${skillFile}: SKILL.md is ${skillBytes.toLocaleString()} bytes; entrypoints must be at most ${MAX_SKILL_BYTES.toLocaleString()} bytes. Move conditional detail into references/.`,
    );
  }
  const fields = parseFrontmatter(text, skillFile);
  const expectedName = path.basename(skillDir);
  if (Object.hasOwn(fields, "disable-model-invocation")) {
    throw new Error(
      `${skillFile}: remove legacy disable-model-invocation and configure agents/openai.yaml policy instead.`,
    );
  }
  const unsupportedFields = Object.keys(fields).filter(
    (field) => field !== "name" && field !== "description",
  );
  if (unsupportedFields.length > 0) {
    throw new Error(
      `${skillFile}: frontmatter allows only name and description; remove ${unsupportedFields.join(", ")}.`,
    );
  }
  if (
    typeof fields.name !== "string" ||
    typeof fields.description !== "string"
  ) {
    throw new Error(`${skillFile}: name and description must be strings.`);
  }
  if (fields.name !== expectedName) {
    throw new Error(`${skillFile}: name must match directory ${expectedName}.`);
  }
  if (!fields.description.trim()) {
    throw new Error(`${skillFile}: description is required.`);
  }
  validatePortableMarkdown(text, skillFile);
  const agentFile = path.join(skillDir, "agents", "openai.yaml");
  if (!existsSync(agentFile))
    throw new Error(`${skillDir}: missing agents/openai.yaml.`);
  const agentText = readFileSync(agentFile, "utf8");
  const agentConfig = parseYamlMapping(agentText, agentFile, "configuration");
  const interfaceFields = agentConfig.interface;
  if (
    !interfaceFields ||
    typeof interfaceFields !== "object" ||
    Array.isArray(interfaceFields)
  ) {
    throw new Error(`${agentFile}: one top-level interface block is required.`);
  }
  for (const field of ["display_name", "short_description", "default_prompt"]) {
    if (
      typeof interfaceFields[field] !== "string" ||
      !interfaceFields[field].trim()
    ) {
      throw new Error(`${agentFile}: interface.${field} is required.`);
    }
  }
  if (!interfaceFields.default_prompt.includes(`$${expectedName}`)) {
    throw new Error(
      `${agentFile}: default_prompt must invoke $${expectedName}.`,
    );
  }
  const policyFields = agentConfig.policy;
  if (
    !policyFields ||
    typeof policyFields !== "object" ||
    Array.isArray(policyFields)
  ) {
    throw new Error(`${agentFile}: one top-level policy block is required.`);
  }
  if (policyFields.allow_implicit_invocation !== true) {
    throw new Error(
      `${agentFile}: policy.allow_implicit_invocation must be explicitly true.`,
    );
  }

  const localLinks = validateLocalLinks(text, skillFile, repoRoot);
  const referenceFiles = [...new Set(localLinks)]
    .filter((referenceFile) => /\.(?:md|markdown)$/i.test(referenceFile))
    .sort();
  const linkedReferenceFiles = new Set(
    referenceFiles.map((referenceFile) => path.resolve(referenceFile)),
  );
  const orphanedReferences = collectMarkdownFiles(
    path.join(skillDir, "references"),
  ).filter((referenceFile) => !linkedReferenceFiles.has(referenceFile));
  if (orphanedReferences.length > 0) {
    throw new Error(
      `${skillFile}: every Markdown file under references/ must be linked directly from SKILL.md: ${orphanedReferences
        .map((referenceFile) => path.relative(skillDir, referenceFile))
        .join(", ")}.`,
    );
  }
  for (const referenceFile of referenceFiles) {
    const referenceText = readFileSync(referenceFile, "utf8");
    validatePortableMarkdown(referenceText, referenceFile);
    validateLocalLinks(referenceText, referenceFile, repoRoot);
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
  return { name: expectedName, skillFile, agentFile, referenceFiles };
}

export function validateSkills({
  skillsDir = SKILLS_DIR,
  repoRoot = REPO_ROOT,
} = {}) {
  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsDir, entry.name))
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
