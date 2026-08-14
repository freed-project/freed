import { describe, expect, it } from "vitest";

import { base64ToBytes, bytesToBase64 } from "./google-drive";

// The contract: cloud bodies cross the Tauri IPC boundary as base64, never as a
// JSON number array. Tauri serialises a Rust Vec<u8> as an array of numbers, so
// a 38 MB document arrived as 38 million boxed JS numbers (~300 MB of renderer
// heap) plus the JSON string carrying it. WebKit does not return that promptly,
// so every cloud sync ratcheted the renderer upward.
describe("cloud IPC body encoding", () => {
  it("round-trips an empty body", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });

  it("round-trips every byte value, including nulls and high bytes", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    expect(Array.from(base64ToBytes(bytesToBase64(all)))).toEqual(Array.from(all));
  });

  it("round-trips across the chunk boundary without corruption", () => {
    // The encoder walks 32 KiB at a time; sizes either side of that boundary
    // are where an off-by-one would show up.
    for (const size of [32_767, 32_768, 32_769, 65_536, 100_003]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
      const restored = base64ToBytes(bytesToBase64(bytes));
      expect(restored.length).toBe(size);
      expect(restored[0]).toBe(bytes[0]);
      expect(restored[size - 1]).toBe(bytes[size - 1]);
      expect(restored[32_768]).toBe(bytes[32_768]);
    }
  });

  it("round-trips a realistic Automerge-sized payload", () => {
    // Not 38 MB in a unit test, but large enough that a chunking bug surfaces.
    const size = 2 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 131 + 17) & 0xff;

    const encoded = bytesToBase64(bytes);
    // Base64 is 4/3 plus padding. If this ever became a number array it would
    // be an order of magnitude larger, which is the whole point of the change.
    expect(encoded.length).toBeLessThan(size * 1.4);

    const restored = base64ToBytes(encoded);
    expect(restored.length).toBe(size);
    let mismatches = 0;
    for (let i = 0; i < size; i += 4096) {
      if (restored[i] !== bytes[i]) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });

  it("produces standard base64, matching the Rust STANDARD engine", () => {
    // The Rust side uses base64::engine::general_purpose::STANDARD. URL-safe
    // output would decode to garbage there, so pin the alphabet.
    const bytes = new Uint8Array([251, 255, 190, 239]);
    const encoded = bytesToBase64(bytes);
    expect(encoded).toBe("+/++7w==");
    expect(encoded).not.toContain("-");
    expect(encoded).not.toContain("_");
  });
});
