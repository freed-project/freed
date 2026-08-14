import { describe, expect, it } from "vitest";

import vectors from "./ed25519-verification-vectors.json";
import { verifyLibraryCoreEd25519WithWebCrypto } from "./ed25519-verification.js";
import type {
  LibraryCoreEd25519PublicKeyHex,
  LibraryCoreEd25519SignatureHex,
} from "./protocol-scalars.js";

function decodeHex(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

describe("Library Core Web Crypto Ed25519 verification", () => {
  it("accepts the shared RFC 8032 vector and rejects altered inputs", async () => {
    const vector = vectors.vectors[0];
    const input = {
      publicKeyHex: vector.public_key_hex as LibraryCoreEd25519PublicKeyHex,
      signatureHex: vector.signature_hex as LibraryCoreEd25519SignatureHex,
      message: decodeHex(vector.message_hex),
    };

    await expect(verifyLibraryCoreEd25519WithWebCrypto(input)).resolves.toBe(
      true,
    );
    await expect(
      verifyLibraryCoreEd25519WithWebCrypto({
        ...input,
        signatureHex:
          `${input.signatureHex.slice(0, -2)}00` as LibraryCoreEd25519SignatureHex,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyLibraryCoreEd25519WithWebCrypto({
        ...input,
        message: new Uint8Array([1]),
      }),
    ).resolves.toBe(false);
    await expect(
      verifyLibraryCoreEd25519WithWebCrypto({
        ...input,
        publicKeyHex: "00".repeat(32) as LibraryCoreEd25519PublicKeyHex,
      }),
    ).resolves.toBe(false);
  });

  it("snapshots the message before the first asynchronous verifier call", async () => {
    const vector = vectors.vectors[0];
    const message = new Uint8Array([7]);
    let releaseImport: (() => void) | undefined;
    const importStarted = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const subtle = {
      async importKey() {
        await importStarted;
        return {} as CryptoKey;
      },
      async verify(
        _algorithm: AlgorithmIdentifier,
        _key: CryptoKey,
        _signature: BufferSource,
        verifiedMessage: BufferSource,
      ) {
        return (verifiedMessage as Uint8Array)[0] === 7;
      },
    } as Pick<SubtleCrypto, "importKey" | "verify"> as SubtleCrypto;
    const result = verifyLibraryCoreEd25519WithWebCrypto(
      {
        publicKeyHex: vector.public_key_hex as LibraryCoreEd25519PublicKeyHex,
        signatureHex: vector.signature_hex as LibraryCoreEd25519SignatureHex,
        message,
      },
      subtle,
    );
    message[0] = 9;
    releaseImport?.();

    await expect(result).resolves.toBe(true);
  });

  it("reads each caller-owned input property exactly once", async () => {
    const vector = vectors.vectors[0];
    const reads = {
      publicKeyHex: 0,
      signatureHex: 0,
      message: 0,
    };
    const input = {
      get publicKeyHex() {
        reads.publicKeyHex += 1;
        return vector.public_key_hex as LibraryCoreEd25519PublicKeyHex;
      },
      get signatureHex() {
        reads.signatureHex += 1;
        return vector.signature_hex as LibraryCoreEd25519SignatureHex;
      },
      get message() {
        reads.message += 1;
        return decodeHex(vector.message_hex);
      },
    };

    await expect(verifyLibraryCoreEd25519WithWebCrypto(input)).resolves.toBe(
      true,
    );
    expect(reads).toStrictEqual({
      publicKeyHex: 1,
      signatureHex: 1,
      message: 1,
    });
  });

  it("snapshots Web Crypto methods before importing the key", async () => {
    const vector = vectors.vectors[0];
    const subtle = {
      async importKey() {
        (
          subtle as unknown as {
            importKey: () => Promise<CryptoKey>;
            verify: () => Promise<boolean>;
          }
        ).verify = async () => false;
        await Promise.resolve();
        return {} as CryptoKey;
      },
      async verify() {
        return true;
      },
    } as Pick<SubtleCrypto, "importKey" | "verify"> as SubtleCrypto;

    await expect(
      verifyLibraryCoreEd25519WithWebCrypto(
        {
          publicKeyHex:
            vector.public_key_hex as LibraryCoreEd25519PublicKeyHex,
          signatureHex:
            vector.signature_hex as LibraryCoreEd25519SignatureHex,
          message: decodeHex(vector.message_hex),
        },
        subtle,
      ),
    ).resolves.toBe(true);
  });

  it("rejects malformed encodings and oversized messages before Web Crypto", async () => {
    const subtle = {
      importKey() {
        throw new Error("must not run");
      },
    } as unknown as SubtleCrypto;
    const base = {
      publicKeyHex: "11".repeat(32) as LibraryCoreEd25519PublicKeyHex,
      signatureHex: "22".repeat(64) as LibraryCoreEd25519SignatureHex,
      message: new Uint8Array(),
    };

    await expect(
      verifyLibraryCoreEd25519WithWebCrypto(
        { ...base, publicKeyHex: "invalid" as LibraryCoreEd25519PublicKeyHex },
        subtle,
      ),
    ).rejects.toThrow(/public key/);
    await expect(
      verifyLibraryCoreEd25519WithWebCrypto(
        { ...base, signatureHex: "invalid" as LibraryCoreEd25519SignatureHex },
        subtle,
      ),
    ).rejects.toThrow(/signature/);
    await expect(
      verifyLibraryCoreEd25519WithWebCrypto(
        { ...base, message: new Uint8Array(4_194_305) },
        subtle,
      ),
    ).rejects.toThrow(/4,194,304/);
  });
});
