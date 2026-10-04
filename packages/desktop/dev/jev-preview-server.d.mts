import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

export function jevPreviewPlugin(): Plugin;
export function createJevPreviewMiddleware(options: {
  loadContract: () => Promise<object>;
  getApiKey?: (request: IncomingMessage) => Promise<string>;
  fetchImpl?: typeof fetch;
  wait?: (ms: number, value?: undefined, options?: { signal: AbortSignal }) => Promise<unknown>;
  deadlineMs?: number;
  maxAttempts?: number;
}): (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;
