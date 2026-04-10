import { useEffect, useState } from "react";
import { toast } from "@freed/ui/components/Toast";
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  subscribeToSnapshots,
  type SnapshotSummary,
} from "../lib/snapshots";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DesktopSnapshotsSection() {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const next = await listSnapshots();
        if (!cancelled) {
          setSnapshots(next);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const unsubscribe = subscribeToSnapshots(() => {
      void load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleCreateSnapshot = async () => {
    setCreating(true);
    try {
      const snapshot = await createSnapshot("manual");
      if (!snapshot) {
        toast.error("Snapshot creation is unavailable until the library is ready");
        return;
      }

      toast.success(`Snapshot saved (...${snapshot.id.slice(-8)})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Snapshot creation failed");
    } finally {
      setCreating(false);
    }
  };

  const handleRestoreSnapshot = async (snapshot: SnapshotSummary) => {
    const confirmed = window.confirm(
      `Restore snapshot from ${dateFormatter.format(snapshot.createdAt)}?\n\nFreed Desktop will reload after the restore completes.`,
    );
    if (!confirmed) return;

    setRestoringId(snapshot.id);
    try {
      await restoreSnapshot(snapshot.id);
      location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Snapshot restore failed");
      setRestoringId(null);
    }
  };

  return (
    <div className="mt-8">
      <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
        Local Snapshots
      </h3>

      <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm text-white">Automatic rotating backups</p>
            <p className="text-xs text-[#71717a] max-w-xl">
              Freed Desktop keeps up to {(24).toLocaleString()} local snapshots of your
              library, including your saved friend graph and synced contact matches, so you can
              roll back after corruption or accidental loss.
            </p>
          </div>
          <button
            onClick={() => void handleCreateSnapshot()}
            disabled={creating || restoringId !== null}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-sm text-[#a1a1aa] transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create snapshot now"}
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-xs text-[#71717a]">Loading snapshots...</p>
        ) : snapshots.length === 0 ? (
          <p className="mt-4 text-xs text-[#71717a]">
            Your first snapshot appears automatically after the library starts changing.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {snapshots.map((snapshot) => {
              const isRestoring = restoringId === snapshot.id;

              return (
                <div
                  key={snapshot.id}
                  className="flex flex-col gap-3 rounded-xl border border-[rgba(255,255,255,0.06)] bg-black/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-white">
                        {dateFormatter.format(snapshot.createdAt)}
                      </p>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-[#71717a]">
                        {snapshot.reason}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#71717a]">
                      {snapshot.itemCount.toLocaleString()} items, {snapshot.friendCount.toLocaleString()} friends,{" "}
                      {snapshot.contactCount.toLocaleString()} contacts,{" "}
                      {snapshot.pendingMatchCount.toLocaleString()} pending matches, {formatByteSize(snapshot.byteSize)}
                    </p>
                    <p className="mt-1 text-[11px] font-mono text-[#52525b]">
                      Snapshot ...{snapshot.id.slice(-8)}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleRestoreSnapshot(snapshot)}
                    disabled={creating || restoringId !== null}
                    className="shrink-0 rounded-xl bg-[#8b5cf6]/15 px-3 py-2 text-sm text-[#c4b5fd] transition-colors hover:bg-[#8b5cf6]/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRestoring ? "Restoring..." : "Restore"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
