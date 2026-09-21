import { describe, expect, it, vi } from "vitest";
import { createLinuxDriveConsentPresenter } from "./linux-drive-consent.js";

function consentUrl() {
  return (
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: "synthetic-client",
      redirect_uri: "http://127.0.0.1:43127/callback",
      response_type: "code",
      scope: "synthetic-scope",
      include_granted_scopes: "true",
      code_challenge: "synthetic-challenge",
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      state: "synthetic-state",
    }).toString()
  );
}

describe("Linux terminal PKCE consent", () => {
  it("shows bounded consent and loopback forwarding instructions on a TTY", async () => {
    const write = vi.fn();
    await createLinuxDriveConsentPresenter({ isTTY: true, write })(
      consentUrl(),
    );
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]).toContain("127.0.0.1:43127");
    expect(write.mock.calls[0]![0]).toContain(consentUrl());
  });
  it.each([false, undefined])(
    "does not leak the consent URL into redirected output %s",
    async (isTTY) => {
      const write = vi.fn();
      await expect(
        createLinuxDriveConsentPresenter({ isTTY, write })(consentUrl()),
      ).rejects.toThrow("drive_auth_failed");
      expect(write).not.toHaveBeenCalled();
    },
  );
  it("rejects other origins, non-loopback callbacks, duplicate fields and token parameters", async () => {
    const write = vi.fn();
    const present = createLinuxDriveConsentPresenter({ isTTY: true, write });
    for (const url of [
      consentUrl().replace("accounts.google.com", "example.invalid"),
      consentUrl().replace("127.0.0.1", "example.invalid"),
      `${consentUrl()}&state=duplicate`,
      `${consentUrl()}&access_token=synthetic-secret`,
      "x".repeat(8_193),
      "invalid",
    ]) {
      await expect(present(url)).rejects.toThrow("drive_auth_failed");
    }
    expect(write).not.toHaveBeenCalled();
  });
});
