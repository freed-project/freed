import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enabled = process.platform === "darwin";
const secretToken = "installation-secret-token-do-not-print";
const tagObjectSha = "b".repeat(40);
const tag = "v26.7.1302-dev";

let fixtureRoot;
let host;
let configPath;
let keyPath;
let worktree;
let commit;
let receipt;
let receiptDigest;
let apiBase;
let server;
let tagCreated = false;
let revokedTokens = 0;
const requests = [];

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function git(args, cwd) {
  return execFileSync("/usr/bin/git", args, {
    cwd,
    encoding: "utf8",
    env: {
      HOME: process.env.HOME,
      PATH: "/usr/bin:/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const data = Buffer.concat(chunks);
      resolve(data.length === 0 ? null : JSON.parse(data.toString("utf8")));
    });
  });
}

function runHost(args, cwd = fixtureRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(host, args, {
      cwd,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error("The native release publisher exceeded its test deadline."));
        return;
      }
      resolve({ status, stdout, stderr });
    });
  });
}

function testingFlags(testKeyPath = keyPath) {
  return [
    "--config",
    configPath,
    "--test-key-file",
    testKeyPath,
    "--api-base",
    apiBase,
  ];
}

function identityArgs(
  repo = "freed-project/freed",
  testKeyPath = keyPath,
) {
  return [
    "--repo",
    repo,
    "--app-id",
    "123456",
    "--app-slug",
    "freed-release-publisher",
    ...testingFlags(testKeyPath),
  ];
}

function publishArgs(overrides = {}) {
  const values = {
    repo: "freed-project/freed",
    worktree,
    tag,
    channel: "dev",
    commit,
    branch: "dev",
    releaseFile: `release-notes/releases/${tag}.json`,
    releaseDigest: receiptDigest,
    testKeyPath: keyPath,
    ...overrides,
  };
  return [
    "publish",
    "--repo",
    values.repo,
    "--worktree",
    values.worktree,
    "--tag",
    values.tag,
    "--channel",
    values.channel,
    "--commit",
    values.commit,
    "--branch",
    values.branch,
    "--release-file",
    values.releaseFile,
    "--release-file-sha256",
    values.releaseDigest,
    ...testingFlags(values.testKeyPath),
  ];
}

before(async () => {
  if (!enabled) return;
  fixtureRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-release-publisher-native-")),
  );
  chmodSync(fixtureRoot, 0o700);
  const productionHost = path.join(fixtureRoot, "production-host");
  execFileSync(
    path.join(root, "scripts", "release-tag-publisher-build.sh"),
    ["--host-output", productionHost],
    { cwd: root, stdio: "pipe" },
  );
  assert.equal(readFileSync(productionHost).length > 0, true);

  host = path.join(fixtureRoot, "release-tag-publisher-test");
  execFileSync(
    "/usr/bin/xcrun",
    [
      "--sdk",
      "macosx",
      "swiftc",
      "-D",
      "RELEASE_TAG_PUBLISHER_HOST_TESTING",
      "-O",
      path.join(root, "scripts", "release-tag-publisher-host.swift"),
      "-o",
      host,
      "-framework",
      "Foundation",
      "-framework",
      "Security",
      "-framework",
      "CryptoKit",
    ],
    { cwd: root, stdio: "pipe" },
  );
  chmodSync(host, 0o700);

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  keyPath = path.join(fixtureRoot, "release-app.pem");
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  configPath = path.join(fixtureRoot, "release-tag-publisher.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        purpose: "freed-release-tag-publisher-binding",
        status: "active",
        repo: "freed-project/freed",
        appId: 123456,
        appSlug: "freed-release-publisher",
        publisherPath: host,
        publisherSha256: sha256(host),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  worktree = path.join(fixtureRoot, "repo");
  mkdirSync(path.join(worktree, "release-notes", "releases"), {
    recursive: true,
  });
  receipt = Buffer.from(
    `${JSON.stringify({
      tag,
      version: tag.slice(1),
      channel: "dev",
      approved: true,
      source: { channel: "dev", productCommitSha: "a".repeat(40) },
    })}\n`,
  );
  writeFileSync(
    path.join(worktree, "release-notes", "releases", `${tag}.json`),
    receipt,
  );
  git(["init", "-b", "dev"], worktree);
  git(["config", "user.name", "Release Test"], worktree);
  git(["config", "user.email", "release-test@example.invalid"], worktree);
  git(["add", "."], worktree);
  git(["commit", "-m", "test: release receipt"], worktree);
  git(
    ["remote", "add", "origin", "https://github.com/freed-project/freed.git"],
    worktree,
  );
  commit = git(["rev-parse", "HEAD"], worktree);
  receiptDigest = createHash("sha256").update(receipt).digest("hex");

  server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body,
    });
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/app") {
      return json(response, 200, {
        id: 123456,
        slug: "freed-release-publisher",
        name: "Freed Release Publisher",
        external_url: "https://freed.wtf",
        events: [],
        permissions: { contents: "write", metadata: "read" },
        owner: { login: "freed-project", type: "Organization" },
      });
    }
    if (
      request.method === "GET" &&
      url.pathname === "/repos/freed-project/freed/installation"
    ) {
      return json(response, 200, {
        id: 42,
        account: { login: "freed-project", type: "Organization" },
        repository_selection: "selected",
        permissions: { contents: "write", metadata: "read" },
        suspended_at: null,
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/app/installations/42/access_tokens"
    ) {
      assert.deepEqual(body, {
        permissions: { contents: "write" },
        repositories: ["freed"],
      });
      return json(response, 201, { token: secretToken });
    }
    if (
      request.method === "GET" &&
      url.pathname === "/installation/repositories"
    ) {
      return json(response, 200, {
        total_count: 1,
        repositories: [{ full_name: "freed-project/freed" }],
      });
    }
    if (request.method === "DELETE" && url.pathname === "/installation/token") {
      revokedTokens += 1;
      response.writeHead(204);
      return response.end();
    }
    if (
      request.method === "GET" &&
      url.pathname === "/repos/freed-project/freed/git/ref/heads/dev"
    ) {
      return json(response, 200, { object: { type: "commit", sha: commit } });
    }
    if (
      request.method === "GET" &&
      url.pathname ===
        `/repos/freed-project/freed/contents/release-notes/releases/${tag}.json`
    ) {
      assert.equal(url.searchParams.get("ref"), commit);
      return json(response, 200, {
        encoding: "base64",
        content: receipt.toString("base64"),
      });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/repos/freed-project/freed/git/ref/tags/${tag}`
    ) {
      return tagCreated
        ? json(response, 200, { object: { type: "tag", sha: tagObjectSha } })
        : json(response, 404, { message: "Not Found" });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/repos/freed-project/freed/git/tags"
    ) {
      assert.deepEqual(body, {
        message: `Freed release ${tag}`,
        object: commit,
        tag,
        type: "commit",
      });
      return json(response, 201, { sha: tagObjectSha });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/repos/freed-project/freed/git/refs"
    ) {
      assert.deepEqual(body, {
        ref: `refs/tags/${tag}`,
        sha: tagObjectSha,
      });
      tagCreated = true;
      return json(response, 201, { ref: `refs/tags/${tag}` });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/repos/freed-project/freed/git/tags/${tagObjectSha}`
    ) {
      return json(response, 200, {
        tag,
        object: { type: "commit", sha: commit },
      });
    }
    return json(response, 500, {
      message: `Unexpected ${request.method} ${request.url}`,
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiBase = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) rmSync(fixtureRoot, { force: true, recursive: true });
});

test("production native publisher tools compile", { skip: !enabled }, () => {
  assert.ok(host);
  const hostSource = readFileSync(
    path.join(root, "scripts", "release-tag-publisher-host.swift"),
    "utf8",
  );
  assert.match(
    hostSource,
    /freed-release-publisher\.private-key\.pem/,
  );
  assert.match(hostSource, /getpwuid\(getuid\(\)\)/);
  assert.match(hostSource, /metadata\.st_mode & 0o7777 == 0o600/);
  assert.doesNotMatch(
    hostSource,
    /SecItemCopyMatching|SecItemAdd|SecItemUpdate|SecItemDelete|kSecAttrService/,
  );
  const attestBranch = hostSource.indexOf('if parsed.name == "attest"');
  const secretRead = hostSource.indexOf("var secret = try readPrivateKey");
  assert.ok(attestBranch >= 0 && secretRead > attestBranch);
  assert.doesNotMatch(
    hostSource.slice(attestBranch, secretRead),
    /readPrivateKey|SecItem|SecKeychain|Keychain/,
  );
});

test(
  "native readiness attestation never accesses the private key",
  { skip: !enabled },
  async () => {
    const original = readFileSync(keyPath);
    const originalConfig = readFileSync(configPath);
    try {
      rmSync(keyPath);
      const attested = await runHost(["attest", ...identityArgs()]);
      assert.equal(attested.status, 0, attested.stderr);
      const verified = await runHost(["verify-installation", ...identityArgs()]);
      assert.equal(verified.status, 1);
      assert.match(verified.stderr, /private key|No such file/);

      const pending = {
        ...JSON.parse(originalConfig.toString("utf8")),
        status: "pending",
      };
      writeFileSync(configPath, `${JSON.stringify(pending)}\n`, { mode: 0o600 });
      const pendingAttestation = await runHost(["attest", ...identityArgs()]);
      assert.equal(pendingAttestation.status, 0, pendingAttestation.stderr);
      writeFileSync(keyPath, original, { mode: 0o600 });
      const beforeRequests = requests.length;
      const pendingVerification = await runHost([
        "verify-installation",
        ...identityArgs(),
      ]);
      assert.equal(pendingVerification.status, 0, pendingVerification.stderr);
      assert.ok(requests.length > beforeRequests);
      const beforePublishRequests = requests.length;
      const pendingPublish = await runHost(publishArgs(), worktree);
      assert.equal(pendingPublish.status, 1);
      assert.match(pendingPublish.stderr, /binding is not active/);
      assert.equal(requests.length, beforePublishRequests);
    } finally {
      writeFileSync(configPath, originalConfig, { mode: 0o600 });
      writeFileSync(keyPath, original, { mode: 0o600 });
      originalConfig.fill(0);
      original.fill(0);
    }
  },
);

test(
  "native credential admission rejects unsafe local files before network access",
  { skip: !enabled },
  async () => {
    const originalKey = readFileSync(keyPath);
    const candidates = [];
    const cleanupPaths = [];
    const addCandidate = (name) => {
      const candidate = path.join(fixtureRoot, name);
      candidates.push(candidate);
      return candidate;
    };
    try {
      const missing = addCandidate("missing-key.pem");
      const symlink = addCandidate("symlink-key.pem");
      symlinkSync(keyPath, symlink);
      const hardLink = addCandidate("hardlink-key.pem");
      linkSync(keyPath, hardLink);
      const wrongMode = addCandidate("wrong-mode-key.pem");
      writeFileSync(wrongMode, originalKey, { mode: 0o644 });
      const oversized = addCandidate("oversized-key.pem");
      writeFileSync(oversized, Buffer.alloc(32 * 1_024 + 1), { mode: 0o600 });
      const invalid = addCandidate("invalid-key.pem");
      writeFileSync(invalid, "not an RSA private key\n", { mode: 0o600 });
      const fifo = addCandidate("fifo-key.pem");
      execFileSync("/usr/bin/mkfifo", [fifo]);
      const unsafeParent = path.join(fixtureRoot, "unsafe-parent");
      mkdirSync(unsafeParent, { mode: 0o700 });
      const unsafeParentKey = path.join(unsafeParent, "release-key.pem");
      writeFileSync(unsafeParentKey, originalKey, { mode: 0o600 });
      chmodSync(unsafeParent, 0o777);
      cleanupPaths.push(unsafeParent);
      const ancestorTarget = path.join(fixtureRoot, "ancestor-target");
      mkdirSync(ancestorTarget, { mode: 0o700 });
      writeFileSync(path.join(ancestorTarget, "release-key.pem"), originalKey, {
        mode: 0o600,
      });
      const symlinkedAncestor = path.join(fixtureRoot, "symlinked-ancestor");
      symlinkSync(ancestorTarget, symlinkedAncestor);
      const symlinkedAncestorKey = path.join(
        symlinkedAncestor,
        "release-key.pem",
      );
      cleanupPaths.push(symlinkedAncestor, ancestorTarget);

      for (const candidate of [
        missing,
        symlink,
        hardLink,
        wrongMode,
        oversized,
        invalid,
        fifo,
        unsafeParentKey,
        symlinkedAncestorKey,
      ]) {
        const beforeRequests = requests.length;
        const result = await runHost([
          "verify-installation",
          ...identityArgs("freed-project/freed", candidate),
        ]);
        assert.equal(result.status, 1, candidate);
        assert.equal(requests.length, beforeRequests, candidate);
      }

      const beforePublishRequests = requests.length;
      const publish = await runHost(
        publishArgs({ testKeyPath: invalid }),
        worktree,
      );
      assert.equal(publish.status, 1);
      assert.equal(requests.length, beforePublishRequests);
    } finally {
      for (const candidate of candidates.reverse()) {
        rmSync(candidate, { force: true });
      }
      for (const candidate of cleanupPaths.reverse()) {
        rmSync(candidate, { force: true, recursive: true });
      }
      originalKey.fill(0);
    }
  },
);

test(
  "native installation verification proves exact App and repository scope",
  { skip: !enabled },
  async () => {
    const result = await runHost(["verify-installation", ...identityArgs()]);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(
      value.purpose,
      "freed-release-tag-publisher-installation-readiness",
    );
    assert.equal(value.appName, "Freed Release Publisher");
    assert.equal(value.appOwnerLogin, "freed-project");
    assert.deepEqual(value.appPermissions, {
      contents: "write",
      metadata: "read",
    });
    assert.deepEqual(value.repositories, ["freed-project/freed"]);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secretToken));
  },
);

test(
  "native publisher rejects wrong repository",
  { skip: !enabled },
  async () => {
    const result = await runHost([
      "verify-installation",
      ...identityArgs("freed-project/not-freed"),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /do not match the root-owned App binding/);
    assert.doesNotMatch(result.stderr, new RegExp(secretToken));
  },
);

test(
  "native publisher rejects wrong branch and receipt digest",
  { skip: !enabled },
  async () => {
    const wrongBranch = await runHost(
      publishArgs({ branch: "main" }),
      worktree,
    );
    assert.equal(wrongBranch.status, 1);
    assert.match(wrongBranch.stderr, /tag, channel, branch/);
    const wrongDigest = await runHost(
      publishArgs({ releaseDigest: "f".repeat(64) }),
      worktree,
    );
    assert.equal(wrongDigest.status, 1);
    assert.match(wrongDigest.stderr, /local release receipt digest/);
    assert.doesNotMatch(
      wrongBranch.stderr + wrongDigest.stderr,
      new RegExp(secretToken),
    );
  },
);

test(
  "native publisher creates and verifies one annotated tag then revokes its token",
  { skip: !enabled },
  async () => {
    const revokedBefore = revokedTokens;
    const result = await runHost(publishArgs(), worktree);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.tag, tag);
    assert.equal(value.commit, commit);
    assert.equal(tagCreated, true);
    assert.equal(revokedTokens, revokedBefore + 1);
    const mutationOrder = requests
      .filter((item) => item.method === "POST")
      .map((item) => item.url);
    assert.ok(
      mutationOrder.indexOf("/repos/freed-project/freed/git/tags") <
        mutationOrder.indexOf("/repos/freed-project/freed/git/refs"),
    );
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secretToken));
  },
);
