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
    // Bodies cross IPC as base64, not as a JSON number array. See
    // NativeHttpResponse in src-tauri/src/lib.rs.
    invokeMock.mockResolvedValueOnce({
      status: 200,
      headers: [["content-type", "application/json"]],
      bodyB64: btoa('{"files":[{"id":"file-1"}]}'),
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
      bodyB64: undefined,
    });
    await expect(response.json()).resolves.toEqual({ files: [{ id: "file-1" }] });
  });

  it("sends upload bytes through the Tauri command", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      headers: [],
      bodyB64: "",
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
      // base64 of [1,2,3], not a number array. A regression here would silently
      // restore ~300 MB of renderer transient per cloud sync.
      bodyB64: "AQID",
    });
    expect(response.ok).toBe(true);
  });

  it("serializes multipart Blob uploads before invoking the native request", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      headers: [],
      bodyB64: "",
    });

    const { googleDriveFetchViaTauri } = await import("./google-drive");
    const multipartBody = new Blob(["metadata\r\n", new Uint8Array([1, 2, 3])], {
      type: "multipart/related; boundary=freed-test",
    });
    const expectedBodyB64 = btoa(
      String.fromCharCode(...new Uint8Array(await multipartBody.arrayBuffer())),
    );

    await googleDriveFetchViaTauri(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { "Content-Type": multipartBody.type },
        body: multipartBody,
      },
    );

    expect(invokeMock).toHaveBeenCalledWith("google_drive_request", {
      url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      method: "POST",
      headers: [["Content-Type", "multipart/related; boundary=freed-test"]],
      bodyB64: expectedBodyB64,
    });
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
