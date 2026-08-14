import {
  LibraryCoreWireFrameDecoderV1,
  encodeLibraryCoreWireFrameV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreWireFrameOptions,
} from "@freed/shared/library-core";

export const LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING = 5_000_000;

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    (value as Uint8Array).BYTES_PER_ELEMENT === 1
  );
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function byteTransform(
  stream: CompressionStream | DecompressionStream,
): ReadableWritablePair<Uint8Array, Uint8Array> {
  // DOM types model writable compression input as BufferSource even though
  // Uint8Array is the interoperable chunk type in browsers and Node.
  return stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
}

async function collectBounded(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength >= maximumBytes) {
        throw new RangeError(
          `Library Core wire object must remain below ${maximumBytes.toLocaleString()} stored bytes`,
        );
      }
      chunks.push(result.value.slice());
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function encodeLibraryCoreWireObjectV1(
  records: readonly LibraryCoreCanonicalValue[],
  options: LibraryCoreWireFrameOptions,
): Promise<Uint8Array> {
  const frame = encodeLibraryCoreWireFrameV1(records, options);
  return collectBounded(
    byteStream(frame).pipeThrough(byteTransform(new CompressionStream("gzip"))),
    LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING,
  );
}

export async function decodeLibraryCoreWireObjectV1(
  storedBytes: Uint8Array,
  options: LibraryCoreWireFrameOptions,
): Promise<readonly LibraryCoreCanonicalValue[]> {
  if (!isUint8Array(storedBytes)) {
    throw new TypeError("Library Core stored wire object must be a Uint8Array");
  }
  if (
    storedBytes.byteLength === 0 ||
    storedBytes.byteLength >= LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING
  ) {
    throw new RangeError(
      `Library Core wire object must contain at least 1 and fewer than ${LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING.toLocaleString()} stored bytes`,
    );
  }

  const reader = byteStream(storedBytes)
    .pipeThrough(byteTransform(new DecompressionStream("gzip")))
    .getReader();
  const decoder = new LibraryCoreWireFrameDecoderV1(options);
  const records: LibraryCoreCanonicalValue[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      records.push(...decoder.push(result.value));
    }
    decoder.finish();
  } finally {
    reader.releaseLock();
  }
  return Object.freeze(records);
}
