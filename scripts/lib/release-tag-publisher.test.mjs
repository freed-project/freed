import assert from "node:assert/strict";
import test from "node:test";

import { verifyReleaseTagPublisherBinding } from "./release-tag-publisher.mjs";

function fixture() {
  const digest = "a".repeat(64);
  const config = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    publisherPath: "/Library/Application Support/Freed/release-tag-publisher",
    publisherSha256: digest,
  };
  const attestation = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-readiness",
    repo: config.repo,
    appId: config.appId,
    appSlug: config.appSlug,
    credentialMode: "short-lived-installation-token",
    operations: ["create-annotated-tag"],
    allowsArbitraryRefs: false,
    allowsUpdates: false,
    allowsDeletions: false,
    digest,
  };
  return { config, attestation, digest };
}

test("publisher binding pins the exact App, operation, and executable digest", () => {
  const { config, attestation, digest } = fixture();
  assert.deepEqual(
    verifyReleaseTagPublisherBinding(config, digest, attestation),
    { ready: true, publisherDigest: digest },
  );
  assert.throws(
    () => verifyReleaseTagPublisherBinding(config, "b".repeat(64), attestation),
    /digest does not match/,
  );
  assert.throws(
    () =>
      verifyReleaseTagPublisherBinding(config, digest, {
        ...attestation,
        operations: ["create-annotated-tag", "delete-tag"],
      }),
    /does not match the pinned short-lived annotated-tag publisher/,
  );
});
