import { describe, expect, it } from "vitest";
import {
  LIBRARY_CORE_MAX_WIRE_RECORD_BYTES,
  LIBRARY_CORE_WIRE_FRAME_VERSION,
  LibraryCoreWireFrameDecoderV1,
  decodeLibraryCoreWireFrameV1,
  encodeLibraryCoreWireFrameV1,
} from "./wire-frame.js";
import type { LibraryCoreCanonicalValue } from "./canonical-codec.js";

function recordIdentity(record: LibraryCoreCanonicalValue): string {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("test record requires operationId");
  }
  const operationId = (record as Record<string, LibraryCoreCanonicalValue>)
    .operationId;
  if (typeof operationId !== "string") {
    throw new TypeError("test record requires operationId");
  }
  return operationId;
}

const RECORDS: readonly LibraryCoreCanonicalValue[] = [
  { operationId: "operation-1", sequence: 1, value: "first" },
  { operationId: "operation-2", sequence: 2, value: "second" },
];

describe("Library Core wire frame v1", () => {
  it("encodes canonical records deterministically and decodes incrementally", () => {
    const encoded = encodeLibraryCoreWireFrameV1(RECORDS, {
      kind: "operations",
      recordIdentity,
    });
    expect(
      encodeLibraryCoreWireFrameV1(RECORDS, {
        kind: "operations",
        recordIdentity,
      }),
    ).toEqual(encoded);
    expect(encoded[8]).toBe(LIBRARY_CORE_WIRE_FRAME_VERSION);

    const decoder = new LibraryCoreWireFrameDecoderV1({
      kind: "operations",
      recordIdentity,
    });
    const decoded: LibraryCoreCanonicalValue[] = [];
    for (const byte of encoded) {
      decoded.push(...decoder.push(Uint8Array.of(byte)));
    }
    decoder.finish();
    expect(decoded).toEqual(RECORDS);
    expect(Object.isFrozen(decoded[0])).toBe(true);
  });

  it("rejects duplicate identities during construction and receipt", () => {
    const duplicate: readonly LibraryCoreCanonicalValue[] = [
      RECORDS[0]!,
      { operationId: "operation-1", sequence: 2 },
    ];
    expect(() =>
      encodeLibraryCoreWireFrameV1(duplicate, {
        kind: "operations",
        recordIdentity,
      }),
    ).toThrow(/duplicate record identity/);

    const encoded = encodeLibraryCoreWireFrameV1(RECORDS, {
      kind: "operations",
      recordIdentity: (record) =>
        (record as { readonly sequence: number }).sequence.toLocaleString(
          "en-US",
          { useGrouping: false },
        ),
    });
    expect(() =>
      decodeLibraryCoreWireFrameV1(encoded, {
        kind: "operations",
        recordIdentity: () => "forged-shared-identity",
      }),
    ).toThrow(/duplicate record identity/);
  });

  it("rejects future versions, wrong object kinds, and reserved header bits", () => {
    const encoded = encodeLibraryCoreWireFrameV1(RECORDS, {
      kind: "operations",
      recordIdentity,
    });
    const future = encoded.slice();
    future[8] = LIBRARY_CORE_WIRE_FRAME_VERSION + 1;
    expect(() =>
      decodeLibraryCoreWireFrameV1(future, {
        kind: "operations",
        recordIdentity,
      }),
    ).toThrow(/future version/);
    expect(() =>
      decodeLibraryCoreWireFrameV1(encoded, {
        kind: "intents",
        recordIdentity,
      }),
    ).toThrow(/kind does not match/);

    const reserved = encoded.slice();
    reserved[10] = 1;
    expect(() =>
      decodeLibraryCoreWireFrameV1(reserved, {
        kind: "operations",
        recordIdentity,
      }),
    ).toThrow(/reserved header/);
  });

  it("rejects truncation, trailing bytes, and record-count drift", () => {
    const encoded = encodeLibraryCoreWireFrameV1(RECORDS, {
      kind: "operations",
      recordIdentity,
    });
    expect(() =>
      decodeLibraryCoreWireFrameV1(encoded.slice(0, -1), {
        kind: "operations",
        recordIdentity,
      }),
    ).toThrow(/truncated|drifted/);

    const trailing = new Uint8Array(encoded.byteLength + 1);
    trailing.set(encoded);
    expect(() =>
      decodeLibraryCoreWireFrameV1(trailing, {
        kind: "operations",
        recordIdentity,
      }),
    ).toThrow(/trailing bytes/);

    const drifted = encoded.slice();
    new DataView(
      drifted.buffer,
      drifted.byteOffset,
      drifted.byteLength,
    ).setUint32(12, 3, false);
    expect(() =>
      decodeLibraryCoreWireFrameV1(drifted, {
        kind: "operations",
        recordIdentity,
      }),
    ).toThrow(/truncated|drifted/);
  });

  it("rejects noncanonical JSON and oversize records", () => {
    const encoded = encodeLibraryCoreWireFrameV1(RECORDS.slice(0, 1), {
      kind: "operations",
      recordIdentity,
    });
    const recordStart = 20;
    const source = new TextDecoder().decode(encoded.slice(recordStart));
    const noncanonicalSource = source.replace(
      '"operationId":"operation-1","sequence":1',
      '"sequence":1,"operationId":"operation-1"',
    );
    expect(noncanonicalSource).not.toBe(source);
    const noncanonicalBytes = new TextEncoder().encode(noncanonicalSource);
    const noncanonical = new Uint8Array(recordStart + noncanonicalBytes.length);
    noncanonical.set(encoded.slice(0, 16));
    new DataView(noncanonical.buffer).setUint32(
      16,
      noncanonicalBytes.length,
      false,
    );
    noncanonical.set(noncanonicalBytes, recordStart);
    expect(() =>
      decodeLibraryCoreWireFrameV1(noncanonical, {
        kind: "operations",
        recordIdentity,
      }),
    ).toThrow(/not RFC 8785 canonical/);

    expect(() =>
      encodeLibraryCoreWireFrameV1(
        [
          {
            operationId: "oversize",
            value: "x".repeat(LIBRARY_CORE_MAX_WIRE_RECORD_BYTES),
          },
        ],
        { kind: "operations", recordIdentity },
      ),
    ).toThrow(/exceeds/);
  });
});
