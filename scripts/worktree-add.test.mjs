import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const git = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "freed-worktree-add-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const bin = path.join(root, "bin");
  await mkdir(path.join(repo, "scripts/lib"), { recursive: true });
  await mkdir(bin);
  for (const file of ["worktree-add.sh", "lib/worktree-runtime.sh"]) {
    await copyFile(path.join(scripts, file), path.join(repo, "scripts", file));
  }
  await writeFile(path.join(repo, "scripts/lib/node-tooling.sh"), `print_node_tooling_preflight() { :; }\nresolve_node_bin() { printf '%s\\n' '${process.execPath}'; }\n`);
  await writeFile(path.join(repo, "scripts/doctor.mjs"), "// Host diagnostics are outside this offline fixture.\n");
  await writeFile(path.join(repo, "scripts/task-decisions.mjs"), `import fs from 'node:fs'; import path from 'node:path'; fs.writeFileSync(path.join(process.argv[4], 'decisions-initialized'), 'yes');\n`);
  await writeFile(path.join(repo, "scripts/worktree-bootstrap.sh"), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$@" > "$1/bootstrap-initialized"\n', { mode: 0o755 });
  const runGit = (...args) => {
    const result = spawnSync(git, args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runGit("init", "-q");
  runGit("add", ".");
  runGit("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  const other = path.join(root, "a-other-task");
  // Inject a real concurrent creation immediately before the requested add.
  await writeFile(path.join(bin, "git"), `#!/bin/bash\nset -eu\nif [[ "\${1:-}" == worktree && "\${2:-}" == add && -n "\${INJECT_OTHER:-}" ]]; then\n  '${git}' worktree add --detach '${other}' HEAD >/dev/null 2>&1\nfi\nexec '${git}' "$@"\n`, { mode: 0o755 });
  return { root, repo, other, runGit, run(args, inject = false, extraEnv = {}) {
    return spawnSync("bash", [path.join(repo, "scripts/worktree-add.sh"), ...args], {
      cwd: repo, encoding: "utf8", timeout: 15_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INJECT_OTHER: inject ? "1" : "", ...extraEnv },
    });
  } };
}

test("worktree-add initializes only its requested destination during concurrent creation", async (t) => {
  for (const mode of ["full", "auto", "none"]) {
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      const destination = path.join(f.root, "z-requested task");
      const result = f.run(["../z-requested task", "-b", "fix/requested", "HEAD", "--install", mode, "--target", "shared"], true);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(path.join(destination, "decisions-initialized"), "utf8"), "yes");
      const initialized = await readdir(destination);
      assert.equal(initialized.includes("bootstrap-initialized"), mode === "full");
      const untouched = await readdir(f.other);
      assert.ok(!untouched.includes("decisions-initialized"));
      assert.ok(!untouched.includes("bootstrap-initialized"));
      const manifests = path.join(f.repo, ".git/freed-runtime/worktrees");
      const names = await readdir(manifests);
      assert.equal(names.length, 1);
      const metadata = await readFile(path.join(manifests, names[0]), "utf8");
      const recorded = spawnSync("bash", ["-c", 'source "$1"; printf "%s" "$WORKTREE_PATH"', "fixture", path.join(manifests, names[0])], { encoding: "utf8" });
      assert.equal(recorded.status, 0, recorded.stderr);
      assert.equal(recorded.stdout, destination);
      assert.ok(!metadata.includes(f.other));
      assert.equal(f.runGit("-C", destination, "branch", "--show-current"), "fix/requested");
    });
  }
});

test("worktree-add preserves options before the path and stops initialization on Git failure", async (t) => {
  const f = await fixture(t);
  const result = f.run(["--detach", "--lock", "--reason", "fixture lock", "--install=none", "--", "../locked task", "HEAD"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.runGit("worktree", "list", "--porcelain"), /locked fixture lock/);
  const failed = f.run(["../must-not-exist", "does-not-exist", "--install=full"]);
  assert.notEqual(failed.status, 0);
  assert.ok(!(await readdir(f.root)).includes("must-not-exist"));
  assert.equal((await readdir(path.join(f.repo, ".git/freed-runtime/worktrees"))).length, 1);
});


test("worktree-add accepts branch options before an absolute destination", async (t) => {
  const f = await fixture(t);
  const destination = path.join(f.root, "branch task");
  const result = f.run(["-bfix/absolute", "--no-checkout", destination, "HEAD", "--install=none"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.runGit("-C", destination, "branch", "--show-current"), "fix/absolute");
  assert.equal(await readFile(path.join(destination, "decisions-initialized"), "utf8"), "yes");
});


test("worktree-add preserves Git abbreviations, short clusters and shell-independent destinations", async (t) => {
  for (const options of [["-dq"], ["--det"], ["--lock", "--rea", "test"]]) {
    await t.test(options.join(" "), async (t) => {
      const f = await fixture(t);
      const result = f.run([...options, "../requested", "HEAD", "--install=none"]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(path.join(f.root, "requested/decisions-initialized"), "utf8"), "yes");
    });
  }
  for (const destination of ["child", "-"]) {
    await t.test(destination, async (t) => {
      const f = await fixture(t);
      const result = f.run(["--detach", destination, "HEAD", "--install=none"], false, { CDPATH: f.root, OLDPWD: f.root });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(path.join(f.repo, destination, "decisions-initialized"), "utf8"), "yes");
      assert.ok(!(await readdir(f.root)).includes("decisions-initialized"));
    });
  }
});


test("worktree-add forwards newer Git switches before the destination", async (t) => {
  const help = spawnSync(git, ["worktree", "add", "-h"], { encoding: "utf8" });
  for (const option of ["--relative-paths", "--no-relative-paths", "--orphan"]) {
    await t.test(option, async (t) => {
      const f = await fixture(t);
      const args = option === "--orphan"
        ? [option, "-b", "fix/unborn", "../requested", "--install=none"]
        : [option, "--detach", "../requested", "HEAD", "--install=none"];
      const result = f.run(args);
      const supported = `${help.stdout}${help.stderr}`.replaceAll("[no-]", "").includes(option.replace("--no-", "--"));
      if (supported) {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await readFile(path.join(f.root, "requested/decisions-initialized"), "utf8"), "yes");
      } else {
        // Older Git must reject the unchanged option itself, not our path parser.
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /error: unknown option/);
        assert.doesNotMatch(result.stderr, /ambiguous or unsupported worktree option/);
        assert.ok(!(await readdir(f.root)).includes("requested"));
      }
    });
  }
});
