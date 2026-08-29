import { describe, expect, it } from "vitest";

import { assertLinuxAclOutputHasOnlyModeEntries } from "./linux-acl-proof.js";

describe("Linux Library service ACL proof", () => {
  it("accepts exactly the three mode-derived base entries", () => {
    expect(() =>
      assertLinuxAclOutputHasOnlyModeEntries(
        "user::rw-\ngroup::---\nother::---\n",
        "",
        0o100600,
      ),
    ).not.toThrow();
    expect(() =>
      assertLinuxAclOutputHasOnlyModeEntries(
        "user::rwx\ngroup::r-x\nother::r-x\n",
        "",
        0o100755,
      ),
    ).not.toThrow();
  });

  it.each([
    "user::rw-\nuser:1001:r--\ngroup::---\nmask::r--\nother::---\n",
    "user::rw-\ngroup::---\nother::---\ndefault:user::rwx\n",
    "user::rw-\ngroup:1002:r--\ngroup::---\nmask::r--\nother::---\n",
  ])("rejects an extended ACL", (stdout) => {
    expect(() =>
      assertLinuxAclOutputHasOnlyModeEntries(stdout, "", 0o100600),
    ).toThrowError(expect.objectContaining({ code: "acl_present" }));
  });

  it.each([
    ["user::rw-\ngroup::---\n", ""],
    ["user::rw-\ngroup::---\nother::---\nforeign\n", ""],
    ["user::rw-\ngroup::---\nother::---\n", "warning\n"],
    ["user::rwx\ngroup::---\nother::---\n", ""],
  ])("rejects malformed or mode-inconsistent output", (stdout, stderr) => {
    expect(() =>
      assertLinuxAclOutputHasOnlyModeEntries(stdout, stderr, 0o100600),
    ).toThrowError(expect.objectContaining({ code: "acl_probe_malformed" }));
  });
});
