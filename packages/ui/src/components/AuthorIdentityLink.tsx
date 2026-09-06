import { useRef, useState } from "react";
import type { FeedItem, Person } from "@freed/shared";
import { isDue, lastReachOutAt } from "@freed/shared";
import { usePlatform } from "../context/PlatformContext.js";
import { FriendOverview } from "./friends/FriendOverview.js";
import { Tooltip } from "./Tooltip.js";

/** Resolve only on intent, never one Library request per mounted feed row. */
export function AuthorIdentityLink({
  item,
  className = "",
  testId,
  onOpen,
}: {
  item: FeedItem;
  className?: string;
  testId?: string;
  onOpen?: (item: FeedItem) => void | Promise<void>;
}) {
  const platform = usePlatform();
  const key = `${item.platform}:${item.author.id}`;
  const latestKey = useRef(key);
  latestKey.current = key;
  const pending = useRef<{
    key: string;
    value: Promise<{ person: Person | null; accountId: string | null }>;
  } | null>(null);
  const [detail, setDetail] = useState<{
    key: string;
    person: Person | null;
    failed?: boolean;
  } | null>(null);
  const person = detail?.key === key ? detail.person : null;
  const resolve = () => {
    if (pending.current?.key === key) return pending.current.value;
    const value = (async () => {
      if (!platform.queryLibraryCore)
        throw new Error("Author lookup unavailable");
      const scope = await platform.queryLibraryCore({
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
        platform: item.platform,
        authorId: item.author.id,
        feedUrl: null,
      });
      const account = scope.accountId
        ? await platform.readLibraryAccountDetail?.(scope.accountId)
        : null;
      const person = account?.personId
        ? ((await platform.readLibraryPersonDetail?.(account.personId)) ?? null)
        : null;
      if (latestKey.current === key) setDetail({ key, person });
      return { person, accountId: scope.accountId };
    })();
    pending.current = { key, value };
    return value;
  };
  const warm = () => {
    void resolve().catch(() => {
      if (latestKey.current === key)
        setDetail({ key, person: null, failed: true });
      if (pending.current?.key === key) pending.current = null;
    });
  };
  const contact = person ? lastReachOutAt(person) : null;
  return (
    <Tooltip
      label={`View ${item.author.displayName} in Friends`}
      content={
        <div className="theme-card-soft w-80 max-w-[calc(100vw-3rem)] rounded-2xl p-3 text-left normal-case tracking-normal">
          <FriendOverview
            name={person?.name ?? item.author.displayName}
            avatarUrl={person?.avatarUrl ?? item.author.avatarUrl}
            bio={person?.bio}
            careLevel={person?.careLevel}
            lastContactAt={person ? contact : undefined}
            needsOutreach={person ? isDue(person) : undefined}
          />
          {!person && (
            <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
              {detail?.key === key
                ? detail.failed
                  ? "Could not load identity. Click to retry."
                  : "View profile in Friends"
                : "Loading identity..."}
            </p>
          )}
        </div>
      }
    >
      <button
        type="button"
        data-testid={testId}
        className={`rounded-sm text-left underline-offset-4 transition-colors hover:text-[color:var(--theme-accent-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-accent-primary)] ${className}`}
        onPointerEnter={warm}
        onFocus={warm}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={async (event) => {
          event.stopPropagation();
          try {
            const result = await resolve();
            if (latestKey.current !== key) return;
            if (!result.person && onOpen) {
              await onOpen(item);
              return;
            }
            if (!result.person && !result.accountId) {
              setDetail({ key, person: null, failed: true });
              pending.current = null;
              return;
            }
            const actions = platform.store.getState();
            actions.setSelectedItem(null);
            // Each selection action clears the other kind of selection.
            if (result.person) actions.setSelectedPerson(result.person.id);
            else actions.setSelectedAccount(result.accountId);
            actions.setActiveView("friends");
          } catch {
            if (latestKey.current !== key) return;
            pending.current = null;
            setDetail({ key, person: null, failed: true });
            if (onOpen) await onOpen(item);
          }
        }}
      >
        {item.author.displayName}
      </button>
    </Tooltip>
  );
}
