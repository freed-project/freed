import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const WEBKIT_TEST_MASTER_KEY = ".freed-webkit-test-master-key";
let adapter;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");

export function requirePrivateSyntheticProfile(profileRoot) {
  const stat = lstatSync(profileRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700 ||
      realpathSync(dirname(profileRoot)) !== realpathSync(tmpdir()) || !basename(profileRoot).startsWith("freed-pwa-")) {
    throw new Error("WebKit custody fixture requires an owned private synthetic temporary profile");
  }
}

function readPrivateSyntheticFile(path, size) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size !== size) {
      throw new Error("Synthetic WebKit file has invalid ownership, permissions or size");
    }
    // Validate and read the same descriptor, without reopening a checked path.
    const bytes = Buffer.alloc(size + 1);
    if (readSync(descriptor, bytes, 0, bytes.length, 0) !== size) {
      throw new Error("Synthetic WebKit file changed size while reading");
    }
    return bytes.subarray(0, size);
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    throw new Error("Synthetic WebKit file is invalid", { cause: error });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readSyntheticMasterKey(profileRoot) {
  requirePrivateSyntheticProfile(profileRoot);
  return readPrivateSyntheticFile(join(profileRoot, WEBKIT_TEST_MASTER_KEY), 16);
}

export function prepareSyntheticMasterKey(profileRoot, reopening = false) {
  requirePrivateSyntheticProfile(profileRoot);
  const path = join(profileRoot, WEBKIT_TEST_MASTER_KEY);
  if (!reopening) {
    let descriptor;
    try {
      // Exclusive creation is the existence decision; never check then create.
      descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (descriptor !== undefined) {
      try { writeFileSync(descriptor, randomBytes(16)); } finally { closeSync(descriptor); }
    }
  }
  try { readPrivateSyntheticFile(path, 16).fill(0); }
  catch (error) {
    if (reopening && error.code === "ENOENT") throw new Error("Synthetic WebKit master key missing on reopen; refusing replacement");
    throw error;
  }
  return path;
}

export function prepareWebKitTestCustody(profileRoot, browserLauncher, reopening = false) {
  if (process.platform !== "darwin") return { launchOptions: {}, verifyLoaded() {} };
  if (process.env.DYLD_INSERT_LIBRARIES) throw new Error("Refusing inherited browser injection in the custody fixture");
  const keyPath = prepareSyntheticMasterKey(profileRoot, reopening);
  const version = JSON.parse(readFileSync(new URL("../../node_modules/playwright/package.json", import.meta.url), "utf8")).version;
  if (version !== "1.62.0") throw new Error("WebKit custody adapter requires source review for this Playwright version");
  const root = dirname(realpathSync(browserLauncher));
  const binary = realpathSync(join(root, "Playwright.app/Contents/MacOS/Playwright"));
  if (!adapter) {
    const source = fileURLToPath(new URL("./webkit-test-custody-adapter.m", import.meta.url));
    const temporary = mkdtempSync(join(tmpdir(), "freed-webkit-test-adapter-"));
    const library = join(temporary, "custody.dylib");
    execFileSync("clang", ["-dynamiclib", "-fobjc-arc", "-fblocks", "-framework", "Foundation", source, "-o", library], { stdio: "pipe" });
    const launcher = join(temporary, "launch.sh");
    // The protected system shell clears inherited DYLD variables; set them
    // only for this explicitly verified test browser after entering the shell.
    writeFileSync(launcher, `#!/bin/sh\nDYLD_INSERT_LIBRARIES=${quote(library)} DYLD_FRAMEWORK_PATH=${quote(root)} DYLD_LIBRARY_PATH=${quote(root)} ${quote(binary)} "$@"\n`, { mode: 0o700, flag: "wx" });
    adapter = { launcher, root, binary };
    process.once("exit", () => rmSync(temporary, { recursive: true, force: true }));
    console.log("macOS synthetic WebKit custody embedder", JSON.stringify({ playwrightVersion: version,
      adapterSourceSha256: digest(source), browserBinarySha256: digest(binary),
      scope: "native wrapping/persistence and JS nonextractability; not Keychain or physical Safari/iOS acceptance" }));
  }
  if (adapter.root !== root || adapter.binary !== binary) throw new Error("WebKit browser identity changed during fixture execution");
  const receiptPath = join(profileRoot, `.freed-webkit-adapter-${randomBytes(12).toString("hex")}`);
  return {
    launchOptions: { executablePath: adapter.launcher, env: { ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
      FREED_WEBKIT_TEST_BROWSER_BINARY: binary, FREED_WEBKIT_TEST_MASTER_KEY_FILE: keyPath,
      FREED_WEBKIT_TEST_ADAPTER_RECEIPT_FILE: receiptPath } },
    verifyLoaded() {
      const expected = "freed-webkit-custody-adapter-v1\n";
      if (readPrivateSyntheticFile(receiptPath, Buffer.byteLength(expected)).toString("utf8") !== expected) {
        throw new Error("WebKit custody adapter was not verified in this browser launch");
      }
      rmSync(receiptPath);
    },
  };
}
