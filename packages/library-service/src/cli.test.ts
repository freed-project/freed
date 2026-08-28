import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    await rm(fixtures.pop()!, { recursive: true, force: true });
  }
});

describe("freed-library CLI", () => {
  it("returns one secret-free bounded doctor failure record", async () => {
    const cliPath = path.resolve("dist/bin.js");
    const missingPath = "/definitely/missing/private-config.json";
    let result: { stdout: string; stderr: string; code: number };
    try {
      await execFileAsync(
        process.execPath,
        [cliPath, "doctor", "--config", missingPath],
        { cwd: path.resolve(".") },
      );
      expect.fail("expected doctor to fail closed");
    } catch (error) {
      result = error as { stdout: string; stderr: string; code: number };
    }

    expect(result!.code).toBe(2);
    expect(result!.stdout).toBe("");
    expect(result!.stderr).not.toContain(missingPath);
    expect(JSON.parse(result!.stderr)).toEqual({
      schemaVersion: 1,
      service: "freed-library",
      ok: false,
      role: null,
      code:
        typeof process.getuid === "function"
          ? "config_missing"
          : "unsupported_secret_store_or_acl_backend",
    });
    expect(Buffer.byteLength(result!.stderr)).toBeLessThan(4 * 1_024);
  });

  it("runs the installed npm bin symlink and fails closed with bounded stderr", async () => {
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeTruthy();
    const fixture = await mkdtemp(
      path.join(os.tmpdir(), "freed-library-packed-bin-"),
    );
    fixtures.push(fixture);
    const packRoot = path.join(fixture, "pack");
    const installRoot = path.join(fixture, "install");
    await Promise.all([
      mkdir(packRoot, { mode: 0o700 }),
      mkdir(installRoot, { mode: 0o700 }),
    ]);
    await writeFile(
      path.join(installRoot, "package.json"),
      '{"name":"freed-library-bin-test","private":true}\n',
      { mode: 0o600 },
    );
    const packed = await execFileAsync(
      process.execPath,
      [npmCli!, "pack", "--json", "--pack-destination", packRoot, "."],
      { cwd: path.resolve("."), maxBuffer: 64 * 1_024 },
    );
    const packReport = JSON.parse(packed.stdout) as Array<{ filename: string }>;
    const archive = path.join(packRoot, packReport[0].filename);
    await execFileAsync(
      process.execPath,
      [
        npmCli!,
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        archive,
      ],
      { cwd: installRoot, maxBuffer: 64 * 1_024 },
    );

    const missingPath = "/definitely/missing/packed-config.json";
    const installedBin = path.join(
      installRoot,
      "node_modules",
      ".bin",
      "freed-library",
    );
    let result: { stdout: string; stderr: string; code: number };
    try {
      await execFileAsync(
        installedBin,
        ["doctor", "--config", missingPath],
        { cwd: installRoot, maxBuffer: 8 * 1_024 },
      );
      expect.fail("expected installed bin to fail closed");
    } catch (error) {
      result = error as { stdout: string; stderr: string; code: number };
    }

    expect(result!.code).toBe(2);
    expect(result!.stdout).toBe("");
    expect(result!.stderr).not.toContain(missingPath);
    expect(JSON.parse(result!.stderr)).toMatchObject({
      service: "freed-library",
      ok: false,
      code:
        typeof process.getuid === "function"
          ? "config_missing"
          : "unsupported_secret_store_or_acl_backend",
    });
    expect(Buffer.byteLength(result!.stderr)).toBeLessThan(4 * 1_024);
  }, 30_000);
});
