import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ACTOR_LAUNCHER_CHANNEL_PROTOCOL =
  "freed-actor-launcher-channel-v1";
export const TEST_LAUNCHER_SHA256 = "a".repeat(64);
export const TEST_ACTOR_RUNTIME_DIGEST = "b".repeat(64);
export const TEST_LAUNCHER_ATTESTATION_SHA256 = "c".repeat(64);
export const TEST_LAUNCHER_SESSION_ID = "d".repeat(64);

export const TEST_TRUSTED_LAUNCHER_PROVENANCE = Object.freeze({
  launcherSha256: TEST_LAUNCHER_SHA256,
  actorRuntimeDigest: TEST_ACTOR_RUNTIME_DIGEST,
  launcherChannelProtocol: ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
  launcherAttestationSha256: TEST_LAUNCHER_ATTESTATION_SHA256,
  launcherSessionId: TEST_LAUNCHER_SESSION_ID,
});

const scriptsDirectory = path.resolve(import.meta.dirname, "..");
const internalControlRoot = mkdtempSync(
  path.join(os.tmpdir(), "freed-trusted-actor-lease-test-"),
);
cpSync(path.join(scriptsDirectory, "lib"), internalControlRoot, {
  recursive: true,
});
const internalControlPath = path.join(
  internalControlRoot,
  "automation-control.mjs",
);
appendFileSync(
  internalControlPath,
  `
export function acquireGeneralActorLeaseForTest(options) {
  const {
    actorCredentialToken: _retiredCredential,
    launcherAttestationSha256 = "c".repeat(64),
    launcherSessionId = "d".repeat(64),
    ...leaseOptions
  } = options;
  return acquireLeaseAuthorized({
    ...leaseOptions,
    trustedLauncherAuthorization: {
      marker: TRUSTED_LAUNCHER_AUTHORIZATION,
      launcherSha256: "a".repeat(64),
      actorRuntimeDigest: "b".repeat(64),
      launcherChannelProtocol: ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
      launcherAttestationSha256,
      launcherSessionId,
      leaseOperationId: leaseOptions.operationId,
      leaseTokenSha256: secretDigest(leaseOptions.token),
    },
  });
}
`,
);

const internalControl = await import(pathToFileURL(internalControlPath).href);

export const TRUSTED_ACTOR_CONTROL_MODULE_URL =
  pathToFileURL(internalControlPath).href;
export const acquireGeneralActorLeaseForTest =
  internalControl.acquireGeneralActorLeaseForTest;

process.once("exit", () => {
  rmSync(internalControlRoot, { recursive: true, force: true });
});
