import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERCEL_PROJECTS = Object.freeze({
  website: "freed-www",
  pwa: "freed-pwa",
});

export function resolveVercelProjectName(target) {
  const projectName = VERCEL_PROJECTS[target];
  if (!projectName) {
    throw new Error(`Unknown Vercel deployment target: ${target}`);
  }
  return projectName;
}

export function stageExistingVercelProjectLink({ sourcePath, targetPath }) {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return true;
}

function usage() {
  return "Usage: node scripts/lib/vercel-project-link.mjs project <website|pwa> | stage <source> <target>";
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "project" && args.length === 1) {
    process.stdout.write(`${resolveVercelProjectName(args[0])}\n`);
    return;
  }
  if (command === "stage" && args.length === 2) {
    process.exitCode = stageExistingVercelProjectLink({
      sourcePath: args[0],
      targetPath: args[1],
    })
      ? 0
      : 2;
    return;
  }
  throw new Error(usage());
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
