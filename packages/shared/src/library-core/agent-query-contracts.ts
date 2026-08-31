import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  LIBRARY_CORE_AGENT_QUERY_DIGEST_DOMAIN,
  LIBRARY_CORE_AGENT_QUERY_FORMAT,
  LIBRARY_CORE_AGENT_QUERY_IDS,
  LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_AGENT_QUERY_SIGNATURE_DOMAIN,
  type LibraryCoreAgentQueryId,
} from "./sqlite-contract.generated.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

export interface LibraryCoreAgentQueryBodyV1 {
  readonly format: typeof LIBRARY_CORE_AGENT_QUERY_FORMAT;
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly capability_id: LibraryCoreLowercaseHex64;
  readonly capability_certificate_digest: LibraryCoreLowercaseHex64;
  readonly request_id: LibraryCoreLowercaseHex64;
  readonly query: Readonly<Record<string, LibraryCoreCanonicalValue>> & {
    readonly queryId: LibraryCoreAgentQueryId;
  };
  readonly signature_algorithm: "ed25519";
}

export interface LibraryCoreAgentQueryEnvelopeV1 {
  readonly agent_query_body: LibraryCoreAgentQueryBodyV1;
  readonly agent_query_body_digest: LibraryCoreLowercaseHex64;
  readonly actor_signature: LibraryCoreEd25519SignatureHex;
}

export interface LibraryCoreAgentQueryConstructionV1 {
  readonly envelope: LibraryCoreAgentQueryEnvelopeV1;
  readonly canonical_agent_query_json: string;
}

export interface LibraryCoreAgentQueryInputV1 {
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly capability_id: LibraryCoreLowercaseHex64;
  readonly capability_certificate_digest: LibraryCoreLowercaseHex64;
  readonly request_id: LibraryCoreLowercaseHex64;
  readonly query: Readonly<Record<string, unknown>>;
}

export interface LibraryCoreAgentQueryConstructionDependenciesV1 {
  readonly digest: (domain: LibraryCoreDigestDomain, value: unknown) => unknown;
  readonly signActor: (input: Uint8Array) => Promise<unknown>;
}

export interface LibraryCoreAgentQueryVerificationDependenciesV1 {
  readonly digest: (domain: LibraryCoreDigestDomain, value: unknown) => unknown;
  readonly verifySignature: (input: {
    readonly publicKeyHex: LibraryCoreEd25519PublicKeyHex;
    readonly signatureHex: LibraryCoreEd25519SignatureHex;
    readonly message: Uint8Array;
  }) => Promise<boolean>;
}

const ENVELOPE_KEYS = Object.freeze([
  "actor_signature",
  "agent_query_body",
  "agent_query_body_digest",
] as const);
const BODY_KEYS = Object.freeze([
  "actor_id",
  "capability_certificate_digest",
  "capability_id",
  "epoch",
  "epoch_id",
  "format",
  "library_id",
  "query",
  "request_id",
  "signature_algorithm",
] as const);
const AGENT_QUERY_IDS = new Set<string>(LIBRARY_CORE_AGENT_QUERY_IDS);

function closedRecord(
  value: unknown,
  keys: readonly string[] | null,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (keys !== null) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      throw new TypeError(`${label} has an invalid field set`);
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function canonicalSnapshot<T extends LibraryCoreCanonicalValue>(value: T): T {
  return decodeLibraryCoreCanonicalValue(
    encodeLibraryCoreCanonicalValue(value, {
      maximumBytes: LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
    }),
    { maximumBytes: LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES },
  ) as T;
}

function checkedDigest(
  dependency: LibraryCoreAgentQueryConstructionDependenciesV1["digest"],
  value: LibraryCoreCanonicalValue,
): LibraryCoreLowercaseHex64 {
  const result = dependency(LIBRARY_CORE_AGENT_QUERY_DIGEST_DOMAIN, value);
  if (!isLibraryCoreLowercaseHex64(result)) {
    throw new TypeError(
      "agent query digest dependency returned an invalid digest",
    );
  }
  return result;
}

function parseBody(value: unknown): LibraryCoreAgentQueryBodyV1 {
  const body = closedRecord(value, BODY_KEYS, "agent query body");
  const query = closedRecord(body.query, null, "agent query request");
  if (
    body.format !== LIBRARY_CORE_AGENT_QUERY_FORMAT ||
    !isLibraryCoreLowercaseHex64(body.library_id) ||
    !isLibraryCoreNonnegativeSafeInteger(body.epoch) ||
    body.epoch === 0 ||
    !isLibraryCoreLowercaseHex64(body.epoch_id) ||
    !isLibraryCoreLowercaseHex64(body.actor_id) ||
    !isLibraryCoreLowercaseHex64(body.capability_id) ||
    !isLibraryCoreLowercaseHex64(body.capability_certificate_digest) ||
    body.capability_id !== body.capability_certificate_digest ||
    !isLibraryCoreLowercaseHex64(body.request_id) ||
    typeof query.queryId !== "string" ||
    !AGENT_QUERY_IDS.has(query.queryId) ||
    body.signature_algorithm !== "ed25519"
  ) {
    throw new TypeError("agent query body is invalid");
  }
  return canonicalSnapshot(
    body as LibraryCoreCanonicalValue,
  ) as unknown as LibraryCoreAgentQueryBodyV1;
}

function parseEnvelope(value: unknown): LibraryCoreAgentQueryEnvelopeV1 {
  const envelope = closedRecord(value, ENVELOPE_KEYS, "agent query envelope");
  const body = parseBody(envelope.agent_query_body);
  if (
    !isLibraryCoreLowercaseHex64(envelope.agent_query_body_digest) ||
    !isLibraryCoreEd25519SignatureHex(envelope.actor_signature)
  ) {
    throw new TypeError("agent query envelope is invalid");
  }
  return Object.freeze({
    agent_query_body: body,
    agent_query_body_digest: envelope.agent_query_body_digest,
    actor_signature: envelope.actor_signature,
  });
}

function signatureInput(digest: LibraryCoreLowercaseHex64): Uint8Array {
  return encodeLibraryCoreSignatureInput(
    LIBRARY_CORE_AGENT_QUERY_SIGNATURE_DOMAIN,
    { agent_query_body_digest: digest },
    { maximumBytes: LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES },
  );
}

export async function constructLibraryCoreAgentQueryV1(
  input: LibraryCoreAgentQueryInputV1,
  dependencies: LibraryCoreAgentQueryConstructionDependenciesV1,
): Promise<LibraryCoreAgentQueryConstructionV1> {
  if (
    typeof dependencies.digest !== "function" ||
    typeof dependencies.signActor !== "function"
  ) {
    throw new TypeError("agent query dependencies must be callable");
  }
  const body = parseBody({
    format: LIBRARY_CORE_AGENT_QUERY_FORMAT,
    library_id: input.library_id,
    epoch: input.epoch,
    epoch_id: input.epoch_id,
    actor_id: input.actor_id,
    capability_id: input.capability_id,
    capability_certificate_digest: input.capability_certificate_digest,
    request_id: input.request_id,
    query: input.query,
    signature_algorithm: "ed25519",
  });
  const bodyDigest = checkedDigest(
    dependencies.digest,
    body as unknown as LibraryCoreCanonicalValue,
  );
  const actorSignature = await dependencies.signActor(
    signatureInput(bodyDigest),
  );
  if (!isLibraryCoreEd25519SignatureHex(actorSignature)) {
    throw new TypeError("agent query actor signature is invalid");
  }
  const envelope = parseEnvelope({
    agent_query_body: body,
    agent_query_body_digest: bodyDigest,
    actor_signature: actorSignature,
  });
  const canonicalBytes = encodeLibraryCoreCanonicalValue(
    envelope as unknown as LibraryCoreCanonicalValue,
    { maximumBytes: LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES },
  );
  return Object.freeze({
    envelope,
    canonical_agent_query_json: new TextDecoder("utf-8", {
      fatal: true,
    }).decode(canonicalBytes),
  });
}

export async function verifyLibraryCoreAgentQueryV1(
  canonicalBytes: Uint8Array,
  actorPublicKey: LibraryCoreEd25519PublicKeyHex,
  dependencies: LibraryCoreAgentQueryVerificationDependenciesV1,
): Promise<LibraryCoreAgentQueryEnvelopeV1> {
  if (
    !isLibraryCoreEd25519PublicKeyHex(actorPublicKey) ||
    typeof dependencies.digest !== "function" ||
    typeof dependencies.verifySignature !== "function"
  ) {
    throw new TypeError("agent query verification dependencies are invalid");
  }
  const decoded = decodeLibraryCoreCanonicalValue(canonicalBytes, {
    maximumBytes: LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
  });
  const canonical = encodeLibraryCoreCanonicalValue(decoded, {
    maximumBytes: LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
  });
  if (
    canonical.byteLength !== canonicalBytes.byteLength ||
    canonical.some((byte, index) => byte !== canonicalBytes[index])
  ) {
    throw new TypeError("agent query bytes are not canonical");
  }
  const envelope = parseEnvelope(decoded);
  const expectedDigest = checkedDigest(
    dependencies.digest,
    envelope.agent_query_body as unknown as LibraryCoreCanonicalValue,
  );
  if (
    expectedDigest !== envelope.agent_query_body_digest ||
    !(await dependencies.verifySignature({
      publicKeyHex: actorPublicKey,
      signatureHex: envelope.actor_signature,
      message: signatureInput(expectedDigest),
    }))
  ) {
    throw new TypeError("agent query proof is invalid");
  }
  return envelope;
}
