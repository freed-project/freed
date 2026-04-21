#!/usr/bin/env node

const MIN_NODE_MAJOR = 20;
const MIN_NPM_MAJOR = 10;

function parseMajor(raw) {
  const match = String(raw).match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

const nodeMajor = parseMajor(process.version);
if (!nodeMajor || nodeMajor < MIN_NODE_MAJOR) {
  console.error(
    `Freed requires Node ${MIN_NODE_MAJOR}+.\nCurrent Node: ${process.version}\nRun \`nvm use\` in the repo root, then retry.`,
  );
  process.exit(1);
}

const userAgent = process.env.npm_config_user_agent || "";
const npmMatch = userAgent.match(/\bnpm\/(\d+)/);
const npmMajor = npmMatch ? Number(npmMatch[1]) : null;

if (npmMajor !== null && npmMajor < MIN_NPM_MAJOR) {
  console.error(
    [
      `Freed requires npm ${MIN_NPM_MAJOR}+ for workspace installs.`,
      `Current npm user agent: ${userAgent}`,
      "",
      "Run `nvm use` and then install with:",
      "  node scripts/npmw.mjs ci --prefer-offline",
    ].join("\n"),
  );
  process.exit(1);
}
