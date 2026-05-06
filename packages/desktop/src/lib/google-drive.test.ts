import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("desktop Google Drive platform fetch", () => {
  afterEach(() => {
    invokeMock.mockReset();
  });

  it("routes Drive API requests through the Tauri command", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: Array.from(new TextEncoder().encode('{"files":[{"id":"file-1"}]}')),
    });

    const { googleDriveFetchViaTauri } = await import("./google-drive");
    const response = await googleDriveFetchViaTauri(
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder",
      { headers: { Authorization: "Bearer token" } },
    );

    expect(invokeMock).toHaveBeenCalledWith("google_drive_request", {
      url: "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder",
      method: "GET",
      headers: [["Authorization", "Bearer token"]],
      body: undefined,
    });
    await expect(response.json()).resolves.toEqual({ files: [{ id: "file-1" }] });
  });

  it("sends upload bytes through the Tauri command", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      headers: [],
      body: [],
    });

    const { googleDriveFetchViaTauri } = await import("./google-drive");
    const response = await googleDriveFetchViaTauri(
      "https://www.googleapis.com/upload/drive/v3/files/file-1?uploadType=media",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array([1, 2, 3]),
      },
    );

    expect(invokeMock).toHaveBeenCalledWith("google_drive_request", {
      url: "https://www.googleapis.com/upload/drive/v3/files/file-1?uploadType=media",
      method: "PATCH",
      headers: [["Content-Type", "application/octet-stream"]],
      body: [1, 2, 3],
    });
    expect(response.ok).toBe(true);
  });

  it("supports empty 204 Drive responses", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 204,
      headers: [],
      body: [],
    });

    const { googleDriveFetchViaTauri } = await import("./google-drive");
    const response = await googleDriveFetchViaTauri(
      "https://www.googleapis.com/drive/v3/files/file-1",
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });
});
