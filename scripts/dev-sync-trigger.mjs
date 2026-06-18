#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const provider = process.argv[2] ?? "facebook";
const allowedProviders = new Set(["facebook", "instagram", "linkedin"]);

if (!allowedProviders.has(provider)) {
  console.error("Usage: node scripts/dev-sync-trigger.mjs [facebook|instagram|linkedin]");
  process.exit(1);
}

const appDataDir =
  process.env.FREED_APP_DATA_DIR ??
  path.join(os.homedir(), "Library", "Application Support", "wtf.freed.desktop");
const requestPath = path.join(appDataDir, "dev-sync-trigger.json");
const resultPath = path.join(appDataDir, "dev-sync-trigger-result.json");
const requestId = `${provider}-${Date.now()}`;

await mkdir(appDataDir, { recursive: true });
await writeFile(
  requestPath,
  `${JSON.stringify(
    {
      enabled: true,
      id: requestId,
      provider,
      createdAt: Date.now(),
    },
    null,
    2,
  )}\n`,
);

console.log(`Queued ${provider} dev sync trigger ${requestId}`);
console.log(`Request: ${requestPath}`);
console.log(`Result: ${resultPath}`);

const deadline = Date.now() + 10 * 60 * 1000;
let lastStatus = "";

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  let parsed = null;
  try {
    parsed = JSON.parse(await readFile(resultPath, "utf8"));
  } catch {
    continue;
  }
  if (parsed?.id !== requestId) continue;
  const statusLine = `${parsed.status}${parsed.detail ? `: ${parsed.detail}` : ""}`;
  if (statusLine !== lastStatus) {
    console.log(statusLine);
    lastStatus = statusLine;
  }
  if (parsed.status === "completed") process.exit(0);
  if (parsed.status === "error" || parsed.status === "ignored") process.exit(1);
}

console.error(`Timed out waiting for ${requestId}`);
process.exit(2);
