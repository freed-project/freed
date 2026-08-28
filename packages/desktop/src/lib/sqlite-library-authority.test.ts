import { describe, expect, it } from "vitest";
import { parseSqliteLibraryAuthorityProtocol } from "./sqlite-library";

const digest = (pair: string): string => pair.repeat(32);

function nativeProtocol(prior: string | null) {
  return {
    format: "freed_library_core_native_authority_protocol_v1",
    active_engine: "library_core_v1",
    schema_version: 12,
    replication_protocol: "op_segments_v1",
    checkpoint_format: "freed_logical_checkpoint_v1",
    transition_certificate_digest: digest("11"),
    native_protocol_certificate_digest: digest("22"),
    prior_transition_certificate_digest: prior,
    source_manifest_digest: digest("33"),
  };
}

describe("SQLite Library native authority protocol", () => {
  it("accepts a closed fresh native genesis receipt", () => {
    expect(parseSqliteLibraryAuthorityProtocol(nativeProtocol(null))).toEqual(
      nativeProtocol(null),
    );
  });

  it("preserves the historical certificate digest on a legacy transition", () => {
    const prior = digest("44");
    expect(
      parseSqliteLibraryAuthorityProtocol(nativeProtocol(prior))
        .prior_transition_certificate_digest,
    ).toBe(prior);
  });

  it("rejects downgraded, malformed, and extended protocol receipts", () => {
    expect(() =>
      parseSqliteLibraryAuthorityProtocol({
        ...nativeProtocol(null),
        replication_protocol: "automerge_blob_v1",
      }),
    ).toThrow(/invalid authority protocol/);
    expect(() =>
      parseSqliteLibraryAuthorityProtocol({
        ...nativeProtocol(null),
        source_manifest_digest: "not-a-digest",
      }),
    ).toThrow(/invalid authority protocol/);
    expect(() =>
      parseSqliteLibraryAuthorityProtocol({
        ...nativeProtocol(null),
        unexpected: true,
      }),
    ).toThrow(/invalid authority protocol/);
  });
});
