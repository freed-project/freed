import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";

export const LIBRARY_CORE_WIRE_FRAME_VERSION = 1 as const;
export const LIBRARY_CORE_MAX_WIRE_RECORDS = 4_096;
export const LIBRARY_CORE_MAX_WIRE_RECORD_BYTES = 1_048_576;
export const LIBRARY_CORE_MAX_DECODED_WIRE_BYTES = 33_554_432;

export const LIBRARY_CORE_WIRE_FRAME_KINDS = [
  "checkpoint",
  "operations",
  "intents",
  "results",
  "search",
] as const;

export type LibraryCoreWireFrameKind =
  (typeof LIBRARY_CORE_WIRE_FRAME_KINDS)[number];

export interface LibraryCoreWireFrameOptions {
  readonly kind: LibraryCoreWireFrameKind;
  readonly maximumDecodedBytes?: number;
  readonly maximumRecordBytes?: number;
  readonly maximumRecords?: number;
  readonly recordIdentity: (record: LibraryCoreCanonicalValue) => string;
}

const MAGIC = new TextEncoder().encode("FRDV2FRM");
const HEADER_BYTES = 16;
const LENGTH_BYTES = 4;

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    (value as Uint8Array).BYTES_PER_ELEMENT === 1
  );
}

function kindCode(kind: LibraryCoreWireFrameKind): number {
  const index = LIBRARY_CORE_WIRE_FRAME_KINDS.indexOf(kind);
  if (index < 0) throw new TypeError("unsupported Library Core frame kind");
  return index + 1;
}

function kindFromCode(code: number): LibraryCoreWireFrameKind {
  const kind = LIBRARY_CORE_WIRE_FRAME_KINDS[code - 1];
  if (kind === undefined) {
    throw new TypeError("Library Core frame has an unsupported kind");
  }
  return kind;
}

interface LibraryCoreWireFrameLimits {
  readonly maximumDecodedBytes: number;
  readonly maximumRecordBytes: number;
  readonly maximumRecords: number;
}

function boundedLimit(
  value: number | undefined,
  ceiling: number,
  label: string,
): number {
  const resolved = value ?? ceiling;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > ceiling) {
    throw new RangeError(
      `${label} must be a positive safe integer no greater than ${ceiling.toLocaleString()}`,
    );
  }
  return resolved;
}

function frameLimits(
  options: LibraryCoreWireFrameOptions,
): LibraryCoreWireFrameLimits {
  return Object.freeze({
    maximumDecodedBytes: boundedLimit(
      options.maximumDecodedBytes,
      LIBRARY_CORE_MAX_DECODED_WIRE_BYTES,
      "maximumDecodedBytes",
    ),
    maximumRecordBytes: boundedLimit(
      options.maximumRecordBytes,
      LIBRARY_CORE_MAX_WIRE_RECORD_BYTES,
      "maximumRecordBytes",
    ),
    maximumRecords: boundedLimit(
      options.maximumRecords,
      LIBRARY_CORE_MAX_WIRE_RECORDS,
      "maximumRecords",
    ),
  });
}

function assertRecordCount(count: number, maximumRecords: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > maximumRecords) {
    throw new RangeError(
      `Library Core frame record count exceeds ${maximumRecords.toLocaleString()}`,
    );
  }
}

function checkedIdentity(
  record: LibraryCoreCanonicalValue,
  identity: (record: LibraryCoreCanonicalValue) => string,
): string {
  const value = identity(record);
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new TypeError(
      "Library Core frame record identity must be a nonempty bounded string",
    );
  }
  return value;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(
    offset,
    value,
    false,
  );
}

function readUint32(source: Uint8Array, offset: number): number {
  return new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  ).getUint32(offset, false);
}

export function encodeLibraryCoreWireFrameV1(
  records: readonly LibraryCoreCanonicalValue[],
  options: LibraryCoreWireFrameOptions,
): Uint8Array {
  if (!Array.isArray(records)) {
    throw new TypeError("Library Core frame records must be an array");
  }
  const limits = frameLimits(options);
  assertRecordCount(records.length, limits.maximumRecords);
  const encodedRecords: Uint8Array[] = [];
  const identities = new Set<string>();
  let totalBytes = HEADER_BYTES;

  for (const record of records) {
    const identity = checkedIdentity(record, options.recordIdentity);
    if (identities.has(identity)) {
      throw new TypeError(
        `Library Core frame contains duplicate record identity: ${identity}`,
      );
    }
    identities.add(identity);
    const encoded = encodeLibraryCoreCanonicalValue(record, {
      maximumBytes: limits.maximumRecordBytes,
    });
    totalBytes += LENGTH_BYTES + encoded.byteLength;
    if (totalBytes > limits.maximumDecodedBytes) {
      throw new RangeError(
        `Library Core frame exceeds ${limits.maximumDecodedBytes.toLocaleString()} decoded bytes`,
      );
    }
    encodedRecords.push(encoded);
  }

  const output = new Uint8Array(totalBytes);
  output.set(MAGIC, 0);
  output[8] = LIBRARY_CORE_WIRE_FRAME_VERSION;
  output[9] = kindCode(options.kind);
  output[10] = 0;
  output[11] = 0;
  writeUint32(output, 12, records.length);

  let offset = HEADER_BYTES;
  for (const encoded of encodedRecords) {
    writeUint32(output, offset, encoded.byteLength);
    offset += LENGTH_BYTES;
    output.set(encoded, offset);
    offset += encoded.byteLength;
  }
  return output;
}

/**
 * Incrementally verifies one decoded frame. It never buffers more than the
 * fixed header or one bounded canonical record.
 */
export class LibraryCoreWireFrameDecoderV1 {
  private readonly expectedKind: LibraryCoreWireFrameKind;
  private readonly recordIdentity: (
    record: LibraryCoreCanonicalValue,
  ) => string;
  private readonly limits: LibraryCoreWireFrameLimits;
  private readonly identities = new Set<string>();
  private pending = new Uint8Array(0);
  private headerRead = false;
  private recordCount = 0;
  private recordsRead = 0;
  private nextRecordLength: number | null = null;
  private totalBytes = 0;
  private finished = false;

  constructor(options: LibraryCoreWireFrameOptions) {
    kindCode(options.kind);
    this.expectedKind = options.kind;
    this.recordIdentity = options.recordIdentity;
    this.limits = frameLimits(options);
  }

  push(chunk: Uint8Array): readonly LibraryCoreCanonicalValue[] {
    if (this.finished) {
      throw new Error("Library Core frame decoder is already finished");
    }
    if (!isUint8Array(chunk)) {
      throw new TypeError("Library Core frame chunk must be a Uint8Array");
    }
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > this.limits.maximumDecodedBytes) {
      throw new RangeError(
        `Library Core frame exceeds ${this.limits.maximumDecodedBytes.toLocaleString()} decoded bytes`,
      );
    }
    this.append(chunk);
    const decoded: LibraryCoreCanonicalValue[] = [];

    if (!this.headerRead && this.pending.byteLength >= HEADER_BYTES) {
      this.readHeader();
    }
    while (this.headerRead && this.recordsRead < this.recordCount) {
      if (this.nextRecordLength === null) {
        if (this.pending.byteLength < LENGTH_BYTES) break;
        this.nextRecordLength = readUint32(this.pending, 0);
        this.consume(LENGTH_BYTES);
        if (
          this.nextRecordLength === 0 ||
          this.nextRecordLength > this.limits.maximumRecordBytes
        ) {
          throw new RangeError(
            "Library Core frame record has an invalid byte length",
          );
        }
      }
      if (this.pending.byteLength < this.nextRecordLength) break;
      const recordBytes = this.pending.slice(0, this.nextRecordLength);
      this.consume(this.nextRecordLength);
      this.nextRecordLength = null;
      const record = decodeLibraryCoreCanonicalValue(recordBytes, {
        maximumBytes: LIBRARY_CORE_MAX_WIRE_RECORD_BYTES,
      });
      const identity = checkedIdentity(record, this.recordIdentity);
      if (this.identities.has(identity)) {
        throw new TypeError(
          `Library Core frame contains duplicate record identity: ${identity}`,
        );
      }
      this.identities.add(identity);
      this.recordsRead += 1;
      decoded.push(record);
    }
    if (
      this.headerRead &&
      this.recordsRead === this.recordCount &&
      this.pending.byteLength > 0
    ) {
      throw new TypeError("Library Core frame contains trailing bytes");
    }
    return Object.freeze(decoded);
  }

  finish(): void {
    if (this.finished) {
      throw new Error("Library Core frame decoder is already finished");
    }
    this.finished = true;
    if (!this.headerRead) {
      throw new TypeError("Library Core frame is truncated before its header");
    }
    if (
      this.nextRecordLength !== null ||
      this.recordsRead !== this.recordCount ||
      this.pending.byteLength !== 0
    ) {
      throw new TypeError(
        "Library Core frame is truncated or its record count drifted",
      );
    }
  }

  private append(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    const combined = new Uint8Array(this.pending.byteLength + chunk.byteLength);
    combined.set(this.pending);
    combined.set(chunk, this.pending.byteLength);
    this.pending = combined;
  }

  private consume(byteLength: number): void {
    this.pending = this.pending.slice(byteLength);
  }

  private readHeader(): void {
    for (let index = 0; index < MAGIC.byteLength; index += 1) {
      if (this.pending[index] !== MAGIC[index]) {
        throw new TypeError("Library Core frame has invalid magic bytes");
      }
    }
    if (this.pending[8] !== LIBRARY_CORE_WIRE_FRAME_VERSION) {
      throw new TypeError("Library Core frame uses a future version");
    }
    const actualKind = kindFromCode(this.pending[9] ?? 0);
    if (actualKind !== this.expectedKind) {
      throw new TypeError("Library Core frame kind does not match its object");
    }
    if (this.pending[10] !== 0 || this.pending[11] !== 0) {
      throw new TypeError("Library Core frame reserved header bytes are set");
    }
    this.recordCount = readUint32(this.pending, 12);
    assertRecordCount(this.recordCount, this.limits.maximumRecords);
    this.consume(HEADER_BYTES);
    this.headerRead = true;
  }
}

export function decodeLibraryCoreWireFrameV1(
  bytes: Uint8Array,
  options: LibraryCoreWireFrameOptions,
): readonly LibraryCoreCanonicalValue[] {
  const decoder = new LibraryCoreWireFrameDecoderV1(options);
  const records = decoder.push(bytes);
  decoder.finish();
  return records;
}
