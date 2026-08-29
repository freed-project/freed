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
const libraryServicePath = resolve(
  root,
  "packages/library-service/src/library-core-command-contract.generated.ts",
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
    "agentQueryProfile",
    "agentQueryProtocol",
    "applicationId",
    "capabilityProfiles",
    "checkpointDatasetSchemaId",
    "checkpointExportFormat",
    "checkpointFormat",
    "checkpointImports",
    "checkpointRecords",
    "contentRangeMapDigestDomain",
    "contentRangeStorageKey",
    "contentWorkPrograms",
    "contractVersion",
    "deviceContactSync",
    "fractionalFields",
    "limits",
    "localActorErrorCodes",
    "localActorMethods",
    "localActorProtocolVersion",
    "localMutationPrograms",
    "localReconciliationPrograms",
    "mutationPrograms",
    "mutations",
    "nativeCommandErrorCodes",
    "nativeCommandProtocolVersion",
    "nativeCommands",
    "operationReplication",
    "preferenceWritePolicies",
    "protocolVersion",
    "queries",
    "queryPrograms",
    "queryRowModels",
    "schemaVersion",
    "scopeActionPrograms",
  ];
  const keys = Object.keys(contract).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError("SQLite contract source has unknown or missing fields");
  }
  if (
    contract.contentRangeMapDigestDomain !==
    "freed.library-core.v1/digest-records/content-range-map\0"
  ) {
    throw new TypeError("SQLite content range map digest domain is invalid");
  }
  if (
    Object.keys(contract.contentRangeStorageKey).sort().join(",") !==
      "maximumUtf8Bytes,prefix,suffix" ||
    contract.contentRangeStorageKey.maximumUtf8Bytes !== 255 ||
    contract.contentRangeStorageKey.prefix !== "range-" ||
    contract.contentRangeStorageKey.suffix !== ".bin"
  ) {
    throw new TypeError("SQLite content range storage key contract is invalid");
  }
  const deviceContactSync = contract.deviceContactSync;
  const expectedDeviceContactSync = Object.freeze({
    deltaMaximumMembers: 64,
    digestDomain:
      "freed.library-core.v1/digest-records/device-contact-mutation\0",
    matchMaximumMembers: 64,
    maximumCanonicalBytes: 131_072,
    maximumEmails: 16,
    maximumMutationCanonicalBytes: 4_194_304,
    maximumOrganizations: 4,
    maximumPhones: 16,
    maximumPhotos: 4,
    maximumResponseBytes: 1_048_576,
    maximumSuggestionAccounts: 64,
    pageMaximumRows: 64,
    reviewMaximumRows: 50,
    schemaVersion: 1,
  });
  if (
    deviceContactSync === null ||
    typeof deviceContactSync !== "object" ||
    Object.keys(deviceContactSync).sort().join(",") !==
      Object.keys(expectedDeviceContactSync).sort().join(",") ||
    Object.entries(expectedDeviceContactSync).some(
      ([key, value]) => deviceContactSync[key] !== value,
    )
  ) {
    throw new TypeError(
      "SQLite device contact sync contract changed without a version boundary",
    );
  }
  if (
    contract.applicationId !== 1_179_796_804 ||
    contract.contractVersion !== 1 ||
    contract.schemaVersion !== 1 ||
    contract.protocolVersion !== 2 ||
    contract.nativeCommandProtocolVersion !== 1 ||
    contract.localActorProtocolVersion !== 2 ||
    contract.checkpointFormat !== "freed_normalized_checkpoint_v2" ||
    contract.checkpointExportFormat !==
      "freed_normalized_checkpoint_export_v2" ||
    contract.checkpointDatasetSchemaId !==
      "library_core_normalized_checkpoint_v2"
  ) {
    throw new TypeError("SQLite contract version identity is invalid");
  }
  const operationReplication = contract.operationReplication;
  const expectedOperationReplication = Object.freeze({
    canonicalByteLimit: 1_048_576,
    exportFormat: "freed_normalized_operation_export_v2",
    format: "freed_normalized_operation_segment_v2",
    logicalRecordByteLimit: 131_072,
    nativeResponseByteLimit: 1_048_576,
    protocol: "normalized_operation_segments_v2",
    protocolVersion: 2,
    recordLimit: 128,
  });
  if (
    operationReplication === null ||
    typeof operationReplication !== "object" ||
    Object.keys(operationReplication).sort().join(",") !==
      Object.keys(expectedOperationReplication).sort().join(",") ||
    Object.entries(expectedOperationReplication).some(
      ([key, value]) => operationReplication[key] !== value,
    )
  ) {
    throw new TypeError(
      "SQLite operation replication contract changed without a version boundary",
    );
  }
  const limits = contract.limits;
  const expectedLimits = Object.freeze({
    checkpointPageDecodedBytes: 2_097_152,
    checkpointPageRecords: 128,
    checkpointRecordCanonicalBytes: 131_072,
    contentChunkBytes: 65_536,
    contentRangeAppendBytes: 262_144,
    nativeExportResponseBytes: 1_048_576,
    nativeCommandFrameBytes: 4_194_304,
    localActorActiveConnections: 32,
    localActorReplayEntries: 256,
    localActorRequestFrameBytes: 1_048_576,
    localActorRequestsPerMinute: 120,
    localActorRequestTimeoutMs: 5_000,
    localActorResponseFrameBytes: 1_048_576,
    followerIntentPageRecords: 128,
    operationTransactionMembers: 1_000,
    operationTransactionBytes: 4_194_304,
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
  if (
    contract.mutations.join(",") !==
    Object.keys(contract.mutationPrograms).sort().join(",")
  ) {
    throw new TypeError(
      "SQLite mutations must exactly match the executable mutation programs",
    );
  }
  assertSortedUnique(
    contract.nativeCommandErrorCodes,
    "nativeCommandErrorCodes",
  );
  assertSortedUnique(contract.nativeCommands, "nativeCommands");
  assertSortedUnique(contract.localActorErrorCodes, "localActorErrorCodes");
  assertSortedUnique(contract.localActorMethods, "localActorMethods");
  assertSortedUnique(contract.queries, "queries");
  if (
    contract.queries.join(",") !==
    Object.keys(contract.queryPrograms).sort().join(",")
  ) {
    throw new TypeError(
      "SQLite queries must exactly match the executable query programs",
    );
  }
  const scopeActionProgramKeys = Object.keys(
    contract.scopeActionPrograms,
  ).sort();
  const expectedScopeActionProgramKeys = [
    "append",
    "create",
    "delete",
    "finalize",
    "freezeRssFeeds",
    "page",
    "status",
  ];
  if (
    scopeActionProgramKeys.join(",") !==
      expectedScopeActionProgramKeys.join(",") ||
    Object.values(contract.scopeActionPrograms).some(
      (sql) => typeof sql !== "string" || sql.length === 0,
    )
  ) {
    throw new TypeError("SQLite scope action program registry is invalid");
  }
  const preferencePolicyKeys = Object.keys(
    contract.preferenceWritePolicies,
  ).sort();
  const expectedPreferencePolicyKeys = [
    "ai",
    "display",
    "facebookCapture",
    "friendSuggestions",
    "reading",
    "storyWall",
    "storyWallPublishTarget",
    "storyWallStyle",
    "ulysses",
    "user",
    "weights",
    "xAccount",
    "xCapture",
  ];
  if (
    preferencePolicyKeys.join(",") !== expectedPreferencePolicyKeys.join(",")
  ) {
    throw new TypeError("SQLite preference write policy registry is invalid");
  }
  const preferenceDispositions = new Set(["device-local", "nested", "sync"]);
  for (const [policyName, policy] of Object.entries(
    contract.preferenceWritePolicies,
  )) {
    if (
      policy === null ||
      typeof policy !== "object" ||
      Array.isArray(policy) ||
      Object.keys(policy).length === 0 ||
      Object.entries(policy).some(
        ([field, disposition]) =>
          !/^[a-z][A-Za-z0-9]*$/.test(field) ||
          !preferenceDispositions.has(disposition),
      )
    ) {
      throw new TypeError(`${policyName} preference write policy is invalid`);
    }
  }
  const capabilityProfileKeys = Object.keys(contract.capabilityProfiles).sort();
  if (capabilityProfileKeys.join(",") !== "primaryWriter,scraper") {
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
  assertSortedUnique(contract.agentQueryProfile, "agent capability queries");
  if (
    contract.agentQueryProfile.length === 0 ||
    contract.agentQueryProfile.some(
      (query) => !contract.queries.includes(query),
    )
  ) {
    throw new TypeError("agent capability includes an undeclared SQLite query");
  }
  const agentQueryProtocol = contract.agentQueryProtocol;
  if (
    agentQueryProtocol === null ||
    typeof agentQueryProtocol !== "object" ||
    Object.keys(agentQueryProtocol).sort().join(",") !==
      "digestDomain,format,maximumCanonicalBytes,resultFormat,signatureDomain" ||
    agentQueryProtocol.digestDomain !== "agent-query-body" ||
    agentQueryProtocol.format !== "freed_library_core_agent_query_v1" ||
    agentQueryProtocol.maximumCanonicalBytes !== 262_144 ||
    agentQueryProtocol.resultFormat !==
      "freed_library_core_agent_query_result_v1" ||
    agentQueryProtocol.signatureDomain !== "agent-query"
  ) {
    throw new TypeError(
      "agent query protocol changed without a version boundary",
    );
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
    "optimisticEffectKind",
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
        "analysis_assignment",
        "boolean_assignment",
        "feed_item_capture_upsert",
        "friend_replace",
        "person_upsert",
        "preferences_leaf_assignment",
        "nullable_text_assignment",
        "person_reach_out_append",
        "priority_assignment",
        "read_at",
        "remove",
        "rss_feed_upsert",
        "sync_receipt",
        "annotations_assignment",
        "text_assignment",
      ].includes(program.payloadKind) ||
      typeof program.requiresExistingTarget !== "boolean" ||
      !Number.isSafeInteger(program.maximumMembers) ||
      program.maximumMembers < 1 ||
      program.maximumMembers > 256 ||
      ![
        "archive_assignment",
        "like_assignment",
        "none",
        "read_assignment",
        "saved_assignment",
      ].includes(program.optimisticEffectKind) ||
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
        "feed_item_capture_upsert",
        "friend_replace",
        "person_upsert",
        "person_reach_out_append",
        "preferences_leaf_assignment",
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
  if (
    Object.keys(contract.localReconciliationPrograms).join(",") !==
      "content_checkpoint_reconcile_v1" ||
    typeof contract.localReconciliationPrograms
      .content_checkpoint_reconcile_v1 !== "string" ||
    contract.localReconciliationPrograms.content_checkpoint_reconcile_v1
      .length === 0
  ) {
    throw new TypeError("SQLite local reconciliation registry is invalid");
  }
  if (
    Object.keys(contract.contentWorkPrograms).sort().join(",") !==
      "eviction_candidates_page_v1,hydration_candidates_page_v1" ||
    Object.values(contract.contentWorkPrograms).some(
      (sql) => typeof sql !== "string" || sql.length === 0,
    )
  ) {
    throw new TypeError("SQLite content work program registry is invalid");
  }
  for (const [mutationId, program] of Object.entries(
    contract.localMutationPrograms,
  )) {
    if (
      !(
        /^(account|person)_graph_position_(clear|set)_v1$/.test(mutationId) ||
        mutationId === "content_policy_set_v1"
      ) ||
      Object.keys(program).sort().join(",") !==
        "entityType,maximumRows,sql,targetExistsSql" ||
      !["Account", "Content", "Person"].includes(program.entityType) ||
      program.maximumRows !== 1 ||
      typeof program.sql !== "string" ||
      program.sql.length === 0 ||
      typeof program.targetExistsSql !== "string" ||
      program.targetExistsSql.length === 0
    ) {
      throw new TypeError("SQLite local mutation program registry is invalid");
    }
  }
  for (const [queryId, program] of Object.entries(contract.queryPrograms)) {
    const queryProgramKeys = Object.keys(program).sort().join(",");
    const variants = program.variants;
    const hasVariants = variants !== undefined;
    if (
      !contract.queries.includes(queryId) ||
      ![
        "countSql,maximumScanRows,sql",
        "countSql,maximumScanRows,reverseSql,sql",
        "countSql,maximumScanRows,variants",
        "countSql,maximumScanRows,sql,variants",
      ].includes(queryProgramKeys) ||
      (!hasVariants &&
        (typeof program.sql !== "string" || program.sql.length === 0)) ||
      (!hasVariants &&
        program.reverseSql !== undefined &&
        (typeof program.reverseSql !== "string" ||
          program.reverseSql.length === 0)) ||
      (hasVariants &&
        (variants === null ||
          typeof variants !== "object" ||
          Array.isArray(variants) ||
          Object.keys(variants).length < 1 ||
          Object.entries(variants).some(
            ([variantId, variant]) =>
              !/^[a-z][a-z0-9_]*$/.test(variantId) ||
              !["sql", "reverseSql,sql"].includes(
                Object.keys(variant).sort().join(","),
              ) ||
              typeof variant.sql !== "string" ||
              variant.sql.length === 0 ||
              (variant.reverseSql !== undefined &&
                (typeof variant.reverseSql !== "string" ||
                  variant.reverseSql.length === 0)),
          ))) ||
      typeof program.countSql !== "string" ||
      program.countSql.length === 0 ||
      !Number.isSafeInteger(program.maximumScanRows) ||
      program.maximumScanRows < 1 ||
      program.maximumScanRows > 1_001
    ) {
      throw new TypeError("SQLite query program registry is invalid");
    }
  }
  const queryRowFieldKeys = [
    "enumValues",
    "integerValues",
    "kind",
    "maximumInteger",
    "maximumUtf8Bytes",
    "minimumInteger",
    "minimumUtf8Bytes",
    "name",
    "nullable",
  ];
  for (const [queryId, fields] of Object.entries(contract.queryRowModels)) {
    if (
      !contract.queries.includes(queryId) ||
      !Array.isArray(fields) ||
      fields.length === 0
    ) {
      throw new TypeError("SQLite query row model registry is invalid");
    }
    let previousField = "";
    for (const field of fields) {
      if (
        field === null ||
        typeof field !== "object" ||
        Array.isArray(field) ||
        Object.keys(field).sort().join(",") !== queryRowFieldKeys.join(",") ||
        typeof field.name !== "string" ||
        !/^[a-z][A-Za-z0-9]*$/.test(field.name) ||
        field.name <= previousField ||
        !["boolean", "integer", "text"].includes(field.kind) ||
        typeof field.nullable !== "boolean" ||
        !Array.isArray(field.enumValues) ||
        field.enumValues.some((value) => typeof value !== "string") ||
        field.enumValues.some(
          (value, index) => index > 0 && field.enumValues[index - 1] >= value,
        ) ||
        !Array.isArray(field.integerValues) ||
        field.integerValues.some((value) => !Number.isSafeInteger(value)) ||
        field.integerValues.some(
          (value, index) =>
            index > 0 && field.integerValues[index - 1] >= value,
        ) ||
        (field.kind === "text" &&
          (!Number.isSafeInteger(field.minimumUtf8Bytes) ||
            field.minimumUtf8Bytes < 0 ||
            !Number.isSafeInteger(field.maximumUtf8Bytes) ||
            field.maximumUtf8Bytes < 1 ||
            field.minimumUtf8Bytes > field.maximumUtf8Bytes ||
            field.maximumUtf8Bytes > 131_072)) ||
        (field.kind !== "text" &&
          (field.minimumUtf8Bytes !== null ||
            field.maximumUtf8Bytes !== null ||
            field.enumValues.length !== 0)) ||
        (field.kind === "integer" &&
          (!Number.isSafeInteger(field.minimumInteger) ||
            !Number.isSafeInteger(field.maximumInteger) ||
            field.minimumInteger > field.maximumInteger)) ||
        (field.kind === "integer" &&
          field.integerValues.some(
            (value) =>
              value < field.minimumInteger || value > field.maximumInteger,
          )) ||
        (field.kind !== "integer" &&
          (field.minimumInteger !== null ||
            field.maximumInteger !== null ||
            field.integerValues.length !== 0))
      ) {
        throw new TypeError("SQLite query row field model is invalid");
      }
      previousField = field.name;
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
export const LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION = ${contract.nativeCommandProtocolVersion} as const;
export const LIBRARY_CORE_NORMALIZED_CHECKPOINT_FORMAT = ${JSON.stringify(contract.checkpointFormat)} as const;
export const LIBRARY_CORE_NORMALIZED_CHECKPOINT_EXPORT_FORMAT = ${JSON.stringify(contract.checkpointExportFormat)} as const;
export const LIBRARY_CORE_NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID = ${JSON.stringify(contract.checkpointDatasetSchemaId)} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_FORMAT = ${JSON.stringify(contract.operationReplication.format)} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_FORMAT = ${JSON.stringify(contract.operationReplication.exportFormat)} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL = ${JSON.stringify(contract.operationReplication.protocol)} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION = ${contract.operationReplication.protocolVersion} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS = ${contract.operationReplication.recordLimit} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES = ${contract.operationReplication.canonicalByteLimit} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES = ${contract.operationReplication.logicalRecordByteLimit} as const;
export const LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES = ${contract.operationReplication.nativeResponseByteLimit} as const;
export const LIBRARY_CORE_CONTENT_RANGE_MAP_DIGEST_DOMAIN = ${JSON.stringify(contract.contentRangeMapDigestDomain)} as const;
export const LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_PREFIX = ${JSON.stringify(contract.contentRangeStorageKey.prefix)} as const;
export const LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_SUFFIX = ${JSON.stringify(contract.contentRangeStorageKey.suffix)} as const;
export const LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_MAXIMUM_UTF8_BYTES = ${contract.contentRangeStorageKey.maximumUtf8Bytes} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_SYNC_SCHEMA_VERSION = ${contract.deviceContactSync.schemaVersion} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS = ${contract.deviceContactSync.deltaMaximumMembers} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS = ${contract.deviceContactSync.matchMaximumMembers} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_PAGE_MAXIMUM_ROWS = ${contract.deviceContactSync.pageMaximumRows} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS = ${contract.deviceContactSync.reviewMaximumRows} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_CANONICAL_BYTES = ${contract.deviceContactSync.maximumCanonicalBytes} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_MUTATION_CANONICAL_BYTES = ${contract.deviceContactSync.maximumMutationCanonicalBytes} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_EMAILS = ${contract.deviceContactSync.maximumEmails} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_PHONES = ${contract.deviceContactSync.maximumPhones} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_PHOTOS = ${contract.deviceContactSync.maximumPhotos} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_ORGANIZATIONS = ${contract.deviceContactSync.maximumOrganizations} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES = ${contract.deviceContactSync.maximumResponseBytes} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_SUGGESTION_ACCOUNTS = ${contract.deviceContactSync.maximumSuggestionAccounts} as const;
export const LIBRARY_CORE_DEVICE_CONTACT_MUTATION_DIGEST_DOMAIN = ${JSON.stringify(contract.deviceContactSync.digestDomain)} as const;
export const LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES = ${contract.limits.checkpointRecordCanonicalBytes} as const;
export const LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES = ${contract.limits.checkpointPageDecodedBytes} as const;
export const LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS = ${contract.limits.checkpointPageRecords} as const;
export const LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES = ${contract.limits.nativeExportResponseBytes} as const;
export const LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES = ${contract.limits.nativeCommandFrameBytes} as const;
export const LIBRARY_CORE_CONTENT_CHUNK_BYTES = ${contract.limits.contentChunkBytes} as const;
export const LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES = ${contract.limits.contentRangeAppendBytes} as const;
export const LIBRARY_CORE_FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS = ${contract.limits.followerIntentPageRecords} as const;
export const LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_MEMBERS = ${contract.limits.operationTransactionMembers} as const;
export const LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_BYTES = ${contract.limits.operationTransactionBytes} as const;
export const LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256 = ${JSON.stringify(schemaDigest)} as const;
export const LIBRARY_CORE_NORMALIZED_SCHEMA_SQL = ${JSON.stringify(schemaSql)} as const;
export const LIBRARY_CORE_PREFERENCE_WRITE_POLICIES = ${JSON.stringify(contract.preferenceWritePolicies, null, 2)} as const;

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
export const LIBRARY_CORE_NATIVE_COMMAND_IDS = [
${stringTuple(contract.nativeCommands)}
] as const;
export const LIBRARY_CORE_NATIVE_COMMAND_ERROR_CODES = [
${stringTuple(contract.nativeCommandErrorCodes)}
] as const;
export type LibraryCoreNativeCommandId = (typeof LIBRARY_CORE_NATIVE_COMMAND_IDS)[number];
export type LibraryCoreNativeCommandErrorCode = (typeof LIBRARY_CORE_NATIVE_COMMAND_ERROR_CODES)[number];
export type LibraryCoreOperationId = (typeof LIBRARY_CORE_OPERATION_IDS)[number];

export const LIBRARY_CORE_CAPABILITY_OPERATION_IDS = Object.freeze([
${stringTuple(capabilityOperationIds)}
] as const);
export type LibraryCoreCapabilityOperationId = (typeof LIBRARY_CORE_CAPABILITY_OPERATION_IDS)[number];

export const LIBRARY_CORE_PRIMARY_WRITER_OPERATION_IDS = Object.freeze([
${stringTuple(contract.capabilityProfiles.primaryWriter)}
] as const satisfies readonly LibraryCoreCapabilityOperationId[]);

export const LIBRARY_CORE_SCRAPER_OPERATION_IDS = Object.freeze([
${stringTuple(contract.capabilityProfiles.scraper)}
] as const satisfies readonly LibraryCoreCapabilityOperationId[]);

export const LIBRARY_CORE_AGENT_QUERY_IDS = Object.freeze([
${stringTuple(contract.agentQueryProfile)}
] as const);
export type LibraryCoreAgentQueryId = (typeof LIBRARY_CORE_AGENT_QUERY_IDS)[number];
export const LIBRARY_CORE_AGENT_QUERY_FORMAT = ${JSON.stringify(contract.agentQueryProtocol.format)} as const;
export const LIBRARY_CORE_AGENT_QUERY_RESULT_FORMAT = ${JSON.stringify(contract.agentQueryProtocol.resultFormat)} as const;
export const LIBRARY_CORE_AGENT_QUERY_DIGEST_DOMAIN = ${JSON.stringify(contract.agentQueryProtocol.digestDomain)} as const;
export const LIBRARY_CORE_AGENT_QUERY_SIGNATURE_DOMAIN = ${JSON.stringify(contract.agentQueryProtocol.signatureDomain)} as const;
export const LIBRARY_CORE_AGENT_QUERY_MAXIMUM_CANONICAL_BYTES = ${contract.agentQueryProtocol.maximumCanonicalBytes} as const;

export const LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS = ${JSON.stringify(contract.mutationPrograms, null, 2)} as const;
export type LibraryCoreSqliteMutationProgramId = keyof typeof LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS;

export const LIBRARY_CORE_SQLITE_LOCAL_MUTATION_PROGRAMS = ${JSON.stringify(contract.localMutationPrograms, null, 2)} as const;
export const LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS = ${JSON.stringify(contract.localReconciliationPrograms, null, 2)} as const;
export const LIBRARY_CORE_SQLITE_CONTENT_WORK_PROGRAMS = ${JSON.stringify(contract.contentWorkPrograms, null, 2)} as const;

export const LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS = ${JSON.stringify(contract.scopeActionPrograms, null, 2)} as const;
export type LibraryCoreSqliteLocalMutationProgramId = keyof typeof LIBRARY_CORE_SQLITE_LOCAL_MUTATION_PROGRAMS;

export const LIBRARY_CORE_QUERY_IDS = [
${stringTuple(contract.queries)}
] as const;
export type LibraryCoreQueryId = (typeof LIBRARY_CORE_QUERY_IDS)[number];

export const LIBRARY_CORE_SQLITE_QUERY_PROGRAMS = ${JSON.stringify(contract.queryPrograms, null, 2)} as const;
export type LibraryCoreSqliteQueryProgramId = keyof typeof LIBRARY_CORE_SQLITE_QUERY_PROGRAMS;

export const LIBRARY_CORE_SQLITE_QUERY_ROW_MODELS = ${JSON.stringify(contract.queryRowModels, null, 2)} as const;
export type LibraryCoreSqliteQueryRowModelId = keyof typeof LIBRARY_CORE_SQLITE_QUERY_ROW_MODELS;

type LibraryCoreSqliteQueryRowField =
  (typeof LIBRARY_CORE_SQLITE_QUERY_ROW_MODELS)[LibraryCoreSqliteQueryRowModelId][number];
type LibraryCoreSqliteQueryRowFieldValue<
  Field extends LibraryCoreSqliteQueryRowField,
> = Field["kind"] extends "boolean"
  ? boolean
  : Field["kind"] extends "integer"
    ? Field["integerValues"] extends readonly []
      ? number
      : Field["integerValues"][number]
    : Field["enumValues"] extends readonly []
      ? string
      : Field["enumValues"][number];
type LibraryCoreSqliteQueryRowValue<
  Field extends LibraryCoreSqliteQueryRowField,
> = Field["nullable"] extends true
  ? LibraryCoreSqliteQueryRowFieldValue<Field> | null
  : LibraryCoreSqliteQueryRowFieldValue<Field>;

export type LibraryCoreGeneratedSqliteQueryRow<
  QueryId extends LibraryCoreSqliteQueryRowModelId,
> = Readonly<{
  [Field in (typeof LIBRARY_CORE_SQLITE_QUERY_ROW_MODELS)[QueryId][number] as Field["name"]]: LibraryCoreSqliteQueryRowValue<Field>;
}>;

const LIBRARY_CORE_GENERATED_QUERY_ROW_TEXT_ENCODER = new TextEncoder();

function libraryCoreGeneratedQueryRowRecord(
  value: unknown,
  sqliteRow: boolean,
): Record<string, unknown> | null {
  const prototype =
    value !== null && typeof value === "object"
      ? Object.getPrototypeOf(value)
      : undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    (prototype !== Object.prototype && !(sqliteRow && prototype === null))
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

function libraryCoreGeneratedQueryRowValue(
  field: LibraryCoreSqliteQueryRowField,
  input: unknown,
  sqliteBooleanIntegers: boolean,
): unknown | undefined {
  if (input === null) return field.nullable ? null : undefined;
  if (field.kind === "boolean") {
    if (typeof input === "boolean") return input;
    if (sqliteBooleanIntegers && (input === 0 || input === 1)) {
      return input === 1;
    }
    return undefined;
  }
  if (field.kind === "integer") {
    return Number.isSafeInteger(input) &&
      (input as number) >= field.minimumInteger! &&
      (input as number) <= field.maximumInteger! &&
      (field.integerValues.length === 0 ||
        (field.integerValues as readonly number[]).includes(input as number))
      ? input
      : undefined;
  }
  if (typeof input !== "string") {
    return undefined;
  }
  const utf8Bytes =
    LIBRARY_CORE_GENERATED_QUERY_ROW_TEXT_ENCODER.encode(input).byteLength;
  if (
    utf8Bytes < field.minimumUtf8Bytes! ||
    utf8Bytes > field.maximumUtf8Bytes!
  ) {
    return undefined;
  }
  if (
    field.enumValues.length > 0 &&
    !(field.enumValues as readonly string[]).includes(input)
  ) {
    return undefined;
  }
  return input;
}

function libraryCoreGeneratedQueryRow<
  QueryId extends LibraryCoreSqliteQueryRowModelId,
>(
  queryId: QueryId,
  input: unknown,
  sqliteBooleanIntegers: boolean,
): LibraryCoreGeneratedSqliteQueryRow<QueryId> | null {
  const record = libraryCoreGeneratedQueryRowRecord(
    input,
    sqliteBooleanIntegers,
  );
  if (!record) return null;
  const fields = LIBRARY_CORE_SQLITE_QUERY_ROW_MODELS[queryId];
  const ownKeys = Reflect.ownKeys(record);
  if (
    ownKeys.length !== fields.length ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        !fields.some((field) => field.name === key),
    )
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const snapshot: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = descriptors[field.name];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    const value = libraryCoreGeneratedQueryRowValue(
      field,
      descriptor.value,
      sqliteBooleanIntegers,
    );
    if (value === undefined) return null;
    snapshot[field.name] = value;
  }
  return Object.freeze(snapshot) as LibraryCoreGeneratedSqliteQueryRow<QueryId>;
}

export function parseLibraryCoreGeneratedSqliteQueryRow<
  QueryId extends LibraryCoreSqliteQueryRowModelId,
>(
  queryId: QueryId,
  input: unknown,
): LibraryCoreGeneratedSqliteQueryRow<QueryId> | null {
  return libraryCoreGeneratedQueryRow(queryId, input, false);
}

export function coerceLibraryCoreGeneratedSqliteQueryRow<
  QueryId extends LibraryCoreSqliteQueryRowModelId,
>(
  queryId: QueryId,
  input: unknown,
): LibraryCoreGeneratedSqliteQueryRow<QueryId> | null {
  return libraryCoreGeneratedQueryRow(queryId, input, true);
}
`;
}

function rustVariant(value) {
  return value
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function rustSource(contract, schemaDigest) {
  const rustString = (value) =>
    JSON.stringify(value).replaceAll("\\u0000", "\\0");
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
    .map(([queryId, program]) => {
      const variants = Object.entries(program.variants ?? {})
        .map(
          ([variantId, variant]) =>
            `        SqliteQueryVariant { variant_id: ${JSON.stringify(variantId)}, sql: ${JSON.stringify(variant.sql)}, reverse_sql: ${JSON.stringify(variant.reverseSql ?? variant.sql)} },`,
        )
        .join("\n");
      const defaultVariant = Object.values(program.variants ?? {})[0];
      return `    SqliteQueryProgram { query_id: ${JSON.stringify(queryId)}, maximum_scan_rows: ${program.maximumScanRows}, sql: ${JSON.stringify(program.sql ?? defaultVariant.sql)}, reverse_sql: ${program.reverseSql === undefined && defaultVariant === undefined ? "None" : `Some(${JSON.stringify(program.reverseSql ?? defaultVariant.reverseSql ?? defaultVariant.sql)})`}, count_sql: ${JSON.stringify(program.countSql)}, variants: &[\n${variants}\n    ] },`;
    })
    .join("\n");
  const queryRowModels = Object.entries(contract.queryRowModels)
    .map(([queryId, fields]) => {
      const rows = fields
        .map(
          (field) =>
            `        SqliteQueryRowField {
            name: ${JSON.stringify(field.name)},
            kind: SqliteQueryRowFieldKind::${rustVariant(field.kind)},
            nullable: ${field.nullable},
            minimum_utf8_bytes: ${field.minimumUtf8Bytes === null ? "None" : `Some(${field.minimumUtf8Bytes})`},
            maximum_utf8_bytes: ${field.maximumUtf8Bytes === null ? "None" : `Some(${field.maximumUtf8Bytes})`},
            minimum_integer: ${field.minimumInteger === null ? "None" : `Some(${field.minimumInteger})`},
            maximum_integer: ${field.maximumInteger === null ? "None" : `Some(${field.maximumInteger})`},
            enum_values: &[${field.enumValues.map((value) => JSON.stringify(value)).join(", ")}],
            integer_values: &[${field.integerValues.join(", ")}],
        },`,
        )
        .join("\n");
      return `    SqliteQueryRowModel {
        query_id: ${JSON.stringify(queryId)},
        fields: &[
${rows}
        ],
    },`;
    })
    .join("\n");
  const mutationPrograms = Object.entries(contract.mutationPrograms)
    .map(
      ([mutationId, program]) =>
        `    SqliteMutationProgram { mutation_id: ${JSON.stringify(mutationId)}, maximum_members: ${program.maximumMembers}, entity_type: ${JSON.stringify(program.entityType)}, invalidation_topic: ${JSON.stringify(program.invalidationTopic)}, optimistic_effect_kind: ${JSON.stringify(program.optimisticEffectKind)}, payload_kind: ${JSON.stringify(program.payloadKind)}, requires_existing_target: ${program.requiresExistingTarget}, target_exists_sql: ${JSON.stringify(program.targetExistsSql)}, current_value_sql: ${JSON.stringify(program.currentValueSql)}, clock_read_sql: ${JSON.stringify(program.clockReadSql)}, dependent_delete_sql: &[${program.dependentDeleteSql.map((sql) => JSON.stringify(sql)).join(", ")}], dependent_insert_sql: &[${program.dependentInsertSql.map((sql) => JSON.stringify(sql)).join(", ")}], materialize_sql: ${JSON.stringify(program.materializeSql)}, clock_write_sql: ${JSON.stringify(program.clockWriteSql)} },`,
    )
    .join("\n");
  const localMutationPrograms = Object.entries(contract.localMutationPrograms)
    .map(
      ([mutationId, program]) =>
        `    (${JSON.stringify(mutationId)}, ${program.maximumRows}, ${JSON.stringify(program.entityType)}, ${JSON.stringify(program.targetExistsSql)}, ${JSON.stringify(program.sql)}),`,
    )
    .join("\n");
  const localReconciliationPrograms = Object.entries(
    contract.localReconciliationPrograms,
  )
    .map(
      ([programId, sql]) =>
        `    (${JSON.stringify(programId)}, ${JSON.stringify(sql)}),`,
    )
    .join("\n");
  const contentWorkPrograms = Object.entries(contract.contentWorkPrograms)
    .map(
      ([programId, sql]) =>
        `    (${JSON.stringify(programId)}, ${JSON.stringify(sql)}),`,
    )
    .join("\n");
  const importPrograms = Object.entries(checkpointImportPrograms(contract))
    .map(
      ([registryKey, program]) =>
        `    (${JSON.stringify(registryKey)}, ${program.primaryKeyArity}, ${program.hasChunkBytes}, ${JSON.stringify(program.sql)}),`,
    )
    .join("\n");
  const scopeActionPrograms = Object.entries(contract.scopeActionPrograms)
    .map(
      ([programId, sql]) =>
        `    (${JSON.stringify(programId)}, ${JSON.stringify(sql)}),`,
    )
    .join("\n");
  return `// This file is generated by scripts/generate-library-core-contract.mjs.

pub const SQLITE_CONTRACT_VERSION: u32 = ${contract.contractVersion};
pub const SQLITE_APPLICATION_ID: u32 = ${contract.applicationId};
pub const SQLITE_SCHEMA_VERSION: u32 = ${contract.schemaVersion};
pub const SQLITE_PROTOCOL_VERSION: u32 = ${contract.protocolVersion};
pub const NATIVE_COMMAND_PROTOCOL_VERSION: u32 = ${contract.nativeCommandProtocolVersion};
pub const NORMALIZED_CHECKPOINT_FORMAT: &str = ${JSON.stringify(contract.checkpointFormat)};
pub const NORMALIZED_CHECKPOINT_EXPORT_FORMAT: &str = ${JSON.stringify(contract.checkpointExportFormat)};
pub const NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID: &str = ${JSON.stringify(contract.checkpointDatasetSchemaId)};
pub const CONTENT_RANGE_MAP_DIGEST_DOMAIN: &str =
    ${rustString(contract.contentRangeMapDigestDomain)};
pub const CONTENT_RANGE_STORAGE_KEY_PREFIX: &str = ${JSON.stringify(contract.contentRangeStorageKey.prefix)};
pub const CONTENT_RANGE_STORAGE_KEY_SUFFIX: &str = ${JSON.stringify(contract.contentRangeStorageKey.suffix)};
pub const CONTENT_RANGE_STORAGE_KEY_MAXIMUM_UTF8_BYTES: usize = ${contract.contentRangeStorageKey.maximumUtf8Bytes};
pub const DEVICE_CONTACT_SYNC_SCHEMA_VERSION: u32 = ${contract.deviceContactSync.schemaVersion};
pub const DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS: usize = ${contract.deviceContactSync.deltaMaximumMembers};
pub const DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS: usize = ${contract.deviceContactSync.matchMaximumMembers};
pub const DEVICE_CONTACT_PAGE_MAXIMUM_ROWS: usize = ${contract.deviceContactSync.pageMaximumRows};
pub const DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS: usize = ${contract.deviceContactSync.reviewMaximumRows};
pub const DEVICE_CONTACT_MAXIMUM_CANONICAL_BYTES: usize = ${contract.deviceContactSync.maximumCanonicalBytes};
pub const DEVICE_CONTACT_MAXIMUM_MUTATION_CANONICAL_BYTES: usize = ${contract.deviceContactSync.maximumMutationCanonicalBytes};
pub const DEVICE_CONTACT_MAXIMUM_EMAILS: usize = ${contract.deviceContactSync.maximumEmails};
pub const DEVICE_CONTACT_MAXIMUM_PHONES: usize = ${contract.deviceContactSync.maximumPhones};
pub const DEVICE_CONTACT_MAXIMUM_PHOTOS: usize = ${contract.deviceContactSync.maximumPhotos};
pub const DEVICE_CONTACT_MAXIMUM_ORGANIZATIONS: usize = ${contract.deviceContactSync.maximumOrganizations};
pub const DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES: usize = ${contract.deviceContactSync.maximumResponseBytes};
pub const DEVICE_CONTACT_MAXIMUM_SUGGESTION_ACCOUNTS: usize = ${contract.deviceContactSync.maximumSuggestionAccounts};
pub const DEVICE_CONTACT_MUTATION_DIGEST_DOMAIN: &str =
    ${rustString(contract.deviceContactSync.digestDomain)};
pub const CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES: usize = ${contract.limits.checkpointRecordCanonicalBytes};
pub const CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES: usize = ${contract.limits.checkpointPageDecodedBytes};
pub const CHECKPOINT_PAGE_MAXIMUM_RECORDS: usize = ${contract.limits.checkpointPageRecords};
pub const NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES: usize = ${contract.limits.nativeExportResponseBytes};
pub const NATIVE_COMMAND_MAXIMUM_FRAME_BYTES: usize = ${contract.limits.nativeCommandFrameBytes};
pub const CONTENT_CHUNK_BYTES: usize = ${contract.limits.contentChunkBytes};
pub const CONTENT_RANGE_MAXIMUM_APPEND_BYTES: usize = ${contract.limits.contentRangeAppendBytes};
pub const FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS: usize = ${contract.limits.followerIntentPageRecords};
pub const OPERATION_TRANSACTION_MAXIMUM_MEMBERS: usize = ${contract.limits.operationTransactionMembers};
pub const OPERATION_TRANSACTION_MAXIMUM_BYTES: usize = ${contract.limits.operationTransactionBytes};
pub const NORMALIZED_SCHEMA_SHA256: &str =
    ${JSON.stringify(schemaDigest)};
pub const NORMALIZED_SCHEMA_SQL: &str =
    include_str!("../../shared/src/library-core/normalized-schema-v1.sql");
pub const PREFERENCE_WRITE_POLICIES_JSON: &str =
    ${JSON.stringify(JSON.stringify(contract.preferenceWritePolicies))};

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

pub const NATIVE_COMMAND_IDS: &[&str] = &[
${rustStringSlice(contract.nativeCommands)}
];

pub const NATIVE_COMMAND_ERROR_CODES: &[&str] = &[
${rustStringSlice(contract.nativeCommandErrorCodes)}
];

pub const NORMALIZED_OPERATION_SEGMENT_FORMAT: &str = ${JSON.stringify(contract.operationReplication.format)};
pub const NORMALIZED_OPERATION_EXPORT_FORMAT: &str = ${JSON.stringify(contract.operationReplication.exportFormat)};
pub const NORMALIZED_OPERATION_SEGMENT_PROTOCOL: &str = ${JSON.stringify(contract.operationReplication.protocol)};
pub const NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION: u8 = ${contract.operationReplication.protocolVersion};
pub const NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS: usize = ${contract.operationReplication.recordLimit};
pub const NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES: usize = ${contract.operationReplication.canonicalByteLimit};
pub const NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES: usize = ${contract.operationReplication.logicalRecordByteLimit};
pub const NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES: usize = ${contract.operationReplication.nativeResponseByteLimit};

pub const CAPABILITY_OPERATION_IDS: &[&str] = &[
${rustStringSlice(capabilityOperationIds)}
];

pub const PRIMARY_WRITER_OPERATION_IDS: &[&str] = &[
${rustStringSlice(contract.capabilityProfiles.primaryWriter)}
];

pub const SCRAPER_OPERATION_IDS: &[&str] = &[${contract.capabilityProfiles.scraper.map((value) => JSON.stringify(value)).join(", ")}];

pub const AGENT_QUERY_IDS: &[&str] = &[
${rustStringSlice(contract.agentQueryProfile)}
];
pub const AGENT_QUERY_FORMAT: &str = ${JSON.stringify(contract.agentQueryProtocol.format)};
pub const AGENT_QUERY_RESULT_FORMAT: &str = ${JSON.stringify(contract.agentQueryProtocol.resultFormat)};
pub const AGENT_QUERY_DIGEST_DOMAIN: &str = ${JSON.stringify(contract.agentQueryProtocol.digestDomain)};
pub const AGENT_QUERY_SIGNATURE_DOMAIN: &str = ${JSON.stringify(contract.agentQueryProtocol.signatureDomain)};
pub const AGENT_QUERY_MAXIMUM_CANONICAL_BYTES: usize = ${contract.agentQueryProtocol.maximumCanonicalBytes};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteMutationProgram {
    pub mutation_id: &'static str,
    pub maximum_members: usize,
    pub entity_type: &'static str,
    pub invalidation_topic: &'static str,
    pub optimistic_effect_kind: &'static str,
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

pub const SQLITE_LOCAL_MUTATION_PROGRAMS: &[(&str, usize, &str, &str, &str)] = &[
${localMutationPrograms}
];

pub const SQLITE_LOCAL_RECONCILIATION_PROGRAMS: &[(&str, &str)] = &[
${localReconciliationPrograms}
];

pub const SQLITE_CONTENT_WORK_PROGRAMS: &[(&str, &str)] = &[
${contentWorkPrograms}
];

pub const SQLITE_SCOPE_ACTION_PROGRAMS: &[(&str, &str)] = &[
${scopeActionPrograms}
];

pub const QUERY_IDS: &[&str] = &[
${queries}
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteQueryVariant {
    pub variant_id: &'static str,
    pub sql: &'static str,
    pub reverse_sql: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteQueryProgram {
    pub query_id: &'static str,
    pub maximum_scan_rows: usize,
    pub sql: &'static str,
    pub reverse_sql: Option<&'static str>,
    pub count_sql: &'static str,
    pub variants: &'static [SqliteQueryVariant],
}

pub const SQLITE_QUERY_PROGRAMS: &[SqliteQueryProgram] = &[
${queryPrograms}
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqliteQueryRowFieldKind {
    Boolean,
    Integer,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteQueryRowField {
    pub name: &'static str,
    pub kind: SqliteQueryRowFieldKind,
    pub nullable: bool,
    pub minimum_utf8_bytes: Option<usize>,
    pub maximum_utf8_bytes: Option<usize>,
    pub minimum_integer: Option<i64>,
    pub maximum_integer: Option<i64>,
    pub enum_values: &'static [&'static str],
    pub integer_values: &'static [i64],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteQueryRowModel {
    pub query_id: &'static str,
    pub fields: &'static [SqliteQueryRowField],
}

#[rustfmt::skip]
pub const SQLITE_QUERY_ROW_MODELS: &[SqliteQueryRowModel] = &[
${queryRowModels}
];

pub const SQLITE_CHECKPOINT_IMPORT_PROGRAMS: &[(&str, usize, bool, &str)] = &[
${importPrograms}
];
`;
}

function libraryServiceSource(contract, schemaDigest) {
  const commandIds = contract.nativeCommands
    .map((value) => `  ${JSON.stringify(value)},`)
    .join("\n");
  const commandErrorCodes = contract.nativeCommandErrorCodes
    .map((value) => `  ${JSON.stringify(value)},`)
    .join("\n");
  const localActorMethods = contract.localActorMethods
    .map((value) => `  ${JSON.stringify(value)},`)
    .join("\n");
  const localActorErrorCodes = contract.localActorErrorCodes
    .map((value) => `  ${JSON.stringify(value)},`)
    .join("\n");
  return `/* This file is generated by scripts/generate-library-core-contract.mjs. */

export const LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION = ${contract.nativeCommandProtocolVersion} as const;
export const LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES = ${contract.limits.nativeCommandFrameBytes} as const;
export const LIBRARY_CORE_LOCAL_ACTOR_PROTOCOL_VERSION = ${contract.localActorProtocolVersion} as const;
export const LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUEST_FRAME_BYTES = ${contract.limits.localActorRequestFrameBytes} as const;
export const LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_RESPONSE_FRAME_BYTES = ${contract.limits.localActorResponseFrameBytes} as const;
export const LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_ACTIVE_CONNECTIONS = ${contract.limits.localActorActiveConnections} as const;
export const LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REPLAY_ENTRIES = ${contract.limits.localActorReplayEntries} as const;
export const LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUESTS_PER_MINUTE = ${contract.limits.localActorRequestsPerMinute} as const;
export const LIBRARY_CORE_LOCAL_ACTOR_REQUEST_TIMEOUT_MS = ${contract.limits.localActorRequestTimeoutMs} as const;
export const LIBRARY_CORE_SQLITE_APPLICATION_ID = ${contract.applicationId} as const;
export const LIBRARY_CORE_SQLITE_CONTRACT_VERSION = ${contract.contractVersion} as const;
export const LIBRARY_CORE_SQLITE_SCHEMA_VERSION = ${contract.schemaVersion} as const;
export const LIBRARY_CORE_SQLITE_PROTOCOL_VERSION = ${contract.protocolVersion} as const;
export const LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256 = ${JSON.stringify(schemaDigest)} as const;
export const LIBRARY_CORE_NATIVE_COMMAND_IDS = [
${commandIds}
] as const;
export const LIBRARY_CORE_NATIVE_COMMAND_ERROR_CODES = [
${commandErrorCodes}
] as const;
export const LIBRARY_CORE_LOCAL_ACTOR_METHODS = [
${localActorMethods}
] as const;
export const LIBRARY_CORE_LOCAL_ACTOR_ERROR_CODES = [
${localActorErrorCodes}
] as const;
export type LibraryCoreNativeCommandId = (typeof LIBRARY_CORE_NATIVE_COMMAND_IDS)[number];
export type LibraryCoreNativeCommandErrorCode = (typeof LIBRARY_CORE_NATIVE_COMMAND_ERROR_CODES)[number];
export type LibraryCoreLocalActorMethod = (typeof LIBRARY_CORE_LOCAL_ACTOR_METHODS)[number];
export type LibraryCoreLocalActorErrorCode = (typeof LIBRARY_CORE_LOCAL_ACTOR_ERROR_CODES)[number];
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
await update(libraryServicePath, libraryServiceSource(contract, schemaDigest));
