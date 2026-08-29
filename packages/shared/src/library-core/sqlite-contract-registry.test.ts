import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_OPERATION_IDS,
  LIBRARY_CORE_QUERY_IDS,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
} from "./sqlite-contract.generated.js";

describe("Library Core SQLite contract registry", () => {
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
