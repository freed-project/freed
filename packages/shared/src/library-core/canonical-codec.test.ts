import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import vectors from "./canonical-codec-vectors.json";
import {
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreOperationSignatureInput,
  LIBRARY_CORE_MAX_CANONICAL_NODES,
  LIBRARY_CORE_MAX_CANONICAL_NESTING_DEPTH,
} from "./canonical-codec.js";

const decoder = new TextDecoder();

describe("Library Core canonical codec", () => {
  it.each(vectors)("$name matches the cross-runtime canonical vector", (test) => {
    expect(
      decoder.decode(encodeLibraryCoreCanonicalValue(test.value as never)),
    ).toBe(test.canonical);
  });

  it("builds exact domain-separated digest and signature inputs", () => {
    const value = { schema_version: 1, operation_type: "person_upsert" };
    const digestInput = encodeLibraryCoreDigestInput(
      "operation-payload",
      value,
    );
    const signatureInput = encodeLibraryCoreOperationSignatureInput({
      operation_signing_body_digest:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });

    expect(decoder.decode(digestInput)).toBe(
      'freed.library-core.v1/digest/operation-payload\u0000{"operation_type":"person_upsert","schema_version":1}',
    );
    expect(createHash("sha256").update(digestInput).digest("hex")).toBe(
      "5192eab75edf78a8181905197adec6ae800e93ce7d568aaf4f1b6f2e98d28285",
    );
    expect(decoder.decode(signatureInput)).toBe(
      'freed.library-core.v1/signature/operation-envelope\u0000{"operation_signing_body_digest":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}',
    );
    expect(() =>
      encodeLibraryCoreOperationSignatureInput(null, { maximumBytes: 20 }),
    ).toThrow(/prefix/);
    expect(() =>
      encodeLibraryCoreDigestInput("made-up-domain" as never, null),
    ).toThrow(/unregistered/);
  });

  it.each([
    ["negative zero", -0],
    ["fraction", 0.5],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["undefined", undefined],
    ["byte array", new Uint8Array([1, 2, 3])],
    ["date", new Date(0)],
    ["unpaired high surrogate", "\ud800"],
    ["unpaired low surrogate", "\udc00"],
  ])("rejects %s", (_name, value) => {
    expect(() =>
      encodeLibraryCoreCanonicalValue(value as never),
    ).toThrowError();
  });

  it("rejects sparse arrays, extra array properties, symbols, accessors, and cycles", () => {
    const sparse = new Array(2);
    sparse[1] = "present";
    const decorated: unknown[] & { extra?: string } = [];
    decorated.extra = "hidden protocol input";
    const symbolRecord = { valid: true } as Record<
      string | symbol,
      unknown
    >;
    symbolRecord[Symbol("hidden")] = true;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "surprise",
    });
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get: () => "surprise",
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    for (const value of [
      sparse,
      decorated,
      symbolRecord,
      accessor,
      accessorArray,
      cyclic,
    ]) {
      expect(() =>
        encodeLibraryCoreCanonicalValue(value as never),
      ).toThrowError();
    }
  });

  it("enforces byte and nesting ceilings before returning canonical bytes", () => {
    expect(() =>
      encodeLibraryCoreCanonicalValue("12345", { maximumBytes: 4 }),
    ).toThrow(/exceeds/);

    let nested: unknown = null;
    for (
      let depth = 0;
      depth <= LIBRARY_CORE_MAX_CANONICAL_NESTING_DEPTH;
      depth += 1
    ) {
      nested = [nested];
    }
    expect(() =>
      encodeLibraryCoreCanonicalValue(nested as never),
    ).toThrow(/nesting/);

    expect(() =>
      encodeLibraryCoreCanonicalValue(
        Array.from(
          { length: LIBRARY_CORE_MAX_CANONICAL_NODES },
          () => null,
        ),
      ),
    ).toThrow(/nodes/);
  });
});
