#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-dev)?$/;
const COMPONENT_PATTERN = /^(0|[1-9][0-9]*)$/;

function parseComponent(value, label) {
  const raw = String(value ?? "").trim();
  if (!COMPONENT_PATTERN.test(raw)) {
    throw new Error(`${label} must be a canonical nonnegative integer.`);
  }
  return Number(raw);
}

export function parseReleaseVersion(
  input,
  { channel = null, requireTagPrefix = false } = {},
) {
  const raw = String(input ?? "").trim();
  const hasTagPrefix = raw.startsWith("v");
  if (requireTagPrefix && !hasTagPrefix) {
    throw new Error(`Release tag ${raw} must begin with v.`);
  }
  if (!requireTagPrefix && hasTagPrefix) {
    throw new Error(`Release version ${raw} must not begin with v.`);
  }

  const normalized = hasTagPrefix ? raw.slice(1) : raw;
  const match = normalized.match(VERSION_PATTERN);
  if (!match) {
    throw new Error(
      `Release version ${raw} must use canonical numeric CalVer with one optional exact -dev suffix and no leading-zero segments.`,
    );
  }

  const major = Number(match[1]);
  const month = Number(match[2]);
  const patch = Number(match[3]);
  const day = Math.floor(patch / 100);
  const build = patch % 100;
  const suffixChannel = match[4] ? "dev" : "production";

  if (major > 255) {
    throw new Error(
      `Release version ${raw} has major ${major.toLocaleString()}, but Windows installers require a major no greater than 255.`,
    );
  }
  if (month < 1 || month > 12) {
    throw new Error(
      `Release version ${raw} has month ${month.toLocaleString()}, expected 1 through 12.`,
    );
  }
  if (day < 1 || day > 31) {
    throw new Error(
      `Release version ${raw} encodes day ${day.toLocaleString()}, expected 1 through 31.`,
    );
  }
  if (build < 0 || build > 99) {
    throw new Error(
      `Release version ${raw} encodes build ${build.toLocaleString()}, expected 0 through 99.`,
    );
  }

  let resolvedChannel = suffixChannel;
  if (channel !== null) {
    if (channel !== "dev" && channel !== "production") {
      throw new Error(
        `Release channel must be dev or production, received ${channel}.`,
      );
    }
    if (channel === "production" && suffixChannel !== "production") {
      throw new Error(
        "Production releases require canonical numeric CalVer without a prerelease suffix.",
      );
    }
    resolvedChannel = channel;
  }

  const appVersion = `${match[1]}.${match[2]}.${match[3]}`;
  const version = resolvedChannel === "dev" ? `${appVersion}-dev` : appVersion;
  return {
    tag: `v${version}`,
    version,
    appVersion,
    channel: resolvedChannel,
    major,
    month,
    patch,
    day,
    build,
    dayKey: `${match[1]}.${match[2]}.${day}`,
  };
}

export function releaseVersionFromComponents({
  major,
  month,
  day,
  build,
  channel,
}) {
  const parsedMajor = parseComponent(major, "Release major");
  const parsedMonth = parseComponent(month, "Release month");
  const parsedDay = parseComponent(day, "Release day");
  const parsedBuild = parseComponent(build, "Release build");
  if (parsedBuild > 99) {
    throw new Error(
      `Release build ${parsedBuild.toLocaleString()} is outside the supported range 0 through 99.`,
    );
  }
  return parseReleaseVersion(
    `${parsedMajor}.${parsedMonth}.${parsedDay * 100 + parsedBuild}`,
    { channel },
  );
}

function parseArgs(argv) {
  let channel = null;
  let input = null;
  const components = {};
  for (const arg of argv) {
    if (arg.startsWith("--channel=")) channel = arg.slice("--channel=".length);
    else if (arg.startsWith("--major="))
      components.major = arg.slice("--major=".length);
    else if (arg.startsWith("--month="))
      components.month = arg.slice("--month=".length);
    else if (arg.startsWith("--day="))
      components.day = arg.slice("--day=".length);
    else if (arg.startsWith("--build="))
      components.build = arg.slice("--build=".length);
    else if (arg === "--help" || arg === "-h") return { help: true };
    else if (input === null) input = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { help: false, channel, input, components };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: node scripts/release-version.mjs --channel=production|dev <version>\n" +
        "   or: node scripts/release-version.mjs --channel=production|dev --major=YY --month=M --day=D --build=BUILD\n",
    );
    return;
  }
  if (!args.channel) {
    throw new Error("Release channel is required.");
  }
  const componentValues = Object.values(args.components);
  const hasComponents = componentValues.length > 0;
  if (hasComponents && componentValues.length !== 4) {
    throw new Error("Release major, month, day, and build are all required.");
  }
  if (hasComponents && args.input !== null) {
    throw new Error(
      "Provide either a release version or release components, not both.",
    );
  }
  if (!hasComponents && args.input === null) {
    throw new Error("Release version or components are required.");
  }
  const result = hasComponents
    ? releaseVersionFromComponents({
        ...args.components,
        channel: args.channel,
      })
    : parseReleaseVersion(args.input, { channel: args.channel });
  process.stdout.write(`${result.version}\n`);
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
