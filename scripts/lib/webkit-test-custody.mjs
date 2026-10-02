import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

export function prepareSyntheticMasterKey(profileRoot, reopening = false) {
  requirePrivateSyntheticProfile(profileRoot);
  const path = join(profileRoot, WEBKIT_TEST_MASTER_KEY);
  if (!existsSync(path)) {
    if (reopening) throw new Error("Synthetic WebKit master key missing on reopen; refusing replacement");
    writeFileSync(path, randomBytes(16), { flag: "wx", mode: 0o600 });
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size !== 16) {
    throw new Error("Synthetic WebKit master key has invalid ownership, permissions or size");
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
      const stat = lstatSync(receiptPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 ||
          readFileSync(receiptPath, "utf8") !== "freed-webkit-custody-adapter-v1\n") throw new Error("WebKit custody adapter was not verified in this browser launch");
      rmSync(receiptPath);
    },
  };
}
