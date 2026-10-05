import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
import { once } from "node:events";
import { execFileSync, spawn, spawnSync } from "node:child_process";

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

test("Desktop Playwright skips unrelated listeners and never reuses a server", async (t) => {
  const server = net.createServer((_socket) => {
    // The listener deliberately is not a Freed Vite server.
  });
  t.after(async () => {
    await close(server);
  });

  await listen(server, 0, "127.0.0.1");
  const address = server.address();
  assert.ok(address && typeof address === "object" && "port" in address);

  const candidate = await findFreePort(address.port, 5);
  assert.notEqual(candidate, address.port);

  const config = readFileSync(path.join(repoRoot, "packages/desktop/playwright.config.ts"), "utf8");
  assert.match(config, /await findFreePort\(DEFAULT_PORT \+ worktreePortOffset\)/);
  assert.match(config, /process\.env\.PLAYWRIGHT_PORT = String\(defaultPort\)/);
  assert.match(config, /reuseExistingServer: false/);
  assert.doesNotMatch(config, /reuseExistingServer: !process\.env\.CI/);
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

test("worktree-preview marks product previews as feature previews", () => {
  const script = readFileSync(path.join(repoRoot, "scripts/worktree-preview.sh"), "utf8");

  assert.equal(
    (script.match(/VITE_FREED_FEATURE_PREVIEW=1/g) ?? []).length,
    6,
  );
  assert.match(
    script,
    /VITE_TEST_TAURI=1 VITE_FREED_FEATURE_PREVIEW=1 VITE_FREED_PREVIEW_LABEL=/,
  );
  assert.match(
    script,
    /cd packages\/pwa && PATH=.*VITE_FREED_FEATURE_PREVIEW=1 VITE_FREED_PREVIEW_LABEL=/,
  );
});

test("Vite worktree previews fail instead of moving to an untracked port", () => {
  const script = readFileSync(path.join(repoRoot, "scripts/worktree-preview.sh"), "utf8");

  assert.equal(
    (script.match(/RUN_ARGS=.*"--strictPort"/g) ?? []).length,
    2,
  );
  assert.match(
    script,
    /cd packages\/desktop .*npm run dev -- --config vite\.config\.ts --port \$\{PORT\} --strictPort/,
  );
  assert.match(
    script,
    /cd packages\/pwa .*npm run dev -- --port \$\{PORT\} --strictPort/,
  );
});

test("native worktree previews cannot reuse the production bundle identifier", () => {
  const script = readFileSync(path.join(repoRoot, "scripts/worktree-preview.sh"), "utf8");

  assert.match(
    script,
    /NATIVE_PREVIEW_IDENTIFIER="wtf\.freed\.desktop\.preview\.p\$\{WORKTREE_ID:0:12\}"/,
  );
  assert.match(
    script,
    /RUN_ARGS=\("\$\{NPM_BIN\}" "run" "tauri:dev" "--" "--config" "\$\{NATIVE_PREVIEW_CONFIG\}"\)/,
  );
  assert.doesNotMatch(script, /RUN_ARGS=\("\$\{NPM_BIN\}" "run" "tauri:dev"\)\n/);
});

// Explicit dependency paths keep these spawned helpers in changed-path tooling.
const processScript = path.join(repoRoot, "scripts/worktree-processes.sh");
const processHelper = path.join(repoRoot, "scripts/lib/preview-processes.py");
const runtimeScript = path.join(repoRoot, "scripts/lib/worktree-runtime.sh");

function processFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "freed-preview-process-")));
  execFileSync("git", ["init", "--quiet", root]);
  assert.ok(fs.existsSync(runtimeScript));
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".cache/\n");
  execFileSync("git", ["-C", root, "add", ".gitignore"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "chore: fixture"]);
  const processes = [];
  t.after(async () => {
    // Teardown owns only these fixture processes, never the real registry.
    for (const { launcher, info } of processes) {
      const identities = info?.identities ?? [];
      for (const identity of identities) {
        spawnSync("python3", ["-B", "-c", `
import importlib.util, json, signal, sys
spec = importlib.util.spec_from_file_location('preview', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.send(json.loads(sys.argv[2]), signal.SIGKILL)
`, processHelper, JSON.stringify(identity)]);
      }
      if (launcher.exitCode === null && launcher.signalCode === null) {
        const exited = once(launcher, "exit");
        launcher.kill("SIGUSR2");
        await exited;
      }
      launcher.stdout.destroy();
      launcher.stderr.destroy();
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = (...args) => spawnSync("bash", [processScript, ...args], {
    cwd: root, encoding: "utf8", timeout: 10_000,
  });
  const manifest = (pid) => path.join(root, ".git/freed-runtime/processes", `${pid}.env`);
  const start = async (name) => {
    const worktree = path.join(root, name);
    execFileSync("git", ["-C", root, "worktree", "add", "--quiet", "-b",
      `fix/fixture-${processes.length}`, worktree]);
    const childSource = `
      const http = require('node:http');
      const fs = require('node:fs');
      const cache = () => {
        fs.mkdirSync('.cache', { recursive: true });
        fs.writeFileSync('.cache/preview', 'fixture');
      };
      const server = http.createServer((req, res) => { cache(); res.end('alive'); });
      server.listen(0, '127.0.0.1', () => {
        cache();
        setInterval(cache, 20);
        process.send({ pid: process.pid, port: server.address().port });
      });
    `;
    const launcher = spawn(process.execPath, ["-e", `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      child.on('message', (info) => console.log(JSON.stringify(info)));
      // Fixture-only teardown must work even when native capability inspection
      // fails. Production cleanup never sends this signal.
      process.on('SIGUSR2', () => {
        if (child.exitCode !== null || child.signalCode !== null) process.exit(0);
        child.once('exit', () => process.exit(0));
        child.kill('SIGKILL');
      });
      setInterval(() => {}, 1000);
    `], { cwd: worktree, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const record = { launcher };
    processes.push(record);
    let stderr = "";
    launcher.stderr.on("data", (chunk) => { stderr += chunk; });
    const info = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture did not start: ${stderr}`)), 5000);
      let stdout = "";
      launcher.once("error", (error) => { clearTimeout(timer); reject(error); });
      launcher.once("exit", () => { clearTimeout(timer); reject(new Error(stderr)); });
      launcher.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes("\n")) {
          clearTimeout(timer);
          resolve(JSON.parse(stdout.split("\n")[0]));
        }
      });
    });
    record.info = info;
    info.identities = JSON.parse(execFileSync("python3", ["-B", "-c", `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('preview', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps([m.inspect(int(pid)) for pid in sys.argv[2:]]))
`, processHelper, String(launcher.pid), String(info.pid)], { encoding: "utf8" }));
    const tracked = run("track", "--pid", String(launcher.pid), "--kind", "web",
      "--target", "pwa", "--worktree", worktree, "--port", String(info.port),
      "--command", "synthetic preview parent with child server");
    assert.equal(tracked.status, 0, tracked.stdout + tracked.stderr);
    return { launcher, info, worktree, manifest: manifest(launcher.pid) };
  };
  return { root, run, start };
}

async function request(port) {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  try {
    await once(socket, "connect");
    socket.end("GET / HTTP/1.0\r\nHost: localhost\r\n\r\n");
    let response = "";
    for await (const chunk of socket) response += chunk;
    return response;
  } finally {
    socket.destroy();
  }
}

test("scoped stop closes parent and child server before removal and preserves another preview", async (t) => {
  const fixture = processFixture(t);
  const owned = await fixture.start("task with spaces");
  const unrelated = await fixture.start("other task");
  assert.match(await request(owned.info.port), /alive/);
  const stopped = fixture.run("stop", "--worktree", owned.worktree);
  assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
  assert.match(stopped.stdout, /Stopped 1 tracked process/);
  await assert.rejects(request(owned.info.port), { code: "ECONNREFUSED" });
  // The child was actively recreating this directory. Verified process exit
  // and a closed listener establish that it cannot recreate it after removal.
  assert.equal(fs.existsSync(path.join(owned.worktree, ".cache/preview")), true);
  execFileSync("git", ["-C", fixture.root, "worktree", "remove", owned.worktree]);
  assert.match(await request(unrelated.info.port), /alive/);
  assert.equal(fs.existsSync(owned.worktree), false);
  assert.equal(fs.existsSync(owned.manifest), false);
  assert.equal(fs.existsSync(unrelated.manifest), true);
  const status = JSON.parse(execFileSync("python3", ["-B", "-c", `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('preview', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps([m.active(info) for info in json.loads(sys.argv[2])]))
`, processHelper, JSON.stringify(owned.info.identities)], { encoding: "utf8" }));
  assert.deepEqual(status, [false, false]);
});

test("stale, legacy and cross-session manifests fail closed without killing their live recipients", async (t) => {
  const fixture = processFixture(t);
  const owned = await fixture.start("owned");
  const original = readFileSync(owned.manifest, "utf8");
  const identity = owned.info.identities[0];
  for (const [label, replacement] of [
    ["PID reuse", { ...identity, birth: "previous-process-generation" }],
    ["foreign session", { ...identity, session: identity.session + 1 }],
    ["foreign group", { ...identity, group: identity.group + 1 }],
    ["manifest PID mismatch", { ...identity, pid: identity.pid + 1 }],
    ["legacy", null],
  ]) {
    // JSON contains no single quote, so this is a literal shell assignment.
    fs.writeFileSync(owned.manifest, original.replace(/^PROCESS_IDENTITY=.*\n/m,
      replacement ? `PROCESS_IDENTITY='${JSON.stringify(replacement)}'\n` : ""));
    const stopped = fixture.run("stop", "--worktree", owned.worktree);
    assert.notEqual(stopped.status, 0, label);
    assert.equal(fs.existsSync(owned.manifest), true, label);
    assert.match(await request(owned.info.port), /alive/, label);
  }
  fs.writeFileSync(owned.manifest, original);
  // A dead PID must not make prune erase the only record of possible orphans.
  const orphan = path.join(path.dirname(owned.manifest), "2147483647.env");
  fs.writeFileSync(orphan, "PID=2147483647\nWORKTREE_PATH=unused\n");
  assert.equal(fixture.run("prune").status, 0);
  assert.equal(fs.existsSync(orphan), true);
  const rejected = fixture.run("track", "--pid", String(owned.info.pid), "--kind", "web",
    "--target", "pwa", "--worktree", owned.worktree, "--command", "not a dedicated leader");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /dedicated session/);
  assert.match(await request(owned.info.port), /alive/);
});

test("process generation checks cover escalation, pidfd pinning, late children and ambiguous anchors", () => {
  const result = spawnSync("python3", ["-B", "-c", `
import ctypes, errno, importlib.util, signal, sys
from types import SimpleNamespace
from unittest.mock import Mock, patch
spec = importlib.util.spec_from_file_location('preview', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root = dict(pid=400, session=400, group=400, birth='root', zombie=False)
child = dict(pid=401, session=400, group=400, birth='child', zombie=False)
replacement = dict(child, birth='reused')

# TERM was sent to the captured child. Its reused PID must not receive KILL.
current = {400: root, 401: child}
signals = []
def send(info, sig):
    if m.active(info):
        signals.append((info['pid'], sig))
        if info == child:
            current[401] = replacement
        else:
            current.pop(400, None)
with patch.object(m, 'inspect', side_effect=lambda pid: current.get(pid)), patch.object(m, 'session_members', side_effect=[[root, child], []]), patch.object(m, 'send', side_effect=send):
    m.stop(root, grace=0)
assert signals == [(401, signal.SIGTERM), (400, signal.SIGTERM)], signals

# Ignored TERM exhausts the bounded grace and escalates both owned generations.
current = {400: root, 401: child}
signals = []
def stubborn(info, sig):
    if m.active(info):
        signals.append((info['pid'], sig))
        if sig == signal.SIGKILL:
            current.pop(info['pid'])
with patch.object(m, 'inspect', side_effect=lambda pid: current.get(pid)), patch.object(m, 'session_members', side_effect=[[root, child], []]), patch.object(m, 'send', side_effect=stubborn):
    m.stop(root, grace=0)
assert signals == [(401, signal.SIGTERM), (400, signal.SIGTERM), (401, signal.SIGKILL), (400, signal.SIGKILL)], signals

for recipient in (None, dict(root, birth='reused')):
    with patch.object(m, 'inspect', return_value=recipient), patch.object(m, 'send') as send:
        try: m.stop(root, grace=0)
        except RuntimeError: pass
        else: raise AssertionError('ambiguous anchor accepted')
        send.assert_not_called()

with patch.object(m, 'inspect', side_effect=[root, dict(root, birth='reused')]), patch.object(m, 'session_members', return_value=[root]), patch.object(m, 'send') as send:
    try: m.stop(root, grace=0)
    except RuntimeError: pass
    else: raise AssertionError('anchor reused during enumeration')
    send.assert_not_called()

with patch.object(m, 'inspect', return_value=root), patch.object(m, 'active', return_value=False), patch.object(m, 'session_members', side_effect=[[root], [child]]), patch.object(m, 'send'):
    try: m.stop(root, grace=0)
    except RuntimeError: pass
    else: raise AssertionError('late child reported stopped')

# Darwin must pass the captured PID version into the kernel, even if the
# numeric PID changes generation after the last userspace inspection.
darwin_child = dict(child, pidversion=72)
tokens = []
def kernel_signal(pointer, sig):
    token = ctypes.cast(pointer, ctypes.POINTER(m.AuditToken)).contents
    tokens.append((token.val[5], token.val[7], sig))
    return errno.ESRCH  # Kernel rejects the captured version after PID reuse.
libproc = SimpleNamespace(proc_signal_with_audittoken=kernel_signal)
with patch.object(m, 'inspect', return_value=darwin_child), patch.object(m.os, 'kill') as kill, patch.object(m.sys, 'platform', 'darwin'), patch.object(m, 'darwin_libproc', return_value=libproc):
    m.send(darwin_child, signal.SIGKILL)
    assert tokens == [(401, 72, signal.SIGKILL)]
    kill.assert_not_called()
with patch.object(m, 'inspect', return_value=dict(darwin_child, pidversion=73)), patch.object(m.os, 'kill') as kill, patch.object(m.sys, 'platform', 'darwin'), patch.object(m, 'darwin_libproc') as library:
    m.send(darwin_child, signal.SIGKILL)
    library.assert_not_called()
    kill.assert_not_called()

# Missing SPI or denied signals must fail, never choose a numeric-PID fallback.
with patch.object(m.ctypes, 'CDLL', return_value=SimpleNamespace(proc_pidinfo=Mock())):
    try: m.darwin_libproc()
    except RuntimeError: pass
    else: raise AssertionError('missing generation-bound API accepted')
with patch.object(m, 'inspect', return_value=darwin_child), patch.object(m.os, 'kill') as kill, patch.object(m.sys, 'platform', 'darwin'), patch.object(m, 'darwin_libproc', return_value=SimpleNamespace(proc_signal_with_audittoken=lambda *args: errno.EPERM)):
    try: m.send(darwin_child, signal.SIGKILL)
    except PermissionError: pass
    else: raise AssertionError('denied signal reported success')
    kill.assert_not_called()

# Acquiring a pidfd before verification and signaling through it closes the
# numeric PID reuse window between the final inspection and the kernel call.
with patch.object(m.sys, 'platform', 'linux'), patch.object(m.os, 'pidfd_open', return_value=9, create=True) as opened, patch.object(m.os, 'close') as closed, patch.object(m, 'inspect', return_value=child), patch.object(m.signal, 'pidfd_send_signal', create=True) as sent, patch.object(m.os, 'kill') as kill:
    m.send(child, signal.SIGKILL)
    opened.assert_called_once_with(401)
    sent.assert_called_once_with(9, signal.SIGKILL)
    closed.assert_called_once_with(9)
    kill.assert_not_called()
print('generation and escalation contracts passed')
`, processHelper], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});


test("macOS kernel rejects an obsolete PID version without signaling the live preview", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const fixture = processFixture(t);
  const owned = await fixture.start("kernel token");
  const result = spawnSync("python3", ["-B", "-c", `
import ctypes, errno, importlib.util, json, signal, sys
spec = importlib.util.spec_from_file_location('preview', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
identity = json.loads(sys.argv[2])
assert ctypes.sizeof(m.BsdInfo) == 136
assert ctypes.sizeof(m.UniqueInfo) == 56
assert ctypes.sizeof(m.BsdWithUniqueInfo) == 192
assert ctypes.sizeof(m.AuditToken) == 32
assert isinstance(identity['pidversion'], int)
token = m.AuditToken()
token.val[5] = identity['pid']
token.val[7] = (identity['pidversion'] + 1) & 0xffffffff
result = m.darwin_libproc().proc_signal_with_audittoken(ctypes.byref(token), signal.SIGTERM)
assert result == errno.ESRCH, result
assert m.active(identity)
print('kernel rejected obsolete version')
`, processHelper, JSON.stringify(owned.info.identities[0])], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(await request(owned.info.port), /alive/);
});


test("preview refuses unavailable generation-bound signaling before bootstrap or launch", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freed-preview-preflight-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const marker = path.join(root, "calls");
  fs.writeFileSync(path.join(bin, "python3"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PREVIEW_CALLS"\necho "generation-bound signaling unavailable" >&2\nexit 1\n',
    { mode: 0o700 });
  const result = spawnSync("bash", [path.join(repoRoot, "scripts/worktree-preview.sh"),
    "pwa", "--worktree", root], {
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      NODE_BIN: process.execPath, PREVIEW_CALLS: marker },
    encoding: "utf8", timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generation-bound signaling unavailable/);
  assert.doesNotMatch(result.stdout, /Bootstrapping|Started/);
  assert.equal(readFileSync(marker, "utf8").trim(), `${processHelper} check`);
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
});
