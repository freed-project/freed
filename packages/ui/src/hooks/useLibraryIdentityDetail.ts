import { useEffect, useState } from "react";
import type { Account, Person } from "@freed/shared";

import {
  usePlatform,
  type PlatformConfig,
} from "../context/PlatformContext.js";

type IdentityDetailStatus = "idle" | "loading" | "ready" | "failed";
type PersonDetailReader = NonNullable<PlatformConfig["readLibraryPersonDetail"]>;
type AccountDetailReader = NonNullable<PlatformConfig["readLibraryAccountDetail"]>;

interface CachedIdentityDetail<Value> {
  readonly key: string;
  promise: Promise<Value | null>;
  result: Value | null | undefined;
}

interface IdentityDetailState<Value> {
  readonly key: string;
  readonly status: IdentityDetailStatus;
  readonly value: Value | null;
}

export interface LibraryIdentityDetailResult<Value> {
  readonly status: IdentityDetailStatus;
  readonly value: Value | null;
}

const personDetailCache = new WeakMap<
  PersonDetailReader,
  CachedIdentityDetail<Person>
>();
const accountDetailCache = new WeakMap<
  AccountDetailReader,
  CachedIdentityDetail<Account>
>();

function prepareIdentityDetail<Value, Reader extends (id: string) => Promise<Value | null>>(
  cache: WeakMap<Reader, CachedIdentityDetail<Value>>,
  reader: Reader,
  id: string,
  sourceVersion: number,
): CachedIdentityDetail<Value> {
  const key = `${sourceVersion}:${id}`;
  const cached = cache.get(reader);
  if (cached?.key === key) return cached;
  const entry: CachedIdentityDetail<Value> = {
    key,
    promise: Promise.resolve(null as never),
    result: undefined,
  };
  entry.promise = reader(id).then((value) => {
    entry.result = value;
    return value;
  }).catch((error: unknown) => {
    if (cache.get(reader) === entry) cache.delete(reader);
    throw error;
  });
  cache.set(reader, entry);
  return entry;
}

function useIdentityDetail<Value, Reader extends (id: string) => Promise<Value | null>>(
  cache: WeakMap<Reader, CachedIdentityDetail<Value>>,
  reader: Reader | undefined,
  id: string | null,
  sourceVersion: number,
): LibraryIdentityDetailResult<Value> {
  const key = `${sourceVersion}:${id ?? ""}`;
  const [state, setState] = useState<IdentityDetailState<Value>>({
    key: "",
    status: "idle",
    value: null,
  });

  useEffect(() => {
    if (!id) {
      setState({ key: "", status: "idle", value: null });
      return;
    }
    if (!reader) {
      setState({ key, status: "failed", value: null });
      return;
    }
    let cancelled = false;
    const prepared = prepareIdentityDetail(cache, reader, id, sourceVersion);
    setState(prepared.result === undefined
      ? { key, status: "loading", value: null }
      : { key, status: "ready", value: prepared.result });
    void prepared.promise
      .then((value) => {
        if (!cancelled) setState({ key, status: "ready", value });
      })
      .catch(() => {
        if (!cancelled) setState({ key, status: "failed", value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [cache, id, key, reader, sourceVersion]);

  if (!id) return { status: "idle", value: null };
  if (state.key !== key) return { status: "loading", value: null };
  return { status: state.status, value: state.value };
}

/** Retain at most one exact SQLite Person row for the active selection. */
export function useLibraryPersonDetail(
  personId: string | null,
  sourceVersion: number,
): LibraryIdentityDetailResult<Person> {
  const { readLibraryPersonDetail } = usePlatform();
  return useIdentityDetail(
    personDetailCache,
    readLibraryPersonDetail,
    personId,
    sourceVersion,
  );
}

/** Retain at most one exact SQLite Account row for the active selection. */
export function useLibraryAccountDetail(
  accountId: string | null,
  sourceVersion: number,
): LibraryIdentityDetailResult<Account> {
  const { readLibraryAccountDetail } = usePlatform();
  return useIdentityDetail(
    accountDetailCache,
    readLibraryAccountDetail,
    accountId,
    sourceVersion,
  );
}
