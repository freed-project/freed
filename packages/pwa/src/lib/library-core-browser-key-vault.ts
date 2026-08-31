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
export const PWA_LIBRARY_CORE_KEY_DATABASE_NAME =
  "freed-library-core-key-vault-v1";
const KEY_DATABASE_VERSION = 2;
const ACTOR_KEYS_STORE = "actor_keys";
const LOCAL_SAMPLE_AUTHORITY_STORE = "local_sample_authority";
const LOCAL_SAMPLE_AUTHORITY_KEY = "active";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Browser key request failed")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(transaction.error ?? new Error("Browser key transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("Browser key transaction failed")),
      { once: true },
    );
  });
}

function lowerHex(bytes: ArrayBuffer): string {
  let output = "";
  for (const byte of new Uint8Array(bytes)) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

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

export interface PwaLibraryCoreLocalSamplePreparedResult {
  readonly canonicalResultBytes: Uint8Array;
  readonly nextActorCounter: number;
  readonly nextResultSequence: number;
  readonly previousResultDigest: LibraryCoreLowercaseHex64;
  readonly sourceRevision: number;
}

interface StoredLocalSampleAuthorityRecord {
  readonly actorId: LibraryCoreLowercaseHex64 | null;
  readonly authorityKeyId: LibraryCoreLowercaseHex64;
  readonly authorityPrivateKeyPkcs8: ArrayBuffer;
  readonly authorityPublicKey: LibraryCoreEd25519PublicKeyHex;
  readonly createdAt: number;
  readonly epochId: LibraryCoreLowercaseHex64;
  readonly key: typeof LOCAL_SAMPLE_AUTHORITY_KEY;
  readonly libraryId: LibraryCoreLowercaseHex64;
  readonly nextActorCounter: number;
  readonly nextResultSequence: number;
  readonly preparedResult: PwaLibraryCoreLocalSamplePreparedResult | null;
  readonly previousResultDigest: LibraryCoreLowercaseHex64 | null;
  readonly schemaVersion: 1;
  readonly sourceRevision: number;
  readonly status: "preparing" | "ready";
}

export type PwaLibraryCoreLocalSampleAuthority = Readonly<
  Omit<StoredLocalSampleAuthorityRecord, "authorityPrivateKeyPkcs8" | "key">
>;

export type PwaLibraryCoreActorIdentity = Readonly<
  Omit<StoredActorKeyRecord, "actorPrivateKey">
>;

export class PwaLibraryCoreLegacyLocalSampleAuthorityError extends Error {
  readonly libraryId: LibraryCoreLowercaseHex64;

  constructor(libraryId: LibraryCoreLowercaseHex64) {
    super("PWA local sample authority uses the retired WebKit key format");
    this.name = "PwaLibraryCoreLegacyLocalSampleAuthorityError";
    this.libraryId = libraryId;
  }
}

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
        if (
          !request.result.objectStoreNames.contains(
            LOCAL_SAMPLE_AUTHORITY_STORE,
          )
        ) {
          request.result.createObjectStore(LOCAL_SAMPLE_AUTHORITY_STORE, {
            keyPath: "key",
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

function validatePreparedResult(
  value: unknown,
): PwaLibraryCoreLocalSamplePreparedResult | null {
  if (value === null) return null;
  const prepared = value as Partial<PwaLibraryCoreLocalSamplePreparedResult>;
  const preparedBytes = prepared.canonicalResultBytes as unknown;
  const canonicalResultBytes =
    preparedBytes instanceof Uint8Array
      ? preparedBytes
      : ArrayBuffer.isView(preparedBytes)
        ? new Uint8Array(
            preparedBytes.buffer,
            preparedBytes.byteOffset,
            preparedBytes.byteLength,
          )
        : null;
  if (
    canonicalResultBytes === null ||
    !Number.isSafeInteger(prepared.nextActorCounter) ||
    prepared.nextActorCounter! < 1 ||
    !Number.isSafeInteger(prepared.nextResultSequence) ||
    prepared.nextResultSequence! < 2 ||
    !isLibraryCoreLowercaseHex64(prepared.previousResultDigest) ||
    !Number.isSafeInteger(prepared.sourceRevision) ||
    prepared.sourceRevision! < 1
  ) {
    throw new Error("PWA local sample prepared result is invalid");
  }
  return Object.freeze({
    canonicalResultBytes: canonicalResultBytes.slice(),
    nextActorCounter: prepared.nextActorCounter!,
    nextResultSequence: prepared.nextResultSequence!,
    previousResultDigest: prepared.previousResultDigest,
    sourceRevision: prepared.sourceRevision!,
  });
}

function validateLocalSampleAuthority(
  value: unknown,
): StoredLocalSampleAuthorityRecord {
  const stored = value as Partial<StoredLocalSampleAuthorityRecord> | undefined;
  const actorReady = stored?.status === "ready";
  const privateKeyBytes = stored?.authorityPrivateKeyPkcs8 as unknown;
  const authorityPrivateKeyPkcs8 =
    privateKeyBytes instanceof ArrayBuffer ||
    Object.prototype.toString.call(privateKeyBytes) === "[object ArrayBuffer]"
      ? exactArrayBuffer(new Uint8Array(privateKeyBytes as ArrayBuffer))
      : ArrayBuffer.isView(privateKeyBytes)
        ? exactArrayBuffer(
            new Uint8Array(
              privateKeyBytes.buffer,
              privateKeyBytes.byteOffset,
              privateKeyBytes.byteLength,
            ),
          )
        : null;
  if (
    !stored ||
    stored.key !== LOCAL_SAMPLE_AUTHORITY_KEY ||
    stored.schemaVersion !== 1 ||
    (stored.status !== "preparing" && stored.status !== "ready") ||
    !isLibraryCoreLowercaseHex64(stored.libraryId) ||
    !isLibraryCoreLowercaseHex64(stored.epochId) ||
    !isLibraryCoreLowercaseHex64(stored.authorityKeyId) ||
    !isLibraryCoreEd25519PublicKeyHex(stored.authorityPublicKey) ||
    authorityPrivateKeyPkcs8 === null ||
    authorityPrivateKeyPkcs8.byteLength < 32 ||
    authorityPrivateKeyPkcs8.byteLength > 256 ||
    !Number.isSafeInteger(stored.createdAt) ||
    stored.createdAt! < 0 ||
    (actorReady !== isLibraryCoreLowercaseHex64(stored.actorId)) ||
    !Number.isSafeInteger(stored.nextActorCounter) ||
    stored.nextActorCounter! < 1 ||
    !Number.isSafeInteger(stored.nextResultSequence) ||
    stored.nextResultSequence! < 1 ||
    !Number.isSafeInteger(stored.sourceRevision) ||
    stored.sourceRevision! < 0 ||
    (stored.nextResultSequence === 1) !==
      (stored.previousResultDigest === null) ||
    (stored.previousResultDigest !== null &&
      !isLibraryCoreLowercaseHex64(stored.previousResultDigest)) ||
    libraryCoreDigest("authority-key", {
      authority_public_key: stored.authorityPublicKey,
      signature_algorithm: "ed25519",
    }) !== stored.authorityKeyId
  ) {
    throw new Error("PWA local sample authority record is invalid");
  }
  const preparedResult = validatePreparedResult(stored.preparedResult);
  return Object.freeze({
    ...(stored as StoredLocalSampleAuthorityRecord),
    authorityPrivateKeyPkcs8: authorityPrivateKeyPkcs8.slice(0),
    preparedResult,
  });
}

function publicLocalSampleAuthority(
  stored: StoredLocalSampleAuthorityRecord,
): PwaLibraryCoreLocalSampleAuthority {
  const { authorityPrivateKeyPkcs8, key, ...publicState } = stored;
  void authorityPrivateKeyPkcs8;
  void key;
  return Object.freeze({
    ...publicState,
    preparedResult: publicState.preparedResult
      ? Object.freeze({
          ...publicState.preparedResult,
          canonicalResultBytes:
            publicState.preparedResult.canonicalResultBytes.slice(),
        })
      : null,
  });
}

async function readStoredLocalSampleAuthority(): Promise<StoredLocalSampleAuthorityRecord | null> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(
      LOCAL_SAMPLE_AUTHORITY_STORE,
      "readonly",
    );
    const done = transactionDone(transaction);
    const stored = await requestResult(
      transaction
        .objectStore(LOCAL_SAMPLE_AUTHORITY_STORE)
        .get(LOCAL_SAMPLE_AUTHORITY_KEY),
    );
    await done;
    if (stored === undefined) return null;
    try {
      return validateLocalSampleAuthority(stored);
    } catch (error) {
      const legacy = stored as Record<string, unknown>;
      if (
        legacy.key === LOCAL_SAMPLE_AUTHORITY_KEY &&
        legacy.schemaVersion === 1 &&
        isLibraryCoreLowercaseHex64(legacy.libraryId) &&
        isLibraryCoreLowercaseHex64(legacy.epochId) &&
        isLibraryCoreLowercaseHex64(legacy.authorityKeyId) &&
        isLibraryCoreEd25519PublicKeyHex(legacy.authorityPublicKey) &&
        legacy.authorityPrivateKey instanceof CryptoKey &&
        legacy.authorityPrivateKey.type === "private" &&
        !legacy.authorityPrivateKey.extractable &&
        legacy.authorityPrivateKey.usages.includes("sign") &&
        legacy.authorityPrivateKey.algorithm.name === "Ed25519"
      ) {
        throw new PwaLibraryCoreLegacyLocalSampleAuthorityError(
          legacy.libraryId,
        );
      }
      throw error;
    }
  } finally {
    database.close();
  }
}

async function writeStoredLocalSampleAuthority(
  stored: StoredLocalSampleAuthorityRecord,
): Promise<void> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(
      LOCAL_SAMPLE_AUTHORITY_STORE,
      "readwrite",
    );
    transaction
      .objectStore(LOCAL_SAMPLE_AUTHORITY_STORE)
      .put(validateLocalSampleAuthority(stored));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function updateStoredLocalSampleAuthority(
  update: (
    stored: StoredLocalSampleAuthorityRecord,
  ) => StoredLocalSampleAuthorityRecord,
): Promise<StoredLocalSampleAuthorityRecord> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(
      LOCAL_SAMPLE_AUTHORITY_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(LOCAL_SAMPLE_AUTHORITY_STORE);
    const current = await requestResult(store.get(LOCAL_SAMPLE_AUTHORITY_KEY));
    if (current === undefined) {
      transaction.abort();
      throw new Error("PWA local sample authority is unavailable");
    }
    const next = validateLocalSampleAuthority(
      update(validateLocalSampleAuthority(current)),
    );
    store.put(next);
    await transactionDone(transaction);
    return next;
  } finally {
    database.close();
  }
}

export async function readPwaLibraryCoreLocalSampleAuthority(): Promise<PwaLibraryCoreLocalSampleAuthority | null> {
  const stored = await readStoredLocalSampleAuthority();
  return stored ? publicLocalSampleAuthority(stored) : null;
}

export async function createPwaLibraryCoreLocalSampleAuthority(): Promise<PwaLibraryCoreLocalSampleAuthority> {
  const existing = await readStoredLocalSampleAuthority();
  if (existing) return publicLocalSampleAuthority(existing);
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const authorityPublicKey = lowerHex(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  ) as LibraryCoreEd25519PublicKeyHex;
  const created = Object.freeze({
    actorId: null,
    authorityKeyId: libraryCoreDigest("authority-key", {
      authority_public_key: authorityPublicKey,
      signature_algorithm: "ed25519",
    }),
    authorityPrivateKeyPkcs8: await crypto.subtle.exportKey(
      "pkcs8",
      pair.privateKey,
    ),
    authorityPublicKey,
    createdAt: Date.now(),
    epochId: randomHex64(),
    key: LOCAL_SAMPLE_AUTHORITY_KEY,
    libraryId: randomHex64(),
    nextActorCounter: 1,
    nextResultSequence: 1,
    preparedResult: null,
    previousResultDigest: null,
    schemaVersion: 1,
    sourceRevision: 0,
    status: "preparing",
  }) satisfies StoredLocalSampleAuthorityRecord;
  await writeStoredLocalSampleAuthority(created);
  const readback = await readStoredLocalSampleAuthority();
  if (!readback || readback.libraryId !== created.libraryId) {
    throw new Error("PWA local sample authority readback changed");
  }
  return publicLocalSampleAuthority(readback);
}

export async function markPwaLibraryCoreLocalSampleAuthorityReady(
  libraryId: LibraryCoreLowercaseHex64,
  actorId: LibraryCoreLowercaseHex64,
): Promise<PwaLibraryCoreLocalSampleAuthority> {
  const stored = await updateStoredLocalSampleAuthority((current) => {
    if (current.libraryId !== libraryId || current.status !== "preparing") {
      throw new Error("PWA local sample authority readiness changed");
    }
    return Object.freeze({ ...current, actorId, status: "ready" });
  });
  return publicLocalSampleAuthority(stored);
}

export async function preparePwaLibraryCoreLocalSampleResult(
  libraryId: LibraryCoreLowercaseHex64,
  preparedResult: PwaLibraryCoreLocalSamplePreparedResult,
): Promise<void> {
  await updateStoredLocalSampleAuthority((current) => {
    if (
      current.libraryId !== libraryId ||
      current.status !== "ready" ||
      current.preparedResult !== null ||
      preparedResult.nextActorCounter <= current.nextActorCounter ||
      preparedResult.nextResultSequence !== current.nextResultSequence + 1 ||
      preparedResult.sourceRevision !== current.sourceRevision + 1 ||
      preparedResult.previousResultDigest === current.previousResultDigest
    ) {
      throw new Error("PWA local sample result preparation changed");
    }
    return Object.freeze({
      ...current,
      preparedResult: validatePreparedResult(preparedResult),
    });
  });
}

export async function commitPwaLibraryCoreLocalSampleResult(
  libraryId: LibraryCoreLowercaseHex64,
  resultDigest: LibraryCoreLowercaseHex64,
): Promise<PwaLibraryCoreLocalSampleAuthority> {
  const stored = await updateStoredLocalSampleAuthority((current) => {
    const prepared = current.preparedResult;
    if (
      current.libraryId !== libraryId ||
      !prepared ||
      prepared.previousResultDigest !== resultDigest
    ) {
      throw new Error("PWA local sample result settlement changed");
    }
    return Object.freeze({
      ...current,
      nextActorCounter: prepared.nextActorCounter,
      nextResultSequence: prepared.nextResultSequence,
      preparedResult: null,
      previousResultDigest: prepared.previousResultDigest,
      sourceRevision: prepared.sourceRevision,
    });
  });
  return publicLocalSampleAuthority(stored);
}

export async function deletePwaLibraryCoreLocalSampleAuthority(): Promise<void> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(
      LOCAL_SAMPLE_AUTHORITY_STORE,
      "readwrite",
    );
    transaction
      .objectStore(LOCAL_SAMPLE_AUTHORITY_STORE)
      .delete(LOCAL_SAMPLE_AUTHORITY_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function signPwaLibraryCoreLocalSampleAuthority(
  authority: PwaLibraryCoreLocalSampleAuthority,
  message: Uint8Array,
): Promise<LibraryCoreEd25519SignatureHex> {
  const stored = await readStoredLocalSampleAuthority();
  if (
    !stored ||
    stored.libraryId !== authority.libraryId ||
    stored.authorityKeyId !== authority.authorityKeyId
  ) {
    throw new Error("PWA local sample authority key changed");
  }
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    stored.authorityPrivateKeyPkcs8,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return lowerHex(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      exactArrayBuffer(message),
    ),
  ) as LibraryCoreEd25519SignatureHex;
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
  if (!isLibraryCoreLowercaseHex64(context.library_id)) {
    throw new Error("PWA Library actor authority identity is invalid");
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
