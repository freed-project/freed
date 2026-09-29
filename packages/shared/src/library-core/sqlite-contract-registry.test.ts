import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_OPERATION_IDS,
  LIBRARY_CORE_LOCAL_SCHEMA_SQL,
  LIBRARY_CORE_LOCAL_SCHEMA_CATALOG,
  LIBRARY_CORE_LOCAL_SCHEMA_SHA256,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SQL,
  LIBRARY_CORE_QUERY_IDS,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
} from "./sqlite-contract.generated.js";

describe("Library Core SQLite contract registry", () => {
  it("shares the exact native local catalog and combined physical schema digest", () => {
    const native = readFileSync(new URL("../../../library-core-native/src/normalized_native_schema_v2.sql", import.meta.url), "utf8");
    expect(LIBRARY_CORE_LOCAL_SCHEMA_SQL).toBe(native);
    expect(LIBRARY_CORE_LOCAL_SCHEMA_CATALOG.map(object => object.sql)).toEqual(native.split(";").map(sql => sql.trim()).filter(Boolean));
    expect(new Set(LIBRARY_CORE_LOCAL_SCHEMA_CATALOG.map(object => object.name)).size).toBe(LIBRARY_CORE_LOCAL_SCHEMA_CATALOG.length);
    expect(createHash("sha256").update(LIBRARY_CORE_NORMALIZED_SCHEMA_SQL).update(native).digest("hex")).toBe(LIBRARY_CORE_LOCAL_SCHEMA_SHA256);
  });

  it("publishes exactly the executable bounded query programs", () => {
    expect([...LIBRARY_CORE_QUERY_IDS].sort()).toEqual(
      Object.keys(LIBRARY_CORE_SQLITE_QUERY_PROGRAMS).sort(),
    );
  });

  it("publishes exactly the executable typed mutation programs", () => {
    expect([...LIBRARY_CORE_OPERATION_IDS].sort()).toEqual(
      Object.keys(LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS).sort(),
    );
  });
});
