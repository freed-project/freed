import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("Facebook admission policy assets match the shared source", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/generate-provider-admission-policy.mjs", "--check"],
    { encoding: "utf8" },
  );
  assert.equal(output, "");
});
