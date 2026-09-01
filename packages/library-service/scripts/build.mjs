import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { build } from "esbuild";

import "./clean-dist.mjs";

const execFileAsync = promisify(execFile);

await execFileAsync(
  process.execPath,
  ["../../node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
  { cwd: process.cwd() },
);

await Promise.all([
  build({
    bundle: true,
    entryPoints: ["src/index.ts"],
    format: "esm",
    outfile: "dist/index.js",
    packages: "bundle",
    platform: "node",
    sourcemap: true,
    target: "node24",
  }),
  build({
    bundle: true,
    entryPoints: ["src/bin.ts"],
    format: "esm",
    outfile: "dist/bin.js",
    packages: "bundle",
    platform: "node",
    sourcemap: true,
    target: "node24",
  }),
]);
