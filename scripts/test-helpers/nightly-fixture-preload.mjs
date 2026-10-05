// Loaded only by the nightly test supervisor, before the suite's ESM imports.
// Updating builtin exports covers module-local imports as well as test wrappers.
import childProcess from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { writeFileSync, renameSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const directory = process.env.FREED_NIGHTLY_SUPERVISION;
const context = new AsyncLocalStorage();
let sequence = 0;

function begin(kind, label, name = context.getStore() ?? "module setup") {
  if (!directory) return () => {};
  const id = `${process.pid}-${++sequence}`;
  const file = path.join(directory, `${id}.json`);
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify({ pid: process.pid, kind, name, label }), { mode: 0o600 });
  renameSync(temporary, file);
  return () => rmSync(file, { force: true });
}

export function withNightlyFixture(name, callback) {
  return context.run(name, async () => {
    const finish = begin("test", name, name);
    try {
      return await callback();
    } finally {
      finish();
    }
  });
}

if (directory && process.env.NODE_TEST_CONTEXT) {
  for (const method of ["execFileSync", "execSync", "spawnSync", "spawn"]) {
    const original = childProcess[method];
    childProcess[method] = function (...args) {
      const label = [method, args[0], ...(Array.isArray(args[1]) ? args[1] : [])]
        .join(" ").slice(0, 1024);
      const finish = begin("operation", label);
      try {
        const result = Reflect.apply(original, this, args);
        if (method.endsWith("Sync")) finish();
        else {
          result.once("close", finish);
          result.once("error", finish);
        }
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    };
  }
  syncBuiltinESMExports();
}
