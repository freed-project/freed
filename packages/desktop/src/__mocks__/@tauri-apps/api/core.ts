/**
 * Mock for @tauri-apps/api/core used when VITE_TEST_TAURI=1.
 *
 * invoke() dispatches to a handler registry so individual tests can override
 * specific commands via window.__TAURI_MOCK_SET_HANDLER__. Unknown commands
 * return undefined (most callers already handle missing/null responses).
 */

type InvokeHandler = (args: unknown) => unknown;

// Global handler registry keyed by command name. Tests may populate this
// via window.__TAURI_MOCK_SET_HANDLER__ injected by addInitScript.
const handlers: Map<string, InvokeHandler> = new Map();

// Expose registry manipulation and invoke directly on window so Playwright
// tests can interact with the IPC layer via page.evaluate() without needing
// to dynamic-import Vite-aliased modules (which the browser can't resolve).
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_SET_HANDLER__ = (
    cmd: string,
    fn: InvokeHandler,
  ) => handlers.set(cmd, fn);

  (window as unknown as Record<string, unknown>).__TAURI_MOCK_CLEAR_HANDLERS__ =
    () => handlers.clear();

  // Direct invoke access for tests — mirrors the module-level invoke() above.
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_INVOKE__ = invoke;
}

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  const handler = handlers.get(cmd);
  if (handler) return handler(args) as T;
  // Default: silent no-op. Callers that need a specific shape must register a
  // handler. Silently returning undefined matches the behaviour of a Tauri
  // command that returns () (unit).
  return undefined as T;
}

/** Always false in the test environment — we're running in plain Chromium. */
export function isTauri(): boolean {
  return true; // Pretend we are Tauri so desktop-specific code paths run.
}
