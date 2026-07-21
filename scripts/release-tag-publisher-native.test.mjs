import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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
let provisioner;
let productionHost;
let productionProvisioner;
let recoveryKey;
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
let remoteBranchCommit;
let remoteReceipt;
let tagNameOverride = null;
let tagMessageOverride = null;
let tagTargetTypeOverride = null;
let tagTargetShaOverride = null;
let refResponseLosses = 0;
let revokeResponseLosses = 0;
let appOverrides = {};
let installationOverrides = {};
const requests = [];

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function cdHash(filePath) {
  const result = spawnSync(
    "/usr/bin/codesign",
    ["-d", "--verbose=4", filePath],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const stderrMatch = String(result.stderr ?? "").match(
    /CDHash=([0-9a-f]{40,64})/,
  );
  assert.ok(stderrMatch);
  return stderrMatch[1];
}

function nativePairSha256({
  publisherPath,
  publisherSha256,
  publisherCdHash,
  provisionerPath,
  provisionerSha256,
  provisionerCdHash,
}) {
  return createHash("sha256")
    .update(
      [
        "freed-release-tag-publisher-native-pair-v2",
        publisherPath,
        publisherSha256,
        publisherCdHash,
        provisionerPath,
        provisionerSha256,
        provisionerCdHash,
        "",
      ].join("\n"),
    )
    .digest("hex");
}

function writeNativeBinding(overrides = {}) {
  const binding = {
    schemaVersion: 3,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    publisherPath: host,
    publisherSha256: sha256(host),
    publisherCdHash: cdHash(host),
    provisionerPath: provisioner,
    provisionerSha256: sha256(provisioner),
    provisionerCdHash: cdHash(provisioner),
    ...overrides,
  };
  binding.nativePairSha256 =
    overrides.nativePairSha256 ?? nativePairSha256(binding);
  writeFileSync(configPath, `${JSON.stringify(binding, null, 2)}\n`, {
    mode: 0o600,
  });
  return binding;
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
  return new Promise((resolve) => {
    const child = spawn(host, args, {
      cwd,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function createProvisionerState() {
  const statePath = path.join(
    fixtureRoot,
    `provisioner-state-${randomUUID()}.json`,
  );
  writeFileSync(statePath, `${JSON.stringify({ exactDeleteCount: 0 })}\n`, {
    mode: 0o600,
  });
  return statePath;
}

function runProvisioner(action, statePath, options = {}) {
  const args = [action, "--host", host, "--test-store", statePath];
  if (options.expectedSha256) {
    args.push("--expected-sha256", options.expectedSha256);
  }
  if (options.failure) {
    args.push("--test-failure", options.failure);
  }
  return spawnSync(provisioner, args, {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
    input: options.input,
  });
}

function testingFlags() {
  return [
    "--config",
    configPath,
    "--test-key-file",
    keyPath,
    "--api-base",
    apiBase,
  ];
}

function identityArgs(repo = "freed-project/freed") {
  return [
    "--repo",
    repo,
    "--app-id",
    "4296969",
    "--app-slug",
    "freed-release-publisher",
    ...testingFlags(),
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
    ...testingFlags(),
  ];
}

function resetPublishState() {
  tagCreated = false;
  remoteBranchCommit = commit;
  remoteReceipt = receipt;
  tagNameOverride = null;
  tagMessageOverride = null;
  tagTargetTypeOverride = null;
  tagTargetShaOverride = null;
  refResponseLosses = 0;
  revokeResponseLosses = 0;
}

before(async () => {
  if (!enabled) return;
  fixtureRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-release-publisher-native-")),
  );
  chmodSync(fixtureRoot, 0o700);
  productionHost = path.join(fixtureRoot, "production-host");
  productionProvisioner = path.join(fixtureRoot, "production-provisioner");
  execFileSync(
    path.join(root, "scripts", "release-tag-publisher-build.sh"),
    [
      "--host-output",
      productionHost,
      "--provisioner-output",
      productionProvisioner,
    ],
    { cwd: root, stdio: "pipe" },
  );
  assert.equal(readFileSync(productionHost).length > 0, true);
  assert.equal(readFileSync(productionProvisioner).length > 0, true);

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
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", "--options", "runtime", host],
    { stdio: "pipe" },
  );
  chmodSync(host, 0o700);

  provisioner = path.join(fixtureRoot, "release-tag-publisher-provision-test");
  execFileSync(
    "/usr/bin/xcrun",
    [
      "--sdk",
      "macosx",
      "swiftc",
      "-D",
      "RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING",
      "-O",
      path.join(root, "scripts", "release-tag-publisher-provision.swift"),
      "-o",
      provisioner,
      "-framework",
      "Foundation",
      "-framework",
      "Security",
      "-framework",
      "CryptoKit",
    ],
    { cwd: root, stdio: "pipe" },
  );
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", "--options", "runtime", provisioner],
    { stdio: "pipe" },
  );
  chmodSync(provisioner, 0o700);

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  recoveryKey = privateKey;
  keyPath = path.join(fixtureRoot, "release-app.pem");
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  configPath = path.join(fixtureRoot, "release-tag-publisher.json");
  writeNativeBinding();

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
  resetPublishState();

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
        id: 4_296_969,
        slug: "freed-release-publisher",
        name: "Freed Release Publisher",
        external_url: "https://freed.wtf",
        events: [],
        permissions: { contents: "write", metadata: "read" },
        owner: { login: "freed-project", type: "Organization" },
        ...appOverrides,
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
        ...installationOverrides,
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
      if (revokeResponseLosses > 0) {
        revokeResponseLosses -= 1;
        response.destroy();
        return;
      }
      response.writeHead(204);
      return response.end();
    }
    if (
      request.method === "GET" &&
      url.pathname === "/repos/freed-project/freed/git/ref/heads/dev"
    ) {
      return json(response, 200, {
        object: { type: "commit", sha: remoteBranchCommit },
      });
    }
    if (
      request.method === "GET" &&
      url.pathname ===
        `/repos/freed-project/freed/contents/release-notes/releases/${tag}.json`
    ) {
      assert.equal(url.searchParams.get("ref"), commit);
      return json(response, 200, {
        encoding: "base64",
        content: remoteReceipt.toString("base64"),
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
      if (refResponseLosses > 0) {
        refResponseLosses -= 1;
        response.destroy();
        return;
      }
      return json(response, 201, { ref: `refs/tags/${tag}` });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/repos/freed-project/freed/git/tags/${tagObjectSha}`
    ) {
      return json(response, 200, {
        tag: tagNameOverride ?? tag,
        message: tagMessageOverride ?? `Freed release ${tag}`,
        object: {
          type: tagTargetTypeOverride ?? "commit",
          sha: tagTargetShaOverride ?? commit,
        },
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
  const provisionerSource = readFileSync(
    path.join(root, "scripts", "release-tag-publisher-provision.swift"),
    "utf8",
  );
  assert.match(hostSource, /kSecUseAuthenticationUIFail/);
  assert.match(provisionerSource, /kSecUseAuthenticationUIFail/);
  const keychainRead = hostSource.slice(
    hostSource.indexOf("private func uniqueKeychainItem"),
    hostSource.indexOf("private func readPrivateKey"),
  );
  assert.match(keychainRead, /kSecMatchLimit: kSecMatchLimitAll/);
  assert.match(keychainRead, /items\.count == 1/);
  const firstAcl = keychainRead.indexOf("exactKeychainACL");
  const contentCopy = keychainRead.indexOf("SecKeychainItemCopyContent");
  const secondAcl = keychainRead.indexOf("exactKeychainACL", firstAcl + 1);
  assert.ok(firstAcl >= 0 && firstAcl < contentCopy);
  assert.ok(secondAcl > contentCopy);
  assert.match(keychainRead, /memset_s\(content, Int\(length\), 0, Int\(length\)\)/);
  assert.match(keychainRead, /SecKeychainItemFreeContent\(nil, content\)/);
  const keychainStoreStart = provisionerSource.indexOf(
    "private final class KeychainStore",
  );
  const provisionerReadStart = provisionerSource.indexOf(
    "  func read(",
    keychainStoreStart,
  );
  const provisionerReadEnd = provisionerSource.indexOf(
    "\n  }\n\n}",
    provisionerReadStart,
  );
  const provisionerKeychainRead = provisionerSource.slice(
    provisionerReadStart,
    provisionerReadEnd,
  );
  const provisionerFirstAcl = provisionerKeychainRead.indexOf("aclMatches");
  const provisionerContentCopy = provisionerKeychainRead.indexOf(
    "SecKeychainItemCopyContent",
  );
  const provisionerSecondAcl = provisionerKeychainRead.indexOf(
    "aclMatches",
    provisionerFirstAcl + 1,
  );
  assert.ok(provisionerFirstAcl >= 0);
  assert.ok(provisionerContentCopy > provisionerFirstAcl);
  assert.ok(provisionerSecondAcl > provisionerContentCopy);
  assert.match(
    provisionerKeychainRead,
    /memset_s\(content, Int\(length\), 0, Int\(length\)\)/,
  );
  assert.match(
    provisionerKeychainRead,
    /SecKeychainItemFreeContent\(nil, content\)/,
  );
  assert.match(hostSource, /SecCodeCopySelf/);
  assert.match(hostSource, /requiredRuntimeSignatureFlag/);
  assert.match(hostSource, /requireHardenedRuntimeFlags/);
  assert.match(hostSource, /kSecCSDynamicInformation/);
  assert.match(hostSource, /kSecCodeInfoStatus/);
  assert.match(provisionerSource, /requireHardenedRuntime\(\)/);
  assert.match(provisionerSource, /kSecCSDynamicInformation/);
  assert.match(provisionerSource, /kSecCodeInfoStatus/);
  assert.match(provisionerSource, /clearEnvironment\(\)/);
  assert.match(hostSource, /kernelPublisherCdHash == binding\.publisherCdHash/);
  assert.match(hostSource, /staticPublisherCdHash == binding\.publisherCdHash/);
  assert.match(hostSource, /staticProvisionerCdHash == binding\.provisionerCdHash/);
  assert.doesNotMatch(hostSource, /String\(data: pem/);
  for (const source of [hostSource, provisionerSource]) {
    assert.match(source, /defer \{ encoded\.resetBytes/);
    assert.match(source, /defer \{ der\.resetBytes/);
  }
  const attestBranch = hostSource.indexOf('if parsed.name == "attest"');
  const secretRead = hostSource.indexOf(
    "var secret = try readPrivateKey",
    attestBranch,
  );
  assert.ok(attestBranch >= 0 && secretRead > attestBranch);
  assert.match(
    hostSource.slice(attestBranch, secretRead),
    /inspectPrivateKey/,
  );
});

test(
  "production hardened runtime blocks injected libraries in both native tools",
  { skip: !enabled },
  () => {
    const source = path.join(fixtureRoot, "publisher-injection.c");
    const library = path.join(fixtureRoot, "publisher-injection.dylib");
    const marker = path.join(fixtureRoot, "publisher-injection-ran");
    const controlSource = path.join(fixtureRoot, "publisher-injection-control.c");
    const control = path.join(fixtureRoot, "publisher-injection-control");
    writeFileSync(
      source,
      `#include <fcntl.h>\n#include <unistd.h>\n__attribute__((constructor)) static void injected(void) { int fd = open(${JSON.stringify(marker)}, O_WRONLY | O_CREAT, 0600); if (fd >= 0) { (void)write(fd, "x", 1); (void)close(fd); } }\n`,
      { mode: 0o600 },
    );
    execFileSync(
      "/usr/bin/xcrun",
      ["--sdk", "macosx", "clang", "-dynamiclib", source, "-o", library],
      { cwd: fixtureRoot, stdio: "pipe" },
    );
    writeFileSync(controlSource, "int main(void) { return 0; }\n", {
      mode: 0o600,
    });
    execFileSync(
      "/usr/bin/xcrun",
      ["--sdk", "macosx", "clang", controlSource, "-o", control],
      { cwd: fixtureRoot, stdio: "pipe" },
    );
    rmSync(marker, { force: true });
    const controlResult = spawnSync(control, [], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        DYLD_INSERT_LIBRARIES: library,
        PATH: "/usr/bin:/bin",
      },
    });
    assert.equal(controlResult.status, 0, controlResult.stderr);
    assert.equal(
      existsSync(marker),
      true,
      "the non-hardened control did not load the injected library",
    );
    for (const [tool, args] of [
      [
        productionHost,
        [
          "attest",
          "--repo",
          "freed-project/freed",
          "--app-id",
          "4296969",
          "--app-slug",
          "freed-release-publisher",
        ],
      ],
      [productionProvisioner, ["inspect", "--host", productionHost]],
    ]) {
      rmSync(marker, { force: true });
      const result = spawnSync(tool, args, {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          DYLD_INSERT_LIBRARIES: library,
          PATH: "/usr/bin:/bin",
        },
      });
      assert.notEqual(result.status, null, result.error?.message);
      assert.equal(existsSync(marker), false, `${tool} loaded injected code`);
      const signature = spawnSync(
        "/usr/bin/codesign",
        ["-d", "--verbose=4", tool],
        { encoding: "utf8" },
      );
      assert.equal(signature.status, 0, signature.stderr);
      assert.match(signature.stderr, /flags=.*runtime/i);
    }
  },
);

test(
  "native ACL model accepts exactly the host and provisioner with no prompt",
  { skip: !enabled },
  () => {
    const model = (applications, prompt) => {
      const value = spawnSync(
        provisioner,
        [
          "acl-model",
          "--test-acl-applications",
          applications.join(","),
          "--test-acl-prompt",
          prompt,
        ],
        {
          cwd: fixtureRoot,
          encoding: "utf8",
          env: { PATH: "/usr/bin:/bin" },
        },
      );
      assert.equal(value.status, 0, value.stderr);
      return JSON.parse(value.stdout).matched;
    };
    assert.equal(model(["host", "provisioner"], "empty"), true);
    assert.equal(model(["provisioner", "host"], "empty"), true);
    assert.equal(model(["host"], "empty"), false);
    assert.equal(model(["host", "provisioner", "other"], "empty"), false);
    assert.equal(model(["host", "host"], "empty"), false);
    assert.equal(model(["host", "provisioner"], "nonempty"), false);

    const production = spawnSync(
      productionProvisioner,
      [
        "acl-model",
        "--test-acl-applications",
        "host,provisioner",
        "--test-acl-prompt",
        "empty",
      ],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin" },
      },
    );
    assert.equal(production.status, 1);
    assert.doesNotMatch(production.stdout, /matched/);
  },
);

test(
  "production provisioner rejects every credential mutation before host or secret admission",
  { skip: !enabled },
  () => {
    const observable = [];
    for (const action of [
      "provision",
      "recover",
      "rotate",
      "discard-recovery",
      "revoke",
    ]) {
      const result = spawnSync(
        productionProvisioner,
        [action, "--host", "/path/that/must/not/be-admitted"],
        {
          cwd: fixtureRoot,
          encoding: "utf8",
          env: { PATH: "/usr/bin:/bin" },
          input: recoveryKey,
        },
      );
      assert.equal(result.status, 1, `${action}: ${result.stderr}`);
      assert.match(
        result.stderr,
        /Credential mutation is unavailable until one-use kernel-attested owner authorization/,
      );
      assert.doesNotMatch(result.stderr, /does not resolve|requires --host/);
      observable.push(result.stdout, result.stderr);
    }
    assert.doesNotMatch(observable.join("\n"), /BEGIN RSA PRIVATE KEY/);
  },
);

test(
  "testing provisioner recovers and matches only the expected item",
  { skip: !enabled },
  () => {
    const statePath = createProvisionerState();
    const digest = createHash("sha256").update(recoveryKey).digest("hex");

    const missing = runProvisioner("inspect", statePath);
    assert.equal(missing.status, 0, missing.stderr);
    const missingResult = JSON.parse(missing.stdout);
    assert.equal(missingResult.state, "missing");
    assert.deepEqual(Object.keys(missingResult).sort(), [
      "account",
      "action",
      "host",
      "purpose",
      "schemaVersion",
      "service",
      "state",
    ]);
    assert.equal(missingResult.schemaVersion, 2);

    const recovered = runProvisioner("recover", statePath, {
      expectedSha256: digest,
      input: recoveryKey,
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    const recoveredResult = JSON.parse(recovered.stdout);
    assert.equal(recoveredResult.changed, true);
    assert.deepEqual(Object.keys(recoveredResult).sort(), [
      "account",
      "action",
      "changed",
      "host",
      "purpose",
      "schemaVersion",
      "service",
    ]);

    const matched = runProvisioner("matches", statePath, {
      expectedSha256: digest,
    });
    assert.equal(matched.status, 0, matched.stderr);
    assert.equal(JSON.parse(matched.stdout).matched, true);

    const duplicate = runProvisioner("recover", statePath, {
      expectedSha256: digest,
      input: recoveryKey,
    });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /already exists/);

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.notEqual(state.itemId ?? null, null);
    assert.equal(state.exactDeleteCount, 0);

    const output = [missing, recovered, matched, duplicate]
      .flatMap((result) => [result.stdout, result.stderr])
      .join("\n");
    assert.doesNotMatch(output, /BEGIN RSA PRIVATE KEY/);
  },
);

test(
  "native provisioner rolls back the exact item when creation validation fails",
  { skip: !enabled },
  () => {
    const statePath = createProvisionerState();
    const digest = createHash("sha256").update(recoveryKey).digest("hex");
    const mismatched = runProvisioner("recover", statePath, {
      expectedSha256: "0".repeat(64),
      input: recoveryKey,
    });
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stderr, /does not match the admitted file digest/);
    let state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.itemId ?? null, null);
    assert.equal(state.exactDeleteCount, 0);

    const result = runProvisioner("recover", statePath, {
      expectedSha256: digest,
      failure: "read-created",
      input: recoveryKey,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Injected test failure/);
    state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.itemId ?? null, null);
    assert.equal(state.exactDeleteCount, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /BEGIN RSA PRIVATE KEY/);
  },
);

test(
  "testing provisioner rejects non-ASCII and oversized PEM input without creating an item",
  { skip: !enabled },
  () => {
    for (const input of [
      Buffer.concat([
        Buffer.from("-----BEGIN RSA PRIVATE KEY-----\n"),
        Buffer.from([0xff]),
        Buffer.from("\n-----END RSA PRIVATE KEY-----\n"),
      ]),
      Buffer.alloc(32 * 1_024 + 1, 0x41),
    ]) {
      const statePath = createProvisionerState();
      const result = runProvisioner("recover", statePath, {
        expectedSha256: createHash("sha256").update(input).digest("hex"),
        input,
      });
      assert.equal(result.status, 1);
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      assert.equal(state.itemId ?? null, null);
      assert.equal(state.exactDeleteCount, 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /BEGIN RSA/);
    }
  },
);

test(
  "native provisioner never widens rollback when exact deletion fails",
  { skip: !enabled },
  () => {
    const statePath = createProvisionerState();
    const digest = createHash("sha256").update(recoveryKey).digest("hex");
    const result = runProvisioner("recover", statePath, {
      expectedSha256: digest,
      failure: "read-created-delete-created",
      input: recoveryKey,
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /exact newly created item could not be rolled back/,
    );
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.match(state.itemId, /^[a-f0-9-]{36}$/);
    assert.equal(state.exactDeleteCount, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /BEGIN RSA PRIVATE KEY/);
  },
);

test(
  "native publisher attests one exact host and provisioner generation",
  { skip: !enabled },
  async () => {
    const result = await runHost(["attest", ...identityArgs()]);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.schemaVersion, 3);
    assert.deepEqual(Object.keys(value).sort(), [
      "allowsArbitraryRefs",
      "allowsDeletions",
      "allowsUpdates",
      "appId",
      "appSlug",
      "credentialMode",
      "nativePairSha256",
      "operations",
      "provisionerCdHash",
      "provisionerSha256",
      "publisherCdHash",
      "publisherSha256",
      "purpose",
      "repo",
      "schemaVersion",
    ]);
    assert.equal(value.publisherSha256, sha256(host));
    assert.equal(value.publisherCdHash, cdHash(host));
    assert.equal(value.provisionerSha256, sha256(provisioner));
    assert.equal(value.provisionerCdHash, cdHash(provisioner));
    assert.equal(
      value.nativePairSha256,
      nativePairSha256({
        publisherPath: host,
        publisherSha256: sha256(host),
        publisherCdHash: cdHash(host),
        provisionerPath: provisioner,
        provisionerSha256: sha256(provisioner),
        provisionerCdHash: cdHash(provisioner),
      }),
    );
    assert.equal("digest" in value, false);
  },
);

test(
  "native attest checks credential admission without reading or importing the secret",
  { skip: !enabled },
  async () => {
    const original = readFileSync(keyPath);
    try {
      writeFileSync(keyPath, "not-a-private-key\n", { mode: 0o600 });
      const attested = await runHost(["attest", ...identityArgs()]);
      assert.equal(attested.status, 0, attested.stderr);
      const consumed = await runHost([
        "verify-installation",
        ...identityArgs(),
      ]);
      assert.equal(consumed.status, 1);
      assert.match(consumed.stderr, /PKCS1|RSA PRIVATE KEY/);
    } finally {
      writeFileSync(keyPath, original, { mode: 0o600 });
      original.fill(0);
    }
  },
);

test(
  "native identity arguments require canonical numeric ID text and exact lowercase slug",
  { skip: !enabled },
  async () => {
    for (const [flag, value] of [
      ["--app-id", "04296969"],
      ["--app-slug", "Freed-Release-Publisher"],
    ]) {
      const args = ["attest", ...identityArgs()];
      args[args.indexOf(flag) + 1] = value;
      const result = await runHost(args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /do not match the root-owned App binding/);
    }
  },
);

test(
  "native publisher rejects a mixed provisioner generation before credential use",
  { skip: !enabled },
  async () => {
    try {
      writeNativeBinding({ provisionerSha256: sha256(productionProvisioner) });
      const result = await runHost(["attest", ...identityArgs()]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /bound provisioner digest/);
      assert.doesNotMatch(result.stderr, /Keychain key is unavailable/);

      writeNativeBinding({ nativePairSha256: "0".repeat(64) });
      const invalidPair = await runHost(["attest", ...identityArgs()]);
      assert.equal(invalidPair.status, 1);
      assert.match(invalidPair.stderr, /native pair digest is invalid/);
      assert.doesNotMatch(invalidPair.stderr, /Keychain key is unavailable/);
    } finally {
      writeNativeBinding();
    }
  },
);

test(
  "native publisher rejects schema 1 and multiply linked native files before credential use",
  { skip: !enabled },
  async () => {
    try {
      writeFileSync(
        configPath,
        `${JSON.stringify({
          schemaVersion: 1,
          purpose: "freed-release-tag-publisher-binding",
          status: "active",
          repo: "freed-project/freed",
          appId: 4_296_969,
          appSlug: "freed-release-publisher",
          publisherPath: host,
          publisherSha256: sha256(host),
        })}\n`,
        { mode: 0o600 },
      );
      const legacy = await runHost(["attest", ...identityArgs()]);
      assert.equal(legacy.status, 1);
      assert.match(legacy.stderr, /unsupported or missing fields/);
      assert.doesNotMatch(legacy.stderr, /private key is unavailable/);
    } finally {
      writeNativeBinding();
    }

    const secondLink = `${provisioner}.second-link`;
    try {
      linkSync(provisioner, secondLink);
      const linked = await runHost(["attest", ...identityArgs()]);
      assert.equal(linked.status, 1);
      assert.match(linked.stderr, /unsafe type or permissions/);
      assert.doesNotMatch(linked.stderr, /private key is unavailable/);
    } finally {
      rmSync(secondLink, { force: true });
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
  "native publisher rejects wrong App casing and installation account before mutation",
  { skip: !enabled },
  async () => {
    try {
      appOverrides = { slug: "Freed-Release-Publisher" };
      const wrongSlug = await runHost([
        "verify-installation",
        ...identityArgs(),
      ]);
      assert.equal(wrongSlug.status, 1);
      assert.match(wrongSlug.stderr, /exact private Freed Release Publisher App/);
      appOverrides = {};

      for (const account of [
        { login: "someone-else", type: "Organization" },
        { login: "freed-project", type: "User" },
      ]) {
        installationOverrides = { account };
        const mutationsBefore = requests.filter(
          ({ method, url }) =>
            method === "POST" &&
            (url.includes("/git/tags") || url.includes("/git/refs")),
        ).length;
        const result = await runHost(publishArgs(), worktree);
        assert.equal(result.status, 1);
        assert.match(
          result.stderr,
          /active, selected-repository only, and have exactly Contents write plus Metadata read/,
        );
        assert.equal(
          requests.filter(
            ({ method, url }) =>
              method === "POST" &&
              (url.includes("/git/tags") || url.includes("/git/refs")),
          ).length,
          mutationsBefore,
        );
      }
    } finally {
      appOverrides = {};
      installationOverrides = {};
    }
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
    resetPublishState();
    const revokedBefore = revokedTokens;
    const requestsBefore = requests.length;
    const result = await runHost(publishArgs(), worktree);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.tag, tag);
    assert.equal(value.commit, commit);
    assert.equal(value.tagObjectSha, tagObjectSha);
    assert.equal(value.recovered, false);
    assert.equal(tagCreated, true);
    assert.equal(revokedTokens, revokedBefore + 1);
    const mutationOrder = requests
      .slice(requestsBefore)
      .filter((item) => item.method === "POST")
      .map((item) => item.url);
    assert.ok(
      mutationOrder.indexOf("/repos/freed-project/freed/git/tags") <
        mutationOrder.indexOf("/repos/freed-project/freed/git/refs"),
    );
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secretToken));
  },
);

test(
  "native publisher verifies the created annotated tag object before creating its ref",
  { skip: !enabled },
  async () => {
    const cases = [
      {
        label: "wrong tag name",
        configure: () => {
          tagNameOverride = `${tag}-wrong`;
        },
      },
      {
        label: "wrong message",
        configure: () => {
          tagMessageOverride = "Unexpected release annotation";
        },
      },
      {
        label: "wrong target type",
        configure: () => {
          tagTargetTypeOverride = "tree";
        },
      },
      {
        label: "wrong target commit",
        configure: () => {
          tagTargetShaOverride = "c".repeat(40);
        },
      },
    ];

    for (const scenario of cases) {
      resetPublishState();
      scenario.configure();
      const revokedBefore = revokedTokens;
      const requestsBefore = requests.length;
      const result = await runHost(publishArgs(), worktree);
      assert.equal(result.status, 1, `${scenario.label}: ${result.stderr}`);
      assert.match(
        result.stderr,
        /does not identify the exact approved release/,
        scenario.label,
      );
      assert.equal(tagCreated, false, scenario.label);
      assert.equal(revokedTokens, revokedBefore + 1, scenario.label);
      const attemptRequests = requests.slice(requestsBefore);
      assert.equal(
        attemptRequests.filter(
          ({ method, url }) =>
            method === "POST" &&
            url === "/repos/freed-project/freed/git/tags",
        ).length,
        1,
        scenario.label,
      );
      assert.equal(
        attemptRequests.some(
          ({ method, url }) =>
            method === "POST" &&
            url === "/repos/freed-project/freed/git/refs",
        ),
        false,
        scenario.label,
      );
      assert.doesNotMatch(
        result.stdout + result.stderr,
        new RegExp(secretToken),
        scenario.label,
      );
    }
    resetPublishState();
  },
);

test(
  "native publisher recovers an exact existing tag after the protected branch advances",
  { skip: !enabled },
  async () => {
    resetPublishState();
    const first = await runHost(publishArgs(), worktree);
    assert.equal(first.status, 0, first.stderr);
    const created = JSON.parse(first.stdout);
    assert.equal(created.recovered, false);
    remoteBranchCommit = "c".repeat(40);
    const requestsBefore = requests.length;
    const retry = await runHost(publishArgs(), worktree);
    assert.equal(retry.status, 0, retry.stderr);
    const recovered = JSON.parse(retry.stdout);
    assert.deepEqual(recovered, { ...created, recovered: true });
    assert.equal(
      requests
        .slice(requestsBefore)
        .some(
          ({ method, url }) =>
            method === "GET" && url.includes("/git/ref/heads/dev"),
        ),
      false,
    );
  },
);

test(
  "native publisher recovers when tag ref creation succeeds but its response is lost",
  { skip: !enabled },
  async () => {
    resetPublishState();
    refResponseLosses = 1;
    const first = await runHost(publishArgs(), worktree);
    assert.equal(first.status, 1);
    assert.equal(tagCreated, true);
    assert.match(first.stderr, /failed|response|network|GitHub/i);
    const retry = await runHost(publishArgs(), worktree);
    assert.equal(retry.status, 0, retry.stderr);
    const recovered = JSON.parse(retry.stdout);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.tagObjectSha, tagObjectSha);
  },
);

test(
  "native publisher recovers when token revocation responses are lost after tag creation",
  { skip: !enabled },
  async () => {
    resetPublishState();
    revokeResponseLosses = 2;
    const first = await runHost(publishArgs(), worktree);
    assert.equal(first.status, 1);
    assert.equal(tagCreated, true);
    const retry = await runHost(publishArgs(), worktree);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).recovered, true);
  },
);

test(
  "native publisher rejects an existing tag with the wrong annotated message",
  { skip: !enabled },
  async () => {
    resetPublishState();
    tagCreated = true;
    tagMessageOverride = "Unexpected release annotation";
    const requestsBefore = requests.length;
    const result = await runHost(publishArgs(), worktree);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not identify the exact approved release/);
    assert.equal(
      requests
        .slice(requestsBefore)
        .some(
          ({ method, url }) =>
            method === "POST" &&
            (url.includes("/git/tags") || url.includes("/git/refs")),
        ),
      false,
    );
  },
);

test(
  "native publisher rechecks the committed receipt before recovering an existing tag",
  { skip: !enabled },
  async () => {
    resetPublishState();
    tagCreated = true;
    remoteReceipt = Buffer.from(
      `${JSON.stringify({
        tag,
        version: tag.slice(1),
        channel: "dev",
        approved: true,
        source: { channel: "dev", productCommitSha: "d".repeat(40) },
      })}\n`,
    );
    const requestsBefore = requests.length;
    const result = await runHost(publishArgs(), worktree);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /committed remote release receipt digest/);
    assert.equal(
      requests
        .slice(requestsBefore)
        .some(({ url }) => url.includes(`/git/ref/tags/${tag}`)),
      false,
    );
  },
);
