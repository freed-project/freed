import type { FeedItem } from "@freed/shared";
import type {
  ScanLibraryItems,
  ScoredLibraryItem,
} from "@freed/ui/context";

import { requestResult, transactionDone } from "./library-core-indexeddb";

const DATABASE_VERSION = 1;
const DOCUMENTS_STORE = "search_documents";
const META_STORE = "search_meta";
const SEARCH_KEY_INDEX = "by_search_key";
const ACTIVE_INDEX_KEY = "active_index";
const RESULT_PAGE_LIMIT = 32;
const PRESERVED_TEXT_LIMIT = 1_200;
const MAX_INDEXED_TERMS_PER_DOCUMENT = 384;
const MAX_PREFIX_KEYS_PER_DOCUMENT = 64;

interface SearchField {
  readonly terms: readonly string[];
  readonly weight: number;
}

interface SearchDocument {
  readonly corpusVersion: number;
  readonly fields: readonly SearchField[];
  readonly globalId: string;
  readonly item: FeedItem;
  readonly searchKeys: readonly string[];
}

interface ActiveIndexRecord {
  readonly corpusVersion: number;
  readonly key: typeof ACTIVE_INDEX_KEY;
}

export type SearchIdentityDecision = "continue" | "stop";

function normalizeSearchText(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFKD")
        .toLocaleLowerCase("en-US")
        .replace(/\p{M}/gu, "")
    : "";
}

function termsFor(value: unknown): string[] {
  const matches = normalizeSearchText(value).match(/[\p{L}\p{N}_@#]+/gu);
  return matches ? Array.from(new Set(matches)) : [];
}

function field(value: unknown, weight: number): SearchField | null {
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
    field(item.preservedContent?.text?.slice(0, PRESERVED_TEXT_LIMIT), 1),
  ].filter((candidate): candidate is SearchField => candidate !== null);
  const fields: SearchField[] = [];
  let remainingTermBudget = MAX_INDEXED_TERMS_PER_DOCUMENT;
  for (const candidate of candidateFields) {
    if (remainingTermBudget === 0) break;
    const terms = candidate.terms.slice(0, remainingTermBudget);
    if (terms.length > 0) fields.push({ ...candidate, terms });
    remainingTermBudget -= terms.length;
  }
  const allTerms = new Set(fields.flatMap((candidate) => candidate.terms));
  const searchKeys = new Set<string>();
  for (const term of [...allTerms].slice(0, MAX_PREFIX_KEYS_PER_DOCUMENT)) {
    searchKeys.add(`${corpusVersion}\u0000t:${term}`);
  }
  return {
    corpusVersion,
    fields,
    globalId: item.globalId,
    item: {
      ...item,
      preservedContent: item.preservedContent
        ? {
            ...item.preservedContent,
            html: undefined,
            text: item.preservedContent.text?.slice(0, PRESERVED_TEXT_LIMIT),
          }
        : undefined,
    },
    searchKeys: [...searchKeys],
  };
}

function boundedEditDistance(left: string, right: string, maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const value = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length] ?? maximum + 1;
}

function termScore(query: string, candidate: string, weight: number): number {
  if (candidate === query) return weight * 4;
  if (candidate.startsWith(query)) return weight * 3;
  if (query.length < 4) return 0;
  const maximum = Math.max(1, Math.floor(query.length * 0.2));
  const distance = boundedEditDistance(query, candidate, maximum);
  return distance <= maximum ? weight * 2 - distance / 10 : 0;
}

function scoreDocument(document: SearchDocument, queryTerms: readonly string[]): number {
  let total = 0;
  for (const query of queryTerms) {
    let best = 0;
    for (const candidateField of document.fields) {
      for (const candidate of candidateField.terms) {
        best = Math.max(best, termScore(query, candidate, candidateField.weight));
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
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
    visit: (
      matches: readonly ScoredLibraryItem[],
    ) => SearchIdentityDecision,
  ): Promise<void> {
    const queryTerms = termsFor(query);
    if (queryTerms.length === 0) return;
    const database = await this.#database();
    const transaction = database.transaction([META_STORE, DOCUMENTS_STORE], "readonly");
    const active = (await requestResult(
      transaction.objectStore(META_STORE).get(ACTIVE_INDEX_KEY),
    )) as ActiveIndexRecord | undefined;
    if (active?.corpusVersion !== corpusVersion) {
      transaction.abort();
      throw new Error("PWA search index does not match the selected Library generation");
    }
    const documents = transaction.objectStore(DOCUMENTS_STORE);
    const index = documents.index(SEARCH_KEY_INDEX);
    const ranges: IDBKeyRange[] = [];
    for (const term of queryTerms) {
      const prefix = `${corpusVersion}\u0000t:${term}`;
      const range = this.#keyRange.bound(prefix, `${prefix}\uffff`);
      if ((await requestResult(index.count(range))) > 0) {
        ranges.push(range);
        continue;
      }
    }
    const counted = await Promise.all(
      ranges.map(async (range) => ({
        count: await requestResult(index.count(range)),
        range,
      })),
    );
    const candidateRange = counted
      .filter(({ count }) => count > 0)
      .sort((left, right) => left.count - right.count)[0]?.range;

    const seen = new Set<string>();
    let batch: ScoredLibraryItem[] = [];
    let cursor = await requestResult(
      candidateRange
        ? index.openCursor(candidateRange)
        : documents.openCursor(
            this.#keyRange.bound(
              [corpusVersion],
              [corpusVersion, []],
            ),
          ),
    );
    while (cursor) {
      const document = cursor.value as SearchDocument;
      if (!seen.has(document.globalId)) {
        seen.add(document.globalId);
        const score = scoreDocument(document, queryTerms);
        if (score > 0) {
          batch.push({ item: document.item, score });
          if (batch.length >= RESULT_PAGE_LIMIT) {
            if (visit(Object.freeze(batch)) === "stop") {
              transaction.abort();
              return;
            }
            batch = [];
          }
        }
      }
      cursor.continue();
      cursor = await requestResult(cursor.request);
    }
    if (batch.length > 0) visit(Object.freeze(batch));
    await transactionDone(transaction);
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
    for (const item of items) documents.put(searchDocument(item, corpusVersion));
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

  async #rebuild(corpusVersion: number, scanItems: ScanLibraryItems): Promise<void> {
    const database = await this.#database();
    const clear = database.transaction([DOCUMENTS_STORE, META_STORE], "readwrite");
    clear.objectStore(DOCUMENTS_STORE).clear();
    clear.objectStore(META_STORE).delete(ACTIVE_INDEX_KEY);
    await transactionDone(clear);

    await scanItems(async (items) => {
      const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
      const documents = transaction.objectStore(DOCUMENTS_STORE);
      for (const item of items) documents.put(searchDocument(item, corpusVersion));
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
      const request = this.#indexedDb.open(this.#databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
          const documents = database.createObjectStore(DOCUMENTS_STORE, {
            keyPath: ["corpusVersion", "globalId"],
          });
          documents.createIndex(SEARCH_KEY_INDEX, "searchKeys", {
            multiEntry: true,
            unique: false,
          });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      });
      request.addEventListener("success", () => {
        const database = request.result;
        database.addEventListener("versionchange", () => database.close());
        resolve(database);
      }, { once: true });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("PWA Library search database failed"));
      }, { once: true });
      request.addEventListener("blocked", () => {
        reject(new Error("PWA Library search database upgrade blocked"));
      }, { once: true });
    });
    return this.#databasePromise;
  }
}
