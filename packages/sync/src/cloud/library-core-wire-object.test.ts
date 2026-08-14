import { describe, expect, it } from "vitest";
import type { LibraryCoreCanonicalValue } from "@freed/shared/library-core";
import {
  LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING,
  decodeLibraryCoreWireObjectV1,
  encodeLibraryCoreWireObjectV1,
} from "./library-core-wire-object.js";

function operationIdentity(record: LibraryCoreCanonicalValue): string {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("operation record requires operationId");
  }
  const operationId = (record as Record<string, LibraryCoreCanonicalValue>)
    .operationId;
  if (typeof operationId !== "string") {
    throw new TypeError("operation record requires operationId");
  }
  return operationId;
}

const OPTIONS = {
  kind: "operations",
  recordIdentity: operationIdentity,
} as const;

describe("Library Core gzip wire object", () => {
  it("round trips exact canonical records through deterministic gzip", async () => {
    const records: readonly LibraryCoreCanonicalValue[] = [
      { operationId: "operation-1", sequence: 1, value: "alpha" },
      { operationId: "operation-2", sequence: 2, value: "beta" },
    ];
    const first = await encodeLibraryCoreWireObjectV1(records, OPTIONS);
    const second = await encodeLibraryCoreWireObjectV1(records, OPTIONS);

    expect(first).toEqual(second);
    expect(first[0]).toBe(0x1f);
    expect(first[1]).toBe(0x8b);
    expect(await decodeLibraryCoreWireObjectV1(first, OPTIONS)).toEqual(
      records,
    );
  });

  it("rejects corrupt gzip, wrong frame families, and oversized stored input", async () => {
    const encoded = await encodeLibraryCoreWireObjectV1(
      [{ operationId: "operation-1", sequence: 1 }],
      OPTIONS,
    );
    const corrupt = encoded.slice();
    corrupt[Math.floor(corrupt.byteLength / 2)] ^= 0xff;

    await expect(
      decodeLibraryCoreWireObjectV1(corrupt, OPTIONS),
    ).rejects.toThrow();
    await expect(
      decodeLibraryCoreWireObjectV1(encoded, {
        ...OPTIONS,
        kind: "intents",
      }),
    ).rejects.toThrow(/kind does not match/);
    await expect(
      decodeLibraryCoreWireObjectV1(
        new Uint8Array(LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING),
        OPTIONS,
      ),
    ).rejects.toThrow(/must contain at least 1/);
  });

  it("rejects duplicate identities after decompression", async () => {
    const encoded = await encodeLibraryCoreWireObjectV1(
      [
        { operationId: "operation-1", sequence: 1 },
        { operationId: "operation-2", sequence: 2 },
      ],
      OPTIONS,
    );

    await expect(
      decodeLibraryCoreWireObjectV1(encoded, {
        kind: "operations",
        recordIdentity: () => "same-identity",
      }),
    ).rejects.toThrow(/duplicate record identity/);
  });
});
