#!/usr/bin/env node

import { randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort } from "./lib/find-free-port.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

async function selectTestPort() {
  const configuredPort = process.env.PWA_CORPUS_HARDENING_PORT?.trim();
  if (configuredPort) return configuredPort;

  const firstCandidate = randomInt(20_000, 60_000);
  return String(await findFreePort(firstCandidate, 1_000));
}

/** Run the opt-in PWA OPFS corpus hardening proof on a fresh origin. */
export async function runPwaLibraryCorpusHardening(
  args = process.argv.slice(2),
) {
  const port = await selectTestPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`PWA corpus hardening origin: ${baseUrl}`);

  const playwrightCli = resolve(
    scriptDirectory,
    "../node_modules/playwright/cli.js",
  );
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", "--config", "playwright.corpus.config.ts", ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, PWA_CORPUS_HARDENING_PORT: port },
      stdio: "inherit",
    },
  );

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runPwaLibraryCorpusHardening();
}
