#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  AutomationControlError,
  acquireGeneralActorLeaseFromTrustedLauncher,
  attestGeneralActorLauncherChannel,
  resolveAutomationStateRoot,
} from "./lib/automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return `Usage:
  node automation-actor-control.mjs --action attest --actor <actor> --state-root <path> --lease-name <name> --ttl-seconds <seconds> --challenge-sha256 <sha256>
  node automation-actor-control.mjs --action acquire --actor <actor> --state-root <path> --lease-name <name> --ttl-seconds <seconds> --challenge-sha256 <sha256>

This entry point is internal to the root-owned automation actor launcher.
It cannot acquire a lease without the launcher's live kernel-attested channel on file descriptor 3.
`;
}

function takeOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (!flag.startsWith("--")) {
      throw new AutomationControlError(
        "invalid_argument",
        `Unexpected argument: ${flag}`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new AutomationControlError(
        "invalid_argument",
        `${flag} requires a value.`,
      );
    }
    const key = flag
      .slice(2)
      .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, key)) {
      throw new AutomationControlError(
        "invalid_argument",
        `${flag} may only be provided once.`,
      );
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function required(options, key, flag) {
  const value = options[key];
  if (typeof value !== "string" || value === "") {
    throw new AutomationControlError(
      "invalid_argument",
      `${flag} is required.`,
    );
  }
  return value;
}

function parseTtlMs(raw) {
  const seconds = Number(raw);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    !Number.isSafeInteger(seconds * 1_000)
  ) {
    throw new AutomationControlError(
      "invalid_value",
      "--ttl-seconds must be a positive integer.",
    );
  }
  return seconds * 1_000;
}

function parseCommand(argv) {
  const options = takeOptions(argv);
  if (options.help) return { help: true };
  const allowed = [
    "action",
    "actor",
    "stateRoot",
    "leaseName",
    "ttlSeconds",
    "challengeSha256",
  ];
  const unexpected = Object.keys(options).filter(
    (key) => !allowed.includes(key),
  );
  if (unexpected.length > 0) {
    throw new AutomationControlError(
      "invalid_argument",
      `Unexpected option: --${unexpected[0].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    );
  }
  const action = required(options, "action", "--action");
  if (action !== "attest" && action !== "acquire") {
    throw new AutomationControlError(
      "invalid_argument",
      "--action must be attest or acquire.",
    );
  }
  return {
    action,
    owner: required(options, "actor", "--actor"),
    stateRoot: required(options, "stateRoot", "--state-root"),
    name: required(options, "leaseName", "--lease-name"),
    ttlMs: parseTtlMs(required(options, "ttlSeconds", "--ttl-seconds")),
    challengeSha256: required(options, "challengeSha256", "--challenge-sha256"),
    actorControlEntryPath: __filename,
  };
}

function errorPayload(error) {
  return {
    ok: false,
    schemaVersion: 1,
    error: {
      code:
        error instanceof AutomationControlError ? error.code : "internal_error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof AutomationControlError && error.details !== undefined
        ? { details: error.details }
        : {}),
    },
  };
}

function main() {
  const command = parseCommand(process.argv.slice(2));
  if (command.help) {
    process.stdout.write(usage());
    return;
  }
  if (command.action === "attest") {
    process.stdout.write(
      `${JSON.stringify(attestGeneralActorLauncherChannel(command))}\n`,
    );
    return;
  }
  const result = acquireGeneralActorLeaseFromTrustedLauncher(command);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      schemaVersion: 1,
      action: "lease.acquire",
      stateRoot: resolveAutomationStateRoot(command.stateRoot),
      result,
    })}\n`,
  );
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify(errorPayload(error))}\n`);
    process.exitCode = 1;
  }
}
