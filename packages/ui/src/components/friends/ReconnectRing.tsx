/**
 * Reconnect Ring overlay — visual label for the gravity zone that attracts
 * high-care friends who are overdue for a reach-out.
 *
 * This is a purely declarative HTML overlay positioned above the canvas.
 * The actual force pulling nodes into the zone lives in FriendGraph.tsx's
 * d3 simulation (forceY with RECONNECT_Y target).
 */

interface ReconnectRingProps {
  /** Number of friends currently in the reconnect zone */
  count: number;
}

export function ReconnectRing({ count }: ReconnectRingProps) {
  if (count === 0) return null;

  return (
    <div
      className="absolute top-0 left-0 right-0 pointer-events-none"
      aria-label={`${count} friend${count === 1 ? "" : "s"} to reconnect with`}
    >
      {/* Dashed border zone indicator */}
      <div className="mx-auto mt-3 w-[min(480px,90%)] rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-2 flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 shrink-0"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-3 h-3"
          >
            <path d="M10 3a1 1 0 01.707.293l6 6a1 1 0 010 1.414l-6 6A1 1 0 019 16V4a1 1 0 011-1z" />
          </svg>
        </span>
        <p className="text-xs text-amber-400/80 font-medium leading-snug">
          Reconnect &mdash;{" "}
          <span className="text-amber-300">{count.toLocaleString()}</span>{" "}
          {count === 1 ? "friend" : "friends"} you haven't reached out to in a
          while
        </p>
      </div>
    </div>
  );
}
