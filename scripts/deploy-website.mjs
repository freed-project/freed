#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEBSITE = Object.freeze({
  scope: "aubreyfs-projects",
  projectName: "freed-www",
  projectId: "prj_YkKRjNQXFDQ7YUU01VDc2dQZFbet",
  orgId: "team_SOkY8Pdbb8c1sY0pKSzczMjW",
  cli: "vercel@59.11.7",
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function verifyWebsiteProject(project) {
  if (
    project?.id !== WEBSITE.projectId ||
    project?.accountId !== WEBSITE.orgId ||
    project?.name !== WEBSITE.projectName ||
    project?.rootDirectory !== "website" ||
    project?.framework !== "nextjs"
  ) {
    throw new Error(
      "Website project, team, Next.js framework, or website root identity mismatch. Do not relink or create a project.",
    );
  }
}

export function verifyWebsiteDeployment(
  deployment,
  { sourceSha, target, archiveSha256 },
) {
  if (
    !/^dpl_[A-Za-z0-9]+$/.test(deployment?.id ?? "") ||
    deployment?.projectId !== WEBSITE.projectId ||
    deployment?.readyState !== "READY" ||
    (deployment?.target ?? "preview") !== target ||
    deployment?.meta?.freedSourceSha !== sourceSha ||
    deployment?.meta?.freedArchiveSha256 !== archiveSha256 ||
    !/^[a-f0-9]{64}$/.test(archiveSha256 ?? "") ||
    typeof deployment?.url !== "string" ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url)
  ) {
    throw new Error(
      "Deployment is not READY for the exact website project, source, and target.",
    );
  }
  return {
    deploymentId: deployment.id,
    url: "https://" + deployment.url,
    sourceSha,
    target,
  };
}

/** Stage immutable tracked bytes only. Never include ignored credentials or local build output. */
export function stageWebsite({ repoRoot = root, target, exec = execFileSync }) {
  if (!["preview", "production"].includes(target))
    throw new Error("Target must be preview or production.");
  const git = (...args) =>
    exec("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  if (git("status", "--porcelain", "--untracked-files=all"))
    throw new Error("Website deployment requires a clean committed worktree.");
  const sourceSha = git("rev-parse", "--verify", "HEAD^{commit}");
  const laneSha = git("rev-parse", "--verify", "origin/www^{commit}");
  if (target === "production" && sourceSha !== laneSha)
    throw new Error("Production website deployment requires exact origin/www.");
  exec("git", ["merge-base", "--is-ancestor", laneSha, sourceSha], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  if (target === "production") {
    const remote = git(
      "ls-remote",
      "--exit-code",
      "origin",
      "refs/heads/www",
    ).split(/\s+/)[0];
    if (remote !== sourceSha)
      throw new Error("Remote www moved. Refresh and review before deploying.");
  }
  const archive = exec("git", ["archive", "--format=tar", sourceSha], {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  });
  const stage = mkdtempSync(path.join(os.tmpdir(), "freed-website-deploy-"));
  try {
    exec("tar", ["-xf", "-", "-C", stage], {
      input: archive,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const manifest = JSON.parse(
      readFileSync(path.join(stage, "website/package.json"), "utf8"),
    );
    const config = JSON.parse(
      readFileSync(path.join(stage, "website/vercel.json"), "utf8"),
    );
    if (
      manifest.name !== "website" ||
      !manifest.dependencies?.next ||
      config.framework !== "nextjs"
    )
      throw new Error("Staged target is not the website Next.js application.");
    mkdirSync(path.join(stage, ".vercel"), { recursive: true });
    writeFileSync(
      path.join(stage, ".vercel/project.json"),
      JSON.stringify({
        projectId: WEBSITE.projectId,
        orgId: WEBSITE.orgId,
        projectName: WEBSITE.projectName,
      }) + "\n",
    );
    return {
      stage,
      sourceSha,
      target,
      archiveSha256: createHash("sha256").update(archive).digest("hex"),
    };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export function deployWebsite({
  target,
  repoRoot = root,
  exec = execFileSync,
}) {
  const pinned = readFileSync(path.join(repoRoot, ".nvmrc"), "utf8")
    .trim()
    .replace(/^v/, "");
  if (process.versions.node !== pinned)
    throw new Error("Use Node " + pinned + " from .nvmrc before deploying.");
  const bundle = stageWebsite({ repoRoot, target, exec });
  const npx = path.join(path.dirname(process.execPath), "npx");
  const env = {
    ...process.env,
    VERCEL_ORG_ID: WEBSITE.orgId,
    VERCEL_PROJECT_ID: WEBSITE.projectId,
  };
  // Explicit IDs replace local .vercel state. The live API must confirm them
  // before pull, build, or deploy. All commands run only in the temporary stage.
  const vercel = (args, capture = false) =>
    exec(
      npx,
      [
        "--yes",
        WEBSITE.cli,
        ...args,
        "--scope",
        WEBSITE.scope,
        ...(process.env.VERCEL_TOKEN
          ? ["--token", process.env.VERCEL_TOKEN]
          : []),
      ],
      {
        cwd: bundle.stage,
        env,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      },
    );
  try {
    verifyWebsiteProject(
      JSON.parse(vercel(["api", "/v9/projects/" + WEBSITE.projectId], true)),
    );
    vercel(["pull", "--yes", "--environment", target]);
    const pulled = JSON.parse(
      readFileSync(path.join(bundle.stage, ".vercel/project.json"), "utf8"),
    );
    if (
      pulled.projectId !== WEBSITE.projectId ||
      pulled.orgId !== WEBSITE.orgId ||
      pulled.settings?.rootDirectory !== "website"
    )
      throw new Error(
        "Pulled project settings do not match the verified website.",
      );
    vercel(["build", ...(target === "production" ? ["--prod"] : [])]);
    if (target === "production") {
      const latest = exec(
        "git",
        ["ls-remote", "--exit-code", "origin", "refs/heads/www"],
        { cwd: repoRoot, encoding: "utf8" },
      ).split(/\s+/)[0];
      if (latest !== bundle.sourceSha)
        throw new Error("Remote www moved during build. Nothing was deployed.");
    }
    const url = vercel(
      [
        "deploy",
        "--prebuilt",
        "--yes",
        "--meta",
        "freedSourceSha=" + bundle.sourceSha,
        "--meta",
        "freedArchiveSha256=" + bundle.archiveSha256,
        ...(target === "production" ? ["--prod"] : []),
      ],
      true,
    ).trim();
    if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(url))
      throw new Error(
        "Deployment returned no unambiguous Vercel URL. Inspect before retrying.",
      );
    const deployment = JSON.parse(
      vercel(
        [
          "api",
          "/v13/deployments/" + encodeURIComponent(new URL(url).hostname),
        ],
        true,
      ),
    );
    if ("https://" + deployment.url !== url)
      throw new Error(
        "Deployment API identity does not match the returned URL.",
      );
    return {
      ...verifyWebsiteDeployment(deployment, bundle),
      archiveSha256: bundle.archiveSha256,
    };
  } finally {
    // stageWebsite created this exact private temporary directory.
    rmSync(bundle.stage, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        "Usage: node scripts/deploy-website.mjs preview|production",
      );
    process.stdout.write(
      JSON.stringify(deployWebsite({ target: process.argv[2] }), null, 2) +
        "\n",
    );
  } catch (error) {
    const message = process.env.VERCEL_TOKEN
      ? error.message.replaceAll(process.env.VERCEL_TOKEN, "[redacted]")
      : error.message;
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
