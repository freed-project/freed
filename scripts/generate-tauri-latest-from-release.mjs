#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLATFORM_PATTERNS = [
  {
    platform: "darwin-aarch64",
    aliases: ["darwin-aarch64-app"],
    pattern: /^Freed_aarch64\.app\.tar\.gz$/,
  },
  {
    platform: "darwin-x86_64",
    aliases: ["darwin-x86_64-app"],
    pattern: /^Freed_x64\.app\.tar\.gz$/,
  },
  {
    platform: "windows-x86_64-msi",
    aliases: [],
    pattern: /^Freed_[^/]+_x64_en-US\.msi$/,
  },
  {
    platform: "windows-x86_64-nsis",
    aliases: [],
    pattern: /^Freed_[^/]+_x64-setup\.exe$/,
  },
  {
    platform: "linux-x86_64",
    aliases: ["linux-x86_64-appimage"],
    pattern: /^Freed_[^/]+_amd64\.AppImage$/,
  },
];

function parseArgs(argv) {
  const args = {
    releaseJson: "",
    output: "",
    notesFile: "",
    signatureDir: "",
    pubDate: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--release-json":
        args.releaseJson = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--output":
        args.output = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--notes-file":
        args.notesFile = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--signature-dir":
        args.signatureDir = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--pub-date":
        args.pubDate = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return `Usage:
  node scripts/generate-tauri-latest-from-release.mjs \\
    --release-json <release.json> \\
    --signature-dir <downloaded-signatures-dir> \\
    --notes-file <release-body.md> \\
    --output <latest.json> [--pub-date <iso-date>]`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function appVersionFromTag(tagName) {
  return String(tagName ?? "")
    .replace(/^v/, "")
    .replace(/-dev$/, "");
}

function findSignatureForAsset(assetName, signatureDir) {
  const signaturePath = path.join(signatureDir, `${assetName}.sig`);
  if (!existsSync(signaturePath)) {
    throw new Error(`Missing updater signature for ${assetName}.`);
  }

  return readFileSync(signaturePath, "utf8").trim();
}

function assetUrl(asset) {
  const url = asset.browser_download_url ?? asset.browserDownloadUrl ?? asset.url;
  if (!url) {
    throw new Error(`Release asset ${asset.name} is missing a download URL.`);
  }
  return url;
}

function withAliases(platforms, platform, aliases) {
  const entry = platforms[platform];
  if (!entry) return;

  for (const alias of aliases) {
    platforms[alias] = entry;
  }
}

export function generateLatestManifest({
  release,
  notes,
  signatureDir,
  pubDate = new Date().toISOString(),
}) {
  if (!release?.tag_name) {
    throw new Error("Release JSON is missing tag_name.");
  }

  if (!signatureDir) {
    throw new Error("signatureDir is required.");
  }

  const assets = release.assets ?? [];
  const platforms = {};

  for (const rule of PLATFORM_PATTERNS) {
    const asset = assets.find((candidate) => rule.pattern.test(candidate.name));
    if (!asset) continue;

    platforms[rule.platform] = {
      signature: findSignatureForAsset(asset.name, signatureDir),
      url: assetUrl(asset),
    };
    withAliases(platforms, rule.platform, rule.aliases);
  }

  if (platforms["windows-x86_64-msi"]) {
    platforms["windows-x86_64"] = platforms["windows-x86_64-msi"];
  } else if (platforms["windows-x86_64-nsis"]) {
    platforms["windows-x86_64"] = platforms["windows-x86_64-nsis"];
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error("No updater artifacts were found in the release assets.");
  }

  return {
    version: appVersionFromTag(release.tag_name),
    notes: notes ?? release.body ?? "",
    pub_date: release.published_at ?? release.created_at ?? pubDate,
    platforms: Object.fromEntries(
      Object.entries(platforms).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.releaseJson || !args.output || !args.signatureDir) {
    throw new Error(`Missing required arguments.\n\n${usage()}`);
  }

  const release = readJson(args.releaseJson);
  const notes = args.notesFile ? readFileSync(args.notesFile, "utf8") : undefined;
  const manifest = generateLatestManifest({
    release,
    notes,
    signatureDir: args.signatureDir,
    pubDate: args.pubDate || undefined,
  });

  mkdirSync(path.dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`);
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
