import { useEffect, useMemo, useRef, useState } from "react";
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
  readonly resultsCurrent: boolean;
  isAccountCurrent(account: CommandSocialAccount): boolean;
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
  const { queryLibraryCore, readLibraryPersonDetail } = usePlatform();
  const termsKey = JSON.stringify(normalizedTerms(query));
  const terms = useMemo<readonly string[]>(() => JSON.parse(termsKey), [termsKey]);
  const queryKey = JSON.stringify({ enabled, sourceVersion, terms });
  type Resource = {
    termsKey: string;
    queryReader: typeof queryLibraryCore;
    personReader: typeof readLibraryPersonDetail;
    sourceVersion: number;
    channels: readonly SocialChannelDestination[];
    error: string | null;
  };
  const [resource, setResource] = useState<Resource | null>(null);
  const contextMatches = enabled && terms.length > 0 && resource !== null &&
    resource.termsKey === termsKey && resource.queryReader === queryLibraryCore &&
    resource.personReader === readLibraryPersonDetail && resource.sourceVersion <= sourceVersion;
  const channels = contextMatches ? resource.channels : [];
  const resultsCurrent = contextMatches && resource.sourceVersion === sourceVersion && resource.error === null;
  const admission = useRef({ channels, resultsCurrent });
  admission.current = { channels, resultsCurrent };
  const isAccountCurrent = useMemo(() => (account: CommandSocialAccount) =>
    admission.current.resultsCurrent && admission.current.channels.some((destination) => destination.account === account), []);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || terms.length === 0) {
      setResource(null);
      return () => {
        cancelled = true;
      };
    }
    if (!queryLibraryCore) {
      setResource({ termsKey, queryReader: queryLibraryCore, personReader: readLibraryPersonDetail, sourceVersion, channels: [], error: "SQLite social channel query is unavailable" });
      return () => {
        cancelled = true;
      };
    }

    const provenance = { termsKey, queryReader: queryLibraryCore, personReader: readLibraryPersonDetail, sourceVersion };
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
        if (cancelled) return Object.freeze([]);
        for (const row of page.rows) {
          const account = toCommandAccount(row);
          if (!account || !matches(account, row.personName, terms)) continue;
          const person = account.personId && readLibraryPersonDetail
            ? await readLibraryPersonDetail(account.personId)
            : undefined;
          if (cancelled) return Object.freeze([]);
          matchesPage.push(Object.freeze({
            person: person ?? undefined,
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
        setResource({ ...provenance, channels: result, error: null });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setResource({ ...provenance, channels: [], error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, queryLibraryCore, readLibraryPersonDetail, terms, termsKey]);

  const error = contextMatches && resource.sourceVersion === sourceVersion ? resource.error : null;
  const loading = enabled && terms.length > 0 && Boolean(queryLibraryCore) && !resultsCurrent && error === null;
  return { channels, error, loading, resultsCurrent, isAccountCurrent };
}
