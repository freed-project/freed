import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { LibraryServiceFailure } from "./contracts.js";

const FORMAT = "freed_google_drive_sealed_credential_v1";
const MAX_PLAINTEXT_BYTES = 16_384;
const MAX_RECORD_BYTES = 24_576;
const RECORD_KEYS = "ciphertext,format,nonce,recordId,schemaVersion,tag";

function refuse(): never {
  // Never forward crypto/parser errors, which can contain record material.
  throw new LibraryServiceFailure("drive_credential_unavailable");
}

function identity(recordId: string, wrappingKey: Uint8Array): Buffer {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(recordId) ||
    !(wrappingKey instanceof Uint8Array) ||
    wrappingKey.byteLength !== 32
  )
    refuse();
  return Buffer.from(`${FORMAT}\0${recordId}`, "utf8");
}

function exactBase64(value: unknown, minimum: number, maximum: number): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(maximum / 3) * 4)
    refuse();
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length < minimum ||
    bytes.length > maximum ||
    bytes.toString("base64") !== value
  )
    refuse();
  return bytes;
}

/** Seal one bounded OAuth record, binding its identity to the authentication tag. */
export function sealLinuxDriveCredential(
  recordId: string,
  credential: string,
  wrappingKey: Uint8Array,
): Uint8Array {
  const aad = identity(recordId, wrappingKey);
  if (
    typeof credential !== "string" ||
    credential.length === 0 ||
    Buffer.byteLength(credential, "utf8") > MAX_PLAINTEXT_BYTES
  )
    refuse();
  const plaintext = Buffer.from(credential, "utf8");
  try {
    if (plaintext.toString("utf8") !== credential) refuse();
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", wrappingKey, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return Buffer.from(
      JSON.stringify({
        ciphertext: ciphertext.toString("base64"),
        format: FORMAT,
        nonce: nonce.toString("base64"),
        recordId,
        schemaVersion: 1,
        tag: cipher.getAuthTag().toString("base64"),
      }),
      "utf8",
    );
  } catch {
    return refuse();
  } finally {
    plaintext.fill(0);
  }
}

/** Authenticate a sealed record before returning any plaintext to the caller. */
export function openLinuxDriveCredential(
  recordId: string,
  sealed: Uint8Array,
  wrappingKey: Uint8Array,
): string {
  const aad = identity(recordId, wrappingKey);
  if (
    !(sealed instanceof Uint8Array) ||
    sealed.byteLength === 0 ||
    sealed.byteLength > MAX_RECORD_BYTES
  )
    refuse();
  let pending: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    const record: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(sealed),
    );
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).sort().join(",") !== RECORD_KEYS
    )
      refuse();
    const value = record as Record<string, unknown>;
    if (
      value.format !== FORMAT ||
      value.schemaVersion !== 1 ||
      value.recordId !== recordId
    )
      refuse();
    const nonce = exactBase64(value.nonce, 12, 12);
    const tag = exactBase64(value.tag, 16, 16);
    const ciphertext = exactBase64(value.ciphertext, 1, MAX_PLAINTEXT_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    pending = decipher.update(ciphertext);
    plaintext = Buffer.concat([pending, decipher.final()]);
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    return refuse();
  } finally {
    pending?.fill(0);
    plaintext?.fill(0);
  }
}
