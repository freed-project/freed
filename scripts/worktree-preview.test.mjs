import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { findFreePort } from "./lib/find-free-port.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test("findFreePort skips a port that is only occupied on IPv6", async (t) => {
  const server = net.createServer();
  t.after(async () => {
    await close(server);
  });

  try {
    await listen(server, 0, "::1");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EADDRNOTAVAIL") {
      t.skip("IPv6 loopback is not available in this environment.");
      return;
    }
    throw error;
  }

  const address = server.address();
  assert.ok(address && typeof address === "object" && "port" in address);

  const candidate = await findFreePort(address.port, 5);
  assert.notEqual(candidate, address.port);
});

test("worktree-preview help prints usage", () => {
  const result = spawnSync("bash", ["scripts/worktree-preview.sh", "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /desktop\|pwa\|website/);
});
