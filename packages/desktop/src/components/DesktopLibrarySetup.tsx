import { useEffect, useRef, useState } from "react";
import { GoogleDriveLibrarySelectionRequiredError } from "@freed/sync/cloud/library-core";
import {
  refreshLibraryCoreDesktopRole,
  selectDesktopLibrarySetup,
  type DesktopLibraryInstallationStatus,
} from "../lib/library-core-desktop-role";
import {
  discoverDesktopCloudLibrary,
  getValidCloudToken,
  initiateDesktopOAuth,
  startCloudSync,
  stopCloudSync,
  storeCloudToken,
} from "../lib/sync";

const buttonClass = "rounded-xl border border-[var(--theme-border-strong)] bg-[var(--theme-bg-card)] px-4 py-3 text-sm font-medium text-[var(--theme-text-primary)] disabled:cursor-not-allowed disabled:opacity-50";

export function DesktopLibrarySetup({ status, initialError, onReady }: {
  status: DesktopLibraryInstallationStatus | null;
  initialError: string | null;
  onReady: (status: DesktopLibraryInstallationStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraries, setLibraries] = useState<readonly string[]>([]);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => { operation.current?.abort(); }, []);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    try {
      await action(controller.signal);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof GoogleDriveLibrarySelectionRequiredError) {
        setLibraries(failure.libraryIds);
      } else {
        setError(failure instanceof Error ? failure.message : "Library setup failed.");
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  function createPrimary() {
    void run(async (signal) => {
      const selected = await selectDesktopLibrarySetup({ role: "primary" });
      if (!signal.aborted) onReady(selected);
    });
  }

  function join(libraryId = status?.libraryId ?? undefined) {
    void run(async (signal) => {
      let accessToken = await getValidCloudToken("gdrive");
      if (!accessToken) {
        const token = await initiateDesktopOAuth("gdrive", { signal });
        if (signal.aborted) return;
        storeCloudToken("gdrive", token);
        accessToken = token.accessToken;
      }
      const discovered = await discoverDesktopCloudLibrary(libraryId, signal);
      if (signal.aborted) return;
      if (!discovered) throw new Error("No published Library was found. Sync Google Drive from your current Primary first.");
      const selected = await selectDesktopLibrarySetup({ role: "follower", libraryId: discovered.libraryId });
      if (signal.aborted) return;
      setLibraries([]);
      onReady(selected);
      await startCloudSync("gdrive", accessToken);
      if (!signal.aborted) onReady(await refreshLibraryCoreDesktopRole());
    });
  }

  const pinned = status?.state === "joining";
  const canChoose = status?.state === "unconfigured";
  return (
    <main className="flex min-h-screen items-center justify-center app-theme-shell p-6 text-[var(--theme-text-primary)]">
      <section className="w-full max-w-lg rounded-2xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-6 shadow-xl">
        <h1 className="text-xl font-semibold">Set up your Library</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--theme-text-secondary)]">
          Join your existing Library to read and edit on this device. Your Primary keeps running capture.
          To move capture here, join first and complete a controlled Primary handoff.
        </p>
        {pinned && <p className="mt-3 text-sm">Selected Library ...{status.libraryId?.slice(-8)}</p>}
        {(error ?? initialError) && <p role="alert" className="mt-4 text-sm theme-feedback-text-danger">{error ?? initialError}</p>}
        <div className="mt-5 grid gap-3">
          {(canChoose || pinned) && <button type="button" className={buttonClass} disabled={busy} onClick={() => join()}>
            {busy ? "Setting up Library..." : pinned ? "Resume joining Library" : "Join an existing Library"}
          </button>}
          {libraries.map((libraryId) => <button type="button" className={buttonClass} disabled={busy} key={libraryId} onClick={() => join(libraryId)}>
            Join Library ...{libraryId.slice(-8)}
          </button>)}
          {(canChoose || status?.state === "creating_primary") && <button type="button" className={buttonClass} disabled={busy} onClick={createPrimary}>
            {status?.state === "creating_primary" ? "Resume creating Library" : "Create a new Library"}
          </button>}
          {!status && !initialError && <p role="status" className="text-sm text-[var(--theme-text-secondary)]">Checking the local Library...</p>}
          {!status && initialError && <button type="button" className={buttonClass} disabled={busy} onClick={() => void run(async () => onReady(await refreshLibraryCoreDesktopRole()))}>Retry native setup check</button>}
          {status?.state === "fenced" && <p className="text-sm text-[var(--theme-text-secondary)]">This installation has no active writer or consumer authority. Its Library is preserved and requires recovery.</p>}
          {busy && <button type="button" className={buttonClass} onClick={() => { operation.current?.abort(); stopCloudSync("gdrive"); }}>Cancel</button>}
        </div>
      </section>
    </main>
  );
}
