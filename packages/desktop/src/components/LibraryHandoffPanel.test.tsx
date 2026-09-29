vi.mock("../hooks/useCloudProviders", () => ({ useCloudProviders: () => ({ providers: { gdrive: { status: "idle" } }, connect: vi.fn(), cancelConnect: vi.fn() }) }));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { LibraryHandoffPanel } from "./LibraryHandoffPanel";
const mocks = vi.hoisted(() => ({ status: null as any, read: vi.fn(), adopt: vi.fn(), token: vi.fn(), accept: vi.fn(), refresh: vi.fn(), role: vi.fn(), prepare: vi.fn() }));
vi.mock("../lib/sqlite-library", () => ({ readNormalizedLibraryHandoffStatus: mocks.read }));
vi.mock("../lib/library-core-desktop-role", () => ({ readLibraryCoreDesktopRole: mocks.role, refreshLibraryCoreDesktopRole: mocks.refresh }));
vi.mock("../lib/sync", () => ({ getValidCloudToken: mocks.token }));
vi.mock("../lib/library-core-handoff", () => ({
  prepareDesktopLibraryTargetReadiness: mocks.prepare, prepareDesktopLibrarySourceHandoff: vi.fn(),
  cancelDesktopLibrarySourceHandoff: vi.fn(), authorizeDesktopLibrarySourceHandoff: vi.fn(),
  acceptDesktopLibraryTargetHandoffCancellation: vi.fn(),
  acceptDesktopLibraryTargetHandoffAuthorization: mocks.accept, catchUpDesktopLibraryTargetHandoff: vi.fn(),
  stageDesktopLibraryTargetHandoff: vi.fn(), publishDesktopLibraryTargetHandoff: vi.fn(),
  activateDesktopLibraryTargetHandoff: vi.fn(), adoptDesktopLibrarySourceHandoff: mocks.adopt,
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); mocks.status = { handoffId: "a".repeat(64), installationRole: "source", phase: "authorized", canonicalReadiness: "{}", canonicalAuthorization: "grant" };
  mocks.read.mockImplementation(async () => mocks.status); mocks.token.mockResolvedValue("token");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<LibraryHandoffPanel />)); }
function buttons() { return Array.from(container.querySelectorAll("button")); }
it("resumes an authorized source without exposing cancellation or legacy takeover", async () => {
  await render();
  expect(container.textContent).toContain("Move authorized");
  expect(buttons().some(b => /Cancel|Make This/.test(b.textContent ?? ""))).toBe(false);
  mocks.adopt.mockRejectedValue(new Error("remote checkpoint unavailable"));
  await act(async () => buttons().find(b => b.textContent?.includes("Verify successor"))!.click());
  expect(mocks.adopt).toHaveBeenCalledWith(expect.objectContaining({ handoffId: mocks.status.handoffId, accessToken: "token" }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("remote checkpoint unavailable");
  expect(container.textContent).toContain("Move authorized");
});
it("retries a committed demotion without requesting another cloud token", async () => {
  mocks.status.phase = "demoted"; await render();
  expect(container.textContent).toContain("Former Primary");
  expect(container.textContent).not.toContain("Current Primary");
  await act(async () => buttons().find(b => b.textContent?.includes("Verify successor"))!.click());
  expect(mocks.token).not.toHaveBeenCalled();
  expect(mocks.adopt).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "" }));
});
it("shows persisted target readiness and requires authorization before staging", async () => {
  mocks.status = { ...mocks.status, installationRole: "target", phase: "preparing", canonicalAuthorization: null,
    canonicalReadiness: JSON.stringify({ body: { target_actor_id: "b".repeat(64) } }) };
  await render();
  expect(container.textContent).toContain("Target device ...bbbbbbbb");
  expect(buttons().find(b => b.textContent === "Verify cancellation and resume as consumer")?.disabled).toBe(true);
  expect(buttons().find(b => b.textContent === "Verify and accept authorization")?.disabled).toBe(true);
  expect(buttons().some(b => b.textContent?.includes("stage this Primary"))).toBe(false);
});
it("keeps a failed native read unavailable until explicit retry", async () => {
  mocks.read.mockRejectedValueOnce(new Error("database unavailable")); await render();
  expect(container.textContent).toContain("database unavailable");
  expect(buttons().map(b => b.textContent)).toEqual(["Retry transfer check"]);
  await act(async () => buttons()[0].click());
  expect(container.textContent).toContain("Move authorized");
});

it("offers signature completion after durable authorization rather than successor adoption", async () => {
  mocks.status.canonicalAuthorization = null; mocks.status.canonicalAuthorizationBody = "durable body";
  await render();
  expect(buttons().some(b => b.textContent === "Finish signed authorization")).toBe(true);
  expect(buttons().some(b => b.textContent?.includes("Verify successor"))).toBe(false);
  expect(mocks.token).not.toHaveBeenCalled();
});

it("shows the durable cancellation receipt after a source restart", async () => {
  mocks.status = { ...mocks.status, phase: "cancelled", canonicalAuthorization: null,
    canonicalCancellation: "signed cancellation fixture" };
  await render();
  expect(container.textContent).toContain("Signed cancellation for the target device");
  expect(Array.from(container.querySelectorAll("textarea")).some(field => field.value === "signed cancellation fixture")).toBe(true);
  expect(mocks.token).not.toHaveBeenCalled();
});

it.each(["consumer", "source"])("offers a later transfer for a completed %s lifecycle", async installationRole => {
  mocks.role.mockReturnValue("follower");
  mocks.status = { ...mocks.status, installationRole, phase: installationRole === "consumer" ? "following" : "demoted" };
  await render();
  expect(container.textContent).not.toContain("Readiness receipt for the current Primary");
  await act(async () => buttons().find(b => b.textContent === "Prepare this device as the new Primary")!.click());
  expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(mocks.token).not.toHaveBeenCalled();
});

it.each(["preparing", "active", "demoted"])("keeps archive discovery available in phase %s", async phase => {
  mocks.status = { ...mocks.status, installationRole: phase === "demoted" ? "source" : "target", phase };
  mocks.role.mockReturnValue(phase === "active" ? "primary" : phase === "demoted" ? "follower" : null);
  await render();
  expect(container.textContent).toContain("Preserved edits");
  expect(buttons().some(button => button.textContent === "Browse recovery archives")).toBe(true);
  expect(container.textContent?.includes("Applying them again is unavailable")).toBe(phase !== "demoted");
});

it.each(["preparing", "cas_pending", "active"])("offers a subsequent source transfer only after target activation: %s", async phase => {
  mocks.status = { ...mocks.status, installationRole: "target", phase };
  mocks.role.mockReturnValue("primary");
  await render();
  const prepare = buttons().find(button => button.textContent === "Pause and prepare transfer");
  expect(Boolean(prepare)).toBe(phase === "active");
  if (prepare) expect(prepare.disabled).toBe(true);
});
