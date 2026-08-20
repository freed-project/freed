import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { bindLibraryServiceConfig } from "./config.js";
import { createNodeLibraryServicePorts } from "./node-ports.js";
import {
  bindLibraryServiceStatusFile,
  createLibraryServiceStatusRecord,
  writeLibraryServiceStatus,
} from "./status.js";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];
const darwinIt = process.platform === "darwin" ? it : it.skip;
const linuxIt = process.platform === "linux" ? it : it.skip;
const posixIt =
  process.platform === "darwin" || process.platform === "linux" ? it : it.skip;

async function privateTemporaryRoot(prefix: string): Promise<string> {
  const physicalTemporaryRoot = await realpath(
    process.platform === "linux" ? os.homedir() : os.tmpdir(),
  );
  const fixture = await mkdtemp(path.join(physicalTemporaryRoot, prefix));
  fixtures.push(fixture);
  await chmod(fixture, 0o700);
  return fixture;
}

async function createServiceFixture(): Promise<{
  configPath: string;
  stateRoot: string;
  statusPath: string;
}> {
  const fixtureRoot = await privateTemporaryRoot("freed-library-service-");
  const dataRoot = path.join(fixtureRoot, "data");
  const stateRoot = path.join(fixtureRoot, "state");
  await Promise.all([
    mkdir(dataRoot, { mode: 0o700 }),
    mkdir(stateRoot, { mode: 0o700 }),
  ]);
  const admissionFile = path.join(stateRoot, "admission.json");
  const credentialDescriptorFile = path.join(stateRoot, "credentials.json");
  const statusPath = path.join(stateRoot, "library-service-status.json");
  await Promise.all([
    writeFile(admissionFile, '{"signedAdmission":"opaque"}\n', {
      mode: 0o600,
    }),
    writeFile(
      credentialDescriptorFile,
      `${JSON.stringify({
        schemaVersion: 1,
        backend: "os-vault",
        recordId: "freed-library-primary",
      })}\n`,
      { mode: 0o600 },
    ),
    writeFile(statusPath, "", { mode: 0o600 }),
  ]);
  const executable = await realpath("/bin/sleep");
  const executableDigest = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
  const configPath = path.join(fixtureRoot, "service.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      role: "primary",
      dataRoot,
      stateRoot,
      admissionFile,
      credentialDescriptorFile,
      sidecar: {
        executable,
        sha256: executableDigest,
        startupTimeoutMs: 500,
        shutdownTimeoutMs: 250,
      },
    })}\n`,
    { mode: 0o600 },
  );
  return { configPath, stateRoot, statusPath };
}

async function runCli(args: readonly string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const cliPath = path.resolve("dist/bin.js");
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { code, stdout, stderr };
}

function sidecarSource(): string {
  return `#!${process.execPath}
import { createHash } from "node:crypto";
import { fstatSync, readSync } from "node:fs";
import { spawn } from "node:child_process";
import { Socket } from "node:net";

function readFd(fd) {
  const size = Number(fstatSync(fd, { bigint: true }).size);
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, bytes, offset, size - offset, offset);
    if (count === 0) process.exit(71);
    offset += count;
  }
  return bytes;
}
function digest(fd) {
  return createHash("sha256").update(readFd(fd)).digest("hex");
}
function identity(fd) {
  const value = fstatSync(fd, { bigint: true });
  return { device: String(value.dev), inode: String(value.ino) };
}

let control = "";
const admissionBytes = readFd(6);
const leaderOnlyTerm = admissionBytes.includes(Buffer.from("leaderOnlyTerm"));
const descendant = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
for await (const chunk of process.stdin) control += chunk.toString("utf8");
const envelope = JSON.parse(control.trim());
let stopping = false;
const watchdog = new Socket({ fd: 8, readable: true, writable: false });
async function stop() {
  if (stopping) return;
  stopping = true;
  watchdog.destroy();
  descendant.kill("SIGTERM");
  const kill = setTimeout(() => descendant.kill("SIGKILL"), 200);
  if (descendant.exitCode === null && descendant.signalCode === null) {
    await new Promise((resolve) => descendant.once("exit", resolve));
  }
  clearTimeout(kill);
  process.exit(0);
}
process.on("SIGTERM", () => {
  if (leaderOnlyTerm) process.exit(0);
  else void stop();
});
watchdog.resume();
watchdog.on("end", () => void stop());
watchdog.on("close", () => void stop());
watchdog.on("error", () => void stop());
const data = identity(4);
const state = identity(5);
const receipt = {
  type: "ready",
  protocolVersion: 1,
  role: "primary",
  pid: process.pid,
  leaseHeld: true,
  authorityOpen: true,
  admissionAccepted: true,
  credentialsReady: true,
  watchdogActive: true,
  parentNonce: envelope.parentNonce,
  configDigest: envelope.configDigest,
  executableDigest: digest(3),
  dataRootDevice: data.device,
  dataRootInode: data.inode,
  stateRootDevice: state.device,
  stateRootInode: state.inode,
  admissionDigest: createHash("sha256").update(admissionBytes).digest("hex"),
  credentialDescriptorDigest: digest(7),
};
await new Promise((resolve) => process.stdout.end(JSON.stringify(receipt) + "\\n", resolve));
`;
}

async function createHarnessFixture(
  input: {
    leaderOnlyTerm?: boolean;
  } = {},
): Promise<{
  args: string[];
  supervisorArgs: string[];
}> {
  const fixtureRoot = await privateTemporaryRoot("freed-library-harness-");
  const dataRoot = path.join(fixtureRoot, "data");
  const stateRoot = path.join(fixtureRoot, "state");
  await Promise.all([
    mkdir(dataRoot, { mode: 0o700 }),
    mkdir(stateRoot, { mode: 0o700 }),
  ]);
  const admission = path.join(stateRoot, "admission.json");
  const credential = path.join(stateRoot, "credentials.json");
  const status = path.join(stateRoot, "library-service-status.json");
  const sidecar = path.join(fixtureRoot, "authority-sidecar");
  const config = path.join(fixtureRoot, "service.json");
  const admissionContents = input.leaderOnlyTerm
    ? '{"leaderOnlyTerm":true}\n'
    : '{"signedAdmission":"opaque"}\n';
  await Promise.all([
    writeFile(admission, admissionContents, { mode: 0o600 }),
    writeFile(
      credential,
      '{"schemaVersion":1,"backend":"os-vault","recordId":"fixture"}\n',
      { mode: 0o600 },
    ),
    writeFile(status, "", { mode: 0o600 }),
    writeFile(sidecar, sidecarSource(), { mode: 0o700 }),
  ]);
  await chmod(sidecar, 0o700);
  const digest = createHash("sha256")
    .update(await readFile(sidecar))
    .digest("hex");
  await writeFile(
    config,
    `${JSON.stringify({
      schemaVersion: 1,
      role: "primary",
      dataRoot,
      stateRoot,
      admissionFile: admission,
      credentialDescriptorFile: credential,
      sidecar: {
        executable: sidecar,
        sha256: digest,
        startupTimeoutMs: 1_000,
        shutdownTimeoutMs: 250,
      },
    })}\n`,
    { mode: 0o600 },
  );
  return {
    args: [sidecar, dataRoot, stateRoot, admission, credential, digest],
    supervisorArgs: [
      config,
      sidecar,
      dataRoot,
      stateRoot,
      admission,
      credential,
    ],
  };
}

function launchHarness(args: readonly string[]): {
  child: ChildProcess;
  ready: Promise<{ sidecarPid: number }>;
} {
  const harnessPath = path.resolve("src/testing/fixtures/runtime-harness.mjs");
  const child = spawn(process.execPath, [harnessPath, ...args], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  const ready = new Promise<{ sidecarPid: number }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout!.on("data", (chunk: string) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      const report = JSON.parse(stdout.slice(0, newline)) as {
        type: string;
        sidecarPid: number;
      };
      if (report.type !== "harness-ready") {
        reject(new Error("unexpected harness report"));
        return;
      }
      resolve({ sidecarPid: report.sidecarPid });
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (stdout.includes("\n")) return;
      reject(
        new Error(`harness exited ${String(code)} ${String(signal)} ${stderr}`),
      );
    });
  });
  return { child, ready };
}

async function runHarnessOnce(args: readonly string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const harnessPath = path.resolve("src/testing/fixtures/runtime-harness.mjs");
  const child = spawn(process.execPath, [harnessPath, ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr!.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { code, stdout, stderr };
}

function launchSupervisorHarness(args: readonly string[]): {
  child: ChildProcess;
  ready: Promise<{ sidecarPid: number }>;
} {
  const harnessPath = path.resolve(
    "src/testing/fixtures/supervisor-runtime-harness.mjs",
  );
  const child = spawn(process.execPath, [harnessPath, ...args], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  const ready = new Promise<{ sidecarPid: number }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout!.on("data", (chunk: string) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      const report = JSON.parse(stdout.slice(0, newline)) as {
        type: string;
        sidecarPid: number;
      };
      if (report.type !== "supervisor-ready") {
        reject(new Error("unexpected supervisor harness report"));
        return;
      }
      resolve({ sidecarPid: report.sidecarPid });
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (stdout.includes("\n")) return;
      reject(
        new Error(
          `supervisor harness exited ${String(code)} ${String(signal)} ${stderr}`,
        ),
      );
    });
  });
  return { child, ready };
}

async function processTable(): Promise<
  Array<{ pid: number; ppid: number; pgid: number; state: string }>
> {
  const result = await execFileAsync("/bin/ps", [
    "-axo",
    "pid=,ppid=,pgid=,state=",
  ]);
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 4)
    .map(([pid, ppid, pgid, state]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      state,
    }));
}

async function waitForGone(pids: readonly number[]): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const live = new Set((await processTable()).map(({ pid }) => pid));
    if (pids.every((pid) => !live.has(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`processes still live: ${pids.join(",")}`);
}

async function waitForHarnessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("harness exit timeout")),
      5_000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

afterEach(async () => {
  while (fixtures.length > 0) {
    await rm(fixtures.pop()!, { recursive: true, force: true });
  }
});

describe("compiled freed-library runtime", () => {
  darwinIt(
    "keeps doctor and status read-only with a root-owned pinned executable",
    async () => {
      const { configPath, statusPath } = await createServiceFixture();

      const doctor = await runCli(["doctor", "--config", configPath]);
      expect(doctor).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        ok: true,
        code: "ready",
      });
      expect(await readFile(statusPath, "utf8")).toBe("");

      const status = await runCli(["status", "--config", configPath]);
      expect(status).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(status.stdout)).toMatchObject({ status: null });
      expect(await readFile(statusPath, "utf8")).toBe("");

      const serve = await runCli(["serve", "--config", configPath]);
      expect(serve).toMatchObject({ code: 2, stdout: "" });
      expect(JSON.parse(serve.stderr)).toMatchObject({
        ok: false,
        code: "ready_response_lost",
      });
      expect(JSON.parse(await readFile(statusPath, "utf8"))).toMatchObject({
        phase: "failed",
        reasonCode: "ready_response_lost",
      });
    },
    15_000,
  );

  linuxIt(
    "fails doctor closed when the production ACL proof is unavailable",
    async () => {
      const { configPath, statusPath } = await createServiceFixture();

      const doctor = await runCli(["doctor", "--config", configPath]);

      expect(doctor).toMatchObject({ code: 2, stdout: "" });
      expect(JSON.parse(doctor.stderr)).toMatchObject({
        ok: false,
        code: "acl_probe_unavailable",
      });
      expect(await readFile(statusPath, "utf8")).toBe("");
    },
    15_000,
  );

  darwinIt(
    "keeps runtime status writes on the bound file after state-root replacement",
    async () => {
      const { configPath, stateRoot, statusPath } =
        await createServiceFixture();
      const ports = createNodeLibraryServicePorts();
      const bound = await bindLibraryServiceConfig(
        configPath,
        ports.fileSystem,
        ports.identity,
        ports.aclProof,
      );
      let statusFile = null;
      try {
        statusFile = await bindLibraryServiceStatusFile(
          bound.config,
          bound.bindings.stateRoot,
          ports.fileSystem,
          ports.identity,
          ports.aclProof,
        );
        expect(statusFile).not.toBeNull();

        const relocatedStateRoot = `${stateRoot}-relocated`;
        await rename(stateRoot, relocatedStateRoot);
        await mkdir(stateRoot, { mode: 0o700 });
        await writeFile(statusPath, "replacement-path\n", { mode: 0o600 });

        const status = createLibraryServiceStatusRecord({
          phase: "running",
          nowMs: Date.parse("2026-08-19T00:00:00.000Z"),
          startedAt: "2026-08-19T00:00:00.000Z",
          sidecarPid: 4_242,
          reasonCode: null,
        });
        await writeLibraryServiceStatus(statusFile!, ports.fileSystem, status);

        expect(await readFile(statusPath, "utf8")).toBe("replacement-path\n");
        expect(
          JSON.parse(
            await readFile(
              path.join(relocatedStateRoot, "library-service-status.json"),
              "utf8",
            ),
          ),
        ).toEqual(status);
      } finally {
        await statusFile?.close().catch(() => undefined);
        await bound.close();
      }
    },
    15_000,
  );

  posixIt.each(["term", "kill"] as const)(
    "contains the whole real process group for %s settlement",
    async (mode) => {
      const { args } = await createHarnessFixture();
      const { child, ready } = launchHarness(args);
      const { sidecarPid } = await ready;
      const table = await processTable();
      const descendant = table.find(({ ppid }) => ppid === sidecarPid);
      expect(descendant).toBeDefined();
      expect(descendant!.pgid).toBe(sidecarPid);

      child.stdin!.write(`${mode}\n`);
      await waitForHarnessExit(child);
      await waitForGone([sidecarPid, descendant!.pid]);
    },
    15_000,
  );

  posixIt(
    "closes the watchdog and contains descendants when the supervisor is killed",
    async () => {
      const { supervisorArgs } = await createHarnessFixture();
      const { child, ready } = launchSupervisorHarness(supervisorArgs);
      const { sidecarPid } = await ready;
      const table = await processTable();
      const descendant = table.find(({ ppid }) => ppid === sidecarPid);
      expect(descendant).toBeDefined();
      expect(descendant!.pgid).toBe(sidecarPid);

      child.kill("SIGKILL");
      await waitForHarnessExit(child);
      expect(child.signalCode).toBe("SIGKILL");
      await waitForGone([sidecarPid, descendant!.pid]);
    },
    15_000,
  );

  posixIt(
    "proves group settlement before rejecting an invalid lifetime channel",
    async () => {
      const { args } = await createHarnessFixture();

      const result = await runHarnessOnce([...args, "invalid-lifetime"]);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      const report = JSON.parse(result.stdout) as {
        type: string;
        code: string;
        sidecarPid: number | null;
        descendantPid: number | null;
      };
      expect(report).toMatchObject({
        type: "invalid-lifetime-settled",
        code: "unsupported_bound_descriptor_execution",
        sidecarPid: expect.any(Number),
        descendantPid: expect.any(Number),
      });
      await waitForGone([report.sidecarPid!, report.descendantPid!]);
    },
    15_000,
  );

  posixIt(
    "kills a surviving descendant after the sidecar leader exits on TERM",
    async () => {
      const { supervisorArgs } = await createHarnessFixture({
        leaderOnlyTerm: true,
      });
      const { child, ready } = launchSupervisorHarness(supervisorArgs);
      const { sidecarPid } = await ready;
      const table = await processTable();
      const descendant = table.find(({ ppid }) => ppid === sidecarPid);
      expect(descendant).toBeDefined();
      expect(descendant!.pgid).toBe(sidecarPid);

      child.stdin!.end("leader-term\n");
      await waitForHarnessExit(child);
      expect(child.exitCode).toBe(0);
      await waitForGone([sidecarPid, descendant!.pid]);
    },
    15_000,
  );
});
