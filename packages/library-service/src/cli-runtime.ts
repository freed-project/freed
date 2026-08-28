import { realpath } from "node:fs/promises";

import {
  LibraryServiceFailure,
  type LibraryServiceFailureCode,
} from "./contracts.js";
import {
  assertLibraryServiceBindingsStable,
  bindLibraryServiceConfig,
} from "./config.js";
import { inspectLibraryServiceReadiness } from "./diagnostics.js";
import { createNodeLibraryServicePorts } from "./node-ports.js";
import {
  bindLibraryServiceStatusFile,
  readLibraryServiceStatus,
} from "./status.js";
import { createLibraryServiceDefinitionV1 } from "./service-definition.js";
import { LibraryServiceSupervisor } from "./supervisor.js";

interface ParsedArguments {
  command: "serve" | "status" | "doctor" | "service-definition";
  configPath: string;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length !== 3 || argv[1] !== "--config") {
    throw new LibraryServiceFailure("config_invalid");
  }
  const command = argv[0];
  if (
    command !== "serve" &&
    command !== "status" &&
    command !== "doctor" &&
    command !== "service-definition"
  ) {
    throw new LibraryServiceFailure("config_invalid");
  }
  return { command, configPath: argv[2] };
}

function writeStandardReport(report: unknown): void {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function writeFailureReport(code: LibraryServiceFailureCode): void {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: 1,
      service: "freed-library",
      ok: false,
      role: null,
      code,
    })}\n`,
  );
}

async function serve(configPath: string): Promise<number> {
  const ports = createNodeLibraryServicePorts();
  const supervisor = new LibraryServiceSupervisor({
    configPath,
    fileSystem: ports.fileSystem,
    identity: ports.identity,
    aclProof: ports.aclProof,
    process: ports.process,
    clock: ports.clock,
    entropy: ports.entropy,
    localActorIngress: ports.localActorIngress,
  });
  const startup = new AbortController();
  let signalCount = 0;
  let started = false;
  let stopPromise: Promise<void> | null = null;
  let resolveStop!: () => void;
  let rejectStop!: (error: unknown) => void;
  const stopCompleted = new Promise<void>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });

  const beginStop = (): void => {
    if (stopPromise !== null) return;
    stopPromise = supervisor.stop();
    void stopPromise.then(resolveStop, rejectStop);
  };

  const onSignal = (): void => {
    signalCount += 1;
    if (signalCount === 1) {
      startup.abort();
      if (started) {
        beginStop();
      }
      return;
    }
    supervisor.forceStop();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const startResult = await supervisor.start(startup.signal);
    started = true;
    writeStandardReport({
      schemaVersion: 1,
      service: "freed-library",
      ok: true,
      ...startResult,
    });
    if (signalCount > 0 && stopPromise === null) {
      beginStop();
    }

    const outcome = await Promise.race([
      supervisor.waitForExit().then(() => "exit" as const),
      stopCompleted.then(() => "stopped" as const),
    ]);
    if (outcome === "exit" && signalCount === 0) {
      throw new LibraryServiceFailure("sidecar_exited");
    }
    if (outcome === "exit") await stopPromise;
    writeStandardReport({
      schemaVersion: 1,
      service: "freed-library",
      ok: true,
      role: "primary",
      phase: "stopped",
      code: "requested_stop",
    });
    return 0;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

async function writeServiceDefinition(configPath: string): Promise<number> {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new LibraryServiceFailure("unsupported_service_platform");
  }
  const cliArgument = process.argv[1];
  if (typeof cliArgument !== "string" || cliArgument.length === 0) {
    throw new LibraryServiceFailure("unsupported_service_platform");
  }
  const ports = createNodeLibraryServicePorts();
  const bound = await bindLibraryServiceConfig(
    configPath,
    ports.fileSystem,
    ports.identity,
    ports.aclProof,
  );
  try {
    const [nodeExecutable, cliExecutable] = await Promise.all([
      realpath(process.execPath),
      realpath(cliArgument),
    ]);
    await assertLibraryServiceBindingsStable(bound, ports.fileSystem);
    writeStandardReport(
      createLibraryServiceDefinitionV1({
        platform: process.platform,
        nodeExecutable,
        cliExecutable,
        configPath: bound.configFile.path,
        dataRoot: bound.config.dataRoot,
        stateRoot: bound.config.stateRoot,
      }),
    );
    return 0;
  } finally {
    await bound.close();
  }
}

export async function runLibraryServiceCli(
  argv: readonly string[],
): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    const ports = createNodeLibraryServicePorts();
    if (parsed.command === "doctor") {
      const report = await inspectLibraryServiceReadiness(
        parsed.configPath,
        ports.fileSystem,
        ports.identity,
        ports.aclProof,
      );
      if (report.code === "ready") writeStandardReport(report);
      else writeFailureReport(report.code);
      return report.ok ? 0 : 2;
    }
    if (parsed.command === "status") {
      const bound = await bindLibraryServiceConfig(
        parsed.configPath,
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
        const report = await readLibraryServiceStatus(
          statusFile,
          ports.fileSystem,
        );
        await assertLibraryServiceBindingsStable(bound, ports.fileSystem);
        writeStandardReport(report);
        return 0;
      } finally {
        await statusFile?.close().catch(() => undefined);
        await bound.close();
      }
    }
    if (parsed.command === "service-definition") {
      return await writeServiceDefinition(parsed.configPath);
    }
    return await serve(parsed.configPath);
  } catch (error) {
    const code =
      error instanceof LibraryServiceFailure
        ? error.code
        : "filesystem_failure";
    writeFailureReport(code);
    return 2;
  }
}
