/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useArchiveAction } from "./useArchiveAction.js";

const context = vi.hoisted(() => ({ mutate: vi.fn<(id: string) => Promise<void>>(), editable: true }));
vi.mock("../context/PlatformContext.js", () => ({
  useAppStore: (selector: (state: { toggleArchived: typeof context.mutate }) => unknown) => selector({ toggleArchived: context.mutate }),
  usePlatformCapabilities: () => ({ libraryEdits: context.editable }),
}));

it("shares pending visibility across consumers, isolates stores and clears rejected writes", async () => {
  let reject!: (error: Error) => void;
  context.editable = true;
  context.mutate = vi.fn(() => new Promise<void>((_resolve, no) => { reject = no; }));
  const firstMutation = context.mutate;
  const views: ReturnType<typeof useArchiveAction>[] = [];
  function Consumer({ index }: { index: number }) { views[index] = useArchiveAction(); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<><Consumer index={0} /><Consumer index={1} /></>));
    let outcome!: Promise<unknown>;
    await act(async () => { outcome = views[0]!.toggleArchived("item").catch(error => error); });
    expect(firstMutation).toHaveBeenCalledWith("item");
    expect(views[1]!.pendingArchiveIds.has("item")).toBe(true);
    context.mutate = vi.fn(async () => {});
    await act(async () => root.render(<><Consumer index={0} /><Consumer index={1} /></>));
    expect(views[0]!.pendingArchiveIds.size).toBe(0);
    await act(async () => { reject(new Error("write refused")); await outcome; });
    context.mutate = firstMutation;
    await act(async () => root.render(<><Consumer index={0} /><Consumer index={1} /></>));
    expect(views[1]!.pendingArchiveIds.size).toBe(0);
    expect(await outcome).toBeInstanceOf(Error);
  } finally { await act(async () => root.unmount()); }
});

it("does not hide unarchived rows and refuses viewer actions before mutation", async () => {
  context.mutate = vi.fn(async () => {});
  context.editable = true;
  let view!: ReturnType<typeof useArchiveAction>;
  function Consumer() { view = useArchiveAction(); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Consumer />));
    await act(async () => { await view.toggleArchived("item", true); });
    expect(view.pendingArchiveIds.size).toBe(0);
    expect(context.mutate).toHaveBeenCalledTimes(1);
    context.editable = false;
    await act(async () => root.render(<Consumer />));
    await expect(view.toggleArchived("item")).rejects.toThrow("read-only");
    expect(context.mutate).toHaveBeenCalledTimes(1);
    expect(view.pendingArchiveIds.size).toBe(0);
  } finally { await act(async () => root.unmount()); }
});
