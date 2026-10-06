import { getJevClassifierProvider, onJevClassifierProviderChange } from "./jev-provider";
import { assertJevSourceCurrent } from "./jev-library";
import { isJevNative, requestNativeJev, jevPreviewHeaders } from "./jev-client";
import { inferContentSignals, type ContentSignals, type FeedItem } from "@freed/shared";
import { buildJevRequest, type JevExperimentalSignals } from "./jev-classification";

export interface JevPreviewResponse {
  contentSignals: ContentSignals;
  experimentalSignals: JevExperimentalSignals;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  abstainedSignals?: readonly string[];
  cached: boolean;
  estimatedCostUsd: number;
  elapsedMs: number;
}

export interface JevPreviewBatchResult<TResponse> {
  item: FeedItem;
  status: "queued" | "running" | "success" | "failed" | "skipped" | "cancelled";
  response?: TResponse;
  error?: string;
}

export type JevPreviewResult = JevPreviewBatchResult<JevPreviewResponse>;

export interface JevPreviewDecision {
  sourceKey: string;
  contentSignals: ContentSignals;
  experimentalSignals?: JevExperimentalSignals;
}

/** Binds tab-local decisions to their exact evidence and synthetic identity. */
export function jevPreviewSourceKey(item: FeedItem): string | null {
  try {
    const fingerprint = item.sampleDataFingerprint;
    return JSON.stringify({
      globalId: item.globalId,
      authorId: item.author.id,
      fingerprint: fingerprint && {
        marker: fingerprint.marker, batchId: fingerprint.batchId,
        generatedAt: fingerprint.generatedAt, generatorVersion: fingerprint.generatorVersion,
      },
      request: buildJevRequest(item),
    });
  } catch {
    return null;
  }
}

interface BatchOptions<TResponse> {
  signal: AbortSignal;
  reclassify?: boolean;
  validate: (item: FeedItem) => unknown;
  classify: (item: FeedItem, signal: AbortSignal, reclassify: boolean) => Promise<TResponse>;
  apply: (item: FeedItem, response: TResponse) => Promise<unknown>;
  onUpdate: (results: readonly JevPreviewBatchResult<TResponse>[]) => void;
}

interface RunOptions {
  signal: AbortSignal;
  reclassify?: boolean;
  apply: (item: FeedItem, signals: ContentSignals) => Promise<unknown>;
  onUpdate: (results: readonly JevPreviewResult[]) => void;
  classify?: (
    item: FeedItem,
    signal: AbortSignal,
    reclassify: boolean,
  ) => Promise<JevPreviewResponse>;
}

class JevPreviewRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

const STOP_RUN_CODES = new Set([
  "key_missing", "jev_401", "preview_budget", "preview_unavailable", "jev_429", "jev_529",
]);

/** Both comparison modes preserve items outside the classifier's source boundary. */
export async function applyJevPreviewComparison(
  items: readonly FeedItem[],
  mode: "rules" | "jev",
  decisions: Readonly<Record<string, JevPreviewDecision>>,
  options: Pick<RunOptions, "signal" | "apply">,
): Promise<void> {
  for (const item of items) {
    if (options.signal.aborted) {
      throw new Error("Comparison stopped. The feed contains a mix of rules and Jev signals; choose a comparison again to finish applying it.");
    }
    try {
      buildJevRequest(item);
    } catch {
      // For example, an image-only story has no source text to reclassify.
      continue;
    }
    const decision = decisions[item.globalId];
    await options.apply(item, mode === "jev" && decision &&
      decision.sourceKey === jevPreviewSourceKey(item)
      ? decision.contentSignals : inferContentSignals(item));
  }
}

async function classifyItem(
  item: FeedItem,
  signal: AbortSignal,
  reclassify: boolean,
): Promise<JevPreviewResponse> {
  return postJevPreviewRequest("/api/jev-preview/classify", { item, reclassify }, signal);
}

/** Both fixed actions share native IPC or the private preview relay. */
export async function postJevPreviewRequest<TResponse>(
  path: "/api/jev-preview/classify" | "/api/jev-preview/match",
  request: unknown,
  signal: AbortSignal,
): Promise<TResponse> {
  if (isJevNative) {
    try {
      const nativeRequest = request as Parameters<typeof requestNativeJev>[1];
      await assertJevSourceCurrent(nativeRequest.item);
      signal.throwIfAborted();
      if (getJevClassifierProvider() === "kev") {
        if (path.endsWith("/match")) throw new Error("Capability matching requires an explicit switch to Jev.");
        const { requestLocalKev } = await import("./kev-client");
        return await requestLocalKev(nativeRequest.item, signal) as TResponse;
      }
      if (getJevClassifierProvider() === "gliclass-base") {
        if (path.endsWith("/match")) throw new Error("Capability matching currently requires Jev. Switch classifiers explicitly to use it.");
        const { requestLocalGliclass } = await import("./gliclass-client");
        return await requestLocalGliclass(nativeRequest.item, signal, Boolean((request as { reclassify?: boolean }).reclassify)) as TResponse;
      }
      return await requestNativeJev(path, nativeRequest, signal) as TResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Classifier request failed.";
      const abstention = getJevClassifierProvider() !== "jev" && /abstain|input limit|token limit/i.test(message);
      throw new JevPreviewRequestError(message, abstention ? "local_abstention" : "preview_unavailable", abstention ? 422 : 503);
    }
  }
  if (getJevClassifierProvider() !== "jev") throw new Error("Local classifiers require Freed Desktop. No cloud request was sent.");
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-freed-jev-preview": "1", ...await jevPreviewHeaders() },
    body: JSON.stringify(request),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new JevPreviewRequestError(
      typeof body?.error === "string"
        ? body.error
        : `Jev request failed (${response.status.toLocaleString()}).`,
      typeof body?.code === "string" ? body.code : "unknown",
      response.status,
    );
  }
  return body as TResponse;
}

/** Network work stays outside the library's serialized mutation queue. */
export async function runJevPreview(
  items: readonly FeedItem[],
  options: RunOptions,
): Promise<readonly JevPreviewResult[]> {
  return runJevPreviewBatch(items, {
    ...options,
    validate: buildJevRequest,
    classify: options.classify ?? classifyItem,
    apply: (item, response) => response.cached && JSON.stringify(item.contentSignals) === JSON.stringify(response.contentSignals)
      ? Promise.resolve() : options.apply(item, response.contentSignals),
  });
}

/** Shares bounded paid work and cancellation across classification and matching. */
export async function runJevPreviewBatch<TResponse>(
  items: readonly FeedItem[],
  options: BatchOptions<TResponse>,
): Promise<readonly JevPreviewBatchResult<TResponse>[]> {
  const results: JevPreviewBatchResult<TResponse>[] = items.map((item) => ({
    item,
    status: "queued",
  }));
  const classify = options.classify;
  const providerAtStart = getJevClassifierProvider();
  const controller = new AbortController();
  const cancelFromOwner = () => controller.abort(options.signal.reason);
  if (options.signal.aborted) cancelFromOwner();
  else options.signal.addEventListener("abort", cancelFromOwner, { once: true });
  const stopProviderListener = onJevClassifierProviderChange(() => controller.abort());
  let nextIndex = 0;
  const update = (index: number, change: Partial<JevPreviewBatchResult<TResponse>>) => {
    results[index] = { ...results[index], ...change };
    options.onUpdate([...results]);
  };
  options.onUpdate([...results]);

  async function worker() {
    while (!controller.signal.aborted && nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      try {
        options.validate(item);
      } catch (error) {
        update(index, {
          status: "skipped",
          error: error instanceof Error ? error.message : "This item has no usable source text.",
        });
        continue;
      }
      update(index, { status: "running" });
      try {
        if (getJevClassifierProvider() !== providerAtStart) { controller.abort(); break; }
        const response = await classify(item, controller.signal, options.reclassify ?? false);
        // Keep metered usage even if cancellation or a stale library edit prevents applying it.
        update(index, { response });
        if (controller.signal.aborted) {
          update(index, { status: "cancelled" });
          continue;
        }
        await options.apply(item, response);
        update(index, { status: "success" });
      } catch (error) {
        const stopRun = !controller.signal.aborted && error instanceof JevPreviewRequestError &&
          (STOP_RUN_CODES.has(error.code) || error.status === 401);
        update(index, {
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: controller.signal.aborted
            ? undefined
            : (error instanceof Error ? error.message : "Classification failed.") +
              (stopRun ? " The run stopped and remaining requests were cancelled." : ""),
        });
        // A host-wide failure cannot be fixed by asking the same question hundreds more times.
        // Stop siblings through our own signal without changing the caller's controller.
        if (stopRun) controller.abort();
      }
    }
  }

  try {
    const concurrency = getJevClassifierProvider() === "jev" ? 4 : 1;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    for (let index = nextIndex; index < results.length; index += 1) {
      results[index] = { ...results[index], status: "cancelled" };
    }
    options.onUpdate([...results]);
    return results;
  } finally {
    options.signal.removeEventListener("abort", cancelFromOwner);
    stopProviderListener();
  }
}
