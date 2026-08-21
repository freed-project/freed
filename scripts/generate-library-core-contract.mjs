#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(
  root,
  "packages/shared/src/library-core/sqlite-contract-v1.json",
);
const schemaPath = resolve(
  root,
  "packages/shared/src/library-core/normalized-schema-v1.sql",
);
const typescriptPath = resolve(
  root,
  "packages/shared/src/library-core/sqlite-contract.generated.ts",
);
const rustPath = resolve(
  root,
  "packages/library-core-native/src/sqlite_contract_generated.rs",
);
const check = process.argv.includes("--check");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function assertSortedUnique(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} must be a nonempty array`);
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== "string" || !/^[a-z0-9_]+$/.test(value)) {
      throw new TypeError(`${label} contains an invalid identifier`);
    }
    if (index > 0 && values[index - 1] >= value) {
      throw new TypeError(`${label} must be sorted and unique`);
    }
  }
}

function assertSortedUniqueFields(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} must be a nonempty array`);
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== "string" || !/^[a-z][A-Za-z0-9]*$/.test(value)) {
      throw new TypeError(`${label} contains an invalid field name`);
    }
    if (index > 0 && values[index - 1] >= value) {
      throw new TypeError(`${label} must be sorted and unique`);
    }
  }
}

function assertContract(contract) {
  const expectedKeys = [
    "applicationId",
    "capabilityProfiles",
    "checkpointFormat",
    "checkpointImports",
    "checkpointRecords",
    "contractVersion",
    "fractionalFields",
    "limits",
    "mutationPrograms",
    "mutations",
    "protocolVersion",
    "queries",
    "queryPrograms",
    "schemaVersion",
  ];
  const keys = Object.keys(contract).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError("SQLite contract source has unknown or missing fields");
  }
  if (
    contract.applicationId !== 1_179_796_804 ||
    contract.contractVersion !== 1 ||
    contract.schemaVersion !== 1 ||
    contract.protocolVersion !== 2 ||
    contract.checkpointFormat !== "freed_normalized_checkpoint_v2"
  ) {
    throw new TypeError("SQLite contract version identity is invalid");
  }
  const limits = contract.limits;
  const expectedLimits = Object.freeze({
    checkpointPageDecodedBytes: 2_097_152,
    checkpointPageRecords: 128,
    checkpointRecordCanonicalBytes: 131_072,
    contentChunkBytes: 65_536,
    nativeExportResponseBytes: 1_048_576,
  });
  if (
    Object.keys(limits).length !== Object.keys(expectedLimits).length ||
    Object.entries(expectedLimits).some(([key, value]) => limits[key] !== value)
  ) {
    throw new TypeError(
      "SQLite contract transport limits changed without a version boundary",
    );
  }
  assertSortedUnique(contract.mutations, "mutations");
  assertSortedUnique(contract.queries, "queries");
  const capabilityProfileKeys = Object.keys(contract.capabilityProfiles).sort();
  if (capabilityProfileKeys.join(",") !== "legacyEditor,scraper") {
    throw new TypeError("SQLite contract capability profiles are invalid");
  }
  for (const [profile, mutations] of Object.entries(
    contract.capabilityProfiles,
  )) {
    assertSortedUnique(mutations, `${profile} capability mutations`);
    if (mutations.some((mutation) => !contract.mutations.includes(mutation))) {
      throw new TypeError(
        `${profile} capability includes an undeclared SQLite mutation`,
      );
    }
  }
  const mutationProgramFields = [
    "clockReadSql",
    "clockWriteSql",
    "currentValueSql",
    "dependentDeleteSql",
    "dependentInsertSql",
    "entityType",
    "invalidationTopic",
    "materializeSql",
    "maximumMembers",
    "payloadKind",
    "requiresExistingTarget",
    "targetExistsSql",
  ];
  for (const [mutationId, program] of Object.entries(
    contract.mutationPrograms,
  )) {
    if (
      !contract.mutations.includes(mutationId) ||
      Object.keys(program).sort().join(",") !==
        mutationProgramFields.join(",") ||
      typeof program.entityType !== "string" ||
      !/^[A-Z][A-Za-z0-9]*$/.test(program.entityType) ||
      typeof program.invalidationTopic !== "string" ||
      !/^[a-z][a-z0-9_]*$/.test(program.invalidationTopic) ||
      !Array.isArray(program.dependentDeleteSql) ||
      program.dependentDeleteSql.some(
        (sql) => typeof sql !== "string" || sql.length === 0,
      ) ||
      !Array.isArray(program.dependentInsertSql) ||
      program.dependentInsertSql.some(
        (sql) => typeof sql !== "string" || sql.length === 0,
      ) ||
      ![
        "account_upsert",
        "boolean_assignment",
        "person_upsert",
        "read_at",
        "remove",
        "rss_feed_upsert",
      ].includes(
        program.payloadKind,
      ) ||
      typeof program.requiresExistingTarget !== "boolean" ||
      !Number.isSafeInteger(program.maximumMembers) ||
      program.maximumMembers < 1 ||
      program.maximumMembers > 256 ||
      [
        program.clockReadSql,
        program.clockWriteSql,
        program.currentValueSql,
        program.materializeSql,
        program.targetExistsSql,
      ].some((sql) => typeof sql !== "string") ||
      program.materializeSql.length === 0 ||
      program.targetExistsSql.length === 0 ||
      (![
        "account_upsert",
        "person_upsert",
        "rss_feed_upsert",
      ].includes(program.payloadKind) &&
        [
          program.clockReadSql,
          program.clockWriteSql,
          program.currentValueSql,
        ].some((sql) => sql.length === 0))
    ) {
      throw new TypeError("SQLite mutation program registry is invalid");
    }
  }
  for (const [queryId, program] of Object.entries(contract.queryPrograms)) {
    if (
      !contract.queries.includes(queryId) ||
      Object.keys(program).sort().join(",") !==
        "countSql,maximumScanRows,sql" ||
      typeof program.sql !== "string" ||
      program.sql.length === 0 ||
      typeof program.countSql !== "string" ||
      program.countSql.length === 0 ||
      !Number.isSafeInteger(program.maximumScanRows) ||
      program.maximumScanRows < 1 ||
      program.maximumScanRows > 1_001
    ) {
      throw new TypeError("SQLite query program registry is invalid");
    }
  }
  const allowedKeyCodecs = new Set([
    "chunk",
    "digest",
    "entity",
    "field",
    "ordinal",
    "pair",
    "receipt",
    "relationship",
    "singleton",
    "text",
  ]);
  let previous = "";
  const payloads = new Set();
  const registryKeys = new Set();
  for (const entry of contract.checkpointRecords) {
    if (
      Object.keys(entry).sort().join(",") !==
        "fields,payload,primaryKey,registryKey" ||
      !/^[0-9a-z]{2}_[a-z0-9_]+$/.test(entry.registryKey) ||
      entry.registryKey <= previous ||
      !allowedKeyCodecs.has(entry.primaryKey) ||
      !/^[a-z0-9_]+$/.test(entry.payload)
    ) {
      throw new TypeError("checkpoint record registry is invalid");
    }
    if (
      entry.registryKey.includes("shell") ||
      entry.payload.includes("shell")
    ) {
      throw new TypeError(
        "checkpoint record registry cannot contain a Library shell",
      );
    }
    if (payloads.has(entry.payload)) {
      throw new TypeError("checkpoint record payload names must be unique");
    }
    previous = entry.registryKey;
    registryKeys.add(entry.registryKey);
    payloads.add(entry.payload);
    assertSortedUniqueFields(entry.fields, `${entry.registryKey} fields`);
  }
  for (const [registryKey, fields] of Object.entries(
    contract.fractionalFields,
  )) {
    const entry = contract.checkpointRecords.find(
      (candidate) => candidate.registryKey === registryKey,
    );
    if (!registryKeys.has(registryKey) || entry === undefined) {
      throw new TypeError("fractional field registry key is unsupported");
    }
    assertSortedUniqueFields(fields, `${registryKey} fractional fields`);
    if (fields.some((field) => !entry.fields.includes(field))) {
      throw new TypeError("fractional field is not in its checkpoint payload");
    }
  }
  const importKeys = Object.keys(contract.checkpointImports).sort();
  if (
    importKeys.length !== registryKeys.size ||
    importKeys.some((key, index) => key !== [...registryKeys].sort()[index])
  ) {
    throw new TypeError(
      "checkpoint import registry must match the record registry",
    );
  }
  const keyArities = Object.freeze({
    chunk: 2,
    digest: 1,
    entity: 2,
    field: 3,
    ordinal: 2,
    pair: 2,
    receipt: 2,
    relationship: 5,
    singleton: 0,
    text: 1,
  });
  for (const entry of contract.checkpointRecords) {
    const program = contract.checkpointImports[entry.registryKey];
    const keys = Object.keys(program);
    if (
      !keys.includes("primaryKeyColumns") ||
      !keys.includes("table") ||
      keys.some(
        (key) =>
          ![
            "constantColumns",
            "fieldColumns",
            "identityPayloadFields",
            "primaryKeyColumns",
            "table",
          ].includes(key),
      ) ||
      typeof program.table !== "string" ||
      !/^[a-z][a-z0-9_]+$/.test(program.table) ||
      !Array.isArray(program.primaryKeyColumns) ||
      program.primaryKeyColumns.length !== keyArities[entry.primaryKey] ||
      program.primaryKeyColumns.some(
        (column) =>
          typeof column !== "string" || !/^[a-z][a-z0-9_]*$/.test(column),
      ) ||
      new Set(program.primaryKeyColumns).size !==
        program.primaryKeyColumns.length
    ) {
      throw new TypeError("checkpoint import program identity is invalid");
    }
    for (const [column, value] of Object.entries(
      program.constantColumns ?? {},
    )) {
      if (!/^[a-z][a-z0-9_]*$/.test(column) || !Number.isSafeInteger(value)) {
        throw new TypeError("checkpoint import constant is invalid");
      }
    }
    for (const [field, column] of Object.entries(program.fieldColumns ?? {})) {
      if (
        !entry.fields.includes(field) ||
        !(
          column === null ||
          column === "$chunkBytes" ||
          (typeof column === "string" && /^[a-z][a-z0-9_]*$/.test(column))
        )
      ) {
        throw new TypeError("checkpoint import field mapping is invalid");
      }
    }
    for (const [field, keyIndex] of Object.entries(
      program.identityPayloadFields ?? {},
    )) {
      if (
        !entry.fields.includes(field) ||
        !Number.isSafeInteger(keyIndex) ||
        keyIndex < 0 ||
        keyIndex >= program.primaryKeyColumns.length
      ) {
        throw new TypeError("checkpoint import identity field is invalid");
      }
    }
  }
}

function camelToSnake(value) {
  return value.replaceAll(/([A-Z])/g, "_$1").toLowerCase();
}

function checkpointImportPrograms(contract) {
  return Object.fromEntries(
    contract.checkpointRecords.map((entry) => {
      const source = contract.checkpointImports[entry.registryKey];
      const columns = [];
      const expressions = [];
      for (const [column, value] of Object.entries(
        source.constantColumns ?? {},
      )) {
        columns.push(column);
        expressions.push(String(value));
      }
      source.primaryKeyColumns.forEach((column, index) => {
        columns.push(column);
        expressions.push(
          source.primaryKeyColumns.length === 1
            ? "json_extract(?1, '$')"
            : `json_extract(?1, '$[${index}]')`,
        );
      });
      let hasChunkBytes = false;
      for (const field of entry.fields) {
        const override = source.fieldColumns?.[field];
        if (override === null) continue;
        const column = override ?? camelToSnake(field);
        if (column === "$chunkBytes") {
          const inferredColumn = camelToSnake(field).replace("_base64", "");
          if (columns.includes(inferredColumn)) {
            throw new TypeError("checkpoint import columns must be unique");
          }
          columns.push(inferredColumn);
          expressions.push("?3");
          hasChunkBytes = true;
          continue;
        }
        if (columns.includes(column)) continue;
        columns.push(column);
        expressions.push(`json_extract(?2, '$.${field}')`);
      }
      if (new Set(columns).size !== columns.length) {
        throw new TypeError("checkpoint import columns must be unique");
      }
      const identityChecks = Object.entries(
        source.identityPayloadFields ?? {},
      ).map(
        ([field, keyIndex]) =>
          `json_extract(?2, '$.${field}') = ${
            source.primaryKeyColumns.length === 1
              ? "json_extract(?1, '$')"
              : `json_extract(?1, '$[${keyIndex}]')`
          }`,
      );
      return [
        entry.registryKey,
        Object.freeze({
          hasChunkBytes,
          primaryKeyArity: source.primaryKeyColumns.length,
          sql: `INSERT INTO ${source.table} (${columns.join(", ")}) SELECT ${expressions.join(", ")}${identityChecks.length === 0 ? "" : ` WHERE ${identityChecks.join(" AND ")}`};`,
        }),
      ];
    }),
  );
}

function typescriptSource(contract, schemaSql, schemaDigest) {
  const entries = JSON.stringify(contract.checkpointRecords, null, 2)
    .replaceAll('"registryKey"', "registryKey")
    .replaceAll('"primaryKey"', "primaryKey")
    .replaceAll('"payload"', "payload")
    .replaceAll('"fields"', "fields")
    .replaceAll(/: "([^"]+)"/g, ': "$1"');
  const stringTuple = (values) =>
    values.map((value) => `  ${JSON.stringify(value)},`).join("\n");
  const importPrograms = checkpointImportPrograms(contract);
  const capabilityOperationIds = [
    ...new Set(Object.values(contract.capabilityProfiles).flat()),
  ].sort();
  return `/* This file is generated by scripts/generate-library-core-contract.mjs. */

export const LIBRARY_CORE_SQLITE_CONTRACT_VERSION = ${contract.contractVersion} as const;
export const LIBRARY_CORE_SQLITE_APPLICATION_ID = ${contract.applicationId} as const;
export const LIBRARY_CORE_SQLITE_SCHEMA_VERSION = ${contract.schemaVersion} as const;
export const LIBRARY_CORE_SQLITE_PROTOCOL_VERSION = ${contract.protocolVersion} as const;
export const LIBRARY_CORE_NORMALIZED_CHECKPOINT_FORMAT = ${JSON.stringify(contract.checkpointFormat)} as const;
export const LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES = ${contract.limits.checkpointRecordCanonicalBytes} as const;
export const LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES = ${contract.limits.checkpointPageDecodedBytes} as const;
export const LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS = ${contract.limits.checkpointPageRecords} as const;
export const LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES = ${contract.limits.nativeExportResponseBytes} as const;
export const LIBRARY_CORE_CONTENT_CHUNK_BYTES = ${contract.limits.contentChunkBytes} as const;
export const LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256 = ${JSON.stringify(schemaDigest)} as const;
export const LIBRARY_CORE_NORMALIZED_SCHEMA_SQL = ${JSON.stringify(schemaSql)} as const;

export const LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY = ${entries} as const;
export const LIBRARY_CORE_CHECKPOINT_FRACTIONAL_FIELDS = ${JSON.stringify(contract.fractionalFields, null, 2)} as const;
export const LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS = ${JSON.stringify(importPrograms, null, 2)} as const;
export type LibraryCoreCheckpointRegistryEntry = (typeof LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY)[number];
export type LibraryCoreCheckpointRegistryKey = LibraryCoreCheckpointRegistryEntry["registryKey"];
export type LibraryCoreCheckpointPayloadKind = LibraryCoreCheckpointRegistryEntry["payload"];
export type LibraryCoreCheckpointPrimaryKeyCodec = LibraryCoreCheckpointRegistryEntry["primaryKey"];

export const LIBRARY_CORE_OPERATION_IDS = [
${stringTuple(contract.mutations)}
] as const;
export type LibraryCoreOperationId = (typeof LIBRARY_CORE_OPERATION_IDS)[number];

export const LIBRARY_CORE_CAPABILITY_OPERATION_IDS = Object.freeze([
${stringTuple(capabilityOperationIds)}
] as const);
export type LibraryCoreCapabilityOperationId = (typeof LIBRARY_CORE_CAPABILITY_OPERATION_IDS)[number];

export const LIBRARY_CORE_LEGACY_EDITOR_OPERATION_IDS = Object.freeze([
${stringTuple(contract.capabilityProfiles.legacyEditor)}
] as const satisfies readonly LibraryCoreCapabilityOperationId[]);

export const LIBRARY_CORE_SCRAPER_OPERATION_IDS = Object.freeze([
${stringTuple(contract.capabilityProfiles.scraper)}
] as const satisfies readonly LibraryCoreCapabilityOperationId[]);

export const LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS = ${JSON.stringify(contract.mutationPrograms, null, 2)} as const;
export type LibraryCoreSqliteMutationProgramId = keyof typeof LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS;

export const LIBRARY_CORE_QUERY_IDS = [
${stringTuple(contract.queries)}
] as const;
export type LibraryCoreQueryId = (typeof LIBRARY_CORE_QUERY_IDS)[number];

export const LIBRARY_CORE_SQLITE_QUERY_PROGRAMS = ${JSON.stringify(contract.queryPrograms, null, 2)} as const;
export type LibraryCoreSqliteQueryProgramId = keyof typeof LIBRARY_CORE_SQLITE_QUERY_PROGRAMS;
`;
}

function rustVariant(value) {
  return value
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function rustSource(contract, schemaDigest) {
  const recordVariants = contract.checkpointRecords
    .map(
      (entry) =>
        `            ${rustVariant(entry.payload)} => ${JSON.stringify(entry.registryKey)},`,
    )
    .join("\n");
  const variants = contract.checkpointRecords
    .map((entry) => `    ${rustVariant(entry.payload)},`)
    .join("\n");
  const registryMatches = contract.checkpointRecords
    .map(
      (entry) =>
        `            ${JSON.stringify(entry.registryKey)} => Some(Self::${rustVariant(entry.payload)}),`,
    )
    .join("\n");
  const fieldVariants = contract.checkpointRecords
    .map(
      (entry) =>
        `            ${rustVariant(entry.payload)} => &[\n${entry.fields.map((field) => `                ${JSON.stringify(field)},`).join("\n")}\n            ],`,
    )
    .join("\n");
  const fractionalFieldVariants = contract.checkpointRecords
    .map((entry) => {
      const fields = contract.fractionalFields[entry.registryKey] ?? [];
      return `            ${rustVariant(entry.payload)} => &[${fields.map((field) => JSON.stringify(field)).join(", ")}],`;
    })
    .join("\n");
  const operations = contract.mutations
    .map((value) => `    ${JSON.stringify(value)},`)
    .join("\n");
  const capabilityOperationIds = [
    ...new Set(Object.values(contract.capabilityProfiles).flat()),
  ].sort();
  const rustStringSlice = (values) =>
    values.map((value) => `    ${JSON.stringify(value)},`).join("\n");
  const queries = contract.queries
    .map((value) => `    ${JSON.stringify(value)},`)
    .join("\n");
  const queryPrograms = Object.entries(contract.queryPrograms)
    .map(
      ([queryId, program]) =>
        `    (${JSON.stringify(queryId)}, ${program.maximumScanRows}, ${JSON.stringify(program.sql)}, ${JSON.stringify(program.countSql)}),`,
    )
    .join("\n");
  const mutationPrograms = Object.entries(contract.mutationPrograms)
    .map(
      ([mutationId, program]) =>
        `    SqliteMutationProgram { mutation_id: ${JSON.stringify(mutationId)}, maximum_members: ${program.maximumMembers}, entity_type: ${JSON.stringify(program.entityType)}, invalidation_topic: ${JSON.stringify(program.invalidationTopic)}, payload_kind: ${JSON.stringify(program.payloadKind)}, requires_existing_target: ${program.requiresExistingTarget}, target_exists_sql: ${JSON.stringify(program.targetExistsSql)}, current_value_sql: ${JSON.stringify(program.currentValueSql)}, clock_read_sql: ${JSON.stringify(program.clockReadSql)}, dependent_delete_sql: &[${program.dependentDeleteSql.map((sql) => JSON.stringify(sql)).join(", ")}], dependent_insert_sql: &[${program.dependentInsertSql.map((sql) => JSON.stringify(sql)).join(", ")}], materialize_sql: ${JSON.stringify(program.materializeSql)}, clock_write_sql: ${JSON.stringify(program.clockWriteSql)} },`,
    )
    .join("\n");
  const importPrograms = Object.entries(checkpointImportPrograms(contract))
    .map(
      ([registryKey, program]) =>
        `    (${JSON.stringify(registryKey)}, ${program.primaryKeyArity}, ${program.hasChunkBytes}, ${JSON.stringify(program.sql)}),`,
    )
    .join("\n");
  return `// This file is generated by scripts/generate-library-core-contract.mjs.

pub const SQLITE_CONTRACT_VERSION: u32 = ${contract.contractVersion};
pub const SQLITE_APPLICATION_ID: u32 = ${contract.applicationId};
pub const SQLITE_SCHEMA_VERSION: u32 = ${contract.schemaVersion};
pub const SQLITE_PROTOCOL_VERSION: u32 = ${contract.protocolVersion};
pub const NORMALIZED_CHECKPOINT_FORMAT: &str = ${JSON.stringify(contract.checkpointFormat)};
pub const CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES: usize = ${contract.limits.checkpointRecordCanonicalBytes};
pub const CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES: usize = ${contract.limits.checkpointPageDecodedBytes};
pub const CHECKPOINT_PAGE_MAXIMUM_RECORDS: usize = ${contract.limits.checkpointPageRecords};
pub const NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES: usize = ${contract.limits.nativeExportResponseBytes};
pub const CONTENT_CHUNK_BYTES: usize = ${contract.limits.contentChunkBytes};
pub const NORMALIZED_SCHEMA_SHA256: &str =
    ${JSON.stringify(schemaDigest)};
pub const NORMALIZED_SCHEMA_SQL: &str =
    include_str!("../../shared/src/library-core/normalized-schema-v1.sql");

#[rustfmt::skip]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointRecordKind {
${variants}
}

#[rustfmt::skip]
impl CheckpointRecordKind {
    pub fn from_registry_key(value: &str) -> Option<Self> {
        match value {
${registryMatches}
            _ => None,
        }
    }

    pub const fn registry_key(self) -> &'static str {
        use CheckpointRecordKind::*;
        match self {
${recordVariants}
        }
    }

    pub const fn payload_fields(self) -> &'static [&'static str] {
        use CheckpointRecordKind::*;
        match self {
${fieldVariants}
        }
    }

    pub const fn fractional_fields(self) -> &'static [&'static str] {
        use CheckpointRecordKind::*;
        match self {
${fractionalFieldVariants}
        }
    }
}

pub const OPERATION_IDS: &[&str] = &[
${operations}
];

pub const CAPABILITY_OPERATION_IDS: &[&str] = &[
${rustStringSlice(capabilityOperationIds)}
];

pub const LEGACY_EDITOR_OPERATION_IDS: &[&str] = &[
${rustStringSlice(contract.capabilityProfiles.legacyEditor)}
];

pub const SCRAPER_OPERATION_IDS: &[&str] = &[${contract.capabilityProfiles.scraper.map((value) => JSON.stringify(value)).join(", ")}];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteMutationProgram {
    pub mutation_id: &'static str,
    pub maximum_members: usize,
    pub entity_type: &'static str,
    pub invalidation_topic: &'static str,
    pub payload_kind: &'static str,
    pub requires_existing_target: bool,
    pub target_exists_sql: &'static str,
    pub current_value_sql: &'static str,
    pub clock_read_sql: &'static str,
    pub dependent_delete_sql: &'static [&'static str],
    pub dependent_insert_sql: &'static [&'static str],
    pub materialize_sql: &'static str,
    pub clock_write_sql: &'static str,
}

pub const SQLITE_MUTATION_PROGRAMS: &[SqliteMutationProgram] = &[
${mutationPrograms}
];

pub const QUERY_IDS: &[&str] = &[
${queries}
];

pub const SQLITE_QUERY_PROGRAMS: &[(&str, usize, &str, &str)] = &[
${queryPrograms}
];

pub const SQLITE_CHECKPOINT_IMPORT_PROGRAMS: &[(&str, usize, bool, &str)] = &[
${importPrograms}
];
`;
}

async function update(path, contents) {
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === contents) return;
  if (check) {
    fail(`${path.slice(root.length + 1)} is stale`);
    return;
  }
  await writeFile(path, contents, "utf8");
}

const contract = JSON.parse(await readFile(sourcePath, "utf8"));
const schemaSql = await readFile(schemaPath, "utf8");
const schemaDigest = createHash("sha256").update(schemaSql).digest("hex");
assertContract(contract);
await update(
  typescriptPath,
  typescriptSource(contract, schemaSql, schemaDigest),
);
await update(rustPath, rustSource(contract, schemaDigest));
