import type { FeedItem } from "@freed/shared";
import {
  LIBRARY_CORE_SEARCH_DOCUMENT_MAXIMUM_TERMS,
  LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_TERMS,
  LIBRARY_CORE_SEARCH_PRESERVED_TEXT_MAXIMUM_SCALARS,
  LIBRARY_CORE_SEARCH_QUERY_MAXIMUM_TERMS,
  LIBRARY_CORE_SEARCH_RESULT_PAGE_LIMIT,
  LIBRARY_CORE_SEARCH_SCAN_ROW_LIMIT,
  projectLibraryCoreSearchResultItemV1,
  scoreLibraryCoreSearchFieldsV1,
  tokenizeLibraryCoreSearchTextV1,
  type LibraryCoreSearchFieldV1,
} from "@freed/shared/library-core";
import type { ScanLibraryItems, ScoredLibraryItem } from "@freed/ui/context";

import { requestResult, transactionDone } from "./library-core-indexeddb";

const DATABASE_VERSION = 2;
const DOCUMENTS_STORE = "search_documents";
const META_STORE = "search_meta";
const ACTIVE_INDEX_KEY = "active_index";

interface SearchDocument {
  readonly corpusVersion: number;
  readonly fields: readonly LibraryCoreSearchFieldV1[];
  readonly globalId: string;
  readonly item: FeedItem;
}

interface ActiveIndexRecord {
  readonly corpusVersion: number;
  readonly key: typeof ACTIVE_INDEX_KEY;
}

export type SearchIdentityDecision = "continue" | "stop";

function termsFor(value: unknown): string[] {
  return [...tokenizeLibraryCoreSearchTextV1(value)];
}

function field(
  value: unknown,
  weight: number,
): LibraryCoreSearchFieldV1 | null {
  const terms = termsFor(value);
  return terms.length > 0 ? { terms, weight } : null;
}

function searchDocument(item: FeedItem, corpusVersion: number): SearchDocument {
  const candidateFields = [
    field(item.content.linkPreview?.title, 4),
    field([...item.topics, ...(item.contentSignals?.tags ?? [])].join(" "), 3),
    field(
      [
        item.eventCandidate?.title,
        item.eventCandidate?.locationName,
        item.eventCandidate?.evidence,
        item.location?.name,
      ]
        .filter(Boolean)
        .join(" "),
      3,
    ),
    field((item.userState.tags ?? []).join(" "), 3),
    field(item.author.displayName, 3),
    field(item.author.handle, 3),
    field(item.author.id, 3),
    field(item.content.text, 2),
    field(item.content.linkPreview?.description, 2),
    field(item.rssSource?.feedTitle, 2),
    field(
      (item.userState.highlights ?? [])
        .map((highlight) => `${highlight.text} ${highlight.note ?? ""}`)
        .join(" "),
      2,
    ),
    field(
      Array.from(item.preservedContent?.text ?? "")
        .slice(0, LIBRARY_CORE_SEARCH_PRESERVED_TEXT_MAXIMUM_SCALARS)
        .join(""),
      1,
    ),
  ].filter(
    (candidate): candidate is LibraryCoreSearchFieldV1 => candidate !== null,
  );
  const fields: LibraryCoreSearchFieldV1[] = [];
  let remainingTermBudget =
    LIBRARY_CORE_SEARCH_DOCUMENT_MAXIMUM_TERMS -
    LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_TERMS;
  for (const candidate of candidateFields) {
    if (remainingTermBudget === 0) break;
    const terms = candidate.terms.slice(0, remainingTermBudget);
    if (terms.length > 0) fields.push({ ...candidate, terms });
    remainingTermBudget -= terms.length;
  }
  return {
    corpusVersion,
    fields,
    globalId: item.globalId,
    item: projectLibraryCoreSearchResultItemV1(item),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

export class PwaLibraryCoreSearchIndex {
  readonly #databaseName: string;
  readonly #indexedDb: IDBFactory;
  readonly #keyRange: typeof IDBKeyRange;
  #databasePromise: Promise<IDBDatabase> | null = null;
  #buildPromise: Promise<void> | null = null;

  constructor(options: {
    readonly databaseName: string;
    readonly indexedDb: IDBFactory;
    readonly keyRange: typeof IDBKeyRange;
  }) {
    this.#databaseName = options.databaseName;
    this.#indexedDb = options.indexedDb;
    this.#keyRange = options.keyRange;
  }

  async ensureBuilt(
    corpusVersion: number,
    scanItems: ScanLibraryItems,
  ): Promise<void> {
    const database = await this.#database();
    const read = database.transaction(META_STORE, "readonly");
    const active = (await requestResult(
      read.objectStore(META_STORE).get(ACTIVE_INDEX_KEY),
    )) as ActiveIndexRecord | undefined;
    await transactionDone(read);
    if (active?.corpusVersion === corpusVersion) return;
    if (this.#buildPromise) return this.#buildPromise;

    const build = this.#rebuild(corpusVersion, scanItems).finally(() => {
      if (this.#buildPromise === build) this.#buildPromise = null;
    });
    this.#buildPromise = build;
    return build;
  }

  async search(
    query: string,
    corpusVersion: number,
    visit: (matches: readonly ScoredLibraryItem[]) => SearchIdentityDecision,
    options: {
      readonly accountAliases?: ReadonlyMap<string, string>;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<void> {
    const queryTerms = tokenizeLibraryCoreSearchTextV1(
      query,
      LIBRARY_CORE_SEARCH_QUERY_MAXIMUM_TERMS,
    );
    if (queryTerms.length === 0) return;
    const database = await this.#database();
    let batch: ScoredLibraryItem[] = [];
    let afterGlobalId: string | null = null;
    for (;;) {
      throwIfAborted(options.signal);
      const transaction = database.transaction(
        [META_STORE, DOCUMENTS_STORE],
        "readonly",
      );
      const active = (await requestResult(
        transaction.objectStore(META_STORE).get(ACTIVE_INDEX_KEY),
      )) as ActiveIndexRecord | undefined;
      if (active?.corpusVersion !== corpusVersion) {
        transaction.abort();
        throw new Error(
          "PWA search index does not match the selected Library generation",
        );
      }
      const documents = transaction.objectStore(DOCUMENTS_STORE);
      const range = this.#keyRange.bound(
        afterGlobalId === null
          ? [corpusVersion]
          : [corpusVersion, afterGlobalId],
        [corpusVersion, []],
        afterGlobalId !== null,
      );
      let cursor = await requestResult(documents.openCursor(range));
      let scanned = 0;
      let nextAfterGlobalId: string | null = null;
      while (cursor && scanned < LIBRARY_CORE_SEARCH_SCAN_ROW_LIMIT) {
        throwIfAborted(options.signal);
        const document = cursor.value as SearchDocument;
        nextAfterGlobalId = document.globalId;
        const alias = options.accountAliases?.get(
          `${document.item.platform}:${document.item.author.id}`,
        );
        const aliasField = alias
          ? {
              terms: tokenizeLibraryCoreSearchTextV1(
                alias,
                LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_TERMS,
              ),
              weight: 3,
            }
          : null;
        const fields = aliasField?.terms.length
          ? [...document.fields, aliasField]
          : document.fields;
        const score = scoreLibraryCoreSearchFieldsV1(fields, queryTerms);
        if (score > 0) {
          batch.push({ item: document.item, score });
          if (batch.length >= LIBRARY_CORE_SEARCH_RESULT_PAGE_LIMIT) {
            if (visit(Object.freeze(batch)) === "stop") {
              transaction.abort();
              return;
            }
            batch = [];
            throwIfAborted(options.signal);
          }
        }
        scanned += 1;
        cursor.continue();
        cursor = await requestResult(cursor.request);
      }
      const done = cursor === null;
      await transactionDone(transaction);
      if (done || nextAfterGlobalId === null) break;
      afterGlobalId = nextAfterGlobalId;
    }
    if (batch.length > 0) visit(Object.freeze(batch));
  }

  async close(): Promise<void> {
    if (!this.#databasePromise) return;
    const database = await this.#databasePromise;
    database.close();
    this.#databasePromise = null;
  }

  async invalidate(): Promise<void> {
    if (!this.#databasePromise) return;
    const database = await this.#databasePromise;
    const transaction = database.transaction(META_STORE, "readwrite");
    transaction.objectStore(META_STORE).delete(ACTIVE_INDEX_KEY);
    await transactionDone(transaction);
  }

  async updateItems(
    corpusVersion: number,
    items: readonly FeedItem[],
  ): Promise<void> {
    if (items.length === 0 || !this.#databasePromise) return;
    const database = await this.#databasePromise;
    const read = database.transaction(META_STORE, "readonly");
    const active = (await requestResult(
      read.objectStore(META_STORE).get(ACTIVE_INDEX_KEY),
    )) as ActiveIndexRecord | undefined;
    await transactionDone(read);
    if (active?.corpusVersion !== corpusVersion) return;
    const write = database.transaction(DOCUMENTS_STORE, "readwrite");
    const documents = write.objectStore(DOCUMENTS_STORE);
    for (const item of items)
      documents.put(searchDocument(item, corpusVersion));
    await transactionDone(write);
  }

  async removeItems(
    corpusVersion: number,
    globalIds: readonly string[],
  ): Promise<void> {
    if (globalIds.length === 0 || !this.#databasePromise) return;
    const database = await this.#databasePromise;
    const read = database.transaction(META_STORE, "readonly");
    const active = (await requestResult(
      read.objectStore(META_STORE).get(ACTIVE_INDEX_KEY),
    )) as ActiveIndexRecord | undefined;
    await transactionDone(read);
    if (active?.corpusVersion !== corpusVersion) return;
    const write = database.transaction(DOCUMENTS_STORE, "readwrite");
    const documents = write.objectStore(DOCUMENTS_STORE);
    for (const globalId of new Set(globalIds)) {
      documents.delete([corpusVersion, globalId]);
    }
    await transactionDone(write);
  }

  async #rebuild(
    corpusVersion: number,
    scanItems: ScanLibraryItems,
  ): Promise<void> {
    const database = await this.#database();
    const clear = database.transaction(
      [DOCUMENTS_STORE, META_STORE],
      "readwrite",
    );
    clear.objectStore(DOCUMENTS_STORE).clear();
    clear.objectStore(META_STORE).delete(ACTIVE_INDEX_KEY);
    await transactionDone(clear);

    await scanItems(async (items) => {
      const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
      const documents = transaction.objectStore(DOCUMENTS_STORE);
      for (const item of items)
        documents.put(searchDocument(item, corpusVersion));
      await transactionDone(transaction);
      return "continue" as const;
    });

    const publish = database.transaction(META_STORE, "readwrite");
    publish.objectStore(META_STORE).put({
      corpusVersion,
      key: ACTIVE_INDEX_KEY,
    } satisfies ActiveIndexRecord);
    await transactionDone(publish);
  }

  #database(): Promise<IDBDatabase> {
    this.#databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.#indexedDb.open(
        this.#databaseName,
        DATABASE_VERSION,
      );
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
          database.createObjectStore(DOCUMENTS_STORE, {
            keyPath: ["corpusVersion", "globalId"],
          });
        } else {
          const documents = request.transaction!.objectStore(DOCUMENTS_STORE);
          if (documents.indexNames.contains("by_search_key")) {
            documents.deleteIndex("by_search_key");
          }
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      });
      request.addEventListener(
        "success",
        () => {
          const database = request.result;
          database.addEventListener("versionchange", () => database.close());
          resolve(database);
        },
        { once: true },
      );
      request.addEventListener(
        "error",
        () => {
          reject(
            request.error ?? new Error("PWA Library search database failed"),
          );
        },
        { once: true },
      );
      request.addEventListener(
        "blocked",
        () => {
          reject(new Error("PWA Library search database upgrade blocked"));
        },
        { once: true },
      );
    });
    return this.#databasePromise;
  }
}
