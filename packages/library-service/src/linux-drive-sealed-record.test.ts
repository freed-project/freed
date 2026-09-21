import { describe, expect, it } from "vitest";
import {
  openLinuxDriveCredential,
  sealLinuxDriveCredential,
} from "./linux-drive-sealed-record.js";

const key = new Uint8Array(32).fill(17);
const secret = JSON.stringify({
  schemaVersion: 1,
  refreshToken: "synthetic-only-token",
});
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

describe("Linux Drive sealed record", () => {
  it("round trips bounded Unicode credentials without plaintext in the record", () => {
    const plaintext = `${secret} café`;
    const first = sealLinuxDriveCredential("drive-1", plaintext, key);
    const second = sealLinuxDriveCredential("drive-1", plaintext, key);
    expect(first).not.toEqual(second);
    expect(new TextDecoder().decode(first)).not.toContain(
      "synthetic-only-token",
    );
    expect(openLinuxDriveCredential("drive-1", first, key)).toBe(plaintext);
    expect(key).toEqual(new Uint8Array(32).fill(17));
  });

  it("authenticates record identity even when the clear identity is relabeled", () => {
    const record = JSON.parse(
      new TextDecoder().decode(
        sealLinuxDriveCredential("drive-1", secret, key),
      ),
    );
    record.recordId = "drive-2";
    expect(() =>
      openLinuxDriveCredential("drive-2", encode(record), key),
    ).toThrow("drive_credential_unavailable");
  });

  it.each(["nonce", "tag", "ciphertext"])(
    "rejects changed %s without releasing plaintext",
    (field) => {
      const record = JSON.parse(
        new TextDecoder().decode(
          sealLinuxDriveCredential("drive-1", secret, key),
        ),
      );
      const bytes = Buffer.from(record[field], "base64");
      bytes[0] = bytes[0]! ^ 1;
      record[field] = bytes.toString("base64");
      expect(() =>
        openLinuxDriveCredential("drive-1", encode(record), key),
      ).toThrow("drive_credential_unavailable");
    },
  );

  it("rejects wrong keys, future formats and noncanonical encoded fields", () => {
    const sealed = sealLinuxDriveCredential("drive-1", secret, key);
    expect(() =>
      openLinuxDriveCredential("drive-1", sealed, new Uint8Array(32)),
    ).toThrow("drive_credential_unavailable");
    const record = JSON.parse(new TextDecoder().decode(sealed));
    for (const patch of [
      { schemaVersion: 2 },
      { format: "unknown" },
      { extra: true },
      { nonce: `${record.nonce}\n` },
      { tag: "" },
      { ciphertext: "" },
    ]) {
      expect(() =>
        openLinuxDriveCredential(
          "drive-1",
          encode({ ...record, ...patch }),
          key,
        ),
      ).toThrow("drive_credential_unavailable");
    }
  });

  it("enforces byte bounds and refuses malformed UTF-8 and identifiers", () => {
    const maximum = "x".repeat(16_384);
    expect(
      openLinuxDriveCredential(
        "drive-1",
        sealLinuxDriveCredential("drive-1", maximum, key),
        key,
      ),
    ).toBe(maximum);
    for (const plaintext of ["", `${maximum}x`, "é".repeat(8_193), "\ud800"]) {
      expect(() => sealLinuxDriveCredential("drive-1", plaintext, key)).toThrow(
        "drive_credential_unavailable",
      );
    }
    expect(() => sealLinuxDriveCredential("../drive", secret, key)).toThrow(
      "drive_credential_unavailable",
    );
    expect(() =>
      sealLinuxDriveCredential("drive-1", secret, new Uint8Array(31)),
    ).toThrow("drive_credential_unavailable");
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array(24_577),
      new Uint8Array([255]),
    ]) {
      expect(() => openLinuxDriveCredential("drive-1", bytes, key)).toThrow(
        "drive_credential_unavailable",
      );
    }
  });
});
