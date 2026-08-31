import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "./Toast";

describe("toast updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a persistent toast visible while its progress changes", () => {
    const id = toast.info("Preparing Library: 0%", { durationMs: null });

    toast.update(id, "Adding items: 40%");

    expect(useToastStore.getState().toasts).toMatchObject([
      { id, message: "Adding items: 40%", type: "info" },
    ]);

    toast.update(id, "Sample data added: 100%.", "success", 4000);
    expect(useToastStore.getState().toasts).toMatchObject([
      { id, message: "Sample data added: 100%.", type: "success" },
    ]);

    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
