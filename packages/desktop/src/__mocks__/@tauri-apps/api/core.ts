/**
 * Mock for @tauri-apps/api/core
 *
 * Activated when VITE_TEST_TAURI=1 is set. Each invoke() call is routed
 * through a per-command handler map so individual tests can override responses
 * without touching global state. All calls are recorded in
 * window.__TAURI_MOCK_INVOCATIONS__ for assertion.
 */

type Handler = (args: Record<string, unknown>) => unknown;

type MockInternals = {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  transformCallback?: (callback: unknown, once?: boolean) => number;
  unregisterCallback?: (id: number) => void;
  callbacks?: Record<number, unknown>;
  metadata?: {
    currentWindow: { label: string };
    currentWebview: { label: string };
  };
  convertFileSrc?: (filePath: string, protocol?: string) => string;
  plugins?: {
    path: {
      sep: string;
      delimiter: string;
    };
  };
};

type PluginEventRecord = {
  event: string;
  callbackId: number;
};

/**
 * Route an HTTP request through the Vite dev server proxy so it can make
 * real network calls server-side, bypassing CORS. Mirrors what the Rust
 * x_api_request / fetch_url commands do in the real Tauri backend.
 */
async function proxyFetch(args: Record<string, unknown>): Promise<string> {
  const resp = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: args.url,
      headers: args.headers ?? {},
      method: args.method ?? "GET",
      body: args.body ?? "",
    }),
  });
  if (!resp.ok) throw new Error(`Proxy ${resp.status}: ${await resp.text()}`);
  return resp.text();
}

async function proxyFetchBinary(args: Record<string, unknown>): Promise<number[]> {
  const resp = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: args.url,
      headers: args.headers ?? {},
      method: args.method ?? "GET",
      body: args.body ?? "",
    }),
  });
  if (!resp.ok) throw new Error(`Proxy ${resp.status}: ${await resp.text()}`);
  return Array.from(new Uint8Array(await resp.arrayBuffer()));
}

/** Default handlers for every command the app calls on startup. */
const handlers: Record<string, Handler> = {
  broadcast_doc: () => null,
  fetch_url: (args: Record<string, unknown>) => proxyFetch({ url: args.url, method: "GET" }),
  fetch_binary_url: (args: Record<string, unknown>) => proxyFetchBinary({ url: args.url, method: "GET" }),
  x_api_request: (args: Record<string, unknown>) => proxyFetch(args),
  get_local_ip: () => "127.0.0.1",
  get_all_local_ips: () => [],
  get_sync_url: () => "ws://127.0.0.1:8765",
  get_sync_client_count: () => 0,
  get_runtime_memory_stats: () => ({
    processResidentBytes: 64 * 1024 * 1024,
    processVirtualBytes: 256 * 1024 * 1024,
    webkitResidentBytes: 96 * 1024 * 1024,
    webkitVirtualBytes: 512 * 1024 * 1024,
    webkitProcessId: 12345,
    webkitTelemetryAvailable: true,
    indexedDbBytes: 8 * 1024 * 1024,
    webkitCacheBytes: 16 * 1024 * 1024,
    relayDocBytes: 0,
    relayClientCount: 0,
  }),
  get_updater_target: () => "darwin-aarch64",
  retry_startup_after_crash: () => null,
  reset_pairing_token: () => null,
  get_recent_logs: () => [],
  start_relay: () => null,
  stop_relay: () => null,
  list_snapshots: () => [],
  save_url_content: () => null,
  get_x_cookies: () => null,
  open_x_login_window: () => null,
  check_x_login_cookies: () => ({ status: "closed" }),
  close_x_login_window: () => null,
  pick_contact: () => null,
  fb_show_login: () => null,
  fb_hide_login: () => null,
  fb_check_auth: () => true,
  fb_scrape_feed: () => null,
  fb_scrape_groups: () => [],
  fb_scrape_comments: () => null,
  fb_disconnect: () => null,
  ig_show_login: () => null,
  ig_hide_login: () => null,
  ig_check_auth: () => true,
  ig_scrape_feed: () => null,
  ig_scrape_comments: () => null,
  ig_disconnect: () => null,
  li_show_login: () => null,
  li_hide_login: () => null,
  li_check_auth: () => true,
  li_scrape_feed: () => null,
  li_disconnect: () => null,
};

// Expose handler map so tests and tauri-init.ts can override defaults.
(window as unknown as Record<string, unknown>).__TAURI_MOCK_HANDLERS__ = handlers;
// Append-only log of every invoke() call for test assertions.
(window as unknown as Record<string, unknown>).__TAURI_MOCK_INVOCATIONS__ = [] as Array<{
  cmd: string;
  args: Record<string, unknown> | undefined;
}>;

const callbackStore = (
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_CALLBACKS__ ??
  ((window as unknown as Record<string, unknown>).__TAURI_MOCK_CALLBACKS__ = {})
) as Record<number, unknown>;
const pluginEventListeners = (
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__ ??
  ((window as unknown as Record<string, unknown>).__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__ = {})
) as Record<number, PluginEventRecord>;

const tauriInternals = (
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ ??
  ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {})
) as MockInternals;

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  (
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_INVOCATIONS__ as Array<{
      cmd: string;
      args: typeof args;
    }>
  ).push({ cmd, args });
  const handler =
    (
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_HANDLERS__ as Record<
        string,
        Handler
      >
    )[cmd] ?? (() => null);
  return (await handler(args ?? {})) as T;
}

let nextCallbackId = 1;
let nextPluginEventId = 1;

tauriInternals.invoke = invoke;
tauriInternals.transformCallback = (callback: unknown) => {
  const id = nextCallbackId++;
  callbackStore[id] = callback;
  return id;
};
tauriInternals.unregisterCallback = (id: number) => {
  delete callbackStore[id];
};
tauriInternals.callbacks = callbackStore;
tauriInternals.metadata = tauriInternals.metadata ?? {
  currentWindow: { label: "main" },
  currentWebview: { label: "main" },
};
tauriInternals.convertFileSrc =
  tauriInternals.convertFileSrc ?? ((filePath: string) => filePath);
tauriInternals.plugins = tauriInternals.plugins ?? {
  path: {
    sep: "/",
    delimiter: ":",
  },
};

(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener(event: string, eventId: number) {
    const record = pluginEventListeners[eventId];
    if (record?.event === event) {
      delete pluginEventListeners[eventId];
    }
  },
};

const baseInvoke = tauriInternals.invoke;
tauriInternals.invoke = async <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  if (cmd === "plugin:event|listen") {
    const eventId = nextPluginEventId++;
    pluginEventListeners[eventId] = {
      event: String(args?.event ?? ""),
      callbackId: Number(args?.handler ?? 0),
    };
    return eventId as T;
  }

  if (cmd === "plugin:event|unlisten") {
    const eventId = Number(args?.eventId ?? 0);
    delete pluginEventListeners[eventId];
    return null as T;
  }

  if (cmd === "plugin:event|emit" || cmd === "plugin:event|emit_to") {
    const eventName = String(args?.event ?? "");
    const payload = args?.payload;
    for (const [eventId, record] of Object.entries(pluginEventListeners)) {
      if (record.event !== eventName) continue;
      const callback = callbackStore[record.callbackId] as
        | ((event: { event: string; id: number; payload: unknown; windowLabel: string }) => void)
        | undefined;
      callback?.({
        event: eventName,
        id: Number(eventId),
        payload,
        windowLabel: "main",
      });
    }
    return null as T;
  }

  return baseInvoke<T>(cmd, args);
};

export function isTauri(): boolean {
  return false;
}
