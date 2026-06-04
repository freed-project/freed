import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  BACKGROUND_CHANNEL_LABELS,
  BACKGROUND_JOB_LABELS,
  useBackgroundActivityStore,
  type BackgroundActivityLogEntry,
  type BackgroundActivityRecord,
} from "../lib/background-activity-store.js";
import { formatClockTime } from "../lib/date-format.js";
import { CloseIcon } from "./icons.js";

interface BackgroundActivityPopoverProps {
  anchorElement: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

const VIEWPORT_PADDING = 12;
const POPOVER_GAP = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function activityScopeLabel(
  entry: Pick<BackgroundActivityRecord | BackgroundActivityLogEntry, "channelId" | "jobKind">,
): string {
  if (entry.channelId) return BACKGROUND_CHANNEL_LABELS[entry.channelId];
  if (entry.jobKind) return BACKGROUND_JOB_LABELS[entry.jobKind];
  return "Activity";
}

function levelClass(level: BackgroundActivityLogEntry["level"]): string {
  if (level === "error") return "text-[rgb(var(--theme-feedback-danger-rgb))]";
  if (level === "warning") return "text-[rgb(var(--theme-feedback-warning-rgb))]";
  if (level === "success") return "text-[rgb(var(--theme-feedback-success-rgb))]";
  return "text-[var(--theme-text-muted)]";
}

function progressLabel(progress?: number): string | null {
  if (typeof progress !== "number") return null;
  return `${Math.round(progress).toLocaleString()}%`;
}

function ActiveRow({ activity }: { activity: BackgroundActivityRecord }) {
  const progress = progressLabel(activity.progress);
  return (
    <div className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[var(--theme-accent-secondary)] border-t-transparent" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--theme-text-primary)]">
          {activity.label}
        </span>
        {progress ? (
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--theme-text-soft)]">
            {progress}
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[11px] text-[var(--theme-text-muted)]">
        {activity.message}
      </p>
    </div>
  );
}

function LogRow({ entry }: { entry: BackgroundActivityLogEntry }) {
  const progress = progressLabel(entry.progress);
  return (
    <div className="grid grid-cols-[3.25rem_4.75rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-1.5 text-[11px] leading-4 hover:bg-[var(--theme-bg-muted)]">
      <span className="font-mono text-[var(--theme-text-soft)]">{formatClockTime(entry.ts)}</span>
      <span className={`truncate font-medium ${levelClass(entry.level)}`}>
        {activityScopeLabel(entry)}
      </span>
      <span className="min-w-0 break-words text-[var(--theme-text-secondary)]">
        {entry.message}
        {progress ? <span className="ml-1 text-[var(--theme-text-soft)]">({progress})</span> : null}
      </span>
    </div>
  );
}

export function BackgroundActivityPopover({
  anchorElement,
  open,
  onClose,
}: BackgroundActivityPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const active = useBackgroundActivityStore((state) => state.active);
  const log = useBackgroundActivityStore((state) => state.log);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<CSSProperties>({
    left: VIEWPORT_PADDING,
    top: VIEWPORT_PADDING,
  });

  const activeRecords = useMemo(
    () => Object.values(active).sort((a, b) => a.startedAt - b.startedAt),
    [active],
  );
  const channelActivities = activeRecords.filter((activity) => activity.kind === "channel");
  const jobActivities = activeRecords.filter((activity) => activity.kind === "job");
  const filteredLog = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return log;
    return log.filter((entry) =>
      `${activityScopeLabel(entry)} ${entry.message}`.toLocaleLowerCase().includes(needle),
    );
  }, [log, query]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchorElement) return undefined;

    const updatePosition = () => {
      const anchorRect = anchorElement.getBoundingClientRect();
      const popoverRect = popoverRef.current?.getBoundingClientRect();
      const width = popoverRect?.width ?? Math.min(380, window.innerWidth - VIEWPORT_PADDING * 2);
      const height = popoverRect?.height ?? 360;
      const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width);
      const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - VIEWPORT_PADDING - height);
      const fitsRight = anchorRect.right + POPOVER_GAP + width + VIEWPORT_PADDING <= window.innerWidth;
      const left = fitsRight
        ? anchorRect.right + POPOVER_GAP
        : clamp(anchorRect.right - width, VIEWPORT_PADDING, maxLeft);
      const sideTop = clamp(anchorRect.bottom - height, VIEWPORT_PADDING, maxTop);
      const belowTop = anchorRect.bottom + POPOVER_GAP;
      const aboveTop = anchorRect.top - height - POPOVER_GAP;
      const fallbackTop = belowTop + height + VIEWPORT_PADDING <= window.innerHeight
        ? belowTop
        : clamp(aboveTop, VIEWPORT_PADDING, maxTop);
      const top = fitsRight ? sideTop : fallbackTop;

      setPosition({
        left: Math.round(left),
        top: Math.round(top),
        "--theme-menu-top": `${Math.max(VIEWPORT_PADDING, Math.round(top))}px`,
        "--theme-menu-max-height": "min(32rem, calc(100dvh - 1rem))",
      } as CSSProperties);
    };

    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorElement, open, activeRecords.length, filteredLog.length]);

  useEffect(() => {
    if (!open) return undefined;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorElement?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      previousActive?.focus();
    };
  }, [anchorElement, onClose, open]);

  if (!mounted || !open || !anchorElement) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Background activity"
      data-testid="background-activity-popover"
      className="theme-dialog-shell theme-menu-shell fixed z-[330] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col !overflow-y-hidden rounded-[var(--card-radius)] border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-0 shadow-2xl shadow-black/45"
      style={position}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] px-3 pb-2.5 pt-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--theme-text-muted)]">
            Background Activity
          </h2>
          <p className="mt-1 text-[11px] text-[var(--theme-text-soft)]">
            {activeRecords.length.toLocaleString()} active, {log.length.toLocaleString()} recent
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div data-testid="background-activity-scroll" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="mt-3">
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter activity"
            data-testid="background-activity-filter"
            className="theme-input w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
          />
        </div>

        {channelActivities.length > 0 ? (
          <section className="mt-3 space-y-2" aria-label="Running channel syncs">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-text-soft)]">
              Channel Syncs
            </p>
            {channelActivities.map((activity) => (
              <ActiveRow key={activity.id} activity={activity} />
            ))}
          </section>
        ) : null}

        {jobActivities.length > 0 ? (
          <section className="mt-3 space-y-2" aria-label="Running background jobs">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-text-soft)]">
              Jobs
            </p>
            {jobActivities.map((activity) => (
              <ActiveRow key={activity.id} activity={activity} />
            ))}
          </section>
        ) : null}

        <section className="mt-3" aria-label="Activity log">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-text-soft)]">
            Live Log
          </p>
          <div
            className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-1"
            data-testid="background-activity-log"
          >
            {filteredLog.length > 0 ? (
              filteredLog.map((entry) => <LogRow key={entry.id} entry={entry} />)
            ) : (
              <p className="px-2 py-3 text-xs text-[var(--theme-text-muted)]">
                No activity matches that filter.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
