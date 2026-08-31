import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  createLibraryServiceDefinitionV1,
  LIBRARY_SERVICE_LAUNCHD_LABEL,
  LIBRARY_SERVICE_SYSTEMD_UNIT,
} from "./service-definition.js";

describe("installed Library service definitions", () => {
  it("builds one deterministic macOS LaunchAgent without a shell or environment", () => {
    const definition = createLibraryServiceDefinitionV1({
      platform: "darwin",
      nodeExecutable: "/Applications/Freed & Friends/node",
      cliExecutable: "/Applications/Freed & Friends/freed-library.js",
      configPath:
        '/Users/freed/Library/Application Support/Freed/config "one".json',
      dataRoot: "/Users/freed/Library/Application Support/Freed/data",
      stateRoot: "/Users/freed/Library/Application Support/Freed/state",
    });

    expect(definition).toMatchObject({
      schemaVersion: 1,
      service: "freed-library",
      role: "primary",
      platform: "darwin",
      format: "launchd-plist-v1",
      fileName: `${LIBRARY_SERVICE_LAUNCHD_LABEL}.plist`,
    });
    expect(definition.contents).toContain(
      "<string>/Applications/Freed &amp; Friends/node</string>",
    );
    expect(definition.contents).toContain(
      "<string>/Users/freed/Library/Application Support/Freed/config &quot;one&quot;.json</string>",
    );
    expect(definition.contents).toContain("<key>Umask</key>");
    expect(definition.contents).toContain("<integer>63</integer>");
    expect(definition.contents).not.toContain("EnvironmentVariables");
    expect(definition.contents).not.toContain("/bin/sh");
    expect(definition.contentsSha256).toBe(
      createHash("sha256").update(definition.contents).digest("hex"),
    );
  });

  it("builds one hardened deterministic Linux user unit with exact writable roots", () => {
    const definition = createLibraryServiceDefinitionV1({
      platform: "linux",
      nodeExecutable: "/opt/freed $channel/node",
      cliExecutable: "/opt/freed %release/freed-library.js",
      configPath: "/home/freed/.config/freed/library service.json",
      dataRoot: "/home/freed/.local/share/freed/library data",
      stateRoot: "/home/freed/.local/state/freed/library %state",
    });

    expect(definition).toMatchObject({
      schemaVersion: 1,
      service: "freed-library",
      role: "primary",
      platform: "linux",
      format: "systemd-user-unit-v1",
      fileName: LIBRARY_SERVICE_SYSTEMD_UNIT,
    });
    expect(definition.contents).toContain(
      'ExecStart="/opt/freed $$channel/node" "/opt/freed %%release/freed-library.js" "serve" "--config" "/home/freed/.config/freed/library service.json"',
    );
    expect(definition.contents).toContain("Type=exec");
    expect(definition.contents).toContain("ProtectSystem=strict");
    expect(definition.contents).toContain("ProtectHome=read-only");
    expect(definition.contents).toContain(
      'ReadWritePaths="/home/freed/.local/share/freed/library data" "/home/freed/.local/state/freed/library %%state"',
    );
    expect(definition.contents).toContain("RestartPreventExitStatus=2");
    expect(definition.contents).not.toContain("Environment=");
    expect(definition.contents).not.toContain("/bin/sh");
    expect(definition.contentsSha256).toBe(
      createHash("sha256").update(definition.contents).digest("hex"),
    );
  });

  it("rejects ambiguous paths and unsupported platforms", () => {
    const valid = {
      platform: "linux" as const,
      nodeExecutable: "/opt/freed/node",
      cliExecutable: "/opt/freed/freed-library.js",
      configPath: "/etc/freed/library.json",
      dataRoot: "/var/lib/freed/library",
      stateRoot: "/var/lib/freed/state",
    };

    expect(() =>
      createLibraryServiceDefinitionV1({
        ...valid,
        configPath: "relative.json",
      }),
    ).toThrow("config path must be an exact absolute path");
    expect(() =>
      createLibraryServiceDefinitionV1({
        ...valid,
        stateRoot: "/var/lib/freed/state\nforeign",
      }),
    ).toThrow("state root must be an exact absolute path");
    expect(() =>
      createLibraryServiceDefinitionV1({
        ...valid,
        platform: "win32" as never,
      }),
    ).toThrow("service definition platform is unsupported");
  });

  (process.platform === "darwin" ? it : it.skip)(
    "emits a plist accepted by the platform parser",
    () => {
      const definition = createLibraryServiceDefinitionV1({
        platform: "darwin",
        nodeExecutable: "/opt/freed/node",
        cliExecutable: "/opt/freed/freed-library.js",
        configPath: "/Users/freed/Library/Application Support/Freed/config.json",
        dataRoot: "/Users/freed/Library/Application Support/Freed/data",
        stateRoot: "/Users/freed/Library/Application Support/Freed/state",
      });
      const result = spawnSync("/usr/bin/plutil", ["-lint", "-"], {
        encoding: "utf8",
        input: definition.contents,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("OK");
    },
  );
});
