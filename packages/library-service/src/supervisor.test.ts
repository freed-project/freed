import { describe, expect, it } from "vitest";

import { LibraryServiceFailure } from "./contracts.js";
import { LibraryServiceSupervisor } from "./supervisor.js";
import {
  Deferred,
  FakeAclProof,
  FakeClock,
  FakeEntropy,
  FakeFileSystem,
  FakeProcessPort,
  FakeSidecarProcess,
  readyBytes,
  validConfigFileSystem,
} from "./testing/fakes.js";

function createSupervisor(
  input: {
    child?: FakeSidecarProcess;
    clock?: FakeClock;
    fileSystem?: FakeFileSystem;
    aclProof?: FakeAclProof;
  } = {},
) {
  const child = input.child ?? new FakeSidecarProcess();
  const process = new FakeProcessPort(child);
  const fileSystem = input.fileSystem ?? validConfigFileSystem();
  const clock = input.clock ?? new FakeClock();
  const aclProof = input.aclProof ?? new FakeAclProof();
  const supervisor = new LibraryServiceSupervisor({
    configPath: "/safe/config.json",
    fileSystem,
    identity: { currentUserId: () => 501 },
    aclProof,
    process,
    clock,
    entropy: new FakeEntropy(),
  });
  return { child, process, fileSystem, aclProof, clock, supervisor };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition did not settle");
}

async function expectStartFailure(
  supervisor: LibraryServiceSupervisor,
  code: string,
): Promise<void> {
  await supervisor.start().then(
    () => expect.fail("expected startup failure"),
    (error) => {
      expect(error).toBeInstanceOf(LibraryServiceFailure);
      expect((error as LibraryServiceFailure).code).toBe(code);
    },
  );
}

const EQUAL_LENGTH_INPUT_REWRITES: ReadonlyArray<
  readonly [string, string, (text: string) => string]
> = [
  [
    "config",
    "/safe/config.json",
    (text: string): string =>
      text.replace('"role":"primary"', '"role":"primarx"'),
  ],
  ["executable", "/trusted/sidecar", (_text: string): string => "changed"],
  [
    "admission",
    "/safe/state/admission.json",
    (text: string): string => text.replace("opaque", "tamper"),
  ],
  [
    "credential descriptor",
    "/safe/state/credentials.json",
    (text: string): string => text.replace("primary", "primarx"),
  ],
];

describe("LibraryServiceSupervisor", () => {
  it("starts exactly one pinned sidecar through an empty argv and environment", async () => {
    const { child, process, fileSystem, supervisor } = createSupervisor();

    const result = await supervisor.start();

    expect(result).toMatchObject({
      role: "primary",
      phase: "running",
      sidecarPid: 4_242,
    });
    expect(process.requests).toHaveLength(1);
    expect(process.requests[0]).toMatchObject({ args: [], env: {} });
    expect(process.requests[0].bindings.executable.path).toBe(
      "/trusted/sidecar",
    );
    expect(process.requests[0].bindings.dataRoot.path).toBe("/safe/data");
    expect(process.requests[0].bindings.stateRoot.path).toBe("/safe/state");
    expect(child.controlClosed).toBe(true);
    expect(JSON.parse(child.controlWrites[0])).toEqual({
      type: "start",
      protocolVersion: 2,
      role: "primary",
      parentNonce: "1".repeat(64),
      configDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      executableDigest: fileSystem.digests.get("/trusted/sidecar"),
      executableFd: 3,
      dataRootFd: 4,
      stateRootFd: 5,
      admissionFd: 6,
      credentialDescriptorFd: 7,
      lifetimeFd: 8,
      commandRequestFd: 9,
      commandResponseFd: 10,
    });
    expect(child.commandRequests).toEqual([
      {
        protocolVersion: 1,
        requestId: "1".repeat(64),
        commandId: "inspect_storage_v1",
        payload: {},
      },
    ]);
    expect(child.controlWrites[0]).not.toContain("/safe");
    const statuses = fileSystem.writes.map(({ contents }) =>
      JSON.parse(contents),
    );
    expect(statuses.map(({ phase }) => phase)).toEqual(["starting", "running"]);
  });

  it("refuses a second start without spawning another sidecar", async () => {
    const { process, supervisor } = createSupervisor();
    await supervisor.start();

    await expect(supervisor.start()).rejects.toMatchObject({
      code: "already_started",
    });
    expect(process.requests).toHaveLength(1);
  });

  it("revalidates private admission at start and never spawns on refusal", async () => {
    const child = new FakeSidecarProcess();
    const { fileSystem, process, supervisor } = createSupervisor({ child });
    fileSystem.metadata.delete("/safe/state/admission.json");
    fileSystem.texts.delete("/safe/state/admission.json");

    await expectStartFailure(supervisor, "admission_missing");

    expect(process.requests).toEqual([]);
    expect(fileSystem.writes).toEqual([]);
    expect(child.controlWrites).toEqual([]);
  });

  it.each(EQUAL_LENGTH_INPUT_REWRITES)(
    "rejects an equal-length in-place %s rewrite while binding",
    async (_label, filePath, rewrite) => {
      const fileSystem = validConfigFileSystem();
      const aclProof = new FakeAclProof();
      const original = fileSystem.texts.get(filePath)!;
      const replacement = rewrite(original);
      expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
      let bindingAclProved = false;
      let rewritten = false;
      aclProof.afterProbe = () => {
        bindingAclProved = true;
      };
      fileSystem.inspectHook = () => {
        if (!bindingAclProved || rewritten) return;
        rewritten = true;
        fileSystem.rewriteFileInPlace(filePath, replacement);
      };
      const { process, supervisor } = createSupervisor({
        fileSystem,
        aclProof,
      });

      await expectStartFailure(supervisor, "bound_input_changed");

      expect(rewritten).toBe(true);
      expect(process.requests).toEqual([]);
      expect(fileSystem.writes).toEqual([]);
    },
  );

  it.each(EQUAL_LENGTH_INPUT_REWRITES)(
    "rejects an equal-length in-place %s rewrite immediately before spawn",
    async (_label, filePath, rewrite) => {
      const fileSystem = validConfigFileSystem();
      const original = fileSystem.texts.get(filePath)!;
      const replacement = rewrite(original);
      expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
      let rewritten = false;
      fileSystem.writeHook = () => {
        if (rewritten) return;
        rewritten = true;
        fileSystem.rewriteFileInPlace(filePath, replacement);
      };
      const { process, supervisor } = createSupervisor({ fileSystem });

      await expectStartFailure(supervisor, "bound_input_changed");

      expect(rewritten).toBe(true);
      expect(process.requests).toEqual([]);
    },
  );

  it("fails startup on a bounded timeout and settles the child", async () => {
    const output = new Deferred<Uint8Array>();
    const child = new FakeSidecarProcess({ output: output.promise });
    const clock = new FakeClock();
    clock.immediateDurations.add(5_000);
    const { supervisor } = createSupervisor({
      child,
      clock,
    });

    await expectStartFailure(supervisor, "startup_timeout");

    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("applies the startup timeout to a blocked control-channel write", async () => {
    const child = new FakeSidecarProcess();
    child.controlWriteBarrier = new Promise(() => undefined);
    const clock = new FakeClock();
    clock.immediateDurations.add(5_000);
    const { supervisor } = createSupervisor({
      child,
      clock,
    });

    await expectStartFailure(supervisor, "startup_timeout");

    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it.each([
    ["malformed", Buffer.from("not-json\n"), "ready_malformed"],
    ["oversized", Buffer.alloc(4 * 1_024 + 1, 0x61), "ready_oversized"],
    ["multiple", Buffer.concat([readyBytes(), readyBytes()]), "ready_multiple"],
    ["response loss", Buffer.alloc(0), "ready_response_lost"],
    ["partial response", Buffer.from("{}"), "ready_response_lost"],
    [
      "role mismatch",
      readyBytes(4_242, { role: "follower" }),
      "ready_role_mismatch",
    ],
  ])("fails startup for %s control output", async (_label, output, code) => {
    const child = new FakeSidecarProcess({ output });
    const { supervisor } = createSupervisor({ child });

    await expectStartFailure(supervisor, code);

    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("fails startup when the child exits before its ready receipt", async () => {
    const output = new Deferred<Uint8Array>();
    const child = new FakeSidecarProcess({ output: output.promise });
    child.resolveExit({ code: 17, signal: null });
    child.groupRunning = false;
    const { supervisor } = createSupervisor({ child });

    await expectStartFailure(supervisor, "sidecar_exited");

    expect(child.signals).toEqual([]);
  });

  it("settles a requested stop with SIGTERM", async () => {
    const { child, fileSystem, supervisor } = createSupervisor();
    await supervisor.start();

    await supervisor.stop();

    expect(child.signals).toEqual(["SIGTERM"]);
    const statuses = fileSystem.writes.map(({ contents }) =>
      JSON.parse(contents),
    );
    expect(statuses.at(-1)).toMatchObject({
      phase: "stopped",
      reasonCode: "requested_stop",
    });
  });

  it("escalates a non-settling child to SIGKILL", async () => {
    const child = new FakeSidecarProcess();
    child.exitOnTerm = false;
    child.groupExitOnTerm = false;
    const clock = new FakeClock();
    const { supervisor } = createSupervisor({ child, clock });
    await supervisor.start();
    clock.sleepImmediately = true;

    await supervisor.stop();

    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("kills a surviving process group after its leader exits on TERM", async () => {
    const child = new FakeSidecarProcess();
    child.groupExitOnTerm = false;
    const clock = new FakeClock();
    const { supervisor } = createSupervisor({ child, clock });
    await supervisor.start();
    clock.sleepImmediately = true;

    await supervisor.stop();

    expect(child.running).toBe(false);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.groupRunning).toBe(false);
  });

  it("reports a settlement timeout when neither signal settles the child", async () => {
    const child = new FakeSidecarProcess();
    child.exitOnTerm = false;
    child.exitOnKill = false;
    child.groupExitOnTerm = false;
    child.groupExitOnKill = false;
    const clock = new FakeClock();
    const { fileSystem, supervisor } = createSupervisor({
      child,
      clock,
    });
    await supervisor.start();
    clock.sleepImmediately = true;

    await expect(supervisor.stop()).rejects.toMatchObject({
      code: "sidecar_settlement_timeout",
    });
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    const statuses = fileSystem.writes.map(({ contents }) =>
      JSON.parse(contents),
    );
    expect(statuses.at(-1)).toMatchObject({
      phase: "failed",
      reasonCode: "sidecar_settlement_timeout",
    });
  });

  it("cancels before validation without opening, writing, or spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fileSystem, process, supervisor } = createSupervisor();

    await expect(supervisor.start(controller.signal)).rejects.toMatchObject({
      code: "startup_cancelled",
    });
    expect(fileSystem.opened).toEqual([]);
    expect(fileSystem.writes).toEqual([]);
    expect(process.requests).toEqual([]);
  });

  it("cancels a blocked descriptor open and never later spawns", async () => {
    const fileSystem = validConfigFileSystem();
    const gate = new Deferred<void>();
    fileSystem.openBarrier = gate.promise;
    const { process, supervisor } = createSupervisor({
      fileSystem,
      clock: new FakeClock(undefined, true),
    });
    const controller = new AbortController();
    const start = supervisor.start(controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));

    controller.abort();
    await expect(start).rejects.toMatchObject({ code: "startup_cancelled" });
    expect(fileSystem.writes).toEqual([]);
    expect(process.requests).toEqual([]);
    gate.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(process.requests).toEqual([]);
  });

  it("cancels a blocked ACL proof and closes late descriptor bindings", async () => {
    const aclProof = new FakeAclProof();
    const gate = new Deferred<void>();
    aclProof.barrier = gate.promise;
    const { fileSystem, process, supervisor } = createSupervisor({ aclProof });
    const controller = new AbortController();
    const start = supervisor.start(controller.signal);
    await waitFor(() => aclProof.calls.length === 1);

    controller.abort();
    await expect(start).rejects.toMatchObject({ code: "startup_cancelled" });
    expect(fileSystem.writes).toEqual([]);
    expect(process.requests).toEqual([]);
    gate.resolve();
    await waitFor(() => fileSystem.opened.every(({ closed }) => closed));
  });

  it("closes a status descriptor that resolves after cancellation", async () => {
    const aclProof = new FakeAclProof();
    const gate = new Deferred<void>();
    aclProof.barrier = gate.promise;
    aclProof.barrierOnCall = 2;
    const { fileSystem, process, supervisor } = createSupervisor({ aclProof });
    const controller = new AbortController();
    const start = supervisor.start(controller.signal);
    await waitFor(() => aclProof.calls.length === 2);

    controller.abort();
    await expect(start).rejects.toMatchObject({ code: "startup_cancelled" });
    expect(process.requests).toEqual([]);
    gate.resolve();
    await waitFor(() =>
      fileSystem.opened
        .filter(({ path }) => path.endsWith("library-service-status.json"))
        .every(({ closed }) => closed),
    );
  });

  it("cancels a blocked starting status write before spawn", async () => {
    const fileSystem = validConfigFileSystem();
    const gate = new Deferred<void>();
    fileSystem.writeBarrier = gate.promise;
    const clock = new FakeClock();
    const { process, supervisor } = createSupervisor({
      fileSystem,
      clock,
    });
    const controller = new AbortController();
    const start = supervisor.start(controller.signal);
    await waitFor(() => fileSystem.writes.length === 1);

    clock.sleepImmediately = true;
    controller.abort();
    await expect(start).rejects.toMatchObject({ code: "startup_cancelled" });
    expect(process.requests).toEqual([]);
    gate.resolve();
  });

  it("cancels a blocked spawn and kills any late child", async () => {
    const child = new FakeSidecarProcess();
    const { process, supervisor } = createSupervisor({ child });
    const gate = new Deferred<void>();
    process.spawnBarrier = gate.promise;
    process.ignoreAbort = true;
    const controller = new AbortController();
    const start = supervisor.start(controller.signal);
    await waitFor(() => process.requests.length === 1);

    controller.abort();
    gate.resolve();
    await expect(start).rejects.toMatchObject({ code: "startup_cancelled" });
    expect(child.signals).toEqual(["SIGKILL"]);
    expect(child.groupRunning).toBe(false);
    expect(child.lifetimeClosed).toBe(true);
  });

  it("kills a child that appears after cancelled spawn settlement times out", async () => {
    const child = new FakeSidecarProcess();
    const fileSystem = validConfigFileSystem();
    const config = JSON.parse(fileSystem.texts.get("/safe/config.json")!);
    config.sidecar.shutdownTimeoutMs = 900;
    fileSystem.addFile("/safe/config.json", JSON.stringify(config));
    const clock = new FakeClock();
    clock.immediateDurations.add(900);
    const { process, supervisor } = createSupervisor({
      child,
      fileSystem,
      clock,
    });
    const gate = new Deferred<void>();
    process.spawnBarrier = gate.promise;
    process.ignoreAbort = true;
    const controller = new AbortController();
    const start = supervisor.start(controller.signal);
    await waitFor(() => process.requests.length === 1);

    controller.abort();
    await expect(start).rejects.toMatchObject({
      code: "sidecar_settlement_timeout",
    });
    gate.resolve();
    await waitFor(() => child.signals.includes("SIGKILL"));

    expect(child.groupRunning).toBe(false);
    expect(child.lifetimeClosed).toBe(true);
  });

  it("cancels a blocked control write and signals the child first", async () => {
    const child = new FakeSidecarProcess();
    const gate = new Deferred<void>();
    child.controlWriteBarrier = gate.promise;
    const { supervisor } = createSupervisor({ child });
    const controller = new AbortController();
    const start = supervisor.start(controller.signal);
    await waitFor(() => child.controlWrites.length === 1);

    controller.abort();
    await expect(start).rejects.toMatchObject({ code: "startup_cancelled" });
    expect(child.signals[0]).toBe("SIGTERM");
    expect(child.lifetimeClosed).toBe(true);
    gate.resolve();
  });

  it("signals TERM before blocked status persistence can run", async () => {
    const clock = new FakeClock();
    const { child, fileSystem, supervisor } = createSupervisor({ clock });
    await supervisor.start();
    fileSystem.writeBarrier = new Promise(() => undefined);
    clock.sleepImmediately = true;

    const stop = supervisor.stop();
    expect(child.signals).toEqual(["SIGTERM"]);
    await stop;
  });

  it("treats a second stop signal as immediate KILL", async () => {
    const child = new FakeSidecarProcess();
    child.exitOnTerm = false;
    child.groupExitOnTerm = false;
    const { supervisor } = createSupervisor({ child });
    await supervisor.start();

    const stop = supervisor.stop();
    expect(child.signals).toEqual(["SIGTERM"]);
    supervisor.forceStop();
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    await stop;
  });

  it("rejects a ready receipt that does not echo exact bindings", async () => {
    const child = new FakeSidecarProcess({
      output: readyBytes(4_242, { configDigest: "f".repeat(64) }),
    });
    const { supervisor } = createSupervisor({ child });

    await expectStartFailure(supervisor, "ready_binding_mismatch");
    expect(child.signals[0]).toBe("SIGTERM");
  });

  it("detects an admission replacement after status opens and before spawn", async () => {
    const fileSystem = validConfigFileSystem();
    let replaced = false;
    fileSystem.writeHook = () => {
      if (replaced) return;
      replaced = true;
      fileSystem.replaceFile(
        "/safe/state/admission.json",
        JSON.stringify({ replacement: true }),
      );
    };
    const { process, supervisor } = createSupervisor({ fileSystem });

    await expectStartFailure(supervisor, "bound_input_changed");
    expect(process.requests).toEqual([]);
  });

  it("kills and proves settlement of descendants after an unexpected leader exit", async () => {
    const child = new FakeSidecarProcess();
    const { fileSystem, supervisor } = createSupervisor({ child });
    await supervisor.start();

    child.resolveExit({ code: 17, signal: null });
    await expect(supervisor.waitForExit()).resolves.toEqual({
      code: 17,
      signal: null,
    });

    expect(child.signals).toEqual(["SIGKILL"]);
    expect(child.groupRunning).toBe(false);
    const statuses = fileSystem.writes.map(({ contents }) =>
      JSON.parse(contents),
    );
    expect(statuses.at(-1)).toMatchObject({
      phase: "failed",
      reasonCode: "sidecar_exited",
    });
  });

  it("surfaces a settlement timeout when descendants survive an unexpected leader exit", async () => {
    const child = new FakeSidecarProcess();
    child.groupExitOnKill = false;
    const clock = new FakeClock();
    const { fileSystem, supervisor } = createSupervisor({
      child,
      clock,
    });
    await supervisor.start();
    clock.sleepImmediately = true;

    child.resolveExit({ code: 17, signal: null });
    await expect(supervisor.waitForExit()).rejects.toMatchObject({
      code: "sidecar_settlement_timeout",
    });

    expect(child.signals).toEqual(["SIGKILL"]);
    const statuses = fileSystem.writes.map(({ contents }) =>
      JSON.parse(contents),
    );
    expect(statuses.at(-1)).toMatchObject({
      phase: "failed",
      reasonCode: "sidecar_settlement_timeout",
    });
  });

  it("cancels every losing deadline after a clean start and stop", async () => {
    const clock = new FakeClock();
    const { supervisor } = createSupervisor({ clock });

    await supervisor.start();
    expect(clock.cancelCalls).toBe(3);
    await supervisor.stop();
    expect(clock.cancelCalls).toBeGreaterThanOrEqual(3);
  });
});
