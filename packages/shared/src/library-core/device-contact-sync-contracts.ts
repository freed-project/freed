import type { GoogleContact, IdentitySuggestion } from "../types.js";
import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";
import { LibraryCoreSha256 } from "./sha256.js";

export const LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS = 64;
export const LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS = 64;
export const LIBRARY_CORE_DEVICE_CONTACT_PAGE_MAXIMUM_ROWS = 64;
export const LIBRARY_CORE_DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS = 50;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_CANONICAL_BYTES = 131_072;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_EMAILS = 16;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_PHONES = 16;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_PHOTOS = 4;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_ORGANIZATIONS = 4;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_SUGGESTION_ACCOUNTS = 64;

export type LibraryCoreDeviceContactSyncMutationV1 =
  | LibraryCoreDeviceContactGenerationBeginV1
  | LibraryCoreDeviceContactDeltaAppendV1
  | LibraryCoreDeviceContactMatchAppendV1
  | LibraryCoreDeviceContactGenerationActivateV1
  | LibraryCoreDeviceContactStatusSetV1
  | LibraryCoreDeviceContactSuggestionDismissV1;

export interface LibraryCoreDeviceContactGenerationBeginV1 {
  readonly generationId: string;
  readonly mutationKind: "device_contact_generation_begin_v1";
  readonly schemaVersion: typeof LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION;
  readonly startedAt: number;
}

export interface LibraryCoreDeviceContactDeltaAppendV1 {
  readonly batchOrdinal: number;
  readonly contacts: readonly GoogleContact[];
  readonly deletedResourceNames: readonly string[];
  readonly generationId: string;
  readonly mutationKind: "device_contact_delta_append_v1";
  readonly schemaVersion: typeof LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION;
  readonly updatedAt: number;
}

export interface LibraryCoreDeviceContactMatchResultV1 {
  readonly resourceName: string;
  readonly suggestion: IdentitySuggestion | null;
}

export interface LibraryCoreDeviceContactMatchAppendV1 {
  readonly generationId: string;
  readonly matchedAt: number;
  readonly matches: readonly LibraryCoreDeviceContactMatchResultV1[];
  readonly mutationKind: "device_contact_match_append_v1";
  readonly schemaVersion: typeof LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION;
}

export interface LibraryCoreDeviceContactGenerationActivateV1 {
  readonly activatedAt: number;
  readonly expectedContactCount: number;
  readonly generationId: string;
  readonly mutationKind: "device_contact_generation_activate_v1";
  readonly nextSyncToken: string;
  readonly schemaVersion: typeof LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION;
}

export interface LibraryCoreDeviceContactStatusSetV1 {
  readonly authStatus: "connected" | "reconnect_required";
  readonly errorCode: "missing_token" | "auth" | "network" | "unknown" | null;
  readonly errorMessage: string | null;
  readonly mutationKind: "device_contact_status_set_v1";
  readonly schemaVersion: typeof LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION;
  readonly syncStartedAt: number | null;
  readonly syncStatus: "idle" | "syncing" | "error";
  readonly updatedAt: number;
}

export interface LibraryCoreDeviceContactSuggestionDismissV1 {
  readonly dismissedAt: number;
  readonly mutationKind: "device_contact_suggestion_dismiss_v1";
  readonly schemaVersion: typeof LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION;
  readonly suggestionId: string;
}

export interface LibraryCoreDeviceContactMutationReceiptV1 {
  readonly activeGenerationId: string | null;
  readonly changed: boolean;
  readonly generationId: string | null;
  readonly matchedContactCount: number;
  readonly revision: number;
  readonly schemaVersion: typeof LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION;
  readonly stagedContactCount: number;
}

export type LibraryCoreDeviceContactParseResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

const textEncoder = new TextEncoder();
const mutationDigestPrefix = textEncoder.encode(
  "freed.library-core.v1/digest-records/device-contact-mutation\u0000",
);

function failure<T>(error: string): LibraryCoreDeviceContactParseResult<T> {
  return Object.freeze({ error, ok: false });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some(
      (key) => !descriptors[key]?.enumerable || !("value" in descriptors[key]),
    )
  ) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function closedRecordWithOptional(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    ownKeys.some(
      (key) => typeof key !== "string" || !allowedKeys.includes(key),
    ) ||
    requiredKeys.some((key) => !ownKeys.includes(key)) ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        !descriptors[key]?.enumerable ||
        !("value" in descriptors[key]),
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    allowedKeys.map((key) => [key, descriptors[key]?.value]),
  );
}

function boundedText(
  value: unknown,
  maximumBytes: number,
  options: { allowEmpty?: boolean; nullable?: boolean } = {},
): string | null | undefined {
  if (options.nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && value.length === 0) ||
    textEncoder.encode(value).byteLength > maximumBytes
  ) {
    return undefined;
  }
  return value;
}

function optionalText(
  value: unknown,
  maximumBytes: number,
): string | undefined | false {
  if (value === undefined) return undefined;
  return boundedText(value, maximumBytes, { allowEmpty: true }) ?? false;
}

function parseContact(value: unknown): GoogleContact | null {
  const record = closedRecordWithOptional(
    value,
    ["emails", "name", "organizations", "phones", "photos", "resourceName"],
    ["etag", "metadata"],
  );
  const name = closedRecordWithOptional(
    record?.name,
    [],
    ["displayName", "familyName", "givenName", "middleName"],
  );
  const resourceName = boundedText(record?.resourceName, 1_024);
  const etag = optionalText(record?.etag, 2_048);
  if (!record || !name || !resourceName || etag === false) return null;

  const nameValues = {
    displayName: optionalText(name.displayName, 2_048),
    familyName: optionalText(name.familyName, 2_048),
    givenName: optionalText(name.givenName, 2_048),
    middleName: optionalText(name.middleName, 2_048),
  };
  if (Object.values(nameValues).some((entry) => entry === false)) return null;

  if (
    !Array.isArray(record.emails) ||
    record.emails.length > LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_EMAILS ||
    !Array.isArray(record.phones) ||
    record.phones.length > LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_PHONES ||
    !Array.isArray(record.photos) ||
    record.photos.length > LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_PHOTOS ||
    !Array.isArray(record.organizations) ||
    record.organizations.length >
      LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_ORGANIZATIONS
  ) {
    return null;
  }

  const parseValueEntry = (entry: unknown) => {
    const item = closedRecordWithOptional(entry, ["value"], ["type"]);
    const itemValue = boundedText(item?.value, 2_048);
    const type = optionalText(item?.type, 255);
    return item && itemValue && type !== false
      ? Object.freeze({
          ...(type === undefined ? {} : { type }),
          value: itemValue,
        })
      : null;
  };
  const emails = record.emails.map(parseValueEntry);
  const phones = record.phones.map(parseValueEntry);
  if (emails.includes(null) || phones.includes(null)) return null;

  const photos = record.photos.map((entry) => {
    const item = closedRecordWithOptional(entry, ["url"], ["default"]);
    const url = boundedText(item?.url, 8_192);
    if (
      !item ||
      !url ||
      (item.default !== undefined && typeof item.default !== "boolean")
    ) {
      return null;
    }
    return Object.freeze({
      ...(item.default === undefined ? {} : { default: item.default }),
      url,
    });
  });
  if (photos.includes(null)) return null;

  const organizations = record.organizations.map((entry) => {
    const item = closedRecordWithOptional(entry, [], ["name", "title"]);
    const organizationName = optionalText(item?.name, 1_024);
    const title = optionalText(item?.title, 1_024);
    if (
      !item ||
      organizationName === false ||
      title === false ||
      (organizationName === undefined && title === undefined)
    ) {
      return null;
    }
    return Object.freeze({
      ...(organizationName === undefined ? {} : { name: organizationName }),
      ...(title === undefined ? {} : { title }),
    });
  });
  if (organizations.includes(null)) return null;

  let metadata: GoogleContact["metadata"];
  if (record.metadata !== undefined) {
    const metadataRecord = closedRecordWithOptional(
      record.metadata,
      [],
      ["deleted"],
    );
    if (
      !metadataRecord ||
      (metadataRecord.deleted !== undefined &&
        typeof metadataRecord.deleted !== "boolean")
    ) {
      return null;
    }
    metadata = Object.freeze({
      ...(metadataRecord.deleted === undefined
        ? {}
        : { deleted: metadataRecord.deleted }),
    });
  }

  const contact = Object.freeze({
    emails: Object.freeze(emails) as GoogleContact["emails"],
    ...(etag === undefined ? {} : { etag }),
    ...(metadata === undefined ? {} : { metadata }),
    name: Object.freeze(
      Object.fromEntries(
        Object.entries(nameValues).filter(([, entry]) => entry !== undefined),
      ),
    ) as GoogleContact["name"],
    organizations: Object.freeze(
      organizations,
    ) as GoogleContact["organizations"],
    phones: Object.freeze(phones) as GoogleContact["phones"],
    photos: Object.freeze(photos) as GoogleContact["photos"],
    resourceName,
  });
  try {
    encodeLibraryCoreCanonicalValue(
      contact as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_CANONICAL_BYTES },
    );
  } catch {
    return null;
  }
  return contact;
}

function parseSuggestion(value: unknown): IdentitySuggestion | null {
  const record = closedRecordWithOptional(
    value,
    ["accountIds", "confidence", "createdAt", "id", "kind", "label"],
    ["personId", "reason"],
  );
  const id = boundedText(record?.id, 8_192);
  const label = boundedText(record?.label, 2_048);
  const personId = optionalText(record?.personId, 2_048);
  const reason = optionalText(record?.reason, 4_096);
  if (
    !record ||
    !id ||
    !label ||
    personId === false ||
    reason === false ||
    !Array.isArray(record.accountIds) ||
    record.accountIds.length >
      LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_SUGGESTION_ACCOUNTS ||
    !["high", "medium"].includes(String(record.confidence)) ||
    !["merge_accounts", "attach_accounts_to_person"].includes(
      String(record.kind),
    ) ||
    !isLibraryCoreNonnegativeSafeInteger(record.createdAt)
  ) {
    return null;
  }
  const accountIds = record.accountIds.map((entry) =>
    boundedText(entry, 1_024),
  );
  if (
    accountIds.some((entry) => !entry) ||
    new Set(accountIds).size !== accountIds.length
  ) {
    return null;
  }
  if (
    (record.kind === "attach_accounts_to_person") !==
    (personId !== undefined)
  ) {
    return null;
  }
  return Object.freeze({
    accountIds: Object.freeze(accountIds) as string[],
    confidence: record.confidence,
    createdAt: record.createdAt,
    id,
    kind: record.kind,
    label,
    ...(personId === undefined ? {} : { personId }),
    ...(reason === undefined ? {} : { reason }),
  }) as IdentitySuggestion;
}

export function parseLibraryCoreDeviceContactSyncMutationV1(
  value: unknown,
): LibraryCoreDeviceContactParseResult<LibraryCoreDeviceContactSyncMutationV1> {
  if (value === null || typeof value !== "object") {
    return failure("device contact mutation is invalid");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "mutationKind")?.value;
  if (kind === "device_contact_generation_begin_v1") {
    const record = closedRecord(value, [
      "generationId",
      "mutationKind",
      "schemaVersion",
      "startedAt",
    ]);
    const generationId = boundedText(record?.generationId, 255);
    if (
      !record ||
      !generationId ||
      record.schemaVersion !== 1 ||
      !isLibraryCoreNonnegativeSafeInteger(record.startedAt)
    ) {
      return failure("device contact generation begin mutation is invalid");
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        ...record,
        generationId,
      }) as unknown as LibraryCoreDeviceContactGenerationBeginV1,
    });
  }
  if (kind === "device_contact_delta_append_v1") {
    const record = closedRecord(value, [
      "batchOrdinal",
      "contacts",
      "deletedResourceNames",
      "generationId",
      "mutationKind",
      "schemaVersion",
      "updatedAt",
    ]);
    const generationId = boundedText(record?.generationId, 255);
    if (
      !record ||
      !generationId ||
      record.schemaVersion !== 1 ||
      !isLibraryCoreNonnegativeSafeInteger(record.batchOrdinal) ||
      !isLibraryCoreNonnegativeSafeInteger(record.updatedAt) ||
      !Array.isArray(record.contacts) ||
      !Array.isArray(record.deletedResourceNames) ||
      record.contacts.length + record.deletedResourceNames.length < 1 ||
      record.contacts.length + record.deletedResourceNames.length >
        LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS
    ) {
      return failure("device contact delta mutation is invalid");
    }
    const contacts = record.contacts.map(parseContact);
    const deletedResourceNames = record.deletedResourceNames.map((entry) =>
      boundedText(entry, 1_024),
    );
    const identities = [
      ...contacts.map((entry) => entry?.resourceName),
      ...deletedResourceNames,
    ];
    if (
      contacts.includes(null) ||
      deletedResourceNames.some((entry) => !entry) ||
      new Set(identities).size !== identities.length
    ) {
      return failure("device contact delta members are invalid");
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        batchOrdinal: record.batchOrdinal,
        contacts: Object.freeze(contacts) as GoogleContact[],
        deletedResourceNames: Object.freeze(deletedResourceNames) as string[],
        generationId,
        mutationKind: kind,
        schemaVersion: 1,
        updatedAt: record.updatedAt,
      }),
    });
  }
  if (kind === "device_contact_match_append_v1") {
    const record = closedRecord(value, [
      "generationId",
      "matchedAt",
      "matches",
      "mutationKind",
      "schemaVersion",
    ]);
    const generationId = boundedText(record?.generationId, 255);
    if (
      !record ||
      !generationId ||
      record.schemaVersion !== 1 ||
      !isLibraryCoreNonnegativeSafeInteger(record.matchedAt) ||
      !Array.isArray(record.matches) ||
      record.matches.length < 1 ||
      record.matches.length > LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS
    ) {
      return failure("device contact match mutation is invalid");
    }
    const matches = record.matches.map((entry) => {
      const match = closedRecord(entry, ["resourceName", "suggestion"]);
      const resourceName = boundedText(match?.resourceName, 1_024);
      if (!match || !resourceName) return null;
      if (match.suggestion === null) {
        return Object.freeze({ resourceName, suggestion: null });
      }
      const suggestion = parseSuggestion(match.suggestion);
      return suggestion ? Object.freeze({ resourceName, suggestion }) : null;
    });
    if (
      matches.includes(null) ||
      new Set(matches.map((entry) => entry?.resourceName)).size !==
        matches.length
    ) {
      return failure("device contact match members are invalid");
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        generationId,
        matchedAt: record.matchedAt,
        matches: Object.freeze(
          matches,
        ) as LibraryCoreDeviceContactMatchResultV1[],
        mutationKind: kind,
        schemaVersion: 1,
      }),
    });
  }
  if (kind === "device_contact_generation_activate_v1") {
    const record = closedRecord(value, [
      "activatedAt",
      "expectedContactCount",
      "generationId",
      "mutationKind",
      "nextSyncToken",
      "schemaVersion",
    ]);
    const generationId = boundedText(record?.generationId, 255);
    const nextSyncToken = boundedText(record?.nextSyncToken, 65_536, {
      allowEmpty: true,
    });
    if (
      !record ||
      !generationId ||
      nextSyncToken === undefined ||
      record.schemaVersion !== 1 ||
      !isLibraryCoreNonnegativeSafeInteger(record.activatedAt) ||
      !isLibraryCoreNonnegativeSafeInteger(record.expectedContactCount)
    ) {
      return failure("device contact activation mutation is invalid");
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        ...record,
        generationId,
        nextSyncToken,
      }) as unknown as LibraryCoreDeviceContactGenerationActivateV1,
    });
  }
  if (kind === "device_contact_status_set_v1") {
    const record = closedRecord(value, [
      "authStatus",
      "errorCode",
      "errorMessage",
      "mutationKind",
      "schemaVersion",
      "syncStartedAt",
      "syncStatus",
      "updatedAt",
    ]);
    const errorMessage = boundedText(record?.errorMessage, 4_096, {
      allowEmpty: true,
      nullable: true,
    });
    if (
      !record ||
      record.schemaVersion !== 1 ||
      !["connected", "reconnect_required"].includes(
        String(record.authStatus),
      ) ||
      !["idle", "syncing", "error"].includes(String(record.syncStatus)) ||
      ![null, "missing_token", "auth", "network", "unknown"].includes(
        record.errorCode as never,
      ) ||
      errorMessage === undefined ||
      (record.errorCode === null) !== (errorMessage === null) ||
      (record.syncStatus === "syncing") !==
        isLibraryCoreNonnegativeSafeInteger(record.syncStartedAt) ||
      !isLibraryCoreNonnegativeSafeInteger(record.updatedAt)
    ) {
      return failure("device contact status mutation is invalid");
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        ...record,
        errorMessage,
      }) as unknown as LibraryCoreDeviceContactStatusSetV1,
    });
  }
  if (kind === "device_contact_suggestion_dismiss_v1") {
    const record = closedRecord(value, [
      "dismissedAt",
      "mutationKind",
      "schemaVersion",
      "suggestionId",
    ]);
    const suggestionId = boundedText(record?.suggestionId, 8_192);
    if (
      !record ||
      !suggestionId ||
      record.schemaVersion !== 1 ||
      !isLibraryCoreNonnegativeSafeInteger(record.dismissedAt)
    ) {
      return failure("device contact dismissal mutation is invalid");
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        ...record,
        suggestionId,
      }) as unknown as LibraryCoreDeviceContactSuggestionDismissV1,
    });
  }
  return failure("device contact mutation kind is invalid");
}

export function parseLibraryCoreDeviceContactMutationReceiptV1(
  value: unknown,
): LibraryCoreDeviceContactParseResult<LibraryCoreDeviceContactMutationReceiptV1> {
  const record = closedRecord(value, [
    "activeGenerationId",
    "changed",
    "generationId",
    "matchedContactCount",
    "revision",
    "schemaVersion",
    "stagedContactCount",
  ]);
  const activeGenerationId = boundedText(record?.activeGenerationId, 255, {
    nullable: true,
  });
  const generationId = boundedText(record?.generationId, 255, {
    nullable: true,
  });
  if (
    !record ||
    activeGenerationId === undefined ||
    generationId === undefined ||
    typeof record.changed !== "boolean" ||
    record.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(record.revision) ||
    !isLibraryCoreNonnegativeSafeInteger(record.stagedContactCount) ||
    !isLibraryCoreNonnegativeSafeInteger(record.matchedContactCount)
  ) {
    return failure("device contact mutation receipt is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      activeGenerationId,
      changed: record.changed,
      generationId,
      matchedContactCount: record.matchedContactCount,
      revision: record.revision,
      schemaVersion: 1,
      stagedContactCount: record.stagedContactCount,
    }),
  });
}

export function digestLibraryCoreDeviceContactSyncMutationV1(
  value: unknown,
): string {
  const parsed = parseLibraryCoreDeviceContactSyncMutationV1(value);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return new LibraryCoreSha256()
    .update(mutationDigestPrefix)
    .update(
      encodeLibraryCoreCanonicalValue(
        parsed.value as unknown as LibraryCoreCanonicalValue,
      ),
    )
    .digestLowerHex();
}
