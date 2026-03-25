import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "../..");
const tauriCli = resolve(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const nodeBinDir = resolve(repoRoot, "node_modules", ".bin");

const env = {
  ...process.env,
  PATH: `${nodeBinDir}:${process.env.PATH ?? ""}`,
};
const tauriArgs = process.argv.slice(2);
const isDevCommand = tauriArgs[0] === "dev";

if (isDevCommand) {
  env.FREED_SYNC_PORT = env.FREED_SYNC_PORT || "8766";
  env.VITE_FREED_SYNC_PORT = env.VITE_FREED_SYNC_PORT || env.FREED_SYNC_PORT;
}

if (process.platform === "darwin") {
  try {
    const sdkRoot = execFileSync("xcrun", ["--show-sdk-path"], {
      encoding: "utf8",
    }).trim();
    const libcxxInclude = `${sdkRoot}/usr/include/c++/v1`;
    const includeFlag = `-isystem ${libcxxInclude}`;

    env.SDKROOT = env.SDKROOT || sdkRoot;
    env.CXXFLAGS = env.CXXFLAGS ? `${env.CXXFLAGS} ${includeFlag}` : includeFlag;
    env.CFLAGS = env.CFLAGS ? `${env.CFLAGS} ${includeFlag}` : includeFlag;
    env.CPPFLAGS = env.CPPFLAGS ? `${env.CPPFLAGS} ${includeFlag}` : includeFlag;
  } catch {
    // Fall back to the existing environment if xcrun is unavailable.
  }
}

const child = spawn(process.execPath, [tauriCli, ...tauriArgs], {
  cwd: packageDir,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
