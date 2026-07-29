/**
 * Bounded canonical encoder for Library Core v1 protocol values.
 *
 * This is the construction side of the RFC 8785 contract. Received bytes need
 * a separate duplicate-preserving parser before they can be verified. Passing
 * a value through JSON.parse first would erase duplicate object names and is
 * therefore not a valid verification path.
 */

export const LIBRARY_CORE_MAX_DIRECT_CANONICAL_BYTES = 4_194_304;
export const LIBRARY_CORE_MAX_CANONICAL_NESTING_DEPTH = 128;
export const LIBRARY_CORE_MAX_CANONICAL_NODES = 65_536;

export const LIBRARY_CORE_OPERATION_DIGEST_DOMAINS = [
  "operation-payload",
  "operation-signing-body",
  "transaction-member",
  "transaction",
  "actor-chain-genesis",
  "actor-chain",
  "operation-envelope",
  "causal-frontier",
] as const;

export type LibraryCoreOperationDigestDomain =
  (typeof LIBRARY_CORE_OPERATION_DIGEST_DOMAINS)[number];

export type LibraryCoreCanonicalValue =
  | null
  | boolean
  | string
  | number
  | readonly LibraryCoreCanonicalValue[]
  | { readonly [key: string]: LibraryCoreCanonicalValue };

export interface LibraryCoreCanonicalEncodingOptions {
  readonly maximumBytes?: number;
}

const textEncoder = new TextEncoder();

function assertUnicodeScalarString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} contains an unpaired high surrogate`);
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`${label} contains an unpaired low surrogate`);
    }
  }
}

function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedMaximumBytes(
  options: LibraryCoreCanonicalEncodingOptions,
): number {
  const maximumBytes =
    options.maximumBytes ?? LIBRARY_CORE_MAX_DIRECT_CANONICAL_BYTES;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes <= 0 ||
    maximumBytes > LIBRARY_CORE_MAX_DIRECT_CANONICAL_BYTES
  ) {
    throw new RangeError(
      `maximumBytes must be a positive safe integer no greater than ${LIBRARY_CORE_MAX_DIRECT_CANONICAL_BYTES.toLocaleString()}`,
    );
  }
  return maximumBytes;
}

class BoundedUtf8Writer {
  private bytes: Uint8Array;
  private length = 0;
  private readonly maximumBytes: number;

  constructor(maximumBytes: number) {
    this.maximumBytes = maximumBytes;
    this.bytes = new Uint8Array(Math.min(maximumBytes, 1_024));
  }

  write(value: string): void {
    const encoded = textEncoder.encode(value);
    const nextLength = this.length + encoded.byteLength;
    if (nextLength > this.maximumBytes) {
      throw new RangeError(
        `canonical value exceeds ${this.maximumBytes.toLocaleString()} UTF-8 bytes`,
      );
    }
    if (nextLength > this.bytes.byteLength) {
      let capacity = this.bytes.byteLength;
      while (capacity < nextLength) {
        capacity = Math.min(
          this.maximumBytes,
          Math.max(capacity * 2, nextLength),
        );
      }
      const grown = new Uint8Array(capacity);
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }
    this.bytes.set(encoded, this.length);
    this.length = nextLength;
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

function writeCanonicalValue(
  writer: BoundedUtf8Writer,
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  nodeBudget: { count: number },
): void {
  nodeBudget.count += 1;
  if (nodeBudget.count > LIBRARY_CORE_MAX_CANONICAL_NODES) {
    throw new RangeError(
      `canonical value exceeds ${LIBRARY_CORE_MAX_CANONICAL_NODES.toLocaleString()} nodes`,
    );
  }
  if (depth > LIBRARY_CORE_MAX_CANONICAL_NESTING_DEPTH) {
    throw new RangeError(
      `canonical value exceeds ${LIBRARY_CORE_MAX_CANONICAL_NESTING_DEPTH.toLocaleString()} nesting levels`,
    );
  }

  if (value === null) {
    writer.write("null");
    return;
  }
  if (typeof value === "boolean") {
    writer.write(value ? "true" : "false");
    return;
  }
  if (typeof value === "string") {
    assertUnicodeScalarString(value, "canonical string");
    writer.write(JSON.stringify(value));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError(
        "canonical numbers must be safe integers and may not be negative zero",
      );
    }
    writer.write(String(value));
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`unsupported canonical value type: ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError("canonical values may not contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value);
      if (
        ownNames.length !== value.length + 1 ||
        ownNames[ownNames.length - 1] !== "length" ||
        Object.getOwnPropertySymbols(value).length !== 0
      ) {
        throw new TypeError(
          "canonical arrays must be dense and may not carry extra properties",
        );
      }
      writer.write("[");
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new TypeError(
            "canonical arrays require dense enumerable data elements",
          );
        }
        if (index > 0) writer.write(",");
        writeCanonicalValue(
          writer,
          descriptor.value,
          depth + 1,
          ancestors,
          nodeBudget,
        );
      }
      writer.write("]");
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical objects must be plain records");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("canonical objects may not contain symbol keys");
    }

    const keys = Object.getOwnPropertyNames(value).sort(compareUtf16CodeUnits);
    writer.write("{");
    keys.forEach((key, index) => {
      assertUnicodeScalarString(key, "canonical object key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError(
          "canonical objects require enumerable data properties",
        );
      }
      if (index > 0) writer.write(",");
      writer.write(JSON.stringify(key));
      writer.write(":");
      writeCanonicalValue(
        writer,
        descriptor.value,
        depth + 1,
        ancestors,
        nodeBudget,
      );
    });
    writer.write("}");
  } finally {
    ancestors.delete(value);
  }
}

export function encodeLibraryCoreCanonicalValue(
  value: LibraryCoreCanonicalValue,
  options: LibraryCoreCanonicalEncodingOptions = {},
): Uint8Array {
  const writer = new BoundedUtf8Writer(normalizedMaximumBytes(options));
  writeCanonicalValue(writer, value, 0, new Set(), { count: 0 });
  return writer.finish();
}

export function encodeLibraryCoreDigestInput(
  domain: LibraryCoreOperationDigestDomain,
  value: LibraryCoreCanonicalValue,
  options: LibraryCoreCanonicalEncodingOptions = {},
): Uint8Array {
  if (!LIBRARY_CORE_OPERATION_DIGEST_DOMAINS.includes(domain)) {
    throw new TypeError(`unregistered Library Core operation domain: ${domain}`);
  }
  const prefix = textEncoder.encode(
    `freed.library-core.v1/digest/${domain}\u0000`,
  );
  const maximumBytes = normalizedMaximumBytes(options);
  if (prefix.byteLength >= maximumBytes) {
    throw new RangeError("maximumBytes cannot fit the digest domain prefix");
  }
  const canonical = encodeLibraryCoreCanonicalValue(value, {
    maximumBytes: maximumBytes - prefix.byteLength,
  });
  const input = new Uint8Array(prefix.byteLength + canonical.byteLength);
  input.set(prefix);
  input.set(canonical, prefix.byteLength);
  return input;
}

export function encodeLibraryCoreOperationSignatureInput(
  value: LibraryCoreCanonicalValue,
  options: LibraryCoreCanonicalEncodingOptions = {},
): Uint8Array {
  const prefix = textEncoder.encode(
    "freed.library-core.v1/signature/operation-envelope\u0000",
  );
  const maximumBytes = normalizedMaximumBytes(options);
  if (prefix.byteLength >= maximumBytes) {
    throw new RangeError("maximumBytes cannot fit the signature domain prefix");
  }
  const canonical = encodeLibraryCoreCanonicalValue(value, {
    maximumBytes: maximumBytes - prefix.byteLength,
  });
  const input = new Uint8Array(prefix.byteLength + canonical.byteLength);
  input.set(prefix);
  input.set(canonical, prefix.byteLength);
  return input;
}
