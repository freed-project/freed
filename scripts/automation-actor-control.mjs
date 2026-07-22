#!/usr/bin/env node

import { readSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AutomationControlError,
  acquireGeneralActorLeaseFromTrustedLauncher,
  attestGeneralActorLauncherChannel,
  resolveAutomationStateRoot,
} from "./lib/automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);
const CHANNEL_DESCRIPTOR = 3;
const MAX_CHANNEL_FRAME_BYTES = 8 * 1_024;

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

function readLauncherChannelFrame(action) {
  const bytes = [];
  const byte = Buffer.allocUnsafe(1);
  while (bytes.length < MAX_CHANNEL_FRAME_BYTES) {
    let count;
    try {
      count = readSync(CHANNEL_DESCRIPTOR, byte, 0, 1, null);
    } catch {
      throw new AutomationControlError(
        "actor_launcher_channel_invalid",
        "The trusted launcher channel frame is unavailable.",
      );
    }
    if (count !== 1) {
      throw new AutomationControlError(
        "actor_launcher_channel_invalid",
        "The trusted launcher channel frame ended before its delimiter.",
      );
    }
    if (byte[0] === 0x0a) break;
    bytes.push(byte[0]);
  }
  if (bytes.length === MAX_CHANNEL_FRAME_BYTES) {
    throw new AutomationControlError(
      "actor_launcher_channel_invalid",
      "The trusted launcher channel frame exceeded its byte bound.",
    );
  }
  let frame;
  try {
    frame = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    frame = null;
  }
  if (
    frame === null ||
    typeof frame !== "object" ||
    Array.isArray(frame) ||
    Object.keys(frame).sort().join("\n") !==
      ["action", "leaseOperationId", "leaseToken", "schemaVersion"]
        .sort()
        .join("\n") ||
    frame.schemaVersion !== 1 ||
    frame.action !== action ||
    typeof frame.leaseOperationId !== "string" ||
    typeof frame.leaseToken !== "string" ||
    frame.leaseToken.trim() !== frame.leaseToken ||
    frame.leaseToken.includes("\0") ||
    Buffer.byteLength(frame.leaseToken, "utf8") < 32 ||
    Buffer.byteLength(frame.leaseToken, "utf8") > 4 * 1_024
  ) {
    throw new AutomationControlError(
      "actor_launcher_channel_invalid",
      "The trusted launcher channel frame is invalid.",
    );
  }
  return {
    operationId: frame.leaseOperationId,
    token: frame.leaseToken,
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
  Object.assign(command, readLauncherChannelFrame(command.action));
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
