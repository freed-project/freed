import { createHash } from "node:crypto";
import path from "node:path";

export const LIBRARY_SERVICE_DEFINITION_SCHEMA_VERSION = 1 as const;
export const LIBRARY_SERVICE_LAUNCHD_LABEL = "wtf.freed.library" as const;
export const LIBRARY_SERVICE_SYSTEMD_UNIT = "freed-library.service" as const;

export type LibraryServiceDefinitionPlatformV1 = "darwin" | "linux";

export interface LibraryServiceDefinitionInputV1 {
  readonly platform: LibraryServiceDefinitionPlatformV1;
  readonly nodeExecutable: string;
  readonly cliExecutable: string;
  readonly configPath: string;
  readonly dataRoot: string;
  readonly stateRoot: string;
}

export interface LibraryServiceDefinitionV1 {
  readonly schemaVersion: typeof LIBRARY_SERVICE_DEFINITION_SCHEMA_VERSION;
  readonly service: "freed-library";
  readonly role: "primary";
  readonly platform: LibraryServiceDefinitionPlatformV1;
  readonly format: "launchd-plist-v1" | "systemd-user-unit-v1";
  readonly fileName:
    | `${typeof LIBRARY_SERVICE_LAUNCHD_LABEL}.plist`
    | typeof LIBRARY_SERVICE_SYSTEMD_UNIT;
  readonly contentsSha256: string;
  readonly contents: string;
}

const ASCII_CONTROL = /[\x00-\x1f\x7f]/;

function exactAbsolutePath(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    ASCII_CONTROL.test(value) ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== value
  ) {
    throw new TypeError(`${label} must be an exact absolute path`);
  }
  return value;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdArgument(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", () => "$$")}"`;
}

function launchdDefinition(input: {
  readonly nodeExecutable: string;
  readonly cliExecutable: string;
  readonly configPath: string;
}): string {
  const argumentsXml = [
    input.nodeExecutable,
    input.cliExecutable,
    "serve",
    "--config",
    input.configPath,
  ]
    .map((argument) => `    <string>${xml(argument)}</string>`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LIBRARY_SERVICE_LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    argumentsXml,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>ThrottleInterval</key>",
    "  <integer>10</integer>",
    "  <key>Umask</key>",
    "  <integer>63</integer>",
    "  <key>WorkingDirectory</key>",
    "  <string>/</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function systemdDefinition(input: {
  readonly nodeExecutable: string;
  readonly cliExecutable: string;
  readonly configPath: string;
  readonly dataRoot: string;
  readonly stateRoot: string;
}): string {
  const command = [
    input.nodeExecutable,
    input.cliExecutable,
    "serve",
    "--config",
    input.configPath,
  ]
    .map(systemdArgument)
    .join(" ");
  return [
    "[Unit]",
    "Description=Freed Library Primary",
    "After=network-online.target",
    "Wants=network-online.target",
    "StartLimitIntervalSec=300",
    "StartLimitBurst=3",
    "",
    "[Service]",
    "Type=exec",
    `ExecStart=${command}`,
    "WorkingDirectory=/",
    "Restart=on-failure",
    "RestartSec=10",
    "RestartPreventExitStatus=2",
    "TimeoutStopSec=15",
    "KillMode=control-group",
    "UMask=0077",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "PrivateDevices=true",
    "ProtectSystem=strict",
    "ProtectHome=read-only",
    `ReadWritePaths=${systemdArgument(input.dataRoot)} ${systemdArgument(input.stateRoot)}`,
    "ProtectControlGroups=true",
    "ProtectKernelModules=true",
    "ProtectKernelTunables=true",
    "RestrictSUIDSGID=true",
    "LockPersonality=true",
    "SystemCallArchitectures=native",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export function createLibraryServiceDefinitionV1(
  input: LibraryServiceDefinitionInputV1,
): LibraryServiceDefinitionV1 {
  if (input.platform !== "darwin" && input.platform !== "linux") {
    throw new TypeError("service definition platform is unsupported");
  }
  const exact = {
    nodeExecutable: exactAbsolutePath(
      input.nodeExecutable,
      "Node executable",
    ),
    cliExecutable: exactAbsolutePath(input.cliExecutable, "CLI executable"),
    configPath: exactAbsolutePath(input.configPath, "config path"),
    dataRoot: exactAbsolutePath(input.dataRoot, "data root"),
    stateRoot: exactAbsolutePath(input.stateRoot, "state root"),
  };
  const contents =
    input.platform === "darwin"
      ? launchdDefinition(exact)
      : systemdDefinition(exact);
  return Object.freeze({
    schemaVersion: LIBRARY_SERVICE_DEFINITION_SCHEMA_VERSION,
    service: "freed-library",
    role: "primary",
    platform: input.platform,
    format:
      input.platform === "darwin"
        ? "launchd-plist-v1"
        : "systemd-user-unit-v1",
    fileName:
      input.platform === "darwin"
        ? `${LIBRARY_SERVICE_LAUNCHD_LABEL}.plist`
        : LIBRARY_SERVICE_SYSTEMD_UNIT,
    contentsSha256: createHash("sha256").update(contents, "utf8").digest("hex"),
    contents,
  });
}
