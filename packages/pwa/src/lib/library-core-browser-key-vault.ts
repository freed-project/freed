import {
  encodeLibraryCoreOperationSignatureInput,
  encodeLibraryCoreDigestInput,
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreFollowerMutationContextV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  lowerHex,
  requestResult,
  transactionDone,
} from "./library-core-indexeddb";

export const PWA_LIBRARY_CORE_KEY_DATABASE_NAME =
  "freed-library-core-key-vault-v1";
const KEY_DATABASE_VERSION = 1;
const ACTOR_KEYS_STORE = "actor_keys";

function libraryCoreDigest(
  domain: LibraryCoreDigestDomain,
  value: unknown,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
  );
}

interface StoredActorKeyRecord {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorIncarnationNonce: LibraryCoreLowercaseHex64;
  readonly actorPrivateKey: CryptoKey;
  readonly actorPublicKey: LibraryCoreEd25519PublicKeyHex;
  readonly installationIncarnation: LibraryCoreLowercaseHex64;
  readonly libraryId: LibraryCoreLowercaseHex64;
  readonly schemaVersion: 1;
}

export type PwaLibraryCoreActorIdentity = Readonly<
  Omit<StoredActorKeyRecord, "actorPrivateKey">
>;

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function randomHex64(): LibraryCoreLowercaseHex64 {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return lowerHex(exactArrayBuffer(bytes)) as LibraryCoreLowercaseHex64;
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      PWA_LIBRARY_CORE_KEY_DATABASE_NAME,
      KEY_DATABASE_VERSION,
    );
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(ACTOR_KEYS_STORE)) {
          request.result.createObjectStore(ACTOR_KEYS_STORE, {
            keyPath: "libraryId",
          });
        }
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

function validateStoredIdentity(
  value: unknown,
  libraryId: LibraryCoreLowercaseHex64,
): StoredActorKeyRecord {
  const stored = value as Partial<StoredActorKeyRecord> | undefined;
  if (
    !stored ||
    stored.schemaVersion !== 1 ||
    stored.libraryId !== libraryId ||
    !isLibraryCoreLowercaseHex64(stored.actorId) ||
    !isLibraryCoreLowercaseHex64(stored.actorIncarnationNonce) ||
    !isLibraryCoreLowercaseHex64(stored.installationIncarnation) ||
    !isLibraryCoreEd25519PublicKeyHex(stored.actorPublicKey) ||
    !(stored.actorPrivateKey instanceof CryptoKey) ||
    stored.actorPrivateKey.type !== "private" ||
    stored.actorPrivateKey.extractable ||
    !stored.actorPrivateKey.usages.includes("sign") ||
    stored.actorPrivateKey.algorithm.name !== "Ed25519" ||
    libraryCoreDigest("actor-id", {
      library_id: stored.libraryId,
      installation_incarnation: stored.installationIncarnation,
      signature_algorithm: "ed25519",
      actor_public_key: stored.actorPublicKey,
      actor_incarnation_nonce: stored.actorIncarnationNonce,
    }) !== stored.actorId
  ) {
    throw new Error("PWA Library actor key record is invalid");
  }
  return stored as StoredActorKeyRecord;
}

function publicIdentity(
  stored: StoredActorKeyRecord,
): PwaLibraryCoreActorIdentity {
  return Object.freeze({
    actorId: stored.actorId,
    actorIncarnationNonce: stored.actorIncarnationNonce,
    actorPublicKey: stored.actorPublicKey,
    installationIncarnation: stored.installationIncarnation,
    libraryId: stored.libraryId,
    schemaVersion: 1,
  });
}

async function readStoredActorKey(
  libraryId: LibraryCoreLowercaseHex64,
): Promise<StoredActorKeyRecord | null> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(ACTOR_KEYS_STORE, "readonly");
    const done = transactionDone(transaction);
    const stored = await requestResult(
      transaction.objectStore(ACTOR_KEYS_STORE).get(libraryId),
    );
    await done;
    return stored === undefined
      ? null
      : validateStoredIdentity(stored, libraryId);
  } finally {
    database.close();
  }
}

export async function getOrCreatePwaLibraryCoreActorIdentity(
  libraryId: LibraryCoreLowercaseHex64,
): Promise<PwaLibraryCoreActorIdentity> {
  if (!isLibraryCoreLowercaseHex64(libraryId)) {
    throw new TypeError("PWA Library actor Library identity is invalid");
  }
  const existing = await readStoredActorKey(libraryId);
  if (existing) return publicIdentity(existing);
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const actorPublicKey = lowerHex(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  ) as LibraryCoreEd25519PublicKeyHex;
  const installationIncarnation = randomHex64();
  const actorIncarnationNonce = randomHex64();
  const actorId = libraryCoreDigest("actor-id", {
    library_id: libraryId,
    installation_incarnation: installationIncarnation,
    signature_algorithm: "ed25519",
    actor_public_key: actorPublicKey,
    actor_incarnation_nonce: actorIncarnationNonce,
  });
  const created = Object.freeze({
    actorId,
    actorIncarnationNonce,
    actorPrivateKey: pair.privateKey,
    actorPublicKey,
    installationIncarnation,
    libraryId,
    schemaVersion: 1,
  }) satisfies StoredActorKeyRecord;
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(ACTOR_KEYS_STORE, "readwrite");
    transaction.objectStore(ACTOR_KEYS_STORE).add(created);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  const readback = await readStoredActorKey(libraryId);
  if (!readback || readback.actorId !== actorId) {
    throw new Error("PWA Library actor key readback changed");
  }
  return publicIdentity(readback);
}

export async function signPwaLibraryCoreActorProof(
  identity: PwaLibraryCoreActorIdentity,
  message: Uint8Array,
): Promise<LibraryCoreEd25519SignatureHex> {
  const stored = await readStoredActorKey(identity.libraryId);
  if (
    !stored ||
    stored.actorId !== identity.actorId ||
    stored.actorPublicKey !== identity.actorPublicKey
  ) {
    throw new Error("PWA Library actor key does not match its identity");
  }
  return lowerHex(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      stored.actorPrivateKey,
      exactArrayBuffer(message),
    ),
  ) as LibraryCoreEd25519SignatureHex;
}

export async function signPwaLibraryCoreFollowerOperation(
  context: LibraryCoreFollowerMutationContextV1,
  operationSigningBodyDigest: LibraryCoreLowercaseHex64,
): Promise<LibraryCoreEd25519SignatureHex> {
  if (!isLibraryCoreLowercaseHex64(operationSigningBodyDigest)) {
    throw new TypeError("PWA follower signing digest is invalid");
  }
  const stored = await readStoredActorKey(context.library_id);
  if (
    !stored ||
    stored.actorId !== context.actor_id ||
    stored.actorPublicKey !== context.actor_public_key
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
}
