import type { LibraryCoreCanonicalValue } from "./canonical-codec.js";

const CODEC = "ieee754_binary64_hex_v1" as const;
const HEX_64 = /^[0-9a-f]{16}$/;

export interface LibraryCoreBinary64V1 {
  readonly bits: string;
  readonly codec: typeof CODEC;
}

function encodeNumber(value: number): LibraryCoreCanonicalValue {
  if (Number.isSafeInteger(value) && !Object.is(value, -0)) return value;
  if (!Number.isFinite(value)) {
    throw new TypeError("Library Core fractional numbers must be finite");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return Object.freeze({
    bits: [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    codec: CODEC,
  }) as Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

function isWrapper(value: unknown): value is LibraryCoreBinary64V1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
  ) {
    return false;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "bits" || keys[1] !== "codec") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.codec === CODEC &&
    typeof record.bits === "string" &&
    HEX_64.test(record.bits);
}

/** Encode finite fractional JSON numbers into the v1 canonical wrapper. */
export function encodeLibraryCoreFractionalNumbersV1(
  value: unknown,
): LibraryCoreCanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") return encodeNumber(value);
  if (Array.isArray(value)) {
    return Object.freeze(value.map(encodeLibraryCoreFractionalNumbersV1));
  }
  if (typeof value !== "object") {
    throw new TypeError("Library Core values must contain only JSON data");
  }
  if (isWrapper(value)) {
    throw new TypeError("Library Core values contain a reserved binary64 wrapper");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Library Core values must contain only plain objects");
  }
  const output: Record<string, LibraryCoreCanonicalValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined) continue;
    output[key] = encodeLibraryCoreFractionalNumbersV1(nested);
  }
  return Object.freeze(output);
}

/** Restore v1 binary64 wrappers after signature verification. */
export function decodeLibraryCoreFractionalNumbersV1(value: unknown): unknown {
  if (isWrapper(value)) {
    const bytes = Uint8Array.from(
      value.bits.match(/../g)!.map((pair) => Number.parseInt(pair, 16)),
    );
    const decoded = new DataView(bytes.buffer).getFloat64(0, false);
    if (!Number.isFinite(decoded)) {
      throw new TypeError("Library Core binary64 wrappers must decode to finite numbers");
    }
    return decoded;
  }
  if (Array.isArray(value)) {
    return value.map(decodeLibraryCoreFractionalNumbersV1);
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = decodeLibraryCoreFractionalNumbersV1(nested);
    }
    return output;
  }
  return value;
}
