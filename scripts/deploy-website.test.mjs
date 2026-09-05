import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WEBSITE,
  stageWebsite,
  deployWebsite,
  verifyWebsiteProject,
  verifyWebsiteDeployment,
} from "./deploy-website.mjs";

function fixture(t) {
  const repoRoot = mkdtempSync(
    path.join(os.tmpdir(), "freed-website-fixture-"),
  );
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=www");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  mkdirSync(path.join(repoRoot, "website"));
  writeFileSync(
    path.join(repoRoot, "website/package.json"),
    JSON.stringify({ name: "website", dependencies: { next: "15.5.15" } }),
  );
  writeFileSync(
    path.join(repoRoot, "website/vercel.json"),
    JSON.stringify({ framework: "nextjs" }),
  );
  writeFileSync(
    path.join(repoRoot, ".gitignore"),
    ".vercel\n.env*\n.next\nnode_modules\n",
  );
  writeFileSync(path.join(repoRoot, ".nvmrc"), process.versions.node);
  git("add", ".");
  git("commit", "-m", "fixture");
  git("update-ref", "refs/remotes/origin/www", "HEAD");
  git("remote", "add", "origin", repoRoot);
  writeFileSync(
    path.join(repoRoot, "website/.env.local"),
    "synthetic private data\n",
  );
  return { repoRoot, git };
}

test("archive staging is deterministic and excludes ignored credentials without local project links", (t) => {
  const { repoRoot } = fixture(t);
  const first = stageWebsite({ repoRoot, target: "preview" });
  const second = stageWebsite({ repoRoot, target: "preview" });
  t.after(() => {
    rmSync(first.stage, { recursive: true, force: true });
    rmSync(second.stage, { recursive: true, force: true });
  });
  assert.equal(first.archiveSha256, second.archiveSha256);
  assert.equal(existsSync(path.join(first.stage, "website/.env.local")), false);
  assert.equal(existsSync(path.join(first.stage, "vercel.json")), false);
  assert.equal(
    JSON.parse(readFileSync(path.join(first.stage, "website/vercel.json")))
      .framework,
    "nextjs",
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(first.stage, ".vercel/project.json")))
      .projectId,
    WEBSITE.projectId,
  );
});

test("dirty sources, unrelated lanes, and unmerged production candidates fail before staging", (t) => {
  const { repoRoot, git } = fixture(t);
  writeFileSync(path.join(repoRoot, "untracked"), "not committed");
  assert.throws(
    () => stageWebsite({ repoRoot, target: "preview" }),
    /clean committed/,
  );
  git("add", "untracked");
  git("commit", "-m", "candidate");
  assert.throws(
    () => stageWebsite({ repoRoot, target: "production" }),
    /exact origin\/www/,
  );
  git("update-ref", "refs/remotes/origin/www", "HEAD");
  git("checkout", "--detach", "HEAD~1");
  assert.throws(() => stageWebsite({ repoRoot, target: "preview" }));
});

test("live project and deployment verification reject wrong identities and stale source", () => {
  const project = {
    id: WEBSITE.projectId,
    accountId: WEBSITE.orgId,
    name: WEBSITE.projectName,
    rootDirectory: "website",
    framework: "nextjs",
  };
  verifyWebsiteProject(project);
  for (const field of ["id", "accountId", "name", "rootDirectory", "framework"])
    assert.throws(
      () => verifyWebsiteProject({ ...project, [field]: "wrong" }),
      /identity mismatch/,
    );
  const deployment = {
    id: "dpl_fixture",
    projectId: WEBSITE.projectId,
    readyState: "READY",
    target: null,
    meta: { freedSourceSha: "a".repeat(40), freedArchiveSha256: "b".repeat(64) },
    url: "fixture.vercel.app",
  };
  const expected = { sourceSha: "a".repeat(40), target: "preview", archiveSha256: "b".repeat(64) };
  assert.equal(
    verifyWebsiteDeployment(deployment, expected).deploymentId,
    "dpl_fixture",
  );
  for (const changes of [
    { readyState: "ERROR" },
    { projectId: "wrong" },
    { target: "production" },
    { meta: {} },
    { url: "host.invalid" },
  ])
    assert.throws(
      () => verifyWebsiteDeployment({ ...deployment, ...changes }, expected),
      /exact website project/,
    );
});

test("deployment uses scoped temporary staging, verifies source and cleans only its own stage", (t) => {
  const { repoRoot, git } = fixture(t);
  const sourceSha = git("rev-parse", "HEAD");
  const calls = [];
  let stage;
  let archiveSha256;
  const exec = (command, args, options) => {
    if (command === "git" || command === "tar")
      return execFileSync(command, args, options);
    stage = options.cwd;
    assert.notEqual(stage, repoRoot);
    assert.ok(args.includes("--scope") && args.includes(WEBSITE.scope));
    const verb = args[2];
    calls.push(verb);
    if (verb === "api" && args[3].startsWith("/v9/"))
      return JSON.stringify({
        id: WEBSITE.projectId,
        accountId: WEBSITE.orgId,
        name: WEBSITE.projectName,
        rootDirectory: "website",
        framework: "nextjs",
      });
    if (verb === "pull")
      writeFileSync(
        path.join(stage, ".vercel/project.json"),
        JSON.stringify({
          projectId: WEBSITE.projectId,
          orgId: WEBSITE.orgId,
          settings: { rootDirectory: "website" },
        }),
      );
    if (verb === "deploy") {
      archiveSha256 = args.find((arg) => arg.startsWith("freedArchiveSha256=")).split("=")[1];
      assert.ok(args.includes("--prebuilt"));
      assert.ok(args.includes("freedSourceSha=" + sourceSha));
      return "https://fixture.vercel.app\n";
    }
    if (verb === "api")
      return JSON.stringify({
        id: "dpl_fixture",
        projectId: WEBSITE.projectId,
        readyState: "READY",
        meta: { freedSourceSha: sourceSha, freedArchiveSha256: archiveSha256 },
        url: "fixture.vercel.app",
      });
    return "";
  };
  assert.equal(
    deployWebsite({ repoRoot, target: "preview", exec }).sourceSha,
    sourceSha,
  );
  assert.deepEqual(calls, ["api", "pull", "build", "deploy", "api"]);
  assert.equal(existsSync(stage), false);
  assert.equal(existsSync(path.join(repoRoot, "website/.env.local")), true);
});
