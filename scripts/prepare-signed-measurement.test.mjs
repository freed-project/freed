import test from "node:test";
import assert from "node:assert/strict";
import {
  measurementIdentity,
  measurementConfig,
} from "./prepare-signed-measurement.mjs";

const input = { runId: "37085839376", attempt: "2", sourceSha: "a".repeat(40) };
const preview = {
  productName: "Freed Preview",
  identifier: "wtf.freed.desktop.sqlite-native-preview",
  bundle: { createUpdaterArtifacts: false },
};

test("each run/attempt has distinct profile and both credential namespaces", () => {
  const first = measurementIdentity(input);
  for (const other of [
    measurementIdentity({ ...input, attempt: "3" }),
    measurementIdentity({ ...input, runId: "37085839377" }),
  ]) {
    for (const key of ["identifier", "jevService", "libraryKeyService"])
      assert.notEqual(first[key], other[key]);
  }
  assert.notEqual(first.identifier, preview.identifier);
  assert.notEqual(first.jevService, "wtf.freed.ai.isolated-preview");
  assert.notEqual(
    first.libraryKeyService,
    "wtf.freed.library-core.sqlite-native-preview",
  );
  assert.equal(first.transferAcceptanceEnabled, false);
});

test("malformed run/source identities cannot select an existing profile", () => {
  for (const bad of [
    { runId: "../primary" },
    { runId: "0" },
    { attempt: "01" },
    { attempt: "2\n" },
    { sourceSha: "a".repeat(7) },
  ]) {
    assert.throws(() => measurementIdentity({ ...input, ...bad }));
  }
});

test("config preserves the isolated feature's base and disables updater contact", () => {
  const config = measurementConfig(measurementIdentity(input), preview);
  assert.equal(config.productName, "Freed Preview");
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(config.plugins.updater.endpoints, []);
  assert.equal(preview.identifier, "wtf.freed.desktop.sqlite-native-preview");
  assert.throws(() =>
    measurementConfig(measurementIdentity(input), {
      ...preview,
      identifier: "wtf.freed.desktop",
    }),
  );
});
