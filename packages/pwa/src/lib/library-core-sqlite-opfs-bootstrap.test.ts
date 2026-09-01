import { describe, expect, it, vi } from "vitest";
import { installPwaLibraryCoreOpfsSahPool } from "./library-core-sqlite-opfs-bootstrap";

describe("PWA SQLite OPFS SAH pool bootstrap", () => {
  it("reinitializes once after WebKit reports an unknown OPFS failure", async () => {
    const pool = { OpfsSAHPoolDb: class {} };
    const install = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException(
          "The operation failed for an unknown transient reason",
          "UnknownError",
        ),
      )
      .mockResolvedValueOnce(pool);

    await expect(installPwaLibraryCoreOpfsSahPool(install)).resolves.toBe(pool);
    expect(install).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        forceReinitIfPreviouslyFailed: true,
        name: "freed-opfs-sahpool-v1",
      }),
    );
    expect(install).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ forceReinitIfPreviouslyFailed: true }),
    );
  });

  it("returns the repeated unknown failure without a third attempt", async () => {
    const first = new DOMException("first transient failure", "UnknownError");
    const second = new DOMException("second transient failure", "UnknownError");
    const install = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);

    await expect(installPwaLibraryCoreOpfsSahPool(install)).rejects.toBe(second);
    expect(install).toHaveBeenCalledTimes(2);
  });

  it.each(["QuotaExceededError", "NotAllowedError"])(
    "does not retry %s",
    async (name) => {
      const failure = new DOMException("storage is unavailable", name);
      const install = vi.fn().mockRejectedValue(failure);

      await expect(installPwaLibraryCoreOpfsSahPool(install)).rejects.toBe(
        failure,
      );
      expect(install).toHaveBeenCalledTimes(1);
    },
  );
});
