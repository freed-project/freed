import { createHash, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const deriveCacheKey = promisify(scrypt);
import { setTimeout as delay } from "node:timers/promises";

const PREFIX = "/api/jev-preview/";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_CONCURRENCY = 4;
const MAX_ATTEMPTS = 2_000;
const DEADLINE_MS = 30_000;
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";


function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function failure(response, status, code, error) {
  if (!response.destroyed) json(response, status, { code, error });
}

function isLocalRequest(request) {
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  try {
    const url = new URL(`http://${host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
    const origin = request.headers.origin;
    return !origin || origin === url.origin;
  } catch {
    return false;
  }
}

function readJsonBody(request, signal) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (error) => {
      cleanup();
      // Stop buffering this body. The caller closes this request's connection
      // after sending its error response, without retaining a pending reader.
      request.pause();
      reject(error);
    };
    const onError = (error) => fail(error);
    const onAborted = () => fail(new Error("request_aborted"));
    const onAbort = () => fail(new Error("body_deadline"));
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) return fail(new Error("body_limit"));
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    };
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function readBoundedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_response");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("response_limit");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** A narrow, local development endpoint, never a general credentialed proxy. */
export function createJevPreviewMiddleware({
  loadContract,
  getApiKey = async (request) => {
    const value = request.headers.authorization;
    return typeof value === "string" && /^Bearer [\x21-\x7e]{1,4096}$/.test(value) ? value.slice(7) : "";
  },
  fetchImpl = globalThis.fetch,
  wait = delay,
  deadlineMs = DEADLINE_MS,
  maxAttempts = MAX_ATTEMPTS,
}) {
  let active = 0;
  let attempts = 0;
  const cache = new Map();
  const cacheSalt = randomBytes(32);

  return async (request, response, next) => {
    const path = request.url?.split("?")[0];
    if (!path?.startsWith(PREFIX)) return next();
    if (!isLocalRequest(request)) {
      return failure(response, 403, "local_only", "Open this preview on localhost.");
    }
    const isMatch = path === `${PREFIX}match`;
    if (path !== `${PREFIX}status` && path !== `${PREFIX}classify` && !isMatch) {
      return failure(response, 404, "not_found", "Unknown preview endpoint.");
    }
    try {
      const contract = await loadContract();
      const apiKey = await getApiKey(request);
      if (path === `${PREFIX}status` && request.method === "GET") {
        return json(response, 200, {
          configured: Boolean(apiKey),
          model: contract.JEV_MODEL,
          questionPackVersion: contract.JEV_QUESTION_PACK_VERSION,
          contextQuestionPackVersion: contract.JEV_CONTEXT_QUESTION_PACK_VERSION,
          inputUsdPerMillion: contract.JEV_INPUT_USD_PER_MILLION,
          maxConcurrency: MAX_CONCURRENCY,
          attemptsRemaining: Math.max(0, maxAttempts - attempts),
        });
      }
      if ((path !== `${PREFIX}classify` && !isMatch) || request.method !== "POST") {
        return failure(response, 405, "method", "Use the preview classification controls.");
      }
      if (request.headers["x-freed-jev-preview"] !== "1" ||
          !request.headers["content-type"]?.startsWith("application/json")) {
        return failure(response, 403, "request_header", "Invalid preview request.");
      }
      if (!apiKey) {
        return failure(response, 503, "key_missing", "The Jev key is not configured in AI settings.");
      }
      if (active >= MAX_CONCURRENCY) {
        return failure(response, 429, "preview_busy", "The preview already has four requests in flight.");
      }
      // Admission is synchronous before reading a body, so concurrent requests
      // cannot all observe the same free slot and exceed the transport bound.
      active += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadlineMs);
      const disconnect = () => { if (!response.writableEnded) controller.abort(); };
      response.once("close", disconnect);
      try {
        let body;
        let payload;
        const questionPackVersion = isMatch
          ? contract.JEV_CONTEXT_QUESTION_PACK_VERSION : contract.JEV_QUESTION_PACK_VERSION;
        try {
          body = await readJsonBody(request, controller.signal);
          if (body?.item?.sampleDataFingerprint?.marker !== "freed.sample-data.v1" ||
              typeof body.item.globalId !== "string") {
            return failure(response, 422, "sample_only", "Only sample Library items can be classified in this preview.");
          }
          payload = isMatch
            ? contract.buildJevMatchRequest(body.item, body.capabilities)
            : contract.buildJevRequest(body.item);
        } catch {
          // An incomplete or oversized body must not keep its connection alive
          // after the admission slot is released. Flush the error first.
          response.shouldKeepAlive = false;
          response.once("finish", () => request.destroy());
          controller.signal.throwIfAborted();
          return failure(response, 422, "invalid_item", isMatch
            ? "Use a sample with source text and declare one to eight nonblank capabilities, each at most 120 characters."
            : "This sample has no usable text or exceeds the preview request limit.");
        }
        const serialized = JSON.stringify(payload);
        // Partition cached responses by credential without retaining the key or
        // a fast credential hash. Admission also bounds concurrent derivations.
        const requestSalt = createHash("sha256")
          .update(cacheSalt).update(questionPackVersion).update(serialized).digest();
        const cacheKey = (await deriveCacheKey(apiKey, requestSalt, 32)).toString("hex");
        controller.signal.throwIfAborted();
        if (body.reclassify !== true && cache.has(cacheKey)) {
          const result = cache.get(cacheKey);
          return json(response, 200, { ...result, cached: true, estimatedCostUsd: 0, elapsedMs: 0 });
        }
        const started = performance.now();
        for (let attempt = 0; attempt < 2; attempt += 1) {
          controller.signal.throwIfAborted();
          if (attempts >= maxAttempts) {
            return failure(response, 429, "preview_budget", "The preview request budget is exhausted. Restart the preview for another run.");
          }
          attempts += 1;
          const upstream = await fetchImpl(ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: serialized,
            signal: controller.signal,
            redirect: "error",
          });
          if ((upstream.status === 429 || upstream.status === 529) && attempt === 0) {
            const retryAfter = upstream.headers.get("retry-after");
            const seconds = Number(retryAfter);
            const waitMs = retryAfter && Number.isFinite(seconds)
              ? Math.max(1_000, seconds * 1_000)
              : retryAfter && Number.isFinite(Date.parse(retryAfter))
                ? Math.max(1_000, Date.parse(retryAfter) - Date.now())
                : 1_000;
            await upstream.body?.cancel();
            if (waitMs >= deadlineMs - (performance.now() - started)) {
              return failure(response, 502, `jev_${upstream.status}`,
                "Jev requested a retry delay beyond this preview's deadline. Retry later.");
            }
            // Do not retry earlier than a provider-requested delay. The total
            // deadline includes both attempts and the intervening backoff.
            await wait(waitMs, undefined, { signal: controller.signal });
            continue;
          }
          if (!upstream.ok) {
            await upstream.body?.cancel();
            return failure(response, upstream.status === 401 ? 401 : 502,
              `jev_${upstream.status}`, upstream.status === 401
                ? "Jev rejected the API key."
                : `Jev returned HTTP ${upstream.status}. Retry this sample later.`);
          }
          let parsed;
          try {
            const upstreamBody = await readBoundedResponse(upstream);
            parsed = isMatch
              ? contract.parseJevMatchResponse(upstreamBody, payload.state.capabilities.length)
              : contract.parseJevResponse(upstreamBody);
          } catch {
            controller.signal.throwIfAborted();
            return failure(response, 502, "invalid_response", "Jev returned an invalid classification response. No scores were applied.");
          }
          controller.signal.throwIfAborted();
          const result = {
            ...parsed,
            questionPackVersion,
            cached: false,
            estimatedCostUsd: parsed.usage.input_tokens * contract.JEV_INPUT_USD_PER_MILLION / 1_000_000,
            elapsedMs: Math.round(performance.now() - started),
          };
          if (cache.size >= 500) cache.delete(cache.keys().next().value);
          cache.set(cacheKey, result);
          return json(response, 200, result);
        }
      } catch {
        failure(response, controller.signal.aborted ? 504 : 502,
          controller.signal.aborted ? "deadline" : "transport",
          controller.signal.aborted ? "Jev classification stopped or timed out."
            : "Could not reach Jev. No scores were applied.");
      } finally {
        clearTimeout(timer);
        response.off("close", disconnect);
        active -= 1;
      }
    } catch {
      failure(response, 500, "preview_unavailable", "The Jev preview endpoint could not initialize.");
    }
  };
}

export function jevPreviewPlugin() {
  return {
    name: "jev-classification-preview",
    apply: "serve",
    configureServer(server) {
      if (process.env.VITE_TEST_TAURI !== "1" || process.env.VITE_FREED_FEATURE_PREVIEW !== "1") return;
      server.middlewares.use(createJevPreviewMiddleware({
        loadContract: () => server.ssrLoadModule("/src/lib/jev-classification.ts"),
      }));
    },
  };
}
