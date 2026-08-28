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

import CANONICAL_DOMAINS_V1 from "./canonical-domains-v1.json" with { type: "json" };

/**
 * The domain lists live once, in `canonical-domains-v1.json`.
 *
 * Rust embeds that same file with `include_str!`, the way the SQL schemas are
 * shared. Both sides reject an unregistered domain, so a list that existed
 * twice could drift and make a digest computed on one side unverifiable on the
 * The tuples below still exist because TypeScript cannot derive a literal
 * union from a JSON import, and losing `LibraryCoreDigestDomain` would remove
 * compile-time domain checking from every caller. They are bound to the file at
 * module load instead: a mismatch throws on import rather than waiting for a
 * test to be run, so a drifted build cannot start at all.
 */
export const LIBRARY_CORE_DIGEST_DOMAINS = [
  "authority-key",
  "actor-public-key",
  "actor-id",
  "actor-enrollment-body",
  "actor-enrollment-certificate",
  "actor-capability-issuance",
  "actor-capability-retirement",
  "actor-capability-body",
  "actor-capability-certificate",
  "actor-retirement-body",
  "actor-retirement-certificate",
  "agent-query-body",
  "epoch-transition-certificate",
  "operation-payload",
  "operation-signing-body",
  "transaction-member",
  "transaction",
  "actor-chain-genesis",
  "actor-chain",
  "operation-envelope",
  "intent-segment-body",
  "result-segment-body",
  "normalized-intent-segment-body-v2",
  "normalized-result-segment-body-v2",
  "follower-result-body",
  "causal-frontier",
  "legacy-source-admission-key",
  "legacy-source-admission-claim",
  "automerge-heads",
  "legacy-epoch-bootstrap-record",
  "legacy-library-control",
  "legacy-epoch-bootstrap-prepared",
  "legacy-epoch-bootstrap-receipt",
  "legacy-library-identity",
  "native-sqlite-library-identity",
  "native-sqlite-source-manifest",
  "installation-incarnation",
  "actor-incarnation-nonce",
] as const;

export type LibraryCoreDigestDomain =
  (typeof LIBRARY_CORE_DIGEST_DOMAINS)[number];

function assertMatchesSharedSource(
  list: readonly string[],
  source: readonly string[],
  which: string,
): void {
  const mismatch =
    list.length !== source.length ||
    list.some((domain, index) => domain !== source[index]);
  if (mismatch) {
    throw new Error(
      `Library Core ${which} domains disagree with canonical-domains-v1.json. ` +
        `Edit the JSON, which Rust also embeds, then mirror it here. ` +
        `TypeScript: ${JSON.stringify(list)}. File: ${JSON.stringify(source)}.`,
    );
  }
}

assertMatchesSharedSource(
  LIBRARY_CORE_DIGEST_DOMAINS,
  CANONICAL_DOMAINS_V1.digest,
  "digest",
);

export const LIBRARY_CORE_SIGNATURE_DOMAINS = [
  "operation-envelope",
  "actor-enrollment-proof",
  "actor-enrollment-authority",
  "actor-capability-authority",
  "actor-retirement-authority",
  "agent-query",
  "epoch-transition-certificate",
  "authority-key-possession",
  "follower-result-envelope",
  "legacy-source-admission-claim-key",
] as const;

assertMatchesSharedSource(
  LIBRARY_CORE_SIGNATURE_DOMAINS,
  CANONICAL_DOMAINS_V1.signature,
  "signature",
);

export type LibraryCoreSignatureDomain =
  (typeof LIBRARY_CORE_SIGNATURE_DOMAINS)[number];

export type LibraryCoreCanonicalValue =
  | null
  | boolean
  | string
  | number
  | readonly LibraryCoreCanonicalValue[]
  | { readonly [key: string]: LibraryCoreCanonicalValue };

export function isLibraryCoreCanonicalRecord(
  value: LibraryCoreCanonicalValue,
): value is Readonly<Record<string, LibraryCoreCanonicalValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface LibraryCoreCanonicalEncodingOptions {
  readonly maximumBytes?: number;
}

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

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
  domain: LibraryCoreDigestDomain,
  value: LibraryCoreCanonicalValue,
  options: LibraryCoreCanonicalEncodingOptions = {},
): Uint8Array {
  if (!LIBRARY_CORE_DIGEST_DOMAINS.includes(domain)) {
    throw new TypeError(`unregistered Library Core digest domain: ${domain}`);
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

export function encodeLibraryCoreSignatureInput(
  domain: LibraryCoreSignatureDomain,
  value: LibraryCoreCanonicalValue,
  options: LibraryCoreCanonicalEncodingOptions = {},
): Uint8Array {
  if (!LIBRARY_CORE_SIGNATURE_DOMAINS.includes(domain)) {
    throw new TypeError(
      `unregistered Library Core signature domain: ${domain}`,
    );
  }
  const prefix = textEncoder.encode(
    `freed.library-core.v1/signature/${domain}\u0000`,
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

export function encodeLibraryCoreOperationSignatureInput(
  value: LibraryCoreCanonicalValue,
  options: LibraryCoreCanonicalEncodingOptions = {},
): Uint8Array {
  return encodeLibraryCoreSignatureInput("operation-envelope", value, options);
}

class CanonicalJsonParser {
  private index = 0;
  private nodeCount = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parse(): LibraryCoreCanonicalValue {
    const value = this.parseValue(0);
    if (this.index !== this.source.length) {
      throw new TypeError("canonical JSON contains trailing input");
    }
    return value;
  }

  private countNode(depth: number): void {
    this.nodeCount += 1;
    if (this.nodeCount > LIBRARY_CORE_MAX_CANONICAL_NODES) {
      throw new RangeError(
        `canonical JSON exceeds ${LIBRARY_CORE_MAX_CANONICAL_NODES.toLocaleString()} nodes`,
      );
    }
    if (depth > LIBRARY_CORE_MAX_CANONICAL_NESTING_DEPTH) {
      throw new RangeError(
        `canonical JSON exceeds ${LIBRARY_CORE_MAX_CANONICAL_NESTING_DEPTH.toLocaleString()} nesting levels`,
      );
    }
  }

  private parseValue(depth: number): LibraryCoreCanonicalValue {
    this.countNode(depth);
    const token = this.source[this.index];
    if (token === '"') return this.parseString();
    if (token === "[") return this.parseArray(depth);
    if (token === "{") return this.parseObject(depth);
    if (token === "t") return this.parseKeyword("true", true);
    if (token === "f") return this.parseKeyword("false", false);
    if (token === "n") return this.parseKeyword("null", null);
    if (token === "-" || (token >= "0" && token <= "9")) {
      return this.parseInteger();
    }
    throw new TypeError("canonical JSON contains an invalid value");
  }

  private parseKeyword<T extends null | boolean>(keyword: string, value: T): T {
    if (
      this.source.slice(this.index, this.index + keyword.length) !== keyword
    ) {
      throw new TypeError(
        `canonical JSON contains an invalid ${keyword} token`,
      );
    }
    this.index += keyword.length;
    return value;
  }

  private parseInteger(): number {
    const start = this.index;
    if (this.source[this.index] === "-") {
      this.index += 1;
    }
    const firstDigit = this.source[this.index];
    if (firstDigit === "0") {
      this.index += 1;
      if (this.isDigit(this.source[this.index])) {
        throw new TypeError("canonical integers may not contain leading zeros");
      }
    } else if (firstDigit >= "1" && firstDigit <= "9") {
      this.index += 1;
      while (this.isDigit(this.source[this.index])) this.index += 1;
    } else {
      throw new TypeError("canonical JSON contains an invalid integer");
    }
    const next = this.source[this.index];
    if (next === "." || next === "e" || next === "E") {
      throw new TypeError(
        "canonical JSON numbers must use the safe-integer codec",
      );
    }
    const lexeme = this.source.slice(start, this.index);
    if (lexeme === "-0") {
      throw new TypeError("canonical integers may not be negative zero");
    }
    let integer: bigint;
    try {
      integer = BigInt(lexeme);
    } catch {
      throw new TypeError("canonical JSON contains an invalid integer");
    }
    if (
      integer < BigInt(Number.MIN_SAFE_INTEGER) ||
      integer > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new TypeError("canonical integer is outside the safe range");
    }
    return Number(integer);
  }

  private isDigit(value: string | undefined): boolean {
    return value !== undefined && value >= "0" && value <= "9";
  }

  private parseString(): string {
    this.index += 1;
    let result = "";
    while (this.index < this.source.length) {
      const codeUnit = this.source.charCodeAt(this.index);
      if (codeUnit === 0x22) {
        this.index += 1;
        return result;
      }
      if (codeUnit === 0x5c) {
        result += this.parseEscape();
        continue;
      }
      if (codeUnit < 0x20) {
        throw new TypeError(
          "canonical JSON strings may not contain raw control characters",
        );
      }
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = this.source.charCodeAt(this.index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          throw new TypeError("canonical JSON contains invalid Unicode");
        }
        result += this.source.slice(this.index, this.index + 2);
        this.index += 2;
        continue;
      }
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        throw new TypeError("canonical JSON contains invalid Unicode");
      }
      result += this.source[this.index];
      this.index += 1;
    }
    throw new TypeError("canonical JSON contains an unterminated string");
  }

  private parseEscape(): string {
    this.index += 1;
    const escaped = this.source[this.index];
    this.index += 1;
    switch (escaped) {
      case '"':
      case "\\":
      case "/":
        return escaped;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u":
        return this.parseUnicodeEscape();
      default:
        throw new TypeError("canonical JSON contains an invalid escape");
    }
  }

  private parseUnicodeEscape(): string {
    const high = this.parseHexCodeUnit();
    if (high >= 0xd800 && high <= 0xdbff) {
      if (
        this.source[this.index] !== "\\" ||
        this.source[this.index + 1] !== "u"
      ) {
        throw new TypeError("canonical JSON contains an unpaired surrogate");
      }
      this.index += 2;
      const low = this.parseHexCodeUnit();
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new TypeError("canonical JSON contains an unpaired surrogate");
      }
      return String.fromCodePoint(
        0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00),
      );
    }
    if (high >= 0xdc00 && high <= 0xdfff) {
      throw new TypeError("canonical JSON contains an unpaired surrogate");
    }
    return String.fromCharCode(high);
  }

  private parseHexCodeUnit(): number {
    const hex = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new TypeError("canonical JSON contains an invalid Unicode escape");
    }
    this.index += 4;
    return Number.parseInt(hex, 16);
  }

  private parseArray(depth: number): readonly LibraryCoreCanonicalValue[] {
    this.index += 1;
    const result: LibraryCoreCanonicalValue[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return Object.freeze(result);
    }
    while (true) {
      result.push(this.parseValue(depth + 1));
      const separator = this.source[this.index];
      this.index += 1;
      if (separator === "]") return Object.freeze(result);
      if (separator !== ",") {
        throw new TypeError("canonical JSON array has an invalid separator");
      }
    }
  }

  private parseObject(
    depth: number,
  ): Readonly<Record<string, LibraryCoreCanonicalValue>> {
    this.index += 1;
    const result: Record<string, LibraryCoreCanonicalValue> =
      Object.create(null);
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return Object.freeze(result);
    }
    while (true) {
      if (this.source[this.index] !== '"') {
        throw new TypeError("canonical JSON object key must be a string");
      }
      const key = this.parseString();
      if (keys.has(key)) {
        throw new TypeError("canonical JSON contains a duplicate object name");
      }
      keys.add(key);
      if (this.source[this.index] !== ":") {
        throw new TypeError("canonical JSON object key is missing a colon");
      }
      this.index += 1;
      result[key] = this.parseValue(depth + 1);
      const separator = this.source[this.index];
      this.index += 1;
      if (separator === "}") return Object.freeze(result);
      if (separator !== ",") {
        throw new TypeError("canonical JSON object has an invalid separator");
      }
    }
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function decodeLibraryCoreCanonicalValue(
  bytes: Uint8Array,
  options: LibraryCoreCanonicalEncodingOptions = {},
): LibraryCoreCanonicalValue {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("canonical input must be a Uint8Array");
  }
  const maximumBytes = normalizedMaximumBytes(options);
  if (bytes.byteLength > maximumBytes) {
    throw new RangeError(
      `canonical input exceeds ${maximumBytes.toLocaleString()} UTF-8 bytes`,
    );
  }
  const snapshot = new Uint8Array(bytes.byteLength);
  snapshot.set(bytes);
  let source: string;
  try {
    source = fatalTextDecoder.decode(snapshot);
  } catch {
    throw new TypeError("canonical input is not valid UTF-8");
  }
  const value = new CanonicalJsonParser(source).parse();
  const canonical = encodeLibraryCoreCanonicalValue(value, { maximumBytes });
  if (!bytesEqual(snapshot, canonical)) {
    throw new TypeError("canonical input bytes are not RFC 8785 canonical");
  }
  return value;
}
