import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("desktop Google Contacts platform fetch", () => {
  afterEach(() => {
    invokeMock.mockReset();
  });

  it("routes People API requests through the Tauri command", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: Array.from(new TextEncoder().encode(JSON.stringify({
      connections: [{
        resourceName: "people/1",
        names: [{ displayName: "Test Contact" }],
      }],
      nextSyncToken: "sync-token",
      }))),
    });

    const { fetchGoogleContactsViaTauri } = await import("./google-contacts");
    const result = await fetchGoogleContactsViaTauri("access-token", null);

    expect(invokeMock).toHaveBeenCalledWith("google_api_request", {
      url: expect.stringContaining("https://people.googleapis.com/v1/people/me/connections?"),
      accessToken: "access-token",
    });
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.name.displayName).toBe("Test Contact");
    expect(result.nextSyncToken).toBe("sync-token");
  });

  it("preserves Google API status codes from native failures", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 403,
      headers: [["content-type", "application/json"]],
      body: Array.from(new TextEncoder().encode(JSON.stringify({
        error: {
          message: "Request had insufficient authentication scopes.",
          errors: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
        },
      }))),
    });

    const { fetchGoogleContactsViaTauri } = await import("./google-contacts");

    await expect(fetchGoogleContactsViaTauri("access-token", null)).rejects.toMatchObject({
      message: "Google Contacts API failed (403): Request had insufficient authentication scopes. (ACCESS_TOKEN_SCOPE_INSUFFICIENT)",
      status: 403,
    });
  });

  it("preserves native transport failures", async () => {
    invokeMock.mockRejectedValueOnce("Google Contacts request failed: dns error");

    const { fetchGoogleContactsViaTauri } = await import("./google-contacts");

    await expect(fetchGoogleContactsViaTauri("access-token", null)).rejects.toMatchObject({
      message: "Google Contacts request failed: dns error",
    });
  });
});
