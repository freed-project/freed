import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every `invoke("name")` in the renderer must name a command Rust actually
 * registers in `generate_handler!`.
 *
 * TypeScript cannot check this: the command name is a string on one side of the
 * language boundary and a function identifier on the other. A rename, a
 * deletion, or a typo therefore fails only at runtime, inside the packaged app,
 * on whichever user first reaches that path. The desktop e2e smoke exercises a
 * handful of flows, not the full command surface.
 *
 * This is the same class of gap that let three shipping query identities go
 * unregistered in the Gate A census. Registries enforced by TypeScript
 * exhaustiveness are safe; inventories whose other half lives in Rust need an
 * explicit check.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = join(HERE, "..");
const LIB_RS = join(HERE, "..", "..", "src-tauri", "src", "lib.rs");

const INVOKE_CALL = /\binvoke(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"/g;
const GENERATE_HANDLER = /generate_handler!\[(.*?)\]/gs;

function rendererSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__mocks__") continue;
      files.push(...rendererSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) continue;
    files.push(full);
  }
  return files;
}

function invokedCommandNames(): Set<string> {
  const names = new Set<string>();
  for (const file of rendererSourceFiles(RENDERER_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(INVOKE_CALL)) names.add(match[1]!);
  }
  return names;
}

function registeredCommandNames(): Set<string> {
  const source = readFileSync(LIB_RS, "utf8");
  const names = new Set<string>();
  for (const block of source.matchAll(GENERATE_HANDLER)) {
    for (const entry of block[1]!.split(",")) {
      // Entries are paths like `module::command` or a bare `command`.
      const leaf = entry.trim().split("::").pop()?.trim();
      if (leaf && /^[a-z0-9_]+$/.test(leaf)) names.add(leaf);
    }
  }
  return names;
}

describe("Tauri command parity", () => {
  it("finds the command surfaces it is meant to police", () => {
    // Guards both extractors. If either silently stops matching, the parity
    // assertion below would pass while checking nothing.
    expect(invokedCommandNames().size).toBeGreaterThan(50);
    expect(registeredCommandNames().size).toBeGreaterThan(50);
  });

  it("registers every command the renderer invokes", () => {
    const registered = registeredCommandNames();
    const unregistered = [...invokedCommandNames()]
      .filter((name) => !registered.has(name))
      .sort();
    expect(
      unregistered,
      `The renderer invokes Tauri commands that lib.rs does not register: ${unregistered.join(", ")}. ` +
        "TypeScript cannot catch this, so it would surface only at runtime in the packaged app.",
    ).toEqual([]);
  });
});
