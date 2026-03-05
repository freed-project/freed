/**
 * Shimmer placeholder that matches the FeedItem card layout.
 * Rendered while the Automerge doc is loading from IndexedDB so the
 * app chrome is visible immediately instead of showing a black spinner.
 */
export function FeedItemSkeleton() {
  return (
    <div className="feed-card animate-pulse" aria-hidden>
      {/* Author row */}
      <div className="flex items-center gap-3 mb-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Display name + handle */}
          <div className="flex items-center gap-2">
            <div className="h-3.5 w-24 rounded bg-white/10" />
            <div className="h-3 w-16 rounded bg-white/[0.06]" />
          </div>
          {/* Platform + timestamp */}
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-white/[0.06]" />
            <div className="h-3 w-16 rounded bg-white/[0.06]" />
          </div>
        </div>
      </div>

      {/* Body lines */}
      <div className="space-y-2">
        <div className="h-3.5 w-full rounded bg-white/10" />
        <div className="h-3.5 w-[85%] rounded bg-white/10" />
        <div className="h-3.5 w-[70%] rounded bg-white/[0.06]" />
      </div>
    </div>
  );
}
