import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreEd25519SignatureHex,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_MAX_SIGNATURE_INPUT_BYTES = 4_194_304;

export interface LibraryCoreEd25519VerificationInput {
  readonly publicKeyHex: LibraryCoreEd25519PublicKeyHex;
  readonly signatureHex: LibraryCoreEd25519SignatureHex;
  readonly message: Uint8Array;
}

function decodeLowercaseHex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function snapshotInput(input: LibraryCoreEd25519VerificationInput): Readonly<{
  publicKey: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
  message: Uint8Array<ArrayBuffer>;
}> {
  const publicKeyHex = input.publicKeyHex;
  const signatureHex = input.signatureHex;
  const inputMessage = input.message;
  if (!isLibraryCoreEd25519PublicKeyHex(publicKeyHex)) {
    throw new TypeError(
      "Ed25519 public key must be 64 lowercase hexadecimal characters",
    );
  }
  if (!isLibraryCoreEd25519SignatureHex(signatureHex)) {
    throw new TypeError(
      "Ed25519 signature must be 128 lowercase hexadecimal characters",
    );
  }
  if (!(inputMessage instanceof Uint8Array)) {
    throw new TypeError("Ed25519 message must be a Uint8Array");
  }
  if (inputMessage.byteLength > LIBRARY_CORE_MAX_SIGNATURE_INPUT_BYTES) {
    throw new RangeError("Ed25519 message exceeds 4,194,304 bytes");
  }
  const message = new Uint8Array(inputMessage.byteLength);
  message.set(inputMessage);
  return Object.freeze({
    publicKey: decodeLowercaseHex(publicKeyHex),
    signature: decodeLowercaseHex(signatureHex),
    message,
  });
}

/**
 * Verify one bounded Library Core Ed25519 signature with the platform Web
 * Crypto implementation.
 *
 * Invalid signatures return false. Missing Ed25519 platform support remains an
 * explicit error so activation cannot mistake an unavailable verifier for a
 * valid negative result.
 */
export async function verifyLibraryCoreEd25519WithWebCrypto(
  input: LibraryCoreEd25519VerificationInput,
  subtleCrypto?: SubtleCrypto,
): Promise<boolean> {
  const snapshot = snapshotInput(input);
  const verifier = subtleCrypto ?? globalThis.crypto?.subtle;
  if (verifier === undefined) {
    throw new Error("Ed25519 Web Crypto verification is unavailable");
  }
  let publicKey: CryptoKey;
  try {
    publicKey = await verifier.importKey(
      "raw",
      snapshot.publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "DataError" || error.name === "OperationError")
    ) {
      return false;
    }
    throw error;
  }
  return verifier.verify(
    { name: "Ed25519" },
    publicKey,
    snapshot.signature,
    snapshot.message,
  );
}
