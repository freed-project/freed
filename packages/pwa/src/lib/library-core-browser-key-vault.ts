import {
  encodeLibraryCoreOperationSignatureInput,
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreFollowerMutationContextV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  lowerHex,
  requestResult,
  transactionDone,
} from "./library-core-indexeddb";

const LEGACY_KEY_DATABASE_NAME = "freed-library-core-portable-v1";
const LEGACY_KEY_DATABASE_VERSION = 11;
const ACTOR_IDENTITIES_STORE = "portable_pwa_actor_identities";

interface StoredActorKeyRecord {
  readonly actorId: unknown;
  readonly actorPrivateKey: unknown;
  readonly actorPublicKey: unknown;
  readonly libraryId: unknown;
  readonly schemaVersion: unknown;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function openExistingKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      LEGACY_KEY_DATABASE_NAME,
      LEGACY_KEY_DATABASE_VERSION,
    );
    request.addEventListener(
      "upgradeneeded",
      () => {
        request.transaction?.abort();
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () =>
        reject(
          request.error ??
            new Error("PWA Library actor key database is unavailable"),
        ),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => reject(new Error("PWA Library actor key database is blocked")),
      { once: true },
    );
  });
}

export async function signPwaLibraryCoreFollowerOperation(
  context: LibraryCoreFollowerMutationContextV1,
  operationSigningBodyDigest: LibraryCoreLowercaseHex64,
): Promise<LibraryCoreEd25519SignatureHex> {
  if (!isLibraryCoreLowercaseHex64(operationSigningBodyDigest)) {
    throw new TypeError("PWA follower signing digest is invalid");
  }
  const database = await openExistingKeyDatabase();
  try {
    if (!database.objectStoreNames.contains(ACTOR_IDENTITIES_STORE)) {
      throw new Error("PWA Library actor key store is unavailable");
    }
    const transaction = database.transaction(ACTOR_IDENTITIES_STORE, "readonly");
    const done = transactionDone(transaction);
    const stored = (await requestResult(
      transaction.objectStore(ACTOR_IDENTITIES_STORE).get(context.library_id),
    )) as StoredActorKeyRecord | undefined;
    await done;
    if (
      !stored ||
      stored.schemaVersion !== 1 ||
      !isLibraryCoreOperationInstanceId(stored.libraryId) ||
      stored.libraryId !== context.library_id ||
      !isLibraryCoreLowercaseHex64(stored.actorId) ||
      stored.actorId !== context.actor_id ||
      !isLibraryCoreEd25519PublicKeyHex(stored.actorPublicKey) ||
      stored.actorPublicKey !== context.actor_public_key ||
      !(stored.actorPrivateKey instanceof CryptoKey) ||
      stored.actorPrivateKey.type !== "private" ||
      stored.actorPrivateKey.extractable ||
      !stored.actorPrivateKey.usages.includes("sign") ||
      stored.actorPrivateKey.algorithm.name !== "Ed25519"
    ) {
      throw new Error("PWA Library actor key does not match SQLite authority");
    }
    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      stored.actorPrivateKey,
      exactArrayBuffer(
        encodeLibraryCoreOperationSignatureInput({
          operation_signing_body_digest: operationSigningBodyDigest,
        }),
      ),
    );
    return lowerHex(signature) as LibraryCoreEd25519SignatureHex;
  } finally {
    database.close();
  }
}
