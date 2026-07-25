import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SHADOW_COLUMNS, SHADOW_TABLE_DDL } from "./shadow-store.js";

/**
 * The shadow store schema exists twice: once in TypeScript, once in Rust at
 * packages/desktop/src-tauri/src/shadow_store.rs. Two copies of a schema drift.
 *
 * That is normally an annoyance. Here it is a data-loss bug waiting to happen,
 * because Stage 8 makes the write path one-way: after the retained Automerge
 * copy is pruned, a column the Rust side never wrote is not recoverable from
 * anywhere. A comment asking the next person to keep them in sync would not
 * survive contact with a hurried change, so this reads the Rust file and fails
 * instead.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUST_SOURCE = path.resolve(
  HERE,
  "../../desktop/src-tauri/src/shadow_store.rs",
);

function rustSource(): string {
  return readFileSync(RUST_SOURCE, "utf8");
}

/** Pull the string literals out of the `COLUMNS` slice. */
function rustColumns(source: string): string[] {
  const match = source.match(/pub const COLUMNS: &\[&str\] = &\[([\s\S]*?)\];/);
  if (match === null) throw new Error("COLUMNS not found in shadow_store.rs");
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!);
}

/** Pull the column names out of the Rust CREATE TABLE body. */
function rustTableColumns(source: string): string[] {
  const match = source.match(
    /CREATE TABLE IF NOT EXISTS feed_items \(([\s\S]*?)\) STRICT;/,
  );
  if (match === null) throw new Error("CREATE TABLE not found in shadow_store.rs");
  return match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[0]!)
    .filter((name) => /^[A-Za-z]/.test(name));
}

function tsTableColumns(): string[] {
  const match = SHADOW_TABLE_DDL.match(
    /CREATE TABLE IF NOT EXISTS feed_items \(([\s\S]*?)\) STRICT;/,
  );
  if (match === null) throw new Error("CREATE TABLE not found in SHADOW_TABLE_DDL");
  return match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[0]!)
    .filter((name) => /^[A-Za-z]/.test(name));
}

describe("shadow store schema parity across the IPC boundary", () => {
  it("declares the same columns, in the same order, on both sides", () => {
    // Order matters as much as membership: both sides generate their INSERT
    // from this list positionally, so a reordering binds every value to the
    // wrong column and still executes without error.
    expect(rustColumns(rustSource())).toStrictEqual([...SHADOW_COLUMNS]);
  });

  it("keeps each side's CREATE TABLE consistent with its own column list", () => {
    expect(rustTableColumns(rustSource()).sort()).toStrictEqual(
      [...SHADOW_COLUMNS].sort(),
    );
    expect(tsTableColumns().sort()).toStrictEqual([...SHADOW_COLUMNS].sort());
  });

  it("keeps the table STRICT on both sides", () => {
    // STRICT is what turns a lossy affinity coercion into an error at the
    // write. Losing it on one side only would mean the two engines silently
    // disagree about what was stored.
    expect(SHADOW_TABLE_DDL).toContain(") STRICT");
    expect(rustSource()).toContain(") STRICT");
  });

  it("binds every column on the Rust side", () => {
    // The Rust bind() builds a positional vector by hand. A column added to
    // COLUMNS but missed there shifts every later value by one and still
    // executes. Rust has its own test for the count; this asserts the guard
    // exists at all, so deleting it fails here too.
    expect(rustSource()).toContain("fn binds_every_declared_column");
    expect(rustSource()).toContain("COLUMNS.len()");
  });
});
