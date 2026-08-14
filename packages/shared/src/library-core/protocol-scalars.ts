/**
 * Exact scalar codecs shared by dormant Library Core protocol validators.
 *
 * These predicates establish syntax and numeric bounds only. They do not prove
 * randomness, cryptographic derivation, authority, or semantic ownership.
 */

declare const lowercaseHex64Brand: unique symbol;
declare const ed25519PublicKeyHexBrand: unique symbol;
declare const ed25519SignatureHexBrand: unique symbol;
declare const entityIdBrand: unique symbol;
declare const operationInstanceIdBrand: unique symbol;

export type LibraryCoreLowercaseHex64 = string & {
  readonly [lowercaseHex64Brand]: true;
};

export type LibraryCoreEd25519PublicKeyHex = string & {
  readonly [ed25519PublicKeyHexBrand]: true;
};

export type LibraryCoreEd25519SignatureHex = string & {
  readonly [ed25519SignatureHexBrand]: true;
};

export type LibraryCoreEntityId = string & {
  readonly [entityIdBrand]: true;
};

export type LibraryCoreOperationInstanceId = string & {
  readonly [operationInstanceIdBrand]: true;
};

export const LIBRARY_CORE_MAX_ENTITY_ID_UTF8_BYTES = 4_096;

export interface LibraryCoreEntityIdCodec {
  readonly codecId: "library_core_entity_id_v1";
  readonly codecVersion: 1;
  readonly maximumUtf8Bytes: 4_096;
  readonly validate: (value: unknown) => value is LibraryCoreEntityId;
}

const LOWERCASE_HEX_64 = /^[0-9a-f]{64}$/;
const LOWERCASE_HEX_128 = /^[0-9a-f]{128}$/;
const OPERATION_INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isLibraryCoreLowercaseHex64(
  value: unknown,
): value is LibraryCoreLowercaseHex64 {
  return typeof value === "string" && LOWERCASE_HEX_64.test(value);
}

export function isLibraryCoreEd25519PublicKeyHex(
  value: unknown,
): value is LibraryCoreEd25519PublicKeyHex {
  return typeof value === "string" && LOWERCASE_HEX_64.test(value);
}

export function isLibraryCoreEd25519SignatureHex(
  value: unknown,
): value is LibraryCoreEd25519SignatureHex {
  return typeof value === "string" && LOWERCASE_HEX_128.test(value);
}

/**
 * Accept the exact bounded entity-key string used by dormant operation
 * schemas. The manual UTF-8 count avoids allocating a second encoded copy and
 * rejects lone UTF-16 surrogates instead of silently replacing them.
 */
export function isLibraryCoreEntityId(
  value: unknown,
): value is LibraryCoreEntityId {
  if (typeof value !== "string" || value.length === 0) return false;

  let utf8Bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      utf8Bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      utf8Bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      utf8Bytes += 4;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    } else {
      utf8Bytes += 3;
    }

    if (utf8Bytes > LIBRARY_CORE_MAX_ENTITY_ID_UTF8_BYTES) return false;
  }

  return true;
}

export const LIBRARY_CORE_ENTITY_ID_CODEC_V1 = Object.freeze({
  codecId: "library_core_entity_id_v1",
  codecVersion: 1,
  maximumUtf8Bytes: LIBRARY_CORE_MAX_ENTITY_ID_UTF8_BYTES,
  validate: isLibraryCoreEntityId,
}) satisfies LibraryCoreEntityIdCodec;

export function isLibraryCoreOperationInstanceId(
  value: unknown,
): value is LibraryCoreOperationInstanceId {
  return typeof value === "string" && OPERATION_INSTANCE_ID.test(value);
}

export function isLibraryCoreNonnegativeSafeInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}
