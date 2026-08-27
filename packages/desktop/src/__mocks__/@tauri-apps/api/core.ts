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
  invoke?: <T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
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

function mockArray<T>(name: string): T[] {
  const w = window as unknown as Record<string, unknown>;
  if (!Array.isArray(w[name])) {
    w[name] = [] as T[];
  }
  return w[name] as T[];
}

function setMockYouTubeWindowVisible(visible: boolean): null {
  (
    window as unknown as Record<string, unknown>
  ).__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = visible;
  return null;
}

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

async function proxyFetchBinary(
  args: Record<string, unknown>,
): Promise<number[]> {
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

// Mirrors the real command: bodies cross the IPC boundary as base64, never as
// a JSON number array. See NativeHttpResponse in src-tauri/src/lib.rs.
function mockBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function mockBase64ToBytes(encoded: string): Uint8Array {
  if (!encoded) return new Uint8Array(0);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function proxyGoogleDriveRequest(args: Record<string, unknown>): Promise<{
  status: number;
  headers: Array<[string, string]>;
  bodyB64: string;
}> {
  const requestBody =
    typeof args.bodyB64 === "string"
      ? Array.from(mockBase64ToBytes(args.bodyB64))
      : [];
  const resp = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: args.url,
      headers: args.headers ?? [],
      method: args.method ?? "GET",
      body: requestBody,
    }),
  });
  return {
    status: resp.status,
    headers: Array.from(resp.headers.entries()),
    bodyB64: mockBytesToBase64(new Uint8Array(await resp.arrayBuffer())),
  };
}

async function proxyNativeHttpRequest(args: Record<string, unknown>): Promise<{
  status: number;
  headers: Array<[string, string]>;
  body: number[];
}> {
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
  return {
    status: resp.status,
    headers: Array.from(resp.headers.entries()),
    body: Array.from(new Uint8Array(await resp.arrayBuffer())),
  };
}

type MockSqliteItem = Record<string, unknown> & {
  globalId: string;
  platform?: string;
  author?: { id?: string };
  rssSource?: { feedUrl?: string };
  userState?: Record<string, unknown>;
  __deleted?: boolean;
};

type MockSqliteLibrary = {
  active: boolean;
  revision: number;
  sourceGeneration: number;
  sourceRevision: number;
  sourceDigest: string;
  expectedItemCount: number;
  shell: Record<string, unknown>;
  items: Record<string, MockSqliteItem>;
  writerAdmission?: {
    configured: boolean;
    allowed: boolean;
    localWriterId: string | null;
    activeWriterId: string | null;
    storageEpoch: string | null;
    controlRevision: string | null;
    verifiedAtMs: number | null;
  };
};

function sqliteLibrary(): MockSqliteLibrary {
  const w = window as unknown as {
    __TAURI_MOCK_SQLITE_LIBRARY__?: MockSqliteLibrary;
  };
  w.__TAURI_MOCK_SQLITE_LIBRARY__ ??= {
    active: false,
    revision: 0,
    sourceGeneration: 0,
    sourceRevision: 0,
    sourceDigest: "",
    expectedItemCount: 0,
    shell: {},
    items: {},
  };
  return w.__TAURI_MOCK_SQLITE_LIBRARY__;
}

function sqliteItemUserState(item: MockSqliteItem): Record<string, unknown> {
  item.userState ??= {};
  return item.userState;
}

function sqliteFacetSummary() {
  const items = Object.values(sqliteLibrary().items).filter(
    (item) => !item.__deleted,
  );
  const tags = new Set<string>();
  for (const item of items) {
    for (const tag of (sqliteItemUserState(item).tags as
      string[] | undefined) ?? []) {
      tags.add(tag);
    }
  }
  return {
    archivedCount: items.filter((item) =>
      Boolean(sqliteItemUserState(item).archived),
    ).length,
    sampleItemCount: items.filter((item) => Boolean(item.sampleData)).length,
    savedArchivedCount: items.filter((item) => {
      const user = sqliteItemUserState(item);
      return Boolean(user.saved) && Boolean(user.archived);
    }).length,
    savedCount: items.filter((item) => Boolean(sqliteItemUserState(item).saved))
      .length,
    savedPlatformCount: new Set(
      items
        .filter((item) => Boolean(sqliteItemUserState(item).saved))
        .map((item) => item.platform),
    ).size,
    tags: [...tags].sort(),
    totalCount: items.length,
  };
}

function normalizedLibraryCloudIdentity(): Record<string, unknown> {
  const state = sqliteLibrary();
  const items = Object.values(state.items).filter((item) => !item.__deleted);
  return {
    format: "freed_normalized_checkpoint_export_v2",
    protocolVersion: 2,
    libraryId: "2".repeat(64),
    authorityEpoch: "3".repeat(64),
    writerId: "6".repeat(64),
    sourceRevision: state.sourceRevision,
    causalFrontierDigest: "a".repeat(64),
    recordCount: items.length + 1,
    itemCount: items.length,
    localActorId: "6".repeat(64),
  };
}

/** Default handlers for every command the app calls on startup. */
const handlers: Record<string, Handler> = {
  ensure_fresh_normalized_desktop_library: () => {
    sqliteLibrary().active = true;
    return true;
  },
  sqlite_library_status: () => {
    const state = sqliteLibrary();
    return state.active
      ? {
          active: true,
          revision: state.revision,
          expectedItemCount: state.expectedItemCount,
          importedItemCount: Object.keys(state.items).length,
          sourceGeneration: state.sourceGeneration,
          sourceRevision: state.sourceRevision,
          sourceDigest: state.sourceDigest,
        }
      : null;
  },
  describe_normalized_library_cloud_identity: normalizedLibraryCloudIdentity,
  read_sqlite_library_facet_summary: sqliteFacetSummary,
  set_sqlite_library_cloud_writer_admission: (
    args: Record<string, unknown>,
  ) => {
    const request = args.request as {
      localWriterId: string;
      activeWriterId: string;
      storageEpoch: string;
      controlRevision: string;
      verifiedAtMs: number;
    };
    const admission = {
      configured: true,
      allowed: request.localWriterId === request.activeWriterId,
      localWriterId: request.localWriterId,
      activeWriterId: request.activeWriterId,
      storageEpoch: request.storageEpoch,
      controlRevision: request.controlRevision,
      verifiedAtMs: request.verifiedAtMs,
    };
    sqliteLibrary().writerAdmission = admission;
    return admission;
  },
  sqlite_library_cloud_writer_admission_status: () =>
    sqliteLibrary().writerAdmission ?? {
      configured: false,
      allowed: true,
      localWriterId: null,
      activeWriterId: null,
      storageEpoch: null,
      controlRevision: null,
      verifiedAtMs: null,
    },
  normalized_library_follower_runtime_status: () => ({
    state: "awaiting_checkpoint",
    libraryId: null,
    authorityEpochId: null,
    actorId: null,
    checkpointGeneration: null,
    sourceRevision: null,
    pendingIntentCount: 0,
    publishedIntentCount: 0,
    importedResultCount: 0,
  }),
  normalized_library_follower_transport_context: () => ({
    actorId: "11".repeat(32),
    libraryId: "22".repeat(32),
    nextIntentActorCounter: 1,
    nextResultSequence: 1,
    previousIntentSegmentDigest: null,
    previousResultSegmentDigest: null,
    schemaVersion: 2,
    storageEpochId: "33".repeat(32),
  }),
  page_normalized_library_follower_transport: (
    args: Record<string, unknown>,
  ) => {
    const page = (args.page ?? {}) as Record<string, unknown>;
    return {
      actorId: page.actorId,
      canonicalEnvelopes: [],
      done: true,
      firstActorCounter: page.firstActorCounter,
      lastActorCounter: null,
      schemaVersion: 2,
    };
  },
  record_normalized_library_follower_intent_transport_publication: (
    args: Record<string, unknown>,
  ) => {
    const publication = (args.publication ?? {}) as Record<string, unknown>;
    return {
      actorId: publication.actorId,
      firstActorCounter: publication.firstActorCounter,
      lastActorCounter: publication.lastActorCounter,
      newlyPublishedTransactionCount: 1,
      nextActorCounter: Number(publication.lastActorCounter) + 1,
      publishedAt: publication.publishedAt,
      semanticSegmentDigest: publication.semanticSegmentDigest,
      storedSegmentDigest: publication.storedSegmentDigest,
    };
  },
  import_normalized_library_follower_result_transport_segment: (
    args: Record<string, unknown>,
  ) => {
    const publication = (args.publication ?? {}) as Record<string, unknown>;
    const records = Array.isArray(publication.records)
      ? publication.records
      : [];
    return {
      acceptedTransactionCount: records.length,
      actorId: publication.actorId,
      firstResultSequence: 1,
      lastResultSequence: records.length,
      nextResultSequence: records.length + 1,
      receivedAt: publication.receivedAt,
      rejectedTransactionCount: 0,
      resultCount: records.length,
      semanticSegmentDigest: publication.semanticSegmentDigest,
      storedSegmentDigest: publication.storedSegmentDigest,
    };
  },
  fetch_url: (args: Record<string, unknown>) =>
    proxyFetch({ url: args.url, method: "GET" }),
  google_api_request: (args: Record<string, unknown>) =>
    proxyNativeHttpRequest({
      url: args.url,
      method: "GET",
      headers: { Authorization: `Bearer ${String(args.accessToken ?? "")}` },
    }),
  google_oauth_proxy_request: (args: Record<string, unknown>) =>
    proxyNativeHttpRequest({
      url: args.url,
      method: "POST",
      headers: {
        "Content-Type": String(args.contentType ?? "application/json"),
      },
      body: args.body,
    }),
  google_drive_request: (args: Record<string, unknown>) =>
    proxyGoogleDriveRequest(args),
  fetch_binary_url: (args: Record<string, unknown>) =>
    proxyFetchBinary({ url: args.url, method: "GET" }),
  x_api_request: (args: Record<string, unknown>) => proxyFetch(args),
  sha256_file: () => "",
  download_local_ai_model_file: (args: Record<string, unknown>) => {
    const request = args.request as { expectedSizeBytes?: number } | undefined;
    return request?.expectedSizeBytes ?? 0;
  },
  cancel_local_ai_model_download: () => null,
  get_desktop_session_state: () =>
    (
      window as unknown as {
        __TAURI_MOCK_DESKTOP_SESSION_STATE__?: {
          available: boolean;
          screenLocked: boolean;
          error?: string | null;
        };
      }
    ).__TAURI_MOCK_DESKTOP_SESSION_STATE__ ?? {
      available: true,
      screenLocked: false,
      error: null,
    },
  get_provider_sync_runtime_eligibility: () => {
    const session = handlers.get_desktop_session_state({}) as {
      available: boolean;
      screenLocked: boolean;
    };
    return {
      available: session.available,
      eligible: !session.available || !session.screenLocked,
      reason:
        session.available && session.screenLocked ? "screen_locked" : null,
    };
  },
  replace_provider_schedule_wake: (args: Record<string, unknown>) => {
    (
      window as unknown as Record<string, unknown>
    ).__TAURI_MOCK_PROVIDER_SCHEDULE_WAKE__ = args.wake ?? null;
    return null;
  },
  get_background_runtime_active_operation: () => ({
    operation: null,
    ageMs: null,
  }),
  get_runtime_memory_stats: () => ({
    totalPhysicalMemoryBytes: 16 * 1024 * 1024 * 1024,
    processResidentBytes: 64 * 1024 * 1024,
    processFootprintBytes: 64 * 1024 * 1024,
    processVirtualBytes: 256 * 1024 * 1024,
    appResidentBytes: 160 * 1024 * 1024,
    appMemoryPressureBytes: 160 * 1024 * 1024,
    webkitResidentBytes: 96 * 1024 * 1024,
    webkitFootprintBytes: 96 * 1024 * 1024,
    webkitVirtualBytes: 512 * 1024 * 1024,
    webkitProcessId: 12345,
    webkitTotalResidentBytes: 96 * 1024 * 1024,
    webkitTotalFootprintBytes: 96 * 1024 * 1024,
    webkitProcessCount: 1,
    webkitLargestResidentBytes: 96 * 1024 * 1024,
    webkitLargestFootprintBytes: 96 * 1024 * 1024,
    webkitLargestProcessId: 12345,
    webkitLargestCpuUsage: 0,
    webkitLargestAgeSeconds: 10,
    webkitLargestRole: "freed-webcontent",
    webkitProcesses: [
      {
        processId: 12345,
        residentBytes: 96 * 1024 * 1024,
        footprintBytes: 96 * 1024 * 1024,
        virtualBytes: 512 * 1024 * 1024,
        cpuUsage: 0,
        ageSeconds: 10,
        role: "freed-webcontent",
      },
    ],
    webkitTelemetryAvailable: true,
    webkitAttributionPrecise: true,
    indexedDbBytes: 8 * 1024 * 1024,
    webkitCacheBytes: 16 * 1024 * 1024,
    storageSizesSampled: true,
    sampleDurationMs: 1,
    memoryHighBytes: 2508 * 1024 * 1024,
    memoryCriticalBytes: 3584 * 1024 * 1024,
    relayDocBytes: 0,
    relayClientCount: 0,
  }),
  trim_webkit_network_cache_now: () => ({
    beforeBytes: 16 * 1024 * 1024,
    afterBytes: 16 * 1024 * 1024,
    cacheTrimmed: false,
  }),
  get_ai_hardware_profile: (args: Record<string, unknown>) => ({
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    availableMemoryBytes: 10 * 1024 * 1024 * 1024,
    availableAppDataBytes: 64 * 1024 * 1024 * 1024,
    os: "macos",
    arch: "aarch64",
    webGPUAvailable: Boolean(args.webGpuAvailable),
  }),
  prepare_social_scrape_memory: () => {
    const after = handlers.get_runtime_memory_stats({});
    return {
      before: after,
      after,
      recycledScraperWindows: false,
      cacheTrimmed: false,
      scraperRecycleVerification: null,
      mayProceed: true,
    };
  },
  get_desktop_installation_witness: () => "a".repeat(64),
  get_updater_target: () => "darwin-aarch64",
  retry_startup_after_crash: () => null,
  export_startup_diagnostics: () =>
    "/Users/test/Downloads/freed-diagnostics-test.json",
  clear_factory_reset_runtime_artifacts: () => null,
  get_recent_logs: () => [],
  show_window: () => null,
  list_snapshots: () => [],
  save_url_content: () => null,
  get_x_cookies: () => null,
  open_x_login_window: () => null,
  check_x_login_cookies: () => ({ status: "closed" }),
  close_x_login_window: () => null,
  pick_contact: () => null,
  get_social_provider_cookie_state: (args?: { provider?: string }) => ({
    provider: args?.provider ?? "facebook",
    ...(((
      window as unknown as {
        __TAURI_MOCK_SOCIAL_COOKIE_STATES__?: Record<string, unknown>;
      }
    ).__TAURI_MOCK_SOCIAL_COOKIE_STATES__?.[args?.provider ?? "facebook"] as
      Record<string, unknown> | undefined) ?? {
      available: false,
      hasAuthCookie: false,
      cookieCount: 0,
      cookieNames: [],
      error: null,
    }),
  }),
  fb_show_login: () => null,
  fb_hide_login: () => null,
  fb_check_auth: () => true,
  fb_scrape_feed: () => null,
  fb_scrape_groups: () => [],
  fb_check_group_membership: (args?: {
    groupId?: string;
    groupUrl?: string;
  }) => ({
    id: args?.groupId ?? "",
    url: args?.groupUrl ?? "",
    name: null,
    stillJoined: null,
    reason: "mock membership control not found",
    checkedAt: Date.now(),
  }),
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
  substack_show_login: () => null,
  substack_hide_login: () => null,
  substack_check_auth: () => true,
  substack_disconnect: () => null,
  substack_scrape_graph: () => null,
  substack_scrape_activity: () => null,
  substack_scrape_essays: () => null,
  medium_show_login: () => null,
  medium_hide_login: () => null,
  medium_check_auth: () => true,
  medium_disconnect: () => null,
  medium_scrape_graph: () => null,
  medium_scrape_activity: () => null,
  medium_scrape_essays: () => null,
  yt_show_login: () => setMockYouTubeWindowVisible(true),
  yt_hide_login: () => setMockYouTubeWindowVisible(false),
  yt_check_auth: () => true,
  yt_capture: () => setMockYouTubeWindowVisible(false),
  yt_add_to_offline_playlist: () => setMockYouTubeWindowVisible(false),
  yt_disconnect: () => setMockYouTubeWindowVisible(false),
  // The init script runs before the Vite module graph and owns persistent or
  // test-specific handlers. Keep those overrides last so this module's
  // convenient defaults cannot silently replace them.
  ...(((window as unknown as Record<string, unknown>).__TAURI_MOCK_HANDLERS__ ??
    {}) as Record<string, Handler>),
};

// Expose handler map so tests and tauri-init.ts can override defaults.
(window as unknown as Record<string, unknown>).__TAURI_MOCK_HANDLERS__ =
  handlers;
// Append-only log of every invoke() call for test assertions.
(window as unknown as Record<string, unknown>).__TAURI_MOCK_INVOCATIONS__ =
  [] as Array<{
    cmd: string;
    args: Record<string, unknown> | undefined;
  }>;
(
  window as unknown as Record<string, unknown>
).__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = false;

const callbackStore = ((window as unknown as Record<string, unknown>)
  .__TAURI_MOCK_CALLBACKS__ ??
  ((window as unknown as Record<string, unknown>).__TAURI_MOCK_CALLBACKS__ =
    {})) as Record<number, unknown>;
const pluginEventListeners = ((window as unknown as Record<string, unknown>)
  .__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__ ??
  ((
    window as unknown as Record<string, unknown>
  ).__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__ = {})) as Record<
  number,
  PluginEventRecord
>;

const tauriInternals = ((window as unknown as Record<string, unknown>)
  .__TAURI_INTERNALS__ ??
  ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ =
    {})) as MockInternals;

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  mockArray<{ cmd: string; args: typeof args }>(
    "__TAURI_MOCK_INVOCATIONS__",
  ).push({ cmd, args });
  const handler =
    (
      (window as unknown as Record<string, unknown>)
        .__TAURI_MOCK_HANDLERS__ as Record<string, Handler>
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

(
  window as unknown as Record<string, unknown>
).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
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
        | ((event: {
            event: string;
            id: number;
            payload: unknown;
            windowLabel: string;
          }) => void)
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
