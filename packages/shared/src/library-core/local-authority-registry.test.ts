import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_CORE_LOCAL_AUTHORITY_NON_PRODUCT_EXCLUSIONS,
  LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY,
  LIBRARY_CORE_LOCAL_AUTHORITY_SOURCE_OWNERS,
  type LibraryCoreLocalAuthorityRegistryEntry,
} from "./local-authority-registry.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PRODUCT_SOURCE_ROOTS = [
  "packages/desktop/src",
  "packages/pwa/src",
  "packages/ui/src",
] as const;

function productSourcePaths(): string[] {
  const pending = PRODUCT_SOURCE_ROOTS.map((sourceRoot) =>
    resolve(REPOSITORY_ROOT, sourceRoot),
  );
  const sourcePaths: string[] = [];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__mocks__" && entry.name !== "__tests__") {
          pending.push(path);
        }
        continue;
      }
      if (
        entry.isFile() &&
        /\.(?:[cm]?[jt]sx?|rs)$/.test(entry.name) &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      ) {
        sourcePaths.push(relative(REPOSITORY_ROOT, path));
      }
    }
  }

  return sourcePaths.sort();
}

function readRepositorySource(sourcePath: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, sourcePath), "utf8");
}

function registryByKey(): Map<string, LibraryCoreLocalAuthorityRegistryEntry> {
  return new Map(
    LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY.map((entry) => [
      entry.registryKey,
      entry,
    ]),
  );
}

function rustByteArrayUuid(sourcePath: string, symbol: string): string {
  const source = readRepositorySource(sourcePath);
  const declaration = source.match(
    new RegExp(
      `const\\s+${symbol}:\\s*\\[u8;\\s*16\\]\\s*=\\s*\\[([\\s\\S]*?)\\];`,
    ),
  );
  if (!declaration) {
    throw new Error(`Missing ${symbol} in ${sourcePath}`);
  }
  const bytes = [...declaration[1].matchAll(/0x([0-9a-f]{2})/gi)]
    .map((match) => match[1]);
  if (bytes.length !== 16) {
    throw new Error(`${symbol} must contain exactly 16 hexadecimal bytes`);
  }
  const hex = bytes.join("").toLowerCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

describe("Library Core local authority registry", () => {
  it("is unique and sorted for deterministic serialization", () => {
    const keys = LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY.map((entry) => entry.registryKey);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the high-risk local-authority families required by Gate A", () => {
    const required = [
      "authenticated-essay-capture-cooldowns",
      "automerge-cloud-dropbox",
      "automerge-cloud-google-drive",
      "automerge-local-document",
      "cloud-oauth-credentials",
      "cloud-runtime-state",
      "contact-sync-state",
      "desktop-client-warning-acknowledgement",
      "desktop-reader-content",
      "desktop-webkit-network-cache",
      "dev-sync-trigger-control",
      "device-ai-preferences",
      "device-display-preferences",
      "device-feed-card-density",
      "device-graph-layout",
      "device-interface-zoom",
      "device-theme",
      "facebook-group-discovery",
      "factory-reset-cloud-cleanup-barrier",
      "geocoding-cache",
      "library-core-actor-private-key",
      "library-core-authority-private-key",
      "library-core-legacy-source-admission-key",
      "library-core-bootstrap-operation-journal",
      "library-core-bootstrap-receipt",
      "library-core-bootstrap-record",
      "library-core-derived-runtime",
      "library-core-installation-identity",
      "library-core-local-control",
      "local-ai-model-files",
      "local-ai-model-state",
      "media-vault",
      "provider-health",
      "provider-user-agents",
      "provider-webview-sessions-linux",
      "provider-webview-sessions-macos",
      "provider-webview-sessions-windows",
      "pwa-automerge-worker-debug",
      "pwa-install-notice",
      "pwa-legal-consent",
      "pwa-reader-content",
      "pwa-relay-credential",
      "pwa-release-channel",
      "pwa-service-worker-build-caches",
      "pwa-service-worker-network-cache",
      "pwa-service-worker-sync-cache",
      "reader-image-cache",
      "release-log-files",
      "rss-runtime-state",
      "scraper-window-modes",
      "secure-api-keys",
      "snapshots",
      "social-outbox-state",
      "x-manual-cookies",
      "youtube-offline-playlist",
    ];
    const keys = new Set<string>(
      LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY.map((entry) => entry.registryKey),
    );

    for (const key of required) expect(keys.has(key)).toBe(true);
  });

  it("registers every Library Core rollback key used by product source", () => {
    const discoveredSources = new Map<string, string[]>();
    for (const sourcePath of productSourcePaths()) {
      const source = readRepositorySource(sourcePath);
      const keys = source.match(
        /freed\.libraryCore\.[A-Za-z0-9]+\.disabled/g,
      ) ?? [];
      for (const key of keys) {
        const paths = discoveredSources.get(key) ?? [];
        paths.push(sourcePath);
        discoveredSources.set(key, paths);
      }
    }

    const derivedRuntime = registryByKey().get("library-core-derived-runtime");
    const registeredKeys = new Set(
      derivedRuntime?.physicalStores
        .filter((store) => store.kind === "local-storage")
        .flatMap((store) => store.keys) ?? [],
    );
    const missing = [...discoveredSources.entries()]
      .filter(([key]) => !registeredKeys.has(key))
      .map(([key, sourcePaths]) => `${key}: ${sourcePaths.join(", ")}`);

    expect(missing).toEqual([]);
  });

  it("binds audited persisted-key families to checked-in source owners", () => {
    const byKey = registryByKey();

    for (const owner of LIBRARY_CORE_LOCAL_AUTHORITY_SOURCE_OWNERS) {
      const entry = byKey.get(owner.registryKey);
      expect(entry, owner.registryKey).toBeDefined();
      expect(entry?.sourceReferences).toContain(owner.sourcePath);

      const registeredKeys = new Set(
        entry?.physicalStores.flatMap((store) => store.keys) ?? [],
      );
      for (const key of owner.registeredKeys) {
        expect(registeredKeys.has(key), `${owner.registryKey}: ${key}`).toBe(true);
      }

      const source = readRepositorySource(owner.sourcePath);
      for (const token of owner.sourceTokens) {
        expect(source.includes(token), `${owner.sourcePath}: ${token}`).toBe(true);
      }
    }
  });

  it("has source-owner coverage for every registered persistent store", () => {
    const persistentStoreKinds = new Set([
      "cache-api",
      "cloud-file",
      "filesystem",
      "indexeddb",
      "local-storage",
      "native-json",
      "platform-credential",
      "session-storage",
      "webkit-data-store",
      "webkitgtk-data-store",
      "webview2-data-store",
    ]);

    for (const entry of LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY) {
      if (
        !entry.physicalStores.some((store) =>
          persistentStoreKinds.has(store.kind),
        )
      ) {
        continue;
      }

      const registeredKeys = new Set(
        LIBRARY_CORE_LOCAL_AUTHORITY_SOURCE_OWNERS
          .filter((owner) => owner.registryKey === entry.registryKey)
          .flatMap((owner) => owner.registeredKeys),
      );
      const physicalKeys = new Set(
        entry.physicalStores.flatMap((store) => store.keys),
      );

      expect(
        [...registeredKeys].sort(),
        entry.registryKey,
      ).toEqual([...physicalKeys].sort());
    }
  });

  it("keeps non-product persistence exclusions explicit and source-backed", () => {
    for (const exclusion of LIBRARY_CORE_LOCAL_AUTHORITY_NON_PRODUCT_EXCLUSIONS) {
      const source = readRepositorySource(exclusion.sourcePath);
      expect(source.includes(exclusion.sourceToken)).toBe(true);
      expect(exclusion.reason.length).toBeGreaterThan(0);
    }
  });

  it("never backs up, exports, or snapshots a secret", () => {
    const secrets = LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY.filter(
      (entry) => entry.locality === "secret",
    );
    expect(secrets.length).toBeGreaterThan(0);
    for (const entry of secrets) {
      expect(entry.backup).toBe("exclude-secret");
      expect(entry.export).toBe("exclude");
      expect(entry.redaction).toBe("drop-entire-value");
      expect(entry.snapshot).toBe("excluded");
    }
    expect(
      secrets.find((entry) =>
        entry.registryKey === "library-core-authority-private-key"
      ),
    ).toMatchObject({
      soleOwner: "unprovisioned Library Core native authority adapter",
      resetSemantics: "Factory reset removes local protected authority material. Restore may install a newly rotated authority key only through an accepted recovery transition; private bytes are never exported or imported.",
    });
  });

  it("blocks cutover on sole-copy, active legacy, unbounded, and unproven authorities", () => {
    const blockers = LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY
      .filter((entry) => entry.cutover.blocksCutover)
      .map((entry) => entry.registryKey);

    expect(blockers).toEqual([
      "automerge-cloud-dropbox",
      "automerge-cloud-google-drive",
      "automerge-local-document",
      "contact-sync-state",
      "desktop-reader-content",
      "device-graph-layout",
      "factory-reset-cloud-cleanup-barrier",
      "library-core-actor-private-key",
      "library-core-authority-private-key",
      "library-core-bootstrap-operation-journal",
      "library-core-bootstrap-receipt",
      "library-core-bootstrap-record",
      "library-core-installation-identity",
      "library-core-local-control",
      "media-vault",
      "provider-webview-sessions-linux",
      "provider-webview-sessions-macos",
      "provider-webview-sessions-windows",
      "pwa-reader-content",
      "pwa-service-worker-network-cache",
      "pwa-service-worker-sync-cache",
      "youtube-offline-playlist",
    ]);
  });

  it("does not waive measured retention for contact, graph, or playlist state", () => {
    const byKey = registryByKey();
    for (const key of [
      "contact-sync-state",
      "device-graph-layout",
      "youtube-offline-playlist",
    ]) {
      const entry = byKey.get(key);
      expect(entry?.retention.kind).toBe("unbounded-current");
      expect(entry?.cutover.blocksCutover).toBe(true);
      expect(entry?.cutover.reason).toMatch(/measured|bounded/);
    }
  });

  it("records the PWA reset envelope and acknowledgement key shapes exactly", () => {
    const entry = registryByKey().get("pwa-factory-reset-coordination");
    const localKeys = entry?.physicalStores.find(
      (store) => store.kind === "local-storage",
    )?.keys;
    const sessionKeys = entry?.physicalStores.find(
      (store) => store.kind === "session-storage",
    )?.keys;

    expect(localKeys).toContain(
      "freed_pwa_factory_reset_ack_<resetId>_<runtimeId>",
    );
    expect(localKeys).toContain("freed_pwa_factory_reset_reload_envelope");
    expect(sessionKeys).toEqual(["freed_pwa_factory_reset_reload"]);
  });

  it("separates provider session ownership by desktop platform and fails closed", () => {
    const byKey = registryByKey();
    const expected = [
      {
        key: "provider-webview-sessions-linux",
        platform: "desktop-linux",
        kind: "webkitgtk-data-store",
      },
      {
        key: "provider-webview-sessions-macos",
        platform: "desktop-macos",
        kind: "webkit-data-store",
      },
      {
        key: "provider-webview-sessions-windows",
        platform: "desktop-windows",
        kind: "webview2-data-store",
      },
    ] as const;

    for (const { key, platform, kind } of expected) {
      const entry = byKey.get(key);
      expect(entry?.physicalStores).toHaveLength(1);
      expect(entry?.physicalStores[0]?.platforms).toEqual([platform]);
      expect(entry?.physicalStores[0]?.kind).toBe(kind);
      expect(entry?.physicalStores[0]?.locator).toMatch(
        platform === "desktop-macos" ? /Library\/WebKit/ : /unresolved:/,
      );
      expect(entry?.cutover.blocksCutover).toBe(true);
      expect(entry?.backup).toBe("exclude-secret");
      expect(entry?.export).toBe("exclude");
      expect(entry?.snapshot).toBe("excluded");
    }

    expect(byKey.has("provider-webview-sessions")).toBe(false);
    expect(byKey.get("provider-webview-sessions-macos")?.resetSemantics)
      .toContain("conditionally");
  });

  it("binds provider session descriptors to the Rust data-store UUID bytes", () => {
    const expectedDescriptors = [
      ["packages/desktop/src-tauri/src/lib.rs", "FB_SCRAPER_DATA_STORE_IDENTIFIER", "facebook"],
      ["packages/desktop/src-tauri/src/lib.rs", "IG_SCRAPER_DATA_STORE_IDENTIFIER", "instagram"],
      ["packages/desktop/src-tauri/src/lib.rs", "LI_SCRAPER_DATA_STORE_IDENTIFIER", "linkedin"],
      ["packages/desktop/src-tauri/src/lib.rs", "SUBSTACK_SCRAPER_DATA_STORE_IDENTIFIER", "substack"],
      ["packages/desktop/src-tauri/src/lib.rs", "MEDIUM_SCRAPER_DATA_STORE_IDENTIFIER", "medium"],
      ["packages/desktop/src-tauri/src/youtube.rs", "YOUTUBE_SESSION_DATA_STORE_IDENTIFIER", "youtube"],
    ].map(([sourcePath, symbol, provider]) =>
      `${rustByteArrayUuid(sourcePath, symbol)} (${provider})`
    );

    const byKey = registryByKey();
    for (const key of [
      "provider-webview-sessions-linux",
      "provider-webview-sessions-macos",
      "provider-webview-sessions-windows",
    ]) {
      const sessionDescriptors = byKey.get(key)?.physicalStores
        .flatMap((store) => store.keys)
        .filter((descriptor) => !descriptor.includes("sessionStorage"));
      expect(sessionDescriptors, key).toEqual(expectedDescriptors);
    }
  });

  it("closes Desktop legal-consent keys over the shared provider-risk union", () => {
    const legalSource = readRepositorySource("packages/shared/src/legal.ts");
    const providerUnion = legalSource.match(
      /export type ProviderRiskId =([\s\S]*?);/,
    );
    if (!providerUnion) {
      throw new Error("ProviderRiskId must remain a closed string union");
    }
    const providers = [...providerUnion[1].matchAll(/"([^"]+)"/g)]
      .map((match) => match[1]);
    const entry = registryByKey().get("desktop-legal-consent");
    const nativeKeys = entry?.physicalStores
      .find((store) => store.kind === "native-json")
      ?.keys.filter((key) => key.startsWith("legal.provider."));
    const fallbackKeys = entry?.physicalStores
      .find((store) => store.kind === "local-storage")
      ?.keys.filter((key) => key.startsWith("freed.legal.legal.provider."));

    expect(nativeKeys).toEqual(providers.map((provider) => `legal.provider.${provider}`));
    expect(fallbackKeys).toEqual(
      providers.map((provider) => `freed.legal.legal.provider.${provider}`),
    );
  });

  it("records the PWA stores that factory reset currently preserves", () => {
    const appSource = readRepositorySource("packages/pwa/src/App.tsx");
    const resetStart = appSource.indexOf("const handleFactoryReset");
    const resetEnd = appSource.indexOf("const platform", resetStart);
    const resetWiring = appSource.slice(
      resetStart,
      resetEnd > resetStart ? resetEnd : undefined,
    );
    expect(resetWiring).toContain("clearLocalData: []");

    const byKey = registryByKey();
    for (const key of [
      "pwa-install-notice",
      "pwa-legal-consent",
      "pwa-reader-content",
      "pwa-release-channel",
      "pwa-service-worker-build-caches",
      "pwa-service-worker-network-cache",
      "pwa-service-worker-sync-cache",
      "reader-image-cache",
      "reader-offline-cache-mode",
    ]) {
      expect(byKey.get(key)?.resetSemantics, key)
        .toMatch(/current PWA factory reset preserves|current PWA factory reset does not delete/);
    }
  });

  it("distinguishes authoritative reader bodies from rebuildable images", () => {
    const byKey = registryByKey();

    for (const key of ["desktop-reader-content", "pwa-reader-content"]) {
      const entry = byKey.get(key);
      expect(entry?.authoritative).toBe(true);
      expect(entry?.snapshot).toBe("authoritative-source-manifest-required");
      expect(entry?.migration).toBe("migrate-to-library-core");
    }

    const images = byKey.get("reader-image-cache");
    expect(images?.authoritative).toBe(false);
    expect(images?.role).toBe("cache");
    expect(images?.snapshot).toBe("rebuildable");
    expect(images?.cutover.blocksCutover).toBe(false);
  });
});
