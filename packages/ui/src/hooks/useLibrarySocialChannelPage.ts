import { useEffect, useMemo, useState } from "react";
import type { Account } from "@freed/shared";
import {
  LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
  type LibraryCoreAccountGraphPageResponseV1,
} from "@freed/shared/library-core";
import { usePlatform } from "../context/PlatformContext.js";
import { accountTitle, providerLabel } from "../lib/account-labels.js";
import type {
  CommandSocialAccount,
  SocialChannelDestination,
} from "../lib/command-palette-registry.js";

const SOCIAL_CHANNEL_RESULT_LIMIT = 25;

export interface LibrarySocialChannelPageState {
  readonly channels: readonly SocialChannelDestination[];
  readonly error: string | null;
  readonly loading: boolean;
}

function normalizedTerms(query: string): readonly string[] {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function toCommandAccount(
  row: LibraryCoreAccountGraphPageResponseV1["rows"][number],
): CommandSocialAccount | null {
  if (
    row.kind !== "social" ||
    row.provider === "rss" ||
    row.provider === "saved" ||
    !row.externalId.trim()
  ) {
    return null;
  }
  return Object.freeze({
    avatarUrl: row.avatarUrl ?? undefined,
    displayName: row.displayName ?? undefined,
    externalId: row.externalId,
    handle: row.handle ?? undefined,
    id: row.id,
    kind: "social" as const,
    personId: row.personId ?? undefined,
    provider: row.provider as Account["provider"],
  });
}

function matches(
  account: CommandSocialAccount,
  personName: string | null,
  terms: readonly string[],
): boolean {
  const handle = account.handle?.startsWith("@")
    ? account.handle.slice(1)
    : account.handle;
  const candidate = [
    accountTitle(account),
    account.displayName,
    account.handle,
    handle,
    account.externalId,
    account.externalId.slice(-8),
    providerLabel(account.provider),
    personName,
    "channel",
    "social",
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
  return terms.every((term) => candidate.includes(term));
}

/** Read only the matching command-palette social channels from SQLite pages. */
export function useLibrarySocialChannelPage({
  enabled,
  query,
  sourceVersion,
}: {
  readonly enabled: boolean;
  readonly query: string;
  readonly sourceVersion: number;
}): LibrarySocialChannelPageState {
  const { queryLibraryCore } = usePlatform();
  const terms = useMemo(() => normalizedTerms(query), [query]);
  const queryKey = JSON.stringify({ enabled, sourceVersion, terms });
  const [channels, setChannels] = useState<readonly SocialChannelDestination[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || terms.length === 0) {
      setChannels([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    if (!queryLibraryCore) {
      setChannels([]);
      setLoading(false);
      setError("SQLite social channel query is unavailable");
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    const readerSessionId = `social-channel-page-reader:${crypto.randomUUID()}`;
    void (async () => {
      const matchesPage: SocialChannelDestination[] = [];
      let cursor: string | null = null;
      do {
        const page: LibraryCoreAccountGraphPageResponseV1 =
          await queryLibraryCore({
            cancellationId: `social-channel-page-cancel:${crypto.randomUUID()}`,
            cursor,
            limit: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
            queryId: "account_graph_page_v1",
            readerSessionId,
            schemaVersion: 1,
          });
        for (const row of page.rows) {
          const account = toCommandAccount(row);
          if (!account || !matches(account, row.personName, terms)) continue;
          matchesPage.push(Object.freeze({
            account,
            personName: row.personName ?? undefined,
          }));
          if (matchesPage.length === SOCIAL_CHANNEL_RESULT_LIMIT) {
            return Object.freeze(matchesPage);
          }
        }
        cursor = page.nextCursor;
      } while (cursor !== null);
      return Object.freeze(matchesPage);
    })()
      .then((result) => {
        if (cancelled) return;
        setChannels(result);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setChannels([]);
        setLoading(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, queryLibraryCore, terms]);

  return { channels, error, loading };
}
