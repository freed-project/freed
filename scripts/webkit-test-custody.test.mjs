import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareSyntheticMasterKey, readSyntheticMasterKey, requirePrivateSyntheticProfile } from "./lib/webkit-test-custody.mjs";

function profiles(run) {
  const roots = [mkdtempSync(join(tmpdir(), "freed-pwa-custody-test-")), mkdtempSync(join(tmpdir(), "freed-pwa-custody-test-"))];
  try { run(...roots); } finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
}

test("synthetic profile keys are private, stable on reopen and distinct across profiles", () => profiles((one, two) => {
  const first = prepareSyntheticMasterKey(one), second = prepareSyntheticMasterKey(two);
  assert.equal(lstatSync(first).mode & 0o777, 0o600);
  assert.equal(prepareSyntheticMasterKey(one, true), first);
  const original = readSyntheticMasterKey(one);
  assert.equal(original.length, 16);
  assert.equal(prepareSyntheticMasterKey(one), first);
  assert.ok(original.equals(readSyntheticMasterKey(one)));
  assert.ok(!original.equals(readSyntheticMasterKey(two)));
}));

test("missing or corrupt reopen keys cannot fabricate replacement custody", () => profiles(one => {
  const key = prepareSyntheticMasterKey(one);
  writeFileSync(key, "invalid");
  assert.throws(() => prepareSyntheticMasterKey(one, true), /invalid/);
  unlinkSync(key);
  assert.throws(() => prepareSyntheticMasterKey(one, true), /missing on reopen/);
  assert.equal(lstatSync(one).mode & 0o777, 0o700);
}));

test("unsafe profiles, key permissions and symlinks are refused", () => profiles((one, two) => {
  const key = prepareSyntheticMasterKey(one);
  chmodSync(key, 0o644);
  assert.throws(() => prepareSyntheticMasterKey(one, true), /invalid/);
  unlinkSync(key);
  const other = prepareSyntheticMasterKey(two);
  symlinkSync(other, key);
  assert.throws(() => prepareSyntheticMasterKey(one, true), /invalid/);
  assert.throws(() => readSyntheticMasterKey(one), /invalid/);
  chmodSync(one, 0o755);
  assert.throws(() => requirePrivateSyntheticProfile(one), /private synthetic/);
  assert.throws(() => requirePrivateSyntheticProfile(process.cwd()), /private synthetic/);
}));
