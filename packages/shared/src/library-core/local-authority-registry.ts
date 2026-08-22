import type { LibraryCorePlannedLocality } from "./protocol-registry.js";

/**
 * Dormant Gate A census of storage that exists outside the synchronized field
 * registry. This file describes current authorities. It does not open, mutate,
 * migrate, reset, export, or activate any store.
 */

export type LibraryCoreLocalPlatform =
  | "desktop"
  | "desktop-linux"
  | "desktop-macos"
  | "desktop-windows"
  | "pwa"
  | "cloud"
  | "node";

export type LibraryCoreLocalStoreKind =
  | "cache-api"
  | "cloud-file"
  | "filesystem"
  | "indexeddb"
  | "local-storage"
  | "memory"
  | "native-json"
  | "platform-credential"
  | "session-storage"
  | "unprovisioned"
  | "webkit-data-store"
  | "webkitgtk-data-store"
  | "webview2-data-store";

export interface LibraryCorePhysicalStore {
  readonly kind: LibraryCoreLocalStoreKind;
  readonly platforms: readonly LibraryCoreLocalPlatform[];
  /**
   * Exact current locator syntax. Runtime-resolved roots use appDataDir(),
   * origin, bundle identifier, or HOME rather than one machine's absolute path.
   */
  readonly locator: string;
  readonly keys: readonly string[];
}

export type LibraryCoreLocalRole =
  | "active-authority"
  | "authoritative-device-source"
  | "backup"
  | "cache"
  | "control"
  | "derived-runtime"
  | "receipt"
  | "secret"
  | "telemetry";

export type LibraryCoreRetention =
  | {
      readonly kind: "bounded-count";
      readonly limit: number;
      readonly unit: string;
    }
  | {
      readonly kind: "bounded-time";
      readonly durationMs: number;
    }
  | {
      readonly kind: "bounded-by-rule";
      readonly rules: readonly {
        readonly scope: string;
        readonly limit: number;
        readonly unit: string;
      }[];
    }
  | {
      readonly kind:
        | "browser-managed"
        | "process-lifetime"
        | "until-disconnect"
        | "until-explicit-delete"
        | "until-reset";
    }
  | {
      readonly kind: "unbounded-current";
      readonly reason: string;
    };

export type LibraryCoreBackupDisposition =
  | "exclude-derived"
  | "exclude-device-local"
  | "exclude-secret"
  | "include-private"
  | "legacy-recovery-only"
  | "not-applicable";

export type LibraryCoreExportDisposition =
  | "exclude"
  | "include-private"
  | "include-redacted-metadata"
  | "legacy-compatibility"
  | "not-applicable";

export type LibraryCoreRedactionDisposition =
  | "drop-entire-value"
  | "not-applicable"
  | "redact-sensitive-fields"
  | "retain-private-bytes";

export type LibraryCoreSnapshotDisposition =
  | "authoritative-source-manifest-required"
  | "excluded"
  | "legacy-recovery"
  | "portable-snapshot-required"
  | "rebuildable";

export type LibraryCoreMigrationDisposition =
  | "exclude-secret-and-retain-current-owner"
  | "generate-after-gate-a"
  | "migrate-to-library-core"
  | "rebuild-after-cutover"
  | "retain-current-device-owner"
  | "retain-legacy-recovery"
  | "retire-with-legacy-epoch";

export interface LibraryCoreCutoverStatus {
  readonly blocksCutover: boolean;
  readonly reason: string;
}

export interface LibraryCoreLocalAuthorityRegistryEntry {
  readonly registryKey: string;
  readonly soleOwner: string;
  readonly locality: LibraryCorePlannedLocality;
  readonly role: LibraryCoreLocalRole;
  readonly authoritative: boolean;
  readonly physicalStores: readonly LibraryCorePhysicalStore[];
  readonly retention: LibraryCoreRetention;
  readonly backup: LibraryCoreBackupDisposition;
  readonly export: LibraryCoreExportDisposition;
  readonly redaction: LibraryCoreRedactionDisposition;
  readonly resetSemantics: string;
  readonly snapshot: LibraryCoreSnapshotDisposition;
  readonly migration: LibraryCoreMigrationDisposition;
  readonly cutover: LibraryCoreCutoverStatus;
  readonly sourceReferences: readonly string[];
}

const APP_DATA = "appDataDir()";
const VERSIONED_RECOVERY = "<key>.recovery.<capturedAtMs>.<sequence>";

/**
 * Registry keys are sorted so JSON serialization and registry digests do not
 * depend on object enumeration or filesystem discovery order.
 */
export const LIBRARY_CORE_LOCAL_AUTHORITY_REGISTRY = [
  {
    registryKey: "authenticated-essay-capture-cooldowns",
    soleOwner: "packages/desktop/src/lib/authenticated-essay-capture.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: [
        "freed.capture-cooldown.substack",
        "freed.capture-cooldown.medium",
      ],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "A deadline becomes semantically inert after at most 36 minutes and is removed on the next read. Without another read, the current factory-reset path does not explicitly remove the physical key.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "These bounded request-scheduling deadlines remain device-local and never enter Library Core operations or provider artifacts.",
    },
    sourceReferences: ["packages/desktop/src/lib/authenticated-essay-capture.ts"],
  },
  {
    registryKey: "automerge-cloud-dropbox",
    soleOwner: "packages/sync/src/cloud/dropbox.ts",
    locality: "synchronized",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "cloud-file",
      platforms: ["cloud"],
      locator: "Dropbox:/Apps/Freed/freed.automerge",
      keys: ["/Apps/Freed/freed.automerge"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "legacy-recovery-only",
    export: "legacy-compatibility",
    redaction: "retain-private-bytes",
    resetSemantics: "Disconnect preserves the remote file; explicit cloud-data deletion removes it.",
    snapshot: "legacy-recovery",
    migration: "retire-with-legacy-epoch",
    cutover: {
      blocksCutover: true,
      reason: "The active legacy cloud replica must be reconciled, fenced, and retired by the signed epoch transition.",
    },
    sourceReferences: ["packages/sync/src/cloud/dropbox.ts"],
  },
  {
    registryKey: "automerge-cloud-google-drive",
    soleOwner: "packages/sync/src/cloud/gdrive.ts",
    locality: "synchronized",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "cloud-file",
      platforms: ["cloud"],
      locator: "GoogleDrive:spaces=appDataFolder;name=freed.automerge",
      keys: ["freed.automerge"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "legacy-recovery-only",
    export: "legacy-compatibility",
    redaction: "retain-private-bytes",
    resetSemantics: "Disconnect preserves the appDataFolder file; explicit cloud-data deletion removes it.",
    snapshot: "legacy-recovery",
    migration: "retire-with-legacy-epoch",
    cutover: {
      blocksCutover: true,
      reason: "The active legacy cloud replica must be reconciled, fenced, and retired by the signed epoch transition.",
    },
    sourceReferences: ["packages/sync/src/cloud/gdrive.ts"],
  },
  {
    registryKey: "automerge-local-document",
    soleOwner: "packages/sync/src/storage/indexeddb.ts",
    locality: "synchronized",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "indexeddb",
      platforms: ["desktop", "pwa"],
      locator: "origin:indexedDB/freed@3/automerge",
      keys: [
        "feed",
        "feed:installation-generation",
        "feed:save-revision",
        "feed:chunk-count",
        "feed:byte-length",
        "feed:chunk:<index>",
      ],
    }],
    retention: { kind: "until-reset" },
    backup: "include-private",
    export: "legacy-compatibility",
    redaction: "retain-private-bytes",
    resetSemantics: "Factory reset atomically clears feed and its chunk metadata and bytes, advances feed:installation-generation, and resets feed:save-revision to zero.",
    snapshot: "portable-snapshot-required",
    migration: "migrate-to-library-core",
    cutover: {
      blocksCutover: true,
      reason: "Cutover requires one immutable raw Automerge source binary and exact heads from the elected migration authority.",
    },
    sourceReferences: [
      "packages/sync/src/storage/indexeddb.ts",
      "packages/desktop/src/lib/automerge.worker.ts",
      "packages/pwa/src/lib/automerge.worker.ts",
    ],
  },
  {
    registryKey: "clipboard-save-shortcut",
    soleOwner: "packages/desktop/src/lib/clipboard-save-shortcut.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "native-json",
      platforms: ["desktop"],
      locator: `${APP_DATA}/clipboard-save-shortcut.json`,
      keys: ["enabled", "shortcut"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Factory reset removes the file and restores the platform default shortcut.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "This is an explicitly retained Desktop control outside Library Core.",
    },
    sourceReferences: ["packages/desktop/src/lib/clipboard-save-shortcut.ts"],
  },
  {
    registryKey: "cloud-oauth-credentials",
    soleOwner: "cloud credential adapter for the current runtime origin",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: [
        "freed_cloud_token_gdrive",
        "freed_cloud_token_dropbox",
        "freed_cloud_token_meta_gdrive",
        "freed_cloud_token_meta_dropbox",
        "freed_cloud_provider",
      ],
    }],
    retention: { kind: "until-disconnect" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Disconnect or factory reset removes access-token, refresh-token, expiry, and provider-selection records.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: false,
      reason: "OAuth credentials remain outside operations, blobs, manifests, snapshots, and portable backups.",
    },
    sourceReferences: [
      "packages/desktop/src/lib/sync.ts",
      "packages/pwa/src/lib/sync.ts",
    ],
  },
  {
    registryKey: "cloud-runtime-state",
    soleOwner: "cloud sync runtime coordinator for the current process",
    locality: "derived",
    role: "derived-runtime",
    authoritative: false,
    physicalStores: [{
      kind: "memory",
      platforms: ["desktop", "pwa"],
      locator: "process:cloud sync lifecycle maps, timers, abort controllers, and last uploaded heads",
      keys: [
        "cloudGenerations",
        "cloudCredentialRevisions",
        "cloudTokenRefreshes",
        "cloudInFlightOperations",
        "lastSuccessfulUploadHeadsByProvider",
      ],
    }],
    retention: { kind: "process-lifetime" },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Disconnect, factory reset, or process exit cancels and drops the current generation.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "The runtime state is reconstructed from durable authority and must never be imported as truth.",
    },
    sourceReferences: [
      "packages/desktop/src/lib/sync.ts",
      "packages/pwa/src/lib/sync.ts",
    ],
  },
  {
    registryKey: "contact-sync-state",
    soleOwner: "packages/desktop/src/lib/contact-sync-storage.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: ["freed_contact_sync"],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "The current schema places no entry or byte ceiling on cached contacts, pending suggestions, or dismissed IDs.",
    },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset clears cached contacts, sync token, errors, suggestions, and match decisions.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: true,
      reason: "Cached contacts, pending suggestions, and dismissed IDs have no measured entry or byte limit. Gate A cannot retain this sole-copy authority without a bounded preservation policy.",
    },
    sourceReferences: [
      "packages/shared/src/contact-sync-state.ts",
      "packages/desktop/src/lib/contact-sync-storage.ts",
    ],
  },
  {
    registryKey: "desktop-client-registration",
    soleOwner: "packages/desktop/src/lib/desktop-client-registration.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [
      {
        kind: "native-json",
        platforms: ["desktop"],
        locator: `${APP_DATA}/desktop-client.json`,
        keys: ["registration"],
      },
      {
        kind: "local-storage",
        platforms: ["desktop"],
        locator: "origin:localStorage",
        keys: [
          "freed-desktop-client-registration-v1",
          "freed-desktop-client-registration-v1.recovery.<capturedAtMs>",
        ],
      },
    ],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset replaces the installation identity and invalidates fallback recovery copies.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The installation identity remains the Desktop client's local authority outside the library corpus.",
    },
    sourceReferences: ["packages/desktop/src/lib/desktop-client-registration.ts"],
  },
  {
    registryKey: "desktop-client-warning-acknowledgement",
    soleOwner: "packages/desktop/src/lib/desktop-client-warning.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: ["freed-multiple-desktop-warning-ack-v1"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Factory reset removes the acknowledged client-set signature so setup can warn again.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The acknowledgement is a local warning control and carries no library or provider authority.",
    },
    sourceReferences: ["packages/desktop/src/lib/desktop-client-warning.ts"],
  },
  {
    registryKey: "desktop-legal-consent",
    soleOwner: "packages/desktop/src/lib/legal-consent.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [
      {
        kind: "native-json",
        platforms: ["desktop"],
        locator: `${APP_DATA}/legal.json`,
        keys: [
          "legal.bundle.desktop",
          "legal.provider.x",
          "legal.provider.facebook",
          "legal.provider.instagram",
          "legal.provider.linkedin",
          "legal.provider.substack",
          "legal.provider.medium",
          "legal.provider.youtube",
        ],
      },
      {
        kind: "local-storage",
        platforms: ["desktop"],
        locator: "origin:localStorage",
        keys: [
          "freed.legal.legal.bundle.desktop",
          "freed.legal.legal.provider.x",
          "freed.legal.legal.provider.facebook",
          "freed.legal.legal.provider.instagram",
          "freed.legal.legal.provider.linkedin",
          "freed.legal.legal.provider.substack",
          "freed.legal.legal.provider.medium",
          "freed.legal.legal.provider.youtube",
        ],
      },
    ],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset removes acceptance and requires the current legal bundle to be accepted again.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Legal acceptance is an installation control, not library content.",
    },
    sourceReferences: [
      "packages/desktop/src/lib/legal-consent.ts",
      "packages/shared/src/legal.ts",
    ],
  },
  {
    registryKey: "desktop-pairing-token",
    soleOwner: "packages/desktop/src-tauri/src/lib.rs",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: `${APP_DATA}/pairing-token`,
      keys: ["raw pairing token bytes"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Factory reset rotates or removes the relay pairing token before a new runtime accepts clients.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: false,
      reason: "Relay pairing material stays outside Library Core and every portable artifact.",
    },
    sourceReferences: ["packages/desktop/src-tauri/src/lib.rs"],
  },
  {
    registryKey: "desktop-reader-content",
    soleOwner: "packages/desktop/src/lib/content-cache.ts",
    locality: "blob",
    role: "authoritative-device-source",
    authoritative: true,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: `${APP_DATA}/content/<globalId with [<>:\"/\\\\|?* and controls] replaced by _>.html`,
      keys: ["<sanitized-globalId>.html"],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "Each HTML file is capped at 2 MiB, but the directory has no total byte or entry ceiling.",
    },
    backup: "include-private",
    export: "include-private",
    redaction: "retain-private-bytes",
    resetSemantics: "Clear cache or factory reset deletes the content directory.",
    snapshot: "authoritative-source-manifest-required",
    migration: "migrate-to-library-core",
    cutover: {
      blocksCutover: true,
      reason: "A file may be the only complete article body and sanitized filenames are not injective; every byte needs an identity-bound disposition.",
    },
    sourceReferences: ["packages/desktop/src/lib/content-cache.ts"],
  },
  {
    registryKey: "desktop-release-channel",
    soleOwner: "packages/desktop/src/lib/release-channel.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [
      {
        kind: "native-json",
        platforms: ["desktop"],
        locator: `${APP_DATA}/release-channel.json`,
        keys: ["channel", "installedChannel"],
      },
      {
        kind: "local-storage",
        platforms: ["desktop"],
        locator: "origin:localStorage",
        keys: ["freed-release-channel", "freed-updated-to"],
      },
    ],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Factory reset or explicit channel selection replaces the local release controls.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Release selection is an installation control and does not enter the library.",
    },
    sourceReferences: [
      "packages/desktop/src/lib/release-channel.ts",
      "packages/desktop/src/lib/desktop-updater.ts",
      "packages/ui/src/lib/release-channel.ts",
    ],
  },
  {
    registryKey: "desktop-webkit-network-cache",
    soleOwner: "packages/desktop/src-tauri/src/lib.rs",
    locality: "derived",
    role: "cache",
    authoritative: false,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: "appCacheDir()/WebKit/NetworkCache",
      keys: ["<WebKit network-cache file>"],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "A memory sample may start a best-effort trim after the entire WebKit cache exceeds 768 MiB and target 512 MiB by deleting NetworkCache files. Sampling can be absent, deletion can fail, and bytes outside NetworkCache cannot be reclaimed by this path, so neither threshold is a hard bound.",
    },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "The current factory-reset path does not delete appCacheDir(). WebKit eviction or the best-effort memory-pressure trim may delete individual NetworkCache files.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "Network responses are derived, non-authoritative cache entries and must never seed Library Core state.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/lib.rs",
      "packages/desktop/src/lib/memory-monitor.ts",
    ],
  },
  {
    registryKey: "dev-sync-trigger-control",
    soleOwner: "Freed Desktop terminal trigger bridge",
    locality: "device-local",
    role: "control",
    authoritative: false,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: APP_DATA,
      keys: ["dev-sync-trigger.json", "dev-sync-trigger-result.json"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Requests older than 10 minutes become ineligible, each new result replaces the prior result, and factory reset removes both files.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "These files are a dev-build terminal control and receipt, not library authority or a portable provider artifact.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/lib.rs",
      "packages/desktop/src/lib/dev-sync-triggers.ts",
    ],
  },
  {
    registryKey: "device-ai-preferences",
    soleOwner: "packages/ui/src/lib/device-ai-preferences.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed-device-ai-preferences-v1", VERSIONED_RECOVERY],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset restores provider none, empty model, and the default Ollama URL.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The current versioned store is explicitly retained as sole owner of device AI selection.",
    },
    sourceReferences: ["packages/ui/src/lib/device-ai-preferences.ts"],
  },
  {
    registryKey: "device-display-preferences",
    soleOwner: "packages/ui/src/lib/device-display-preferences.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed-device-display-preferences-v1", VERSIONED_RECOVERY],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Factory reset replaces the record with default display values and purges recovery copies.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The current versioned store is explicitly retained as sole owner of display state.",
    },
    sourceReferences: ["packages/ui/src/lib/device-display-preferences.ts"],
  },
  {
    registryKey: "device-feed-card-density",
    soleOwner: "packages/ui/src/lib/feed-card-density.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed-feed-card-density"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Factory reset removes the key and restores comfortable cards.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Feed-card density remains a presentation preference outside synchronized library state.",
    },
    sourceReferences: ["packages/ui/src/lib/feed-card-density.ts"],
  },
  {
    registryKey: "device-graph-layout",
    soleOwner: "packages/ui/src/lib/device-graph-layout.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed-device-graph-layout-v1", VERSIONED_RECOVERY],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "Pinned person and account positions have no current entry or byte ceiling.",
    },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Entity unpin removes its record; factory reset clears persons, accounts, and legacy migration state.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: true,
      reason: "The final foreign-keyed SQLite layout and one-row local mutation contract are implemented, but the active product store still owns localStorage migration, pruning, reset, and writes until the graph reader cutover replaces it.",
    },
    sourceReferences: [
      "packages/ui/src/lib/device-graph-layout.ts",
      "packages/shared/src/library-core/device-graph-layout-mutation-contracts.ts",
      "packages/shared/src/library-core/normalized-schema-v1.sql",
    ],
  },
  {
    registryKey: "device-interface-zoom",
    soleOwner: "packages/ui/src/lib/interface-zoom.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed-interface-zoom"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Factory reset removes the key and restores 100 percent zoom.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Interface zoom remains a presentation preference outside synchronized library state.",
    },
    sourceReferences: ["packages/ui/src/lib/interface-zoom.ts"],
  },
  {
    registryKey: "device-theme",
    soleOwner: "packages/ui/src/lib/theme.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed-theme"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Factory reset removes the key and restores the default theme.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Theme selection remains a presentation preference outside synchronized library state.",
    },
    sourceReferences: ["packages/ui/src/lib/theme.ts"],
  },
  {
    registryKey: "facebook-group-discovery",
    soleOwner: "packages/desktop/src/lib/facebook-group-discovery.ts",
    locality: "device-local",
    role: "cache",
    authoritative: false,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: ["freed-device-facebook-groups-v1", VERSIONED_RECOVERY],
    }],
    retention: { kind: "bounded-count", limit: 5_000, unit: "groups" },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset clears discovered groups and legacy migration completion.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "The discovery roster is rebuildable provider cache and cannot be treated as library authority.",
    },
    sourceReferences: ["packages/desktop/src/lib/facebook-group-discovery.ts"],
  },
  {
    registryKey: "factory-reset-cloud-cleanup-barrier",
    soleOwner: "packages/ui/src/lib/factory-reset.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed_factory_reset_cloud_cleanup_pending"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "The barrier is written before destructive cloud cleanup and removed only after cleanup completes or an explicit reconnect.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: true,
      reason: "Cutover admission must prove that no durable cloud-cleanup barrier is pending. Treating a missing credential as completed deletion would violate authority.",
    },
    sourceReferences: [
      "packages/ui/src/lib/factory-reset.ts",
      "packages/desktop/src/lib/sync.ts",
      "packages/pwa/src/lib/sync.ts",
    ],
  },
  {
    registryKey: "geocoding-cache",
    soleOwner: "packages/ui/src/lib/geocoding-cache.ts",
    locality: "derived",
    role: "cache",
    authoritative: false,
    physicalStores: [{
      kind: "indexeddb",
      platforms: ["desktop", "pwa"],
      locator: "origin:indexedDB/freed-geocache@1/locations",
      keys: ["query"],
    }],
    retention: {
      kind: "bounded-by-rule",
      rules: [
        { scope: "successful geocodes", limit: 30, unit: "days" },
        { scope: "negative geocodes", limit: 7, unit: "days" },
      ],
    },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Factory reset clears the database; expired hits and misses become cache misses.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "Geocodes are derived from queries; hits expire after 30 days and misses after 7 days.",
    },
    sourceReferences: ["packages/ui/src/lib/geocoding-cache.ts"],
  },
  {
    registryKey: "library-core-actor-private-key",
    soleOwner: "packages/desktop/src-tauri/src/library_core_actor_enrollment.rs",
    locality: "secret",
    role: "secret",
    authoritative: false,
    physicalStores: [{
      kind: "platform-credential",
      platforms: ["desktop-macos", "desktop-windows"],
      locator: "platform-credential:wtf.freed.library-core/actor-current",
      keys: ["actor-current"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "A reset or restore creates a new installation actor key and incarnation; active private material is never imported.",
    snapshot: "excluded",
    migration: "retire-with-legacy-epoch",
    cutover: {
      blocksCutover: true,
      reason: "The code to generate and enroll this key exists on desktop macOS and Windows but has no production caller, because the epoch it would enroll under is disposable local shadow state rather than authority. The enrolled actor has written no operation, and neither Linux nor the PWA has a proven noninteractive vault to hold this key at all.",
    },
    sourceReferences: [
      "docs/LIBRARY-CORE-CONTRACT.md",
      "packages/desktop/src-tauri/src/library_core_actor_enrollment.rs",
      "packages/desktop/src-tauri/src/library_core_platform_key.rs",
    ],
  },
  {
    registryKey: "library-core-authority-private-key",
    soleOwner: "packages/desktop/src-tauri/src/library_core_authority_genesis.rs",
    locality: "secret",
    role: "secret",
    authoritative: false,
    physicalStores: [{
      kind: "platform-credential",
      platforms: ["desktop-macos", "desktop-windows"],
      locator: "platform-credential:wtf.freed.library-core/authority-current",
      keys: ["authority-current"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Factory reset removes local protected authority material. Restore may install a newly rotated authority key only through an accepted recovery transition; private bytes are never exported or imported.",
    snapshot: "excluded",
    migration: "retire-with-legacy-epoch",
    cutover: {
      blocksCutover: true,
      reason: "The code to mint this key exists on desktop macOS and Windows but has no production caller: startup was minting it automatically, which the contract forbids because a key the app creates and signs proves only that the app possesses the key it just created. Any key or epoch produced by that path is disposable local shadow state and can never be canonical authority. The real authority key stays unprovisioned until a user-present or authenticated authority-holder protocol exists.",
    },
    sourceReferences: [
      "docs/LIBRARY-CORE-CONTRACT.md",
      "packages/desktop/src-tauri/src/library_core_authority_genesis.rs",
      "packages/desktop/src-tauri/src/library_core_platform_key.rs",
    ],
  },
  {
    registryKey: "library-core-bootstrap-operation-journal",
    soleOwner: "unprovisioned Library Core legacy bootstrap transaction adapter",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "unprovisioned",
      platforms: ["desktop", "pwa"],
      locator: "none:the dormant contract does not persist a prepared bootstrap operation",
      keys: [],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Reset removes the local prepared operation. It cannot be reconstructed from synchronized state or reused by a replacement storage generation.",
    snapshot: "excluded",
    migration: "generate-after-gate-a",
    cutover: {
      blocksCutover: true,
      reason: "The closed prepared-operation journal has no owner-confirmed, compare-and-swap transaction adapter.",
    },
    sourceReferences: [
      "docs/LIBRARY-CORE-CONTRACT.md",
      "packages/shared/src/library-core/legacy-epoch-bootstrap-contract.ts",
    ],
  },
  {
    registryKey: "library-core-bootstrap-receipt",
    soleOwner: "unprovisioned Library Core legacy bootstrap transaction adapter",
    locality: "device-local",
    role: "receipt",
    authoritative: true,
    physicalStores: [{
      kind: "unprovisioned",
      platforms: ["desktop", "pwa"],
      locator: "none:the dormant contract does not persist a bootstrap completion receipt",
      keys: [],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Reset removes the local completion receipt and creator write authority. A synchronized bootstrap record cannot recreate either one.",
    snapshot: "excluded",
    migration: "generate-after-gate-a",
    cutover: {
      blocksCutover: true,
      reason: "Creator writes remain blocked until one atomic transaction durably binds the prepared operation, document, local control, and completion receipt.",
    },
    sourceReferences: [
      "docs/LIBRARY-CORE-CONTRACT.md",
      "packages/shared/src/library-core/legacy-epoch-bootstrap-contract.ts",
    ],
  },
  {
    registryKey: "library-core-bootstrap-record",
    soleOwner: "unprovisioned Library Core legacy bootstrap record adapter",
    locality: "synchronized",
    role: "control",
    authoritative: false,
    physicalStores: [{
      kind: "unprovisioned",
      platforms: ["desktop", "pwa"],
      locator: "none:the dormant contract does not persist a legacy bootstrap record",
      keys: [],
    }],
    retention: { kind: "until-reset" },
    backup: "include-private",
    export: "include-private",
    redaction: "retain-private-bytes",
    resetSemantics: "A local reset may remove its cached copy. Sync may restore the same content-addressed record only as TOFU read-only state. Explicit library deletion removes it.",
    snapshot: "portable-snapshot-required",
    migration: "generate-after-gate-a",
    cutover: {
      blocksCutover: true,
      reason: "The synchronized bootstrap record names an epoch and source frontier but grants no write authority and has no durable adapter.",
    },
    sourceReferences: [
      "docs/LIBRARY-CORE-CONTRACT.md",
      "packages/shared/src/library-core/legacy-epoch-bootstrap-contract.ts",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    soleOwner: "Freed Desktop and PWA Library Core derived runtimes",
    locality: "derived",
    role: "derived-runtime",
    authoritative: false,
    physicalStores: [
      {
        kind: "filesystem",
        platforms: ["desktop"],
        locator: `${APP_DATA}/library-core-external-migration-v1, ${APP_DATA}/library-core-shadow-v1, ${APP_DATA}/library-core-feed-browse-v1, and ${APP_DATA}/library-core-saved-feed-v1`,
        keys: [
          "library-core-external-migration-v1/scratch/<sessionSha256>.sqlite",
          "library-core-external-migration-v1/spool/<sessionSha256>.journal.jsonl",
          "library-core-external-migration-v1/spool/<sessionSha256>.snapshot",
          "library-core-feed-browse-v1/generations/.<sourceKey>.staging.sqlite",
          "library-core-feed-browse-v1/generations/<sourceKey>.sqlite",
          "library-core-feed-browse-v1/registry.sqlite",
          "library-core-saved-feed-v1/generations/.<sourceKey>.staging.sqlite",
          "library-core-saved-feed-v1/generations/<sourceKey>.sqlite",
          "library-core-saved-feed-v1/registry.sqlite",
          "library-core-shadow-v1/generations/.<sourceKey>.staging.sqlite",
          "library-core-shadow-v1/generations/<sourceKey>.sqlite",
          "library-core-shadow-v1/registry.sqlite",
        ],
      },
      {
        kind: "local-storage",
        platforms: ["desktop"],
        locator: "origin:localStorage",
        keys: [
          "freed.libraryCore.feedBrowseBidirectionalReaderV1.disabled",
          "freed.libraryCore.feedBrowseReaderV1.disabled",
          "freed.libraryCore.friendsFeedReaderV1.disabled",
          "freed.libraryCore.friendsReaderV1.disabled",
          "freed.libraryCore.itemDetailReaderV1.disabled",
          "freed.libraryCore.rendererItemEvictionV1.disabled",
          "freed.libraryCore.savedAnalyticsReaderV1.disabled",
          "freed.libraryCore.savedFeedReaderV1.disabled",
          "freed.libraryCore.searchJumpReaderV1.disabled",
        ],
      },
      {
        kind: "unprovisioned",
        platforms: ["pwa"],
        locator: "none:the dormant portable-checkpoint and operation-tail IndexedDB adapter has no production caller",
        keys: [
          "portable_generations",
          "portable_records",
          "portable_pages",
          "portable_operations",
          "portable_segments",
          "portable_actor_enrollments",
          "portable_actor_tips",
          "portable_authenticated_operations",
          "portable_authenticated_segments",
          "portable_materialized_rows",
          "portable_read_state",
          "portable_control",
        ],
      },
    ],
    retention: {
      kind: "bounded-by-rule",
      rules: [
        { scope: "crash-replay migration revisions", limit: 1, unit: "revision" },
        { scope: "complete immutable projection generations per native query root", limit: 2, unit: "generation" },
        { scope: "complete portable PWA checkpoint generations and their operation tails", limit: 2, unit: "generation" },
        { scope: "migration and Gate D rollback controls", limit: 11, unit: "keys" },
      ],
    },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Successful two-sided migration confirmation removes that revision's spool and scratch graph. New selection retains only the selected and exact rollback SQLite or portable IndexedDB generations, including each retained portable generation's imported operation tail. Factory reset removes every registered native derived-runtime root and, after activation, the portable IndexedDB database; clearing site data removes the local rollback switches.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "This is a bounded, rebuildable compatibility projection. Automerge remains the sole authority until the governed Library Core cutover.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/library_core_external_migration_runtime.rs",
      "packages/desktop/src-tauri/src/library_core_feed_browse_runtime.rs",
      "packages/desktop/src-tauri/src/library_core_saved_feed_runtime.rs",
      "packages/desktop/src-tauri/src/library_core_shadow_runtime.rs",
      "packages/desktop/src/lib/automerge.ts",
      "packages/desktop/src/lib/library-core-feed-browse-reader-runtime.ts",
      "packages/desktop/src/lib/library-core-item-detail-runtime.ts",
      "packages/desktop/src/lib/library-core-provider-settings-runtime.ts",
      "packages/desktop/src/lib/library-core-saved-feed-reader-runtime.ts",
      "packages/pwa/src/lib/library-core-portable-checkpoint-store.ts",
      "packages/pwa/src/lib/library-core-operation-segment-runtime.ts",
      "packages/sync/src/cloud/library-core-operation-segments.ts",
      "packages/ui/src/components/friends/FriendEditor.tsx",
      "packages/ui/src/hooks/useLibraryCommandPaletteReader.ts",
    ],
  },
  {
    registryKey: "library-core-installation-identity",
    soleOwner: "unprovisioned Library Core installation identity adapter",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "unprovisioned",
      platforms: ["desktop", "pwa"],
      locator: "none:the dormant contract does not persist a Library Core installation identity",
      keys: [],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "A new installation, reset, clone recovery, or restore creates a fresh cryptographically random installation identity. Portable state never imports one as authority.",
    snapshot: "excluded",
    migration: "generate-after-gate-a",
    cutover: {
      blocksCutover: true,
      reason: "Creator and adopter control records cannot exist until stable installation identity has a platform durability adapter.",
    },
    sourceReferences: [
      "docs/LIBRARY-CORE-CONTRACT.md",
      "packages/shared/src/library-core/legacy-epoch-bootstrap-contract.ts",
    ],
  },
  {
    registryKey: "library-core-legacy-source-admission-key",
    soleOwner: "packages/desktop/src-tauri/src/library_core_migration_claim.rs",
    locality: "secret",
    role: "secret",
    authoritative: false,
    physicalStores: [{
      kind: "platform-credential",
      platforms: ["desktop-macos", "desktop-windows"],
      locator: "platform-credential:wtf.freed.library-core/migration-source-current",
      keys: ["migration-source-current"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Factory reset removes the platform credential before deleting local migration claims and staging state.",
    snapshot: "excluded",
    migration: "retire-with-legacy-epoch",
    cutover: {
      blocksCutover: false,
      reason: "This macOS and Windows key authenticates one device-local legacy source-admission receipt. It grants no Library Core writer or cloud authority and cannot satisfy elected migration admission. Linux remains on the Automerge rollback path until it has a proven noninteractive platform vault.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/library_core_migration_claim.rs",
      "packages/desktop/src-tauri/src/library_core_platform_key.rs",
    ],
  },
  {
    registryKey: "library-core-local-control",
    soleOwner: "unprovisioned Library Core local control adapter",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "unprovisioned",
      platforms: ["desktop", "pwa"],
      locator: "none:the dormant contract does not persist library_control",
      keys: [],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Reset removes the local control record and its installation identity. Missing control state never prepares a creator operation or authorizes a new bootstrap record.",
    snapshot: "excluded",
    migration: "generate-after-gate-a",
    cutover: {
      blocksCutover: true,
      reason: "The closed library_control shape has no atomic document, storage-generation, bootstrap-record, journal, receipt, and response-loss transaction.",
    },
    sourceReferences: [
      "docs/LIBRARY-CORE-CONTRACT.md",
      "packages/shared/src/library-core/legacy-epoch-bootstrap-contract.ts",
    ],
  },
  {
    registryKey: "local-ai-model-files",
    soleOwner: "packages/desktop/src/lib/local-ai-models.ts",
    locality: "derived",
    role: "cache",
    authoritative: false,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: `${APP_DATA}/local-ai-models/<modelId>/<manifestRevision>/<manifestPath>`,
      keys: ["manifest file path", "<target>.partial"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Model removal or factory reset deletes downloaded and partial files.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "Every model file is verified against a pinned manifest and can be downloaded again.",
    },
    sourceReferences: ["packages/desktop/src/lib/local-ai-models.ts"],
  },
  {
    registryKey: "local-ai-model-state",
    soleOwner: "packages/desktop/src/lib/local-ai-models.ts",
    locality: "device-local",
    role: "derived-runtime",
    authoritative: true,
    physicalStores: [{
      kind: "native-json",
      platforms: ["desktop"],
      locator: `${APP_DATA}/local-ai-models/state.json`,
      keys: ["version", "selectedModelId", "models"],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Model removal or factory reset clears selection, install progress, and local health.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Installed-model selection and health remain device-local; model bytes are separately rebuildable.",
    },
    sourceReferences: ["packages/desktop/src/lib/local-ai-models.ts"],
  },
  {
    registryKey: "media-vault",
    soleOwner: "packages/desktop/src/lib/media-vault.ts",
    locality: "blob",
    role: "authoritative-device-source",
    authoritative: true,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: `${APP_DATA}/media-vault`,
      keys: [
        "manifest.json",
        "facebook/<safe-entry-id>.<extension>",
        "instagram/<safe-entry-id>.<extension>",
      ],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "Permanent media, roster records, and failure records have no current total byte or entry ceiling.",
    },
    backup: "include-private",
    export: "include-private",
    redaction: "retain-private-bytes",
    resetSemantics: "Only explicit vault removal or factory reset deletes permanent files and manifest state.",
    snapshot: "authoritative-source-manifest-required",
    migration: "migrate-to-library-core",
    cutover: {
      blocksCutover: true,
      reason: "The manifest and every retained Meta export byte are authoritative device-local sources requiring a fenced portable snapshot.",
    },
    sourceReferences: [
      "packages/desktop/src/lib/media-vault.ts",
      "packages/desktop/src/lib/meta-export-import.ts",
    ],
  },
  {
    registryKey: "provider-auth-hints",
    soleOwner: "Desktop provider authentication hint adapter",
    locality: "device-local",
    role: "control",
    authoritative: false,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: [
        "fb_auth_state",
        "ig_auth_state",
        "li_auth_state",
        "substack_auth_state",
        "medium_auth_state",
        "youtube_auth_state",
      ],
    }],
    retention: { kind: "until-disconnect" },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Disconnect or factory reset writes a disconnected hint; the WebView cookie store remains the authentication authority.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "These sanitized hints are not proof of provider authentication and remain outside Library Core.",
    },
    sourceReferences: [
      "packages/desktop/src/lib/fb-auth.ts",
      "packages/desktop/src/lib/instagram-auth.ts",
      "packages/desktop/src/lib/li-auth.ts",
      "packages/desktop/src/lib/substack-auth.ts",
      "packages/desktop/src/lib/medium-auth.ts",
      "packages/desktop/src/lib/youtube-auth.ts",
    ],
  },
  {
    registryKey: "provider-health",
    soleOwner: "packages/desktop/src/lib/provider-health.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [
      {
        kind: "native-json",
        platforms: ["desktop"],
        locator: `${APP_DATA}/sync-health.json`,
        keys: ["provider-health"],
      },
      {
        kind: "local-storage",
        platforms: ["desktop"],
        locator: "origin:localStorage",
        keys: ["freed.provider-health", "__TAURI_MOCK_STORE__:sync-health.json"],
      },
    ],
    retention: {
      kind: "bounded-by-rule",
      rules: [
        { scope: "provider attempts", limit: 20, unit: "attempts per provider" },
        { scope: "feed attempts", limit: 5, unit: "attempts per feed" },
        { scope: "daily summaries", limit: 7, unit: "buckets" },
        { scope: "hourly summaries", limit: 24, unit: "buckets" },
      ],
    },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset clears provider and feed histories, pause state, and repair artifacts.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The native JSON file remains the sole request-history authority; feed attempts are separately capped at 5 per feed.",
    },
    sourceReferences: ["packages/desktop/src/lib/provider-health.ts"],
  },
  {
    registryKey: "provider-user-agents",
    soleOwner: "packages/desktop/src/lib/user-agent.ts",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: [
        "freed_ua_facebook",
        "freed_ua_instagram",
        "freed_ua_linkedin",
        "freed_ua_substack",
        "freed_ua_medium",
        "freed_ua_x",
      ],
    }],
    retention: { kind: "until-disconnect" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Provider disconnect removes that provider's persisted user agent so reconnect chooses a new one.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: false,
      reason: "Provider-facing identity material remains outside every Library Core operation, snapshot, export, backup, and diagnostic artifact.",
    },
    sourceReferences: ["packages/desktop/src/lib/user-agent.ts"],
  },
  {
    registryKey: "provider-webview-sessions-linux",
    soleOwner: "Tauri WebKitGTK provider WebView profile",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "webkitgtk-data-store",
      platforms: ["desktop-linux"],
      locator: "unresolved:Tauri WebKitGTK profile root, identifier mapping, and physical cookie ownership are not proven by current source",
      keys: [
        "66726565-64fb-0001-9a7d-370102fb0001 (facebook)",
        "66726565-641a-0002-9a7d-3701021a0002 (instagram)",
        "66726565-641d-0003-9a7d-3701021d0003 (linkedin)",
        "66726565-645b-0004-9a7d-3701025b0004 (substack)",
        "66726565-646d-0005-9a7d-3701026d0005 (medium)",
        "66726565-6479-7401-9a7d-370102797401 (youtube)",
        "freed.essay.roster.v1 (substack sessionStorage)",
        "freed.essay.roster.v1 (medium sessionStorage)",
      ],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "The current source does not prove WebKitGTK profile lifetime, eviction, or physical removal.",
    },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Disconnect calls clear_all_browsing_data only through a live or temporary provider window. The current source does not prove identifier isolation or physical deletion on Linux.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: true,
      reason: "Gate A must prove the Linux profile owner, provider isolation, and deletion semantics while continuing to exclude all session bytes from Library Core artifacts.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/lib.rs",
      "packages/desktop/src-tauri/src/medium-extract.js",
      "packages/desktop/src-tauri/src/substack-extract.js",
      "packages/desktop/src-tauri/src/youtube.rs",
    ],
  },
  {
    registryKey: "provider-webview-sessions-macos",
    soleOwner: "Tauri WebKit provider WebsiteDataStore identifiers",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "webkit-data-store",
      platforms: ["desktop-macos"],
      locator: "$HOME/Library/WebKit/<bundleId>/WebsiteDataStore/<identifier>",
      keys: [
        "66726565-64fb-0001-9a7d-370102fb0001 (facebook)",
        "66726565-641a-0002-9a7d-3701021a0002 (instagram)",
        "66726565-641d-0003-9a7d-3701021d0003 (linkedin)",
        "66726565-645b-0004-9a7d-3701025b0004 (substack)",
        "66726565-646d-0005-9a7d-3701026d0005 (medium)",
        "66726565-6479-7401-9a7d-370102797401 (youtube)",
        "freed.essay.roster.v1 (substack sessionStorage)",
        "freed.essay.roster.v1 (medium sessionStorage)",
      ],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "YouTube explicitly removes its data store on Apple, but Facebook, Instagram, and LinkedIn clear only an existing window and essay-provider cleanup depends on a live or temporary window succeeding.",
    },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "YouTube disconnect fetches and removes its Apple data-store identifier. Other providers call clear_all_browsing_data conditionally and do not prove physical directory removal.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: true,
      reason: "Gate A must close the conditional cleanup gap for every macOS provider data store while continuing to exclude all session bytes from Library Core artifacts.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/lib.rs",
      "packages/desktop/src-tauri/src/medium-extract.js",
      "packages/desktop/src-tauri/src/substack-extract.js",
      "packages/desktop/src-tauri/src/youtube.rs",
    ],
  },
  {
    registryKey: "provider-webview-sessions-windows",
    soleOwner: "Tauri WebView2 provider profile",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "webview2-data-store",
      platforms: ["desktop-windows"],
      locator: "unresolved:Tauri WebView2 user-data root, identifier mapping, and physical cookie ownership are not proven by current source",
      keys: [
        "66726565-64fb-0001-9a7d-370102fb0001 (facebook)",
        "66726565-641a-0002-9a7d-3701021a0002 (instagram)",
        "66726565-641d-0003-9a7d-3701021d0003 (linkedin)",
        "66726565-645b-0004-9a7d-3701025b0004 (substack)",
        "66726565-646d-0005-9a7d-3701026d0005 (medium)",
        "66726565-6479-7401-9a7d-370102797401 (youtube)",
        "freed.essay.roster.v1 (substack sessionStorage)",
        "freed.essay.roster.v1 (medium sessionStorage)",
      ],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "The current source does not prove WebView2 profile lifetime, identifier isolation, eviction, or physical removal.",
    },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Disconnect calls clear_all_browsing_data only through a live or temporary provider window. The Apple-only remove_data_store path does not run on Windows.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: true,
      reason: "Gate A must prove the Windows profile owner, provider isolation, and deletion semantics while continuing to exclude all session bytes from Library Core artifacts.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/lib.rs",
      "packages/desktop/src-tauri/src/medium-extract.js",
      "packages/desktop/src-tauri/src/substack-extract.js",
      "packages/desktop/src-tauri/src/youtube.rs",
    ],
  },
  {
    registryKey: "pwa-automerge-worker-debug",
    soleOwner: "packages/pwa/src/lib/automerge-worker-debug.ts",
    locality: "derived",
    role: "telemetry",
    authoritative: false,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["pwa"],
      locator: "origin:localStorage",
      keys: ["freed:pwa:automerge-worker-debug:v1"],
    }],
    retention: { kind: "bounded-count", limit: 30, unit: "events" },
    backup: "exclude-derived",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset removes all persisted worker debug events.",
    snapshot: "excluded",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "Bounded worker diagnostics are non-authoritative and must never seed Library Core state.",
    },
    sourceReferences: ["packages/pwa/src/lib/automerge-worker-debug.ts"],
  },
  {
    registryKey: "pwa-factory-reset-coordination",
    soleOwner: "packages/pwa/src/lib/factory-reset-coordinator.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [
      {
        kind: "local-storage",
        platforms: ["pwa"],
        locator: "origin:localStorage",
        keys: [
          "freed_pwa_installation_generation",
          "freed_pwa_factory_reset_tombstone",
          "freed_pwa_factory_reset_message",
          "freed_pwa_runtime_<runtimeId>",
          "freed_pwa_factory_reset_ack_<resetId>_<runtimeId>",
          "freed_pwa_factory_reset_claim_<claimId>",
          "freed_pwa_factory_reset_reload_envelope",
        ],
      },
      {
        kind: "session-storage",
        platforms: ["pwa"],
        locator: "origin:sessionStorage",
        keys: ["freed_pwa_factory_reset_reload"],
      },
    ],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "The winning reset transaction advances generation, tombstones stale runtimes, reloads peers, then prunes transient coordination records.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Generation and reset barriers remain PWA installation controls outside library content.",
    },
    sourceReferences: ["packages/pwa/src/lib/factory-reset-coordinator.ts"],
  },
  {
    registryKey: "pwa-install-notice",
    soleOwner: "packages/pwa/src/lib/pwa-install.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["pwa"],
      locator: "origin:localStorage",
      keys: ["freed.pwa.install.dismissed"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "The current PWA factory reset preserves the dismissal marker. A successful installation or direct clearInstallNoticeDismissal call removes it.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The installation prompt dismissal is PWA chrome state, not library authority.",
    },
    sourceReferences: ["packages/pwa/src/lib/pwa-install.ts"],
  },
  {
    registryKey: "pwa-legal-consent",
    soleOwner: "packages/pwa/src/lib/legal-consent.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["pwa"],
      locator: "origin:localStorage",
      keys: ["freed.legal.pwa.bundle"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "redact-sensitive-fields",
    resetSemantics: "The current PWA factory reset preserves legal acceptance. Clearing origin site data removes it; accepting a later legal bundle replaces it.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "PWA legal acceptance remains installation-local control state outside library content.",
    },
    sourceReferences: ["packages/pwa/src/lib/legal-consent.ts"],
  },
  {
    registryKey: "pwa-oauth-pkce",
    soleOwner: "PWA OAuth redirect transaction coordinator",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "session-storage",
      platforms: ["pwa"],
      locator: "origin:sessionStorage",
      keys: [
        "freed_pkce_verifier",
        "freed_pkce_provider",
        "freed_pkce_google_redirect_uri",
        "freed_pkce_installation_generation",
      ],
    }],
    retention: { kind: "process-lifetime" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "OAuth callback consumes verifier and provider; factory reset invalidates the installation generation.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: false,
      reason: "PKCE material is ephemeral authentication state and cannot enter a library artifact.",
    },
    sourceReferences: [
      "packages/pwa/src/lib/cloud-oauth.ts",
      "packages/pwa/src/lib/oauth-redirect.ts",
      "packages/pwa/src/components/OAuthCallback.tsx",
      "packages/pwa/src/components/SyncConnectDialog.tsx",
    ],
  },
  {
    registryKey: "pwa-reader-content",
    soleOwner: "packages/ui/src/lib/article-cache.ts",
    locality: "blob",
    role: "authoritative-device-source",
    authoritative: true,
    physicalStores: [
      {
        kind: "cache-api",
        platforms: ["pwa"],
        locator: "origin:CacheStorage/freed-articles-v1",
        keys: ["<articleUrl>", "/content/<globalId>"],
      },
      {
        kind: "cache-api",
        platforms: ["pwa"],
        locator: "origin:CacheStorage/freed-articles-pinned-v1",
        keys: ["<articleUrl>", "/content/<globalId>", "/pinned-content/<globalId>"],
      },
    ],
    retention: {
      kind: "unbounded-current",
      reason: "Neither authoritative cache namespace has a current byte or entry ceiling and browser eviction is possible.",
    },
    backup: "include-private",
    export: "include-private",
    redaction: "retain-private-bytes",
    resetSemantics: "The current PWA factory reset preserves both namespaces. Browser eviction or clearing origin CacheStorage deletes entries; there is no current app cache-wide deletion path.",
    snapshot: "authoritative-source-manifest-required",
    migration: "migrate-to-library-core",
    cutover: {
      blocksCutover: true,
      reason: "Either namespace may hold the only complete article body; every request entry needs an immutable lookup plan and source disposition.",
    },
    sourceReferences: [
      "packages/ui/src/lib/article-cache.ts",
      "packages/pwa/src/lib/reader-cache.ts",
    ],
  },
  {
    registryKey: "pwa-relay-credential",
    soleOwner: "packages/pwa/src/lib/sync.ts",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["pwa"],
      locator: "origin:localStorage",
      keys: ["freed_relay_url"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Explicit relay cleanup or factory reset removes the relay URL, including its pairing-token query value.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: false,
      reason: "The relay URL is authentication material and remains outside every Library Core artifact.",
    },
    sourceReferences: ["packages/pwa/src/lib/sync.ts"],
  },
  {
    registryKey: "pwa-release-channel",
    soleOwner: "packages/ui/src/lib/release-channel.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["pwa"],
      locator: "origin:localStorage",
      keys: ["freed-release-channel"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "The current PWA factory reset preserves the release channel. Explicit channel selection replaces it, and clearing origin site data removes it.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Release selection is an installation control and does not enter the library.",
    },
    sourceReferences: ["packages/ui/src/lib/release-channel.ts"],
  },
  {
    registryKey: "pwa-service-worker-build-caches",
    soleOwner: "packages/pwa/vite.config.ts",
    locality: "derived",
    role: "cache",
    authoritative: false,
    physicalStores: [
      {
        kind: "cache-api",
        platforms: ["pwa"],
        locator: "origin:CacheStorage/freed-wasm",
        keys: ["GET <http-or-https URL ending .wasm>"],
      },
      {
        kind: "cache-api",
        platforms: ["pwa"],
        locator: "origin:CacheStorage/workbox-precache-v2-<scope>",
        keys: ["build manifest:**/*.{js,css,html,ico,png,svg}"],
      },
    ],
    retention: { kind: "browser-managed" },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "The current PWA factory reset preserves both namespaces. Browser eviction, site-data clearing, or service-worker cache replacement may delete entries.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "WASM and build assets are reproducible from an exact build and must never seed Library Core state.",
    },
    sourceReferences: ["packages/pwa/vite.config.ts"],
  },
  {
    registryKey: "pwa-service-worker-network-cache",
    soleOwner: "packages/pwa/vite.config.ts",
    locality: "secret",
    role: "cache",
    authoritative: false,
    physicalStores: [{
      kind: "cache-api",
      platforms: ["pwa"],
      locator: "origin:CacheStorage/freed-network",
      keys: ["GET <http-or-https URL matched by the catch-all rule>"],
    }],
    retention: {
      kind: "bounded-by-rule",
      rules: [
        { scope: "Workbox expiration entries", limit: 200, unit: "requests" },
        { scope: "Workbox expiration age", limit: 7, unit: "days" },
      ],
    },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "The current PWA factory reset preserves this namespace. Browser eviction, Workbox expiration, or clearing origin CacheStorage deletes entries.",
    snapshot: "excluded",
    migration: "retire-with-legacy-epoch",
    cutover: {
      blocksCutover: true,
      reason: "The catch-all rule has no public-only or unauthenticated-response filter, so the cache can retain external authenticated response bytes. Gate A must delete the namespace and replace it with classified cache rules.",
    },
    sourceReferences: ["packages/pwa/vite.config.ts"],
  },
  {
    registryKey: "pwa-service-worker-sync-cache",
    soleOwner: "packages/pwa/vite.config.ts",
    locality: "synchronized",
    role: "authoritative-device-source",
    authoritative: true,
    physicalStores: [{
      kind: "cache-api",
      platforms: ["pwa"],
      locator: "origin:CacheStorage/freed-sync-v1",
      keys: ["GET <origin>/sync[?<query>]"],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "The NetworkFirst rule has no expiration policy and accepts distinct query URLs.",
    },
    backup: "legacy-recovery-only",
    export: "legacy-compatibility",
    redaction: "retain-private-bytes",
    resetSemantics: "The current PWA factory reset preserves this namespace. Browser eviction or clearing origin CacheStorage deletes entries.",
    snapshot: "legacy-recovery",
    migration: "retire-with-legacy-epoch",
    cutover: {
      blocksCutover: true,
      reason: "The service worker can return a cached legacy /sync response offline. Gate A must delete or epoch-fence the namespace before a Library Core reader can interpret the response.",
    },
    sourceReferences: ["packages/pwa/vite.config.ts"],
  },
  {
    registryKey: "reader-image-cache",
    soleOwner: "packages/ui/src/lib/article-cache.ts",
    locality: "derived",
    role: "cache",
    authoritative: false,
    physicalStores: [{
      kind: "cache-api",
      platforms: ["desktop", "pwa"],
      locator: "origin:CacheStorage/freed-images",
      keys: ["<resolved-http-or-https-image-url>"],
    }],
    retention: { kind: "browser-managed" },
    backup: "exclude-derived",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "The current PWA factory reset preserves the image cache. Browser eviction or clearing origin CacheStorage deletes images; the HTML/source URL can warm them again.",
    snapshot: "rebuildable",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "Image responses are rebuildable and are never the sole authoritative reader body.",
    },
    sourceReferences: ["packages/ui/src/lib/article-cache.ts"],
  },
  {
    registryKey: "reader-offline-cache-mode",
    soleOwner: "packages/ui/src/lib/reader-cache-settings.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop", "pwa"],
      locator: "origin:localStorage",
      keys: ["freed.reader.offlineCacheMode"],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "The current PWA factory reset preserves this preference. A new selection replaces it, and clearing origin site data restores the saved_only default.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The preference remains device-local; it does not determine whether already retained content is authoritative.",
    },
    sourceReferences: ["packages/ui/src/lib/reader-cache-settings.ts"],
  },
  {
    registryKey: "release-log-files",
    soleOwner: "packages/desktop/src-tauri/src/lib.rs",
    locality: "derived",
    role: "telemetry",
    authoritative: false,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: "appLogDir()",
      keys: ["<tauri-plugin-log rotating file>"],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "Release logs rotate at 10 MiB per file with RotationStrategy::KeepAll, so file count and total bytes have no current ceiling.",
    },
    backup: "exclude-derived",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "The current factory-reset path does not delete appLogDir(). A bug-report export reads and sanitizes recent lines, but it does not remove source log files.",
    snapshot: "excluded",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "Release logs are diagnostic derivatives and must never become library or migration authority.",
    },
    sourceReferences: [
      "packages/desktop/src-tauri/src/lib.rs",
      "packages/desktop/src/lib/bug-report.ts",
    ],
  },
  {
    registryKey: "rss-runtime-state",
    soleOwner: "packages/desktop/src/lib/rss-runtime-state.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: ["freed-device-rss-runtime-v1", VERSIONED_RECOVERY],
    }],
    retention: { kind: "bounded-count", limit: 10_000, unit: "feed URLs" },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Feed removal deletes its scheduler record; factory reset clears the ledger and retry barriers.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "The scheduler ledger is retained locally; legacy etag and lastModified fields remain compatibility-only and are not current local authority.",
    },
    sourceReferences: [
      "packages/desktop/src/lib/rss-runtime-state.ts",
      "packages/shared/src/sync-write-policy.ts",
    ],
  },
  {
    registryKey: "runtime-observability",
    soleOwner: "packages/desktop/src-tauri/src/lib.rs",
    locality: "derived",
    role: "telemetry",
    authoritative: false,
    physicalStores: [{
      kind: "filesystem",
      platforms: ["desktop"],
      locator: APP_DATA,
      keys: [
        "runtime-health.jsonl or runtime-health-<YYYY-MM-DD>.jsonl",
        "runtime-diagnostics.jsonl",
        "startup-recovery.json",
        ".runtime-health.writer.lock",
      ],
    }],
    retention: {
      kind: "bounded-by-rule",
      rules: [
        { scope: "runtime-health dated files", limit: 14, unit: "days" },
        { scope: "runtime-health current file on non-Unix", limit: 5_242_880, unit: "bytes" },
        { scope: "runtime-diagnostics.jsonl", limit: 5_242_880, unit: "bytes" },
      ],
    },
    backup: "exclude-derived",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset removes runtime health, diagnostics, startup recovery state, and writer lock.",
    snapshot: "excluded",
    migration: "rebuild-after-cutover",
    cutover: {
      blocksCutover: false,
      reason: "Diagnostics may prove migration behavior but are not library authority.",
    },
    sourceReferences: ["packages/desktop/src-tauri/src/lib.rs"],
  },
  {
    registryKey: "scraper-window-modes",
    soleOwner: "packages/desktop/src/lib/scraper-prefs.ts",
    locality: "device-local",
    role: "control",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: [
        "fb_scraper_debug_window",
        "ig_scraper_debug_window",
        "li_scraper_debug_window",
        "substack_scraper_debug_window",
        "medium_scraper_debug_window",
      ],
    }],
    retention: { kind: "until-reset" },
    backup: "exclude-device-local",
    export: "exclude",
    redaction: "not-applicable",
    resetSemantics: "Removing a key restores the hidden mode. The current factory-reset path relies on browser-origin clearing rather than calling this module directly.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Window presentation mode remains a device-local provider control and never enters Library Core artifacts.",
    },
    sourceReferences: ["packages/desktop/src/lib/scraper-prefs.ts"],
  },
  {
    registryKey: "secure-api-keys",
    soleOwner: "packages/desktop/src/lib/secure-storage.ts",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "native-json",
      platforms: ["desktop"],
      locator: `${APP_DATA}/secure.json`,
      keys: [
        "apiKey.openai",
        "apiKey.anthropic",
        "apiKey.gemini",
        "apiKey.github_story_wall",
      ],
    }],
    retention: { kind: "until-explicit-delete" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "Explicit key removal or factory reset deletes the provider key.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: false,
      reason: "API keys remain in the current plugin-store JSON authority and are forbidden in every Library Core artifact; at-rest hardening is separate security debt.",
    },
    sourceReferences: ["packages/desktop/src/lib/secure-storage.ts"],
  },
  {
    registryKey: "snapshots",
    soleOwner: "packages/desktop/src/lib/snapshots.ts",
    locality: "compatibility",
    role: "backup",
    authoritative: false,
    physicalStores: [
      {
        kind: "filesystem",
        platforms: ["desktop"],
        locator: `${APP_DATA}/snapshots`,
        keys: ["index.json", "<snapshotId>.automerge", "<snapshotId>.contacts.json"],
      },
      {
        kind: "local-storage",
        platforms: ["desktop"],
        locator: "origin:localStorage",
        keys: ["freed.snapshots"],
      },
    ],
    retention: { kind: "bounded-count", limit: 24, unit: "snapshots" },
    backup: "legacy-recovery-only",
    export: "legacy-compatibility",
    redaction: "retain-private-bytes",
    resetSemantics: "Factory reset deletes native snapshots and browser fallback snapshots.",
    snapshot: "legacy-recovery",
    migration: "retain-legacy-recovery",
    cutover: {
      blocksCutover: false,
      reason: "Legacy snapshots stay explicit recovery inputs and never override the elected immutable migration source.",
    },
    sourceReferences: ["packages/desktop/src/lib/snapshots.ts"],
  },
  {
    registryKey: "social-outbox-state",
    soleOwner: "packages/desktop/src/lib/social-outbox-state.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: ["freed-device-social-outbox-v1", VERSIONED_RECOVERY],
    }],
    retention: {
      kind: "bounded-by-rule",
      rules: [
        { scope: "provider intents", limit: 2_000, unit: "intents" },
        { scope: "one provider intent", limit: 3, unit: "attempts" },
      ],
    },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "Factory reset clears intent, retry, and provider-confirmation state; each intent permits at most 3 attempts.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: false,
      reason: "Execution receipts remain the Desktop outbox authority and are not synchronized library operations.",
    },
    sourceReferences: ["packages/desktop/src/lib/social-outbox-state.ts"],
  },
  {
    registryKey: "x-manual-cookies",
    soleOwner: "packages/desktop/src/lib/x-auth.ts",
    locality: "secret",
    role: "secret",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: ["x_auth_cookies"],
    }],
    retention: { kind: "until-disconnect" },
    backup: "exclude-secret",
    export: "exclude",
    redaction: "drop-entire-value",
    resetSemantics: "X disconnect or factory reset removes ct0 and authToken.",
    snapshot: "excluded",
    migration: "exclude-secret-and-retain-current-owner",
    cutover: {
      blocksCutover: false,
      reason: "X cookies remain outside Library Core and every backup, manifest, segment, log, and telemetry event.",
    },
    sourceReferences: ["packages/desktop/src/lib/x-auth.ts"],
  },
  {
    registryKey: "youtube-offline-playlist",
    soleOwner: "packages/desktop/src/lib/youtube-playlist.ts",
    locality: "device-local",
    role: "active-authority",
    authoritative: true,
    physicalStores: [{
      kind: "local-storage",
      platforms: ["desktop"],
      locator: "origin:localStorage",
      keys: ["youtube_offline_playlist_state"],
    }],
    retention: {
      kind: "unbounded-current",
      reason: "The current playlist execution record has no explicit entry or byte ceiling.",
    },
    backup: "exclude-device-local",
    export: "include-redacted-metadata",
    redaction: "redact-sensitive-fields",
    resetSemantics: "YouTube disconnect clears playlist progress; factory reset preserves only governed request receipts outside this store.",
    snapshot: "excluded",
    migration: "retain-current-device-owner",
    cutover: {
      blocksCutover: true,
      reason: "The synced video-ID receipt set has no measured entry or byte limit. Gate A cannot retain this sole provider-action progress authority without a bounded policy.",
    },
    sourceReferences: ["packages/desktop/src/lib/youtube-playlist.ts"],
  },
] as const satisfies readonly LibraryCoreLocalAuthorityRegistryEntry[];

export interface LibraryCoreLocalAuthoritySourceOwner {
  readonly registryKey: string;
  readonly sourcePath: string;
  /**
   * Stable source tokens that identify the current persistence owner. Tests
   * read the checked-in source and require every token. This is deliberately
   * not described as AST exhaustiveness.
   */
  readonly sourceTokens: readonly string[];
  /** Exact registry key descriptors owned by that source. */
  readonly registeredKeys: readonly string[];
}

/**
 * Checked-in source-owner manifest for the persistence constants audited in
 * this Gate A slice. A new product persistence family must add its source
 * owner here and a registry entry above. Dynamic key builders use their stable
 * prefix/function token plus the closed key expansion registered above.
 */
export const LIBRARY_CORE_LOCAL_AUTHORITY_SOURCE_OWNERS = [
  {
    registryKey: "authenticated-essay-capture-cooldowns",
    sourcePath: "packages/desktop/src/lib/authenticated-essay-capture.ts",
    sourceTokens: [
      'const COOLDOWN_STORAGE_PREFIX = "freed.capture-cooldown"',
      "function cooldownStorageKey",
    ],
    registeredKeys: [
      "freed.capture-cooldown.substack",
      "freed.capture-cooldown.medium",
    ],
  },
  {
    registryKey: "automerge-cloud-dropbox",
    sourcePath: "packages/sync/src/cloud/dropbox.ts",
    sourceTokens: [
      'const FILE_NAME = "freed.automerge"',
      "const DBX_PATH = `/Apps/Freed/${FILE_NAME}`",
    ],
    registeredKeys: ["/Apps/Freed/freed.automerge"],
  },
  {
    registryKey: "automerge-cloud-google-drive",
    sourcePath: "packages/sync/src/cloud/gdrive.ts",
    sourceTokens: [
      'const FILE_NAME = "freed.automerge"',
      'parents: ["appDataFolder"]',
    ],
    registeredKeys: ["freed.automerge"],
  },
  {
    registryKey: "automerge-local-document",
    sourcePath: "packages/sync/src/storage/indexeddb.ts",
    sourceTokens: [
      'const DB_NAME = "freed"',
      "const DB_VERSION = 3",
      'const STORE_NAME = "automerge"',
      'const DOC_KEY = "feed"',
      'const DOCUMENT_GENERATION_KEY = "feed:installation-generation"',
      'const SAVE_REVISION_KEY = "feed:save-revision"',
      'const DOCUMENT_CHUNK_COUNT_KEY = "feed:chunk-count"',
      'const DOCUMENT_BYTE_LENGTH_KEY = "feed:byte-length"',
      'const DOCUMENT_CHUNK_KEY_PREFIX = "feed:chunk:"',
    ],
    registeredKeys: [
      "feed",
      "feed:installation-generation",
      "feed:save-revision",
      "feed:chunk-count",
      "feed:byte-length",
      "feed:chunk:<index>",
    ],
  },
  {
    registryKey: "clipboard-save-shortcut",
    sourcePath: "packages/desktop/src/lib/clipboard-save-shortcut.ts",
    sourceTokens: ['const STORE_FILE = "clipboard-save-shortcut.json"'],
    registeredKeys: ["enabled", "shortcut"],
  },
  {
    registryKey: "cloud-oauth-credentials",
    sourcePath: "packages/desktop/src/lib/sync.ts",
    sourceTokens: [
      "const CLOUD_TOKEN_KEY = (p: CloudProvider) => `freed_cloud_token_${p}`",
      "const CLOUD_TOKEN_META_KEY = (p: CloudProvider) => `freed_cloud_token_meta_${p}`",
    ],
    registeredKeys: [
      "freed_cloud_token_gdrive",
      "freed_cloud_token_dropbox",
      "freed_cloud_token_meta_gdrive",
      "freed_cloud_token_meta_dropbox",
    ],
  },
  {
    registryKey: "cloud-oauth-credentials",
    sourcePath: "packages/pwa/src/lib/sync.ts",
    sourceTokens: [
      "const CLOUD_TOKEN_KEY = (provider: CloudProvider) =>\n  `freed_cloud_token_${provider}`",
      "const CLOUD_TOKEN_META_KEY = (provider: CloudProvider) =>\n  `freed_cloud_token_meta_${provider}`",
      'const CLOUD_PROVIDER_KEY = "freed_cloud_provider"',
    ],
    registeredKeys: [
      "freed_cloud_token_gdrive",
      "freed_cloud_token_dropbox",
      "freed_cloud_token_meta_gdrive",
      "freed_cloud_token_meta_dropbox",
      "freed_cloud_provider",
    ],
  },
  {
    registryKey: "contact-sync-state",
    sourcePath: "packages/shared/src/contact-sync-state.ts",
    sourceTokens: [
      'export const CONTACT_SYNC_STORAGE_KEY = "freed_contact_sync"',
    ],
    registeredKeys: ["freed_contact_sync"],
  },
  {
    registryKey: "desktop-client-registration",
    sourcePath: "packages/desktop/src/lib/desktop-client-registration.ts",
    sourceTokens: [
      'const STORE_FILE = "desktop-client.json"',
      'const STORE_KEY = "registration"',
      'const FALLBACK_STORAGE_KEY = "freed-desktop-client-registration-v1"',
    ],
    registeredKeys: [
      "registration",
      "freed-desktop-client-registration-v1",
      "freed-desktop-client-registration-v1.recovery.<capturedAtMs>",
    ],
  },
  {
    registryKey: "desktop-client-warning-acknowledgement",
    sourcePath: "packages/desktop/src/lib/desktop-client-warning.ts",
    sourceTokens: [
      'const DESKTOP_WARNING_ACK_KEY = "freed-multiple-desktop-warning-ack-v1"',
    ],
    registeredKeys: ["freed-multiple-desktop-warning-ack-v1"],
  },
  {
    registryKey: "desktop-legal-consent",
    sourcePath: "packages/desktop/src/lib/legal-consent.ts",
    sourceTokens: [
      'const DESKTOP_BUNDLE_KEY = "legal.bundle.desktop"',
      'const PROVIDER_PREFIX = "legal.provider"',
      'const FALLBACK_STORAGE_PREFIX = "freed.legal."',
      'const LEGAL_STORE_FILE = "legal.json"',
    ],
    registeredKeys: [
      "legal.bundle.desktop",
      "legal.provider.x",
      "legal.provider.facebook",
      "legal.provider.instagram",
      "legal.provider.linkedin",
      "legal.provider.substack",
      "legal.provider.medium",
      "legal.provider.youtube",
      "freed.legal.legal.bundle.desktop",
      "freed.legal.legal.provider.x",
      "freed.legal.legal.provider.facebook",
      "freed.legal.legal.provider.instagram",
      "freed.legal.legal.provider.linkedin",
      "freed.legal.legal.provider.substack",
      "freed.legal.legal.provider.medium",
      "freed.legal.legal.provider.youtube",
    ],
  },
  {
    registryKey: "desktop-legal-consent",
    sourcePath: "packages/shared/src/legal.ts",
    sourceTokens: ["export type ProviderRiskId ="],
    registeredKeys: [
      "legal.provider.x",
      "legal.provider.facebook",
      "legal.provider.instagram",
      "legal.provider.linkedin",
      "legal.provider.substack",
      "legal.provider.medium",
      "legal.provider.youtube",
      "freed.legal.legal.provider.x",
      "freed.legal.legal.provider.facebook",
      "freed.legal.legal.provider.instagram",
      "freed.legal.legal.provider.linkedin",
      "freed.legal.legal.provider.substack",
      "freed.legal.legal.provider.medium",
      "freed.legal.legal.provider.youtube",
    ],
  },
  {
    registryKey: "desktop-pairing-token",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: ['data_dir.join("pairing-token")'],
    registeredKeys: ["raw pairing token bytes"],
  },
  {
    registryKey: "desktop-reader-content",
    sourcePath: "packages/desktop/src/lib/content-cache.ts",
    sourceTokens: [
      'const dir = `${dataDir}/content`',
      "function idToFilename",
    ],
    registeredKeys: ["<sanitized-globalId>.html"],
  },
  {
    registryKey: "desktop-release-channel",
    sourcePath: "packages/desktop/src/lib/release-channel.ts",
    sourceTokens: [
      'const DESKTOP_RELEASE_CHANNEL_STORE_FILE = "release-channel.json"',
      'const DESKTOP_RELEASE_CHANNEL_STORE_KEY = "channel"',
      'const DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY = "installedChannel"',
    ],
    registeredKeys: ["channel", "installedChannel"],
  },
  {
    registryKey: "desktop-release-channel",
    sourcePath: "packages/ui/src/lib/release-channel.ts",
    sourceTokens: [
      'export const RELEASE_CHANNEL_STORAGE_KEY = "freed-release-channel"',
    ],
    registeredKeys: ["freed-release-channel"],
  },
  {
    registryKey: "desktop-release-channel",
    sourcePath: "packages/desktop/src/lib/desktop-updater.ts",
    sourceTokens: [
      'export const JUST_UPDATED_KEY = "freed-updated-to"',
    ],
    registeredKeys: ["freed-updated-to"],
  },
  {
    registryKey: "desktop-webkit-network-cache",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: [
      "const WEBKIT_CACHE_TRIM_AT_BYTES: u64 = 768 * 1024 * 1024",
      "const WEBKIT_CACHE_TRIM_TARGET_BYTES: u64 = 512 * 1024 * 1024",
      'let network_cache_root = webkit_root.join("NetworkCache")',
    ],
    registeredKeys: ["<WebKit network-cache file>"],
  },
  {
    registryKey: "desktop-webkit-network-cache",
    sourcePath: "packages/desktop/src/lib/memory-monitor.ts",
    sourceTokens: [
      "const WEBKIT_CACHE_TRIM_AT_BYTES = 768 * 1024 * 1024",
      'invoke<WebkitCacheTrimResult>("trim_webkit_network_cache_now")',
    ],
    registeredKeys: ["<WebKit network-cache file>"],
  },
  {
    registryKey: "dev-sync-trigger-control",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: [
      'const DEV_SYNC_TRIGGER_FILE: &str = "dev-sync-trigger.json"',
      'const DEV_SYNC_TRIGGER_RESULT_FILE: &str = "dev-sync-trigger-result.json"',
      "const DEV_SYNC_TRIGGER_REQUEST_MAX_AGE_MS: u64 = 10 * 60 * 1000",
    ],
    registeredKeys: ["dev-sync-trigger.json", "dev-sync-trigger-result.json"],
  },
  {
    registryKey: "dev-sync-trigger-control",
    sourcePath: "packages/desktop/src/lib/dev-sync-triggers.ts",
    sourceTokens: [
      'const DEV_SYNC_TRIGGER_FILE = "dev-sync-trigger.json"',
      'const DEV_SYNC_TRIGGER_RESULT_FILE = "dev-sync-trigger-result.json"',
      "const DEV_SYNC_TRIGGER_REQUEST_MAX_AGE_MS = 10 * 60 * 1000",
    ],
    registeredKeys: ["dev-sync-trigger.json", "dev-sync-trigger-result.json"],
  },
  {
    registryKey: "device-ai-preferences",
    sourcePath: "packages/ui/src/lib/device-ai-preferences.ts",
    sourceTokens: [
      'export const DEVICE_AI_PREFERENCES_STORAGE_KEY = "freed-device-ai-preferences-v1"',
      "writeVersionedLocalStorage",
    ],
    registeredKeys: [
      "freed-device-ai-preferences-v1",
      "<key>.recovery.<capturedAtMs>.<sequence>",
    ],
  },
  {
    registryKey: "device-display-preferences",
    sourcePath: "packages/ui/src/lib/device-display-preferences.ts",
    sourceTokens: [
      'export const DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY = "freed-device-display-preferences-v1"',
      "writeVersionedLocalStorage",
    ],
    registeredKeys: [
      "freed-device-display-preferences-v1",
      "<key>.recovery.<capturedAtMs>.<sequence>",
    ],
  },
  {
    registryKey: "device-feed-card-density",
    sourcePath: "packages/ui/src/lib/feed-card-density.ts",
    sourceTokens: ['const STORAGE_KEY = "freed-feed-card-density"'],
    registeredKeys: ["freed-feed-card-density"],
  },
  {
    registryKey: "device-graph-layout",
    sourcePath: "packages/ui/src/lib/device-graph-layout.ts",
    sourceTokens: [
      'export const DEVICE_GRAPH_LAYOUT_STORAGE_KEY = "freed-device-graph-layout-v1"',
      "writeVersionedLocalStorage",
    ],
    registeredKeys: [
      "freed-device-graph-layout-v1",
      "<key>.recovery.<capturedAtMs>.<sequence>",
    ],
  },
  {
    registryKey: "device-interface-zoom",
    sourcePath: "packages/ui/src/lib/interface-zoom.ts",
    sourceTokens: ['const STORAGE_KEY = "freed-interface-zoom"'],
    registeredKeys: ["freed-interface-zoom"],
  },
  {
    registryKey: "device-theme",
    sourcePath: "packages/ui/src/lib/theme.ts",
    sourceTokens: ['export const THEME_STORAGE_KEY = "freed-theme"'],
    registeredKeys: ["freed-theme"],
  },
  {
    registryKey: "facebook-group-discovery",
    sourcePath: "packages/desktop/src/lib/facebook-group-discovery.ts",
    sourceTokens: [
      'export const FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY = "freed-device-facebook-groups-v1"',
      "writeVersionedLocalStorage",
    ],
    registeredKeys: [
      "freed-device-facebook-groups-v1",
      "<key>.recovery.<capturedAtMs>.<sequence>",
    ],
  },
  {
    registryKey: "factory-reset-cloud-cleanup-barrier",
    sourcePath: "packages/ui/src/lib/factory-reset.ts",
    sourceTokens: [
      'const FACTORY_RESET_CLOUD_CLEANUP_BARRIER_KEY =',
      '"freed_factory_reset_cloud_cleanup_pending"',
    ],
    registeredKeys: ["freed_factory_reset_cloud_cleanup_pending"],
  },
  {
    registryKey: "geocoding-cache",
    sourcePath: "packages/ui/src/lib/geocoding-cache.ts",
    sourceTokens: [
      'const DB_NAME = "freed-geocache"',
      'const STORE_NAME = "locations"',
    ],
    registeredKeys: ["query"],
  },
  {
    registryKey: "library-core-legacy-source-admission-key",
    sourcePath: "packages/desktop/src-tauri/src/library_core_migration_claim.rs",
    sourceTokens: [
      'account: "migration-source-current"',
      'envelope_format: "freed_library_core_migration_key_v1"',
    ],
    registeredKeys: ["migration-source-current"],
  },
  {
    registryKey: "library-core-actor-private-key",
    sourcePath: "packages/desktop/src-tauri/src/library_core_actor_enrollment.rs",
    sourceTokens: [
      'account: "actor-current"',
      'envelope_format: "freed_library_core_actor_key_v1"',
    ],
    registeredKeys: ["actor-current"],
  },
  {
    registryKey: "library-core-authority-private-key",
    sourcePath: "packages/desktop/src-tauri/src/library_core_authority_genesis.rs",
    sourceTokens: [
      'account: "authority-current"',
      'envelope_format: "freed_library_core_authority_key_v1"',
    ],
    registeredKeys: ["authority-current"],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src-tauri/src/library_core_external_migration_runtime.rs",
    sourceTokens: [
      'const MIGRATION_ROOT_DIRECTORY: &str = "library-core-external-migration-v1"',
      'const SPOOL_DIRECTORY: &str = "spool"',
      'const SCRATCH_DIRECTORY: &str = "scratch"',
    ],
    registeredKeys: [
      "library-core-external-migration-v1/scratch/<sessionSha256>.sqlite",
      "library-core-external-migration-v1/spool/<sessionSha256>.journal.jsonl",
      "library-core-external-migration-v1/spool/<sessionSha256>.snapshot",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src-tauri/src/library_core_shadow_runtime.rs",
    sourceTokens: [
      'const SHADOW_ROOT_DIRECTORY: &str = "library-core-shadow-v1"',
      'const GENERATION_DIRECTORY: &str = "generations"',
      'const REGISTRY_FILE: &str = "registry.sqlite"',
    ],
    registeredKeys: [
      "library-core-shadow-v1/generations/.<sourceKey>.staging.sqlite",
      "library-core-shadow-v1/generations/<sourceKey>.sqlite",
      "library-core-shadow-v1/registry.sqlite",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src-tauri/src/library_core_feed_browse_runtime.rs",
    sourceTokens: [
      'pub(super) const ROOT_DIRECTORY_FOR_ADAPTERS: &str = "library-core-feed-browse-v1"',
      'const GENERATION_DIRECTORY: &str = "generations"',
      'const REGISTRY_FILE: &str = "registry.sqlite"',
    ],
    registeredKeys: [
      "library-core-feed-browse-v1/generations/.<sourceKey>.staging.sqlite",
      "library-core-feed-browse-v1/generations/<sourceKey>.sqlite",
      "library-core-feed-browse-v1/registry.sqlite",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src-tauri/src/library_core_saved_feed_runtime.rs",
    sourceTokens: [
      'const ROOT_DIRECTORY: &str = "library-core-saved-feed-v1"',
    ],
    registeredKeys: [
      "library-core-saved-feed-v1/generations/.<sourceKey>.staging.sqlite",
      "library-core-saved-feed-v1/generations/<sourceKey>.sqlite",
      "library-core-saved-feed-v1/registry.sqlite",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src/lib/automerge.ts",
    sourceTokens: [
      'const LIBRARY_CORE_RENDERER_ITEM_EVICTION_DISABLED_KEY =',
      '"freed.libraryCore.rendererItemEvictionV1.disabled"',
    ],
    registeredKeys: [
      "freed.libraryCore.rendererItemEvictionV1.disabled",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src/lib/library-core-feed-browse-reader-runtime.ts",
    sourceTokens: [
      "LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY =",
      '"freed.libraryCore.feedBrowseReaderV1.disabled"',
      "LIBRARY_CORE_FRIENDS_FEED_READER_DISABLED_KEY =",
      '"freed.libraryCore.friendsFeedReaderV1.disabled"',
      "LIBRARY_CORE_FEED_BROWSE_BIDIRECTIONAL_READER_DISABLED_KEY =",
      '"freed.libraryCore.feedBrowseBidirectionalReaderV1.disabled"',
    ],
    registeredKeys: [
      "freed.libraryCore.feedBrowseBidirectionalReaderV1.disabled",
      "freed.libraryCore.feedBrowseReaderV1.disabled",
      "freed.libraryCore.friendsFeedReaderV1.disabled",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src/lib/library-core-item-detail-runtime.ts",
    sourceTokens: [
      "LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY =",
      '"freed.libraryCore.itemDetailReaderV1.disabled"',
      "LIBRARY_CORE_FRIENDS_READER_DISABLED_KEY =",
      '"freed.libraryCore.friendsReaderV1.disabled"',
      "LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY =",
      '"freed.libraryCore.savedAnalyticsReaderV1.disabled"',
    ],
    registeredKeys: [
      "freed.libraryCore.itemDetailReaderV1.disabled",
      "freed.libraryCore.friendsReaderV1.disabled",
      "freed.libraryCore.savedAnalyticsReaderV1.disabled",
    ],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/desktop/src/lib/library-core-saved-feed-reader-runtime.ts",
    sourceTokens: [
      "LIBRARY_CORE_SAVED_FEED_READER_DISABLED_KEY =",
      '"freed.libraryCore.savedFeedReaderV1.disabled"',
    ],
    registeredKeys: ["freed.libraryCore.savedFeedReaderV1.disabled"],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/ui/src/hooks/useLibraryCommandPaletteReader.ts",
    sourceTokens: [
      "LIBRARY_CORE_SEARCH_JUMP_READER_DISABLED_KEY =",
      '"freed.libraryCore.searchJumpReaderV1.disabled"',
    ],
    registeredKeys: ["freed.libraryCore.searchJumpReaderV1.disabled"],
  },
  {
    registryKey: "library-core-derived-runtime",
    sourcePath: "packages/pwa/src/lib/library-core-portable-checkpoint-store.ts",
    sourceTokens: [
      'const GENERATIONS_STORE = "portable_generations"',
      'const RECORDS_STORE = "portable_records"',
      'const PAGES_STORE = "portable_pages"',
      'const OPERATIONS_STORE = "portable_operations"',
      'const SEGMENTS_STORE = "portable_segments"',
      'const ACTOR_ENROLLMENTS_STORE = "portable_actor_enrollments"',
      'const ACTOR_TIPS_STORE = "portable_actor_tips"',
      'const AUTHENTICATED_OPERATIONS_STORE = "portable_authenticated_operations"',
      'const AUTHENTICATED_SEGMENTS_STORE = "portable_authenticated_segments"',
      'const MATERIALIZED_ROWS_STORE = "portable_materialized_rows"',
      'const READ_STATE_STORE = "portable_read_state"',
      'const CONTROL_STORE = "portable_control"',
      "const MAXIMUM_RETAINED_GENERATIONS = 2",
    ],
    registeredKeys: [
      "portable_generations",
      "portable_records",
      "portable_pages",
      "portable_operations",
      "portable_segments",
      "portable_actor_enrollments",
      "portable_actor_tips",
      "portable_authenticated_operations",
      "portable_authenticated_segments",
      "portable_materialized_rows",
      "portable_read_state",
      "portable_control",
    ],
  },
  {
    registryKey: "local-ai-model-files",
    sourcePath: "packages/desktop/src/lib/local-ai-models.ts",
    sourceTokens: [
      'const MODEL_ROOT_DIR = "local-ai-models"',
      "const partial = `${target}.partial`",
    ],
    registeredKeys: ["manifest file path", "<target>.partial"],
  },
  {
    registryKey: "local-ai-model-state",
    sourcePath: "packages/desktop/src/lib/local-ai-models.ts",
    sourceTokens: ['const STATE_FILE = "state.json"'],
    registeredKeys: ["version", "selectedModelId", "models"],
  },
  {
    registryKey: "media-vault",
    sourcePath: "packages/desktop/src/lib/media-vault.ts",
    sourceTokens: [
      'const MANIFEST_FILE = "manifest.json"',
      'const PROVIDERS: MediaVaultProvider[] = ["facebook", "instagram"]',
      "safeMediaVaultFilename",
      "extensionFromCandidate",
    ],
    registeredKeys: [
      "manifest.json",
      "facebook/<safe-entry-id>.<extension>",
      "instagram/<safe-entry-id>.<extension>",
    ],
  },
  {
    registryKey: "provider-auth-hints",
    sourcePath: "packages/desktop/src/lib/fb-auth.ts",
    sourceTokens: ['const FB_AUTH_KEY = "fb_auth_state"'],
    registeredKeys: ["fb_auth_state"],
  },
  {
    registryKey: "provider-auth-hints",
    sourcePath: "packages/desktop/src/lib/instagram-auth.ts",
    sourceTokens: ['const IG_AUTH_KEY = "ig_auth_state"'],
    registeredKeys: ["ig_auth_state"],
  },
  {
    registryKey: "provider-auth-hints",
    sourcePath: "packages/desktop/src/lib/li-auth.ts",
    sourceTokens: ['const LI_AUTH_KEY = "li_auth_state"'],
    registeredKeys: ["li_auth_state"],
  },
  {
    registryKey: "provider-auth-hints",
    sourcePath: "packages/desktop/src/lib/medium-auth.ts",
    sourceTokens: ['storageKey: "medium_auth_state"'],
    registeredKeys: ["medium_auth_state"],
  },
  {
    registryKey: "provider-auth-hints",
    sourcePath: "packages/desktop/src/lib/substack-auth.ts",
    sourceTokens: ['storageKey: "substack_auth_state"'],
    registeredKeys: ["substack_auth_state"],
  },
  {
    registryKey: "provider-auth-hints",
    sourcePath: "packages/desktop/src/lib/youtube-auth.ts",
    sourceTokens: ['const YOUTUBE_AUTH_KEY = "youtube_auth_state"'],
    registeredKeys: ["youtube_auth_state"],
  },
  {
    registryKey: "provider-health",
    sourcePath: "packages/desktop/src/lib/provider-health.ts",
    sourceTokens: [
      'const HEALTH_STORE_FILE = "sync-health.json"',
      'const HEALTH_STORE_KEY = "provider-health"',
      'const FALLBACK_STORAGE_KEY = "freed.provider-health"',
    ],
    registeredKeys: [
      "provider-health",
      "freed.provider-health",
      "__TAURI_MOCK_STORE__:sync-health.json",
    ],
  },
  {
    registryKey: "provider-user-agents",
    sourcePath: "packages/desktop/src/lib/user-agent.ts",
    sourceTokens: [
      'export type Platform = "facebook" | "instagram" | "linkedin" | "substack" | "medium" | "x"',
      "const storageKey = (platform: Platform) => `freed_ua_${platform}`",
    ],
    registeredKeys: [
      "freed_ua_facebook",
      "freed_ua_instagram",
      "freed_ua_linkedin",
      "freed_ua_substack",
      "freed_ua_medium",
      "freed_ua_x",
    ],
  },
  {
    registryKey: "provider-webview-sessions-linux",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: [
      "FB_SCRAPER_DATA_STORE_IDENTIFIER",
      "IG_SCRAPER_DATA_STORE_IDENTIFIER",
      "LI_SCRAPER_DATA_STORE_IDENTIFIER",
      "SUBSTACK_SCRAPER_DATA_STORE_IDENTIFIER",
      "MEDIUM_SCRAPER_DATA_STORE_IDENTIFIER",
    ],
    registeredKeys: [
      "66726565-64fb-0001-9a7d-370102fb0001 (facebook)",
      "66726565-641a-0002-9a7d-3701021a0002 (instagram)",
      "66726565-641d-0003-9a7d-3701021d0003 (linkedin)",
      "66726565-645b-0004-9a7d-3701025b0004 (substack)",
      "66726565-646d-0005-9a7d-3701026d0005 (medium)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-linux",
    sourcePath: "packages/desktop/src-tauri/src/medium-extract.js",
    sourceTokens: ['var ROSTER_STORAGE_KEY = "freed.essay.roster.v1"'],
    registeredKeys: [
      "freed.essay.roster.v1 (medium sessionStorage)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-linux",
    sourcePath: "packages/desktop/src-tauri/src/substack-extract.js",
    sourceTokens: ['var ROSTER_STORAGE_KEY = "freed.essay.roster.v1"'],
    registeredKeys: [
      "freed.essay.roster.v1 (substack sessionStorage)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-linux",
    sourcePath: "packages/desktop/src-tauri/src/youtube.rs",
    sourceTokens: ["YOUTUBE_SESSION_DATA_STORE_IDENTIFIER"],
    registeredKeys: [
      "66726565-6479-7401-9a7d-370102797401 (youtube)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-macos",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: [
      "FB_SCRAPER_DATA_STORE_IDENTIFIER",
      "IG_SCRAPER_DATA_STORE_IDENTIFIER",
      "LI_SCRAPER_DATA_STORE_IDENTIFIER",
      "SUBSTACK_SCRAPER_DATA_STORE_IDENTIFIER",
      "MEDIUM_SCRAPER_DATA_STORE_IDENTIFIER",
    ],
    registeredKeys: [
      "66726565-64fb-0001-9a7d-370102fb0001 (facebook)",
      "66726565-641a-0002-9a7d-3701021a0002 (instagram)",
      "66726565-641d-0003-9a7d-3701021d0003 (linkedin)",
      "66726565-645b-0004-9a7d-3701025b0004 (substack)",
      "66726565-646d-0005-9a7d-3701026d0005 (medium)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-macos",
    sourcePath: "packages/desktop/src-tauri/src/medium-extract.js",
    sourceTokens: ['var ROSTER_STORAGE_KEY = "freed.essay.roster.v1"'],
    registeredKeys: [
      "freed.essay.roster.v1 (medium sessionStorage)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-macos",
    sourcePath: "packages/desktop/src-tauri/src/substack-extract.js",
    sourceTokens: ['var ROSTER_STORAGE_KEY = "freed.essay.roster.v1"'],
    registeredKeys: [
      "freed.essay.roster.v1 (substack sessionStorage)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-macos",
    sourcePath: "packages/desktop/src-tauri/src/youtube.rs",
    sourceTokens: [
      "YOUTUBE_SESSION_DATA_STORE_IDENTIFIER",
      "remove_data_store(YOUTUBE_SESSION_DATA_STORE_IDENTIFIER)",
    ],
    registeredKeys: [
      "66726565-6479-7401-9a7d-370102797401 (youtube)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-windows",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: [
      "FB_SCRAPER_DATA_STORE_IDENTIFIER",
      "IG_SCRAPER_DATA_STORE_IDENTIFIER",
      "LI_SCRAPER_DATA_STORE_IDENTIFIER",
      "SUBSTACK_SCRAPER_DATA_STORE_IDENTIFIER",
      "MEDIUM_SCRAPER_DATA_STORE_IDENTIFIER",
    ],
    registeredKeys: [
      "66726565-64fb-0001-9a7d-370102fb0001 (facebook)",
      "66726565-641a-0002-9a7d-3701021a0002 (instagram)",
      "66726565-641d-0003-9a7d-3701021d0003 (linkedin)",
      "66726565-645b-0004-9a7d-3701025b0004 (substack)",
      "66726565-646d-0005-9a7d-3701026d0005 (medium)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-windows",
    sourcePath: "packages/desktop/src-tauri/src/medium-extract.js",
    sourceTokens: ['var ROSTER_STORAGE_KEY = "freed.essay.roster.v1"'],
    registeredKeys: [
      "freed.essay.roster.v1 (medium sessionStorage)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-windows",
    sourcePath: "packages/desktop/src-tauri/src/substack-extract.js",
    sourceTokens: ['var ROSTER_STORAGE_KEY = "freed.essay.roster.v1"'],
    registeredKeys: [
      "freed.essay.roster.v1 (substack sessionStorage)",
    ],
  },
  {
    registryKey: "provider-webview-sessions-windows",
    sourcePath: "packages/desktop/src-tauri/src/youtube.rs",
    sourceTokens: ["YOUTUBE_SESSION_DATA_STORE_IDENTIFIER"],
    registeredKeys: [
      "66726565-6479-7401-9a7d-370102797401 (youtube)",
    ],
  },
  {
    registryKey: "pwa-automerge-worker-debug",
    sourcePath: "packages/pwa/src/lib/automerge-worker-debug.ts",
    sourceTokens: [
      'const WORKER_DEBUG_STORAGE_KEY = "freed:pwa:automerge-worker-debug:v1"',
      "const MAX_PERSISTED_WORKER_DEBUG_EVENTS = 30",
    ],
    registeredKeys: ["freed:pwa:automerge-worker-debug:v1"],
  },
  {
    registryKey: "pwa-factory-reset-coordination",
    sourcePath: "packages/pwa/src/lib/factory-reset-coordinator.ts",
    sourceTokens: [
      'const GENERATION_KEY = "freed_pwa_installation_generation"',
      'const TOMBSTONE_KEY = "freed_pwa_factory_reset_tombstone"',
      'const MESSAGE_KEY = "freed_pwa_factory_reset_message"',
      'const RUNTIME_KEY_PREFIX = "freed_pwa_runtime_"',
      'const ACK_KEY_PREFIX = "freed_pwa_factory_reset_ack_"',
      'const RESET_CLAIM_KEY_PREFIX = "freed_pwa_factory_reset_claim_"',
      'const RELOAD_MARKER_KEY = "freed_pwa_factory_reset_reload"',
      'const RELOAD_ENVELOPE_KEY = "freed_pwa_factory_reset_reload_envelope"',
    ],
    registeredKeys: [
      "freed_pwa_installation_generation",
      "freed_pwa_factory_reset_tombstone",
      "freed_pwa_factory_reset_message",
      "freed_pwa_runtime_<runtimeId>",
      "freed_pwa_factory_reset_ack_<resetId>_<runtimeId>",
      "freed_pwa_factory_reset_claim_<claimId>",
      "freed_pwa_factory_reset_reload",
      "freed_pwa_factory_reset_reload_envelope",
    ],
  },
  {
    registryKey: "pwa-install-notice",
    sourcePath: "packages/pwa/src/lib/pwa-install.ts",
    sourceTokens: [
      'const INSTALL_PROMPT_DISMISS_KEY = "freed.pwa.install.dismissed"',
    ],
    registeredKeys: ["freed.pwa.install.dismissed"],
  },
  {
    registryKey: "pwa-legal-consent",
    sourcePath: "packages/pwa/src/lib/legal-consent.ts",
    sourceTokens: ['const PWA_BUNDLE_KEY = "freed.legal.pwa.bundle"'],
    registeredKeys: ["freed.legal.pwa.bundle"],
  },
  {
    registryKey: "pwa-oauth-pkce",
    sourcePath: "packages/pwa/src/lib/cloud-oauth.ts",
    sourceTokens: [
      'sessionStorage.setItem("freed_pkce_verifier", verifier)',
      'sessionStorage.setItem("freed_pkce_provider", "gdrive")',
    ],
    registeredKeys: ["freed_pkce_verifier", "freed_pkce_provider"],
  },
  {
    registryKey: "pwa-oauth-pkce",
    sourcePath: "packages/pwa/src/components/SyncConnectDialog.tsx",
    sourceTokens: [
      'sessionStorage.setItem("freed_pkce_verifier", verifier)',
      'sessionStorage.setItem("freed_pkce_provider", "dropbox")',
    ],
    registeredKeys: ["freed_pkce_verifier", "freed_pkce_provider"],
  },
  {
    registryKey: "pwa-oauth-pkce",
    sourcePath: "packages/pwa/src/components/OAuthCallback.tsx",
    sourceTokens: [
      'sessionStorage.getItem("freed_pkce_verifier")',
      'sessionStorage.removeItem("freed_pkce_provider")',
      'sessionStorage.removeItem("freed_pkce_verifier")',
    ],
    registeredKeys: ["freed_pkce_verifier", "freed_pkce_provider"],
  },
  {
    registryKey: "pwa-oauth-pkce",
    sourcePath: "packages/pwa/src/lib/oauth-redirect.ts",
    sourceTokens: [
      'const GOOGLE_REDIRECT_URI_STORAGE_KEY = "freed_pkce_google_redirect_uri"',
      'const PKCE_GENERATION_STORAGE_KEY = "freed_pkce_installation_generation"',
    ],
    registeredKeys: [
      "freed_pkce_google_redirect_uri",
      "freed_pkce_installation_generation",
    ],
  },
  {
    registryKey: "pwa-reader-content",
    sourcePath: "packages/ui/src/lib/article-cache.ts",
    sourceTokens: [
      'const ARTICLE_CONTENT_CACHE_NAME = "freed-articles-v1"',
      'const PINNED_ARTICLE_CONTENT_CACHE_NAME = "freed-articles-pinned-v1"',
    ],
    registeredKeys: [
      "<articleUrl>",
      "/content/<globalId>",
      "/pinned-content/<globalId>",
    ],
  },
  {
    registryKey: "pwa-relay-credential",
    sourcePath: "packages/pwa/src/lib/sync.ts",
    sourceTokens: ['"freed_relay_url"'],
    registeredKeys: ["freed_relay_url"],
  },
  {
    registryKey: "pwa-release-channel",
    sourcePath: "packages/ui/src/lib/release-channel.ts",
    sourceTokens: [
      'export const RELEASE_CHANNEL_STORAGE_KEY = "freed-release-channel"',
    ],
    registeredKeys: ["freed-release-channel"],
  },
  {
    registryKey: "pwa-service-worker-build-caches",
    sourcePath: "packages/pwa/vite.config.ts",
    sourceTokens: [
      'cacheName: "freed-wasm"',
      'globPatterns: ["**/*.{js,css,html,ico,png,svg}"]',
    ],
    registeredKeys: [
      "GET <http-or-https URL ending .wasm>",
      "build manifest:**/*.{js,css,html,ico,png,svg}",
    ],
  },
  {
    registryKey: "pwa-service-worker-network-cache",
    sourcePath: "packages/pwa/vite.config.ts",
    sourceTokens: [
      'cacheName: "freed-network"',
      "maxEntries: 200",
      "maxAgeSeconds: 60 * 60 * 24 * 7",
    ],
    registeredKeys: [
      "GET <http-or-https URL matched by the catch-all rule>",
    ],
  },
  {
    registryKey: "pwa-service-worker-sync-cache",
    sourcePath: "packages/pwa/vite.config.ts",
    sourceTokens: [
      'cacheName: "freed-sync-v1"',
      "networkTimeoutSeconds: 5",
    ],
    registeredKeys: ["GET <origin>/sync[?<query>]"],
  },
  {
    registryKey: "reader-image-cache",
    sourcePath: "packages/ui/src/lib/article-cache.ts",
    sourceTokens: ['const ARTICLE_IMAGE_CACHE_NAME = "freed-images"'],
    registeredKeys: ["<resolved-http-or-https-image-url>"],
  },
  {
    registryKey: "reader-offline-cache-mode",
    sourcePath: "packages/ui/src/lib/reader-cache-settings.ts",
    sourceTokens: ['const STORAGE_KEY = "freed.reader.offlineCacheMode"'],
    registeredKeys: ["freed.reader.offlineCacheMode"],
  },
  {
    registryKey: "release-log-files",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: [
      ".max_file_size(10 * 1024 * 1024)",
      ".rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)",
      "app.path().app_log_dir()",
    ],
    registeredKeys: ["<tauri-plugin-log rotating file>"],
  },
  {
    registryKey: "release-log-files",
    sourcePath: "packages/desktop/src/lib/bug-report.ts",
    sourceTokens: [
      'invoke<string[]>("get_recent_logs", { limit })',
      'zip.file("logs/recent.log", logLines.join("\\n"))',
    ],
    registeredKeys: ["<tauri-plugin-log rotating file>"],
  },
  {
    registryKey: "rss-runtime-state",
    sourcePath: "packages/desktop/src/lib/rss-runtime-state.ts",
    sourceTokens: [
      'const STORAGE_KEY = "freed-device-rss-runtime-v1"',
      "const MAX_TRACKED_FEEDS = 10_000",
      "writeVersionedLocalStorage",
    ],
    registeredKeys: [
      "freed-device-rss-runtime-v1",
      "<key>.recovery.<capturedAtMs>.<sequence>",
    ],
  },
  {
    registryKey: "runtime-observability",
    sourcePath: "packages/desktop/src-tauri/src/lib.rs",
    sourceTokens: [
      'const STARTUP_RECOVERY_STATE_FILE: &str = "startup-recovery.json"',
      'const RUNTIME_HEALTH_FILE: &str = "runtime-health.jsonl"',
      'const RUNTIME_DIAGNOSTICS_FILE: &str = "runtime-diagnostics.jsonl"',
      'const RUNTIME_HEALTH_WRITER_LOCK_FILE: &str = ".runtime-health.writer.lock"',
    ],
    registeredKeys: [
      "runtime-health.jsonl or runtime-health-<YYYY-MM-DD>.jsonl",
      "runtime-diagnostics.jsonl",
      "startup-recovery.json",
      ".runtime-health.writer.lock",
    ],
  },
  {
    registryKey: "scraper-window-modes",
    sourcePath: "packages/desktop/src/lib/scraper-prefs.ts",
    sourceTokens: [
      'const IG_KEY = "ig_scraper_debug_window"',
      'const FB_KEY = "fb_scraper_debug_window"',
      'const LI_KEY = "li_scraper_debug_window"',
      'const SUBSTACK_KEY = "substack_scraper_debug_window"',
      'const MEDIUM_KEY = "medium_scraper_debug_window"',
    ],
    registeredKeys: [
      "fb_scraper_debug_window",
      "ig_scraper_debug_window",
      "li_scraper_debug_window",
      "substack_scraper_debug_window",
      "medium_scraper_debug_window",
    ],
  },
  {
    registryKey: "secure-api-keys",
    sourcePath: "packages/desktop/src/lib/secure-storage.ts",
    sourceTokens: [
      'type ApiKeyProvider = "openai" | "anthropic" | "gemini" | "github_story_wall"',
      'load("secure.json", { defaults: {}, autoSave: true })',
      "`apiKey.${provider}`",
    ],
    registeredKeys: [
      "apiKey.openai",
      "apiKey.anthropic",
      "apiKey.gemini",
      "apiKey.github_story_wall",
    ],
  },
  {
    registryKey: "snapshots",
    sourcePath: "packages/desktop/src/lib/snapshots.ts",
    sourceTokens: [
      'const SNAPSHOT_INDEX_FILE = "index.json"',
      'const SNAPSHOT_FALLBACK_STORAGE_KEY = "freed.snapshots"',
      "function snapshotBinaryPath",
      "function snapshotContactsPath",
    ],
    registeredKeys: [
      "index.json",
      "<snapshotId>.automerge",
      "<snapshotId>.contacts.json",
      "freed.snapshots",
    ],
  },
  {
    registryKey: "social-outbox-state",
    sourcePath: "packages/desktop/src/lib/social-outbox-state.ts",
    sourceTokens: [
      'const STORAGE_KEY = "freed-device-social-outbox-v1"',
      "const MAX_RECORDS = 2_000",
      "writeVersionedLocalStorage",
    ],
    registeredKeys: [
      "freed-device-social-outbox-v1",
      "<key>.recovery.<capturedAtMs>.<sequence>",
    ],
  },
  {
    registryKey: "x-manual-cookies",
    sourcePath: "packages/desktop/src/lib/x-auth.ts",
    sourceTokens: ['const X_COOKIES_KEY = "x_auth_cookies"'],
    registeredKeys: ["x_auth_cookies"],
  },
  {
    registryKey: "youtube-offline-playlist",
    sourcePath: "packages/desktop/src/lib/youtube-playlist.ts",
    sourceTokens: [
      'const PLAYLIST_STATE_KEY = "youtube_offline_playlist_state"',
      "const MAX_PLAYLIST_ACTIONS_PER_SYNC = 25",
    ],
    registeredKeys: ["youtube_offline_playlist_state"],
  },
] as const satisfies readonly LibraryCoreLocalAuthoritySourceOwner[];

/**
 * Persisted records intentionally excluded from the product authority census.
 * Keeping the exclusions explicit prevents a test-only or preview-only key from
 * being mistaken for a durable production family.
 */
export const LIBRARY_CORE_LOCAL_AUTHORITY_NON_PRODUCT_EXCLUSIONS = [
  {
    sourcePath: "packages/desktop/src/App.tsx",
    sourceToken: 'const guardKey = "freed_dev_seeded"',
    reason: "Development and feature-preview session guard only.",
  },
  {
    sourcePath: "packages/desktop/src/__mocks__/@tauri-apps/plugin-store/index.ts",
    sourceToken: '"__TAURI_MOCK_STORE_THROW__"',
    reason: "Test-only mock failure switch.",
  },
] as const;
