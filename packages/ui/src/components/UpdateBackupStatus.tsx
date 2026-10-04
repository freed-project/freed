import { useEffect, useState } from "react";

/** The start belongs to performance.now() in this renderer, not wall-clock time. */
export function UpdateBackupStatus({ startedAtMonotonicMs, className }: {
  startedAtMonotonicMs?: number;
  className?: string;
}) {
  const [mountedAt] = useState(() => performance.now());
  const startedAt = startedAtMonotonicMs ?? mountedAt;
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const format = (value: number) => value.toLocaleString(undefined, {
    minimumIntegerDigits: 2, useGrouping: false,
  });
  const elapsed = `${format(Math.floor(seconds / 60))}:${format(seconds % 60)}`;
  return (
    <div className={className}>
      <p role="status">Saving Library backup before updating...</p>
      <span role="timer" aria-live="off" aria-label="Backup elapsed time"
        className="mt-1 block text-text-muted tabular-nums">{elapsed}</span>
    </div>
  );
}
