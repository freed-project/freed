import type { LibraryCoreLowercaseHex64 } from "./protocol-scalars.js";

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

const SHA256_BLOCK_BYTES = 64;
const SHA256_LENGTH_BYTES = 8;
const SHA256_MAX_INPUT_BYTES = Math.floor(
  Number.MAX_SAFE_INTEGER / 8,
);

/**
 * Incremental SHA-256 state for Library Core byte streams.
 *
 * The state retains one 64-byte tail and the fixed compression schedule. It
 * never retains prior input chunks, which lets large blob identities be
 * verified without allocating the complete blob in JavaScript.
 */
export class LibraryCoreSha256 {
  private readonly state = new Uint32Array(INITIAL_STATE);
  private readonly tail = new Uint8Array(SHA256_BLOCK_BYTES);
  private readonly words = new Uint32Array(64);
  private tailLength = 0;
  private totalByteLength = 0;
  private finalDigest: LibraryCoreLowercaseHex64 | null = null;

  update(input: Uint8Array): this {
    if (
      !ArrayBuffer.isView(input) ||
      Object.prototype.toString.call(input) !== "[object Uint8Array]"
    ) {
      throw new TypeError("SHA-256 input must be a Uint8Array");
    }
    if (this.finalDigest !== null) {
      throw new Error("SHA-256 state is already finalized");
    }
    const nextTotal = this.totalByteLength + input.byteLength;
    if (
      !Number.isSafeInteger(nextTotal) ||
      nextTotal > SHA256_MAX_INPUT_BYTES
    ) {
      throw new RangeError("SHA-256 input length exceeds the safe integer range");
    }
    this.totalByteLength = nextTotal;

    let inputOffset = 0;
    if (this.tailLength > 0) {
      const copied = Math.min(
        SHA256_BLOCK_BYTES - this.tailLength,
        input.byteLength,
      );
      this.tail.set(input.subarray(0, copied), this.tailLength);
      this.tailLength += copied;
      inputOffset += copied;
      if (this.tailLength === SHA256_BLOCK_BYTES) {
        this.compress(this.tail, 0);
        this.tailLength = 0;
      }
    }

    while (inputOffset + SHA256_BLOCK_BYTES <= input.byteLength) {
      this.compress(input, inputOffset);
      inputOffset += SHA256_BLOCK_BYTES;
    }
    if (inputOffset < input.byteLength) {
      const remainder = input.subarray(inputOffset);
      this.tail.set(remainder, 0);
      this.tailLength = remainder.byteLength;
    }
    return this;
  }

  digestLowerHex(): LibraryCoreLowercaseHex64 {
    if (this.finalDigest !== null) return this.finalDigest;
    const originalBitLength = this.totalByteLength * 8;
    const paddingBlocks =
      this.tailLength + 1 + SHA256_LENGTH_BYTES <= SHA256_BLOCK_BYTES ? 1 : 2;
    const padding = new Uint8Array(paddingBlocks * SHA256_BLOCK_BYTES);
    padding.set(this.tail.subarray(0, this.tailLength));
    padding[this.tailLength] = 0x80;
    const view = new DataView(padding.buffer);
    view.setUint32(
      padding.byteLength - SHA256_LENGTH_BYTES,
      Math.floor(originalBitLength / 0x1_0000_0000),
      false,
    );
    view.setUint32(
      padding.byteLength - 4,
      originalBitLength >>> 0,
      false,
    );
    for (
      let offset = 0;
      offset < padding.byteLength;
      offset += SHA256_BLOCK_BYTES
    ) {
      this.compress(padding, offset);
    }
    this.finalDigest = Array.from(
      this.state,
      (word) => word.toString(16).padStart(8, "0"),
    ).join("") as LibraryCoreLowercaseHex64;
    return this.finalDigest;
  }

  private compress(input: Uint8Array, offset: number): void {
    const view = new DataView(
      input.buffer,
      input.byteOffset + offset,
      SHA256_BLOCK_BYTES,
    );
    for (let index = 0; index < 16; index += 1) {
      this.words[index] = view.getUint32(index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = this.words[index - 15]!;
      const right = this.words[index - 2]!;
      const sigma0 =
        rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 =
        rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      this.words[index] =
        (this.words[index - 16]! +
          sigma0 +
          this.words[index - 7]! +
          sigma1) >>>
        0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          sum1 +
          choice +
          ROUND_CONSTANTS[index]! +
          this.words[index]!) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

/**
 * Dependency-free SHA-256 for the synchronous digest hooks used by Library
 * Core's closed construction contracts. Signature verification still uses
 * platform Web Crypto. Inputs are already bounded by the canonical codec.
 */
export function sha256LowerHex(
  input: Uint8Array,
): LibraryCoreLowercaseHex64 {
  return new LibraryCoreSha256().update(input).digestLowerHex();
}
