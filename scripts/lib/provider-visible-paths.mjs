#!/usr/bin/env node

// Canonical classification of provider-visible paths (stability task W1-06).
//
// "Provider-visible" means a change here can alter what X, Facebook, Instagram,
// LinkedIn, or another third-party provider can observe: WebView loads,
// navigation, request frequency, timing, cookies, headers, user agent, or
// extractor scripts. Per AGENTS.md and docs/STABILITY-PROGRAM.md, such changes
// require explicit owner approval before they ship.
//
// Consumers:
// - scripts/validate-worktree.mjs (focused provider test selection)
// - scripts/nightly-self-improve.mjs (peer-worktree risk classification)
// - scripts/worktree-publish.sh (publish-time enforcement via the CLI below)
//
// Do not fork this list. Add new provider surfaces here so every consumer
// agrees on what needs the provider-visible approval lane.

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  AUTOMATION_CONTROL_SCHEMA_VERSION,
  automationControlPaths,
  readTaskManifest,
} from "./automation-control.mjs";

// Desktop files that drive provider WebViews: capture orchestration, auth,
// session/cookie state, and the injected extractor scripts.
export const SOCIAL_PROVIDER_DESKTOP_FILES = new Set([
  "packages/desktop/src/App.tsx",
  "packages/desktop/src/components/CloudProviderCard.tsx",
  "packages/desktop/src/components/CloudSyncNudge.tsx",
  "packages/desktop/src/components/FacebookFeedEmptyState.tsx",
  "packages/desktop/src/components/FacebookSettingsSection.tsx",
  "packages/desktop/src/components/InstagramFeedEmptyState.tsx",
  "packages/desktop/src/components/InstagramSettingsSection.tsx",
  "packages/desktop/src/components/LinkedInSettingsSection.tsx",
  "packages/desktop/src/components/ProviderSyncActionButton.tsx",
  "packages/desktop/src/components/ScraperWindowModeControl.tsx",
  "packages/desktop/src/components/SyncProviderSectionSurface.tsx",
  "packages/desktop/src/components/XFeedEmptyState.tsx",
  "packages/desktop/src/components/XSettingsSection.tsx",
  "packages/desktop/src/hooks/useCloudProviders.ts",
  "packages/desktop/src/hooks/usePostLoginAutoSync.ts",
  "packages/desktop/src/hooks/useProviderRiskGate.tsx",
  "packages/desktop/src/lib/capture.ts",
  "packages/desktop/src/lib/dev-sync-triggers.ts",
  "packages/desktop/src/lib/fb-auth.ts",
  "packages/desktop/src/lib/fb-capture.ts",
  "packages/desktop/src/lib/instagram-auth.ts",
  "packages/desktop/src/lib/instagram-capture.ts",
  "packages/desktop/src/lib/legal-consent.ts",
  "packages/desktop/src/lib/li-auth.ts",
  "packages/desktop/src/lib/li-capture.ts",
  "packages/desktop/src/lib/provider-auth-errors.ts",
  "packages/desktop/src/lib/provider-health.ts",
  "packages/desktop/src/lib/reader-hydration.ts",
  "packages/desktop/src/lib/scraper-media-diag.ts",
  "packages/desktop/src/lib/scraper-prefs.ts",
  "packages/desktop/src/lib/social-auth-cookie-state.ts",
  "packages/desktop/src/lib/social-capture-runtime.ts",
  "packages/desktop/src/lib/social-comment-hydration.ts",
  "packages/desktop/src/lib/social-provider-copy.ts",
  "packages/desktop/src/lib/x-auth.ts",
  "packages/desktop/src/lib/x-capture.ts",
  "packages/desktop/src/lib/youtube-auth.ts",
  "packages/desktop/src/lib/youtube-capture.ts",
  "packages/desktop/src/lib/youtube-playlist.ts",
  "packages/desktop/src-tauri/src/fb-comments-extract.js",
  "packages/desktop/src-tauri/src/fb-extract.js",
  "packages/desktop/src-tauri/src/fb-groups-extract.js",
  "packages/desktop/src-tauri/src/fb-stories-extract.js",
  "packages/desktop/src-tauri/src/ig-comments-extract.js",
  "packages/desktop/src-tauri/src/ig-extract.js",
  "packages/desktop/src-tauri/src/ig-stories-extract.js",
  "packages/desktop/src-tauri/src/li-extract.js",
  "packages/desktop/src-tauri/src/youtube-extract.js",
  "packages/desktop/src-tauri/src/youtube-playlist-action.js",
  "packages/desktop/src-tauri/src/youtube.rs",
  "scripts/dev-sync-trigger.mjs",
]);

// Social capture packages whose focused provider tests validate-worktree runs.
export const SOCIAL_PROVIDER_PACKAGE_PREFIXES = [
  "packages/capture-facebook/",
  "packages/capture-instagram/",
  "packages/capture-x/",
];

// Risk-only additions beyond the focused-test surface above. These change what
// providers can observe but have no dedicated focused provider test lane, so
// validate-worktree intentionally does not narrow validation for them.
export const PROVIDER_VISIBLE_EXTRA_FILES = new Set([
  "packages/desktop/src/components/YouTubeSettingsSection.tsx",
  "packages/desktop/src-tauri/capabilities/fb-scraper.json",
  "packages/desktop/src-tauri/capabilities/ig-scraper.json",
  "packages/desktop/src-tauri/capabilities/youtube-session.json",
  "packages/desktop/src/lib/rss-refresh-plan.ts",
  "packages/capture-rss/src/discovery.ts",
  "packages/capture-save/src/extract.ts",
  "packages/desktop/src/lib/user-agent.ts",
  "packages/desktop/src-tauri/src/webkit-mask.js",
  "packages/pwa/api/oauth/google.ts",
  "packages/pwa/src/components/OAuthCallback.tsx",
  "packages/pwa/src/components/PwaSyncSettings.tsx",
  "packages/pwa/src/components/SyncConnectDialog.tsx",
  "packages/pwa/src/lib/cloud-oauth.ts",
  "packages/pwa/src/lib/contacts.ts",
  "packages/pwa/src/lib/oauth-redirect.ts",
  "packages/pwa/src/lib/reader-cache.ts",
  "packages/pwa/src/lib/sync.ts",
  "packages/pwa/src/lib/youtube-handoff.ts",
  "packages/shared/src/google-contacts-automation.ts",
  "packages/shared/src/google-contacts.ts",
  "packages/shared/src/legal.ts",
  "packages/shared/src/schema.ts",
  "packages/shared/src/youtube.ts",
  "packages/ui/src/components/feed/ReaderView.tsx",
  "packages/ui/src/components/feed/YouTubeFocusPlayer.tsx",
]);

// These files own provider contact cadence, retry behavior, WebView lifecycle,
// or platform writeback. They stay outside the focused provider test surface
// because a narrow extractor suite is not sufficient validation for them.
// Keep this conservative until the native monolith and runtime callers are
// split into provider-specific modules.
export const PROVIDER_VISIBLE_ORCHESTRATION_FILES = new Set([
  "packages/desktop/src/lib/background-runtime-coordinator.ts",
  "packages/desktop/src/lib/content-fetcher.ts",
  "packages/desktop/src/lib/dev-sync-triggers.ts",
  "packages/desktop/src/lib/google-contacts.ts",
  "packages/desktop/src/lib/media-vault.ts",
  "packages/desktop/src/lib/memory-monitor.ts",
  "packages/desktop/src/lib/outbox.ts",
  "packages/desktop/src/lib/platform-actions.ts",
  "packages/desktop/src/lib/rss-poller.ts",
  "packages/desktop/src/lib/side-effect-scheduler.ts",
  "packages/desktop/src/lib/sync.ts",
  "packages/desktop/src/lib/google-drive.ts",
  "packages/desktop/src-tauri/src/lib.rs",
]);

// Exact state, reset, and request boundaries whose provider scope is known.
// These files may not name a provider in their path, but a change can still
// alter whether provider work starts, retries, commits, or survives reset.
// Keep the values sorted because approval packets compare exact scopes.
export const PROVIDER_VISIBLE_EXACT_SCOPES = new Map([
  [
    "packages/desktop/src/App.tsx",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/desktop/src/components/MobileSyncTab.tsx", ["other"]],
  ["packages/desktop/src/hooks/useCloudProviders.ts", ["other"]],
  ["packages/desktop/src/lib/ai-summarizer.ts", ["other"]],
  [
    "packages/desktop/src/lib/automerge-types.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/desktop/src/lib/automerge.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/desktop/src/lib/automerge.worker.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/desktop/src/lib/contact-sync-storage.ts", ["other"]],
  ["packages/desktop/src/lib/facebook-group-discovery.ts", ["facebook"]],
  [
    "packages/desktop/src/lib/factory-reset-guard.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/desktop/src/lib/local-ai-models.ts", ["other"]],
  [
    "packages/desktop/src/lib/media-vault.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/desktop/src/lib/native-json-store.ts",
    ["facebook", "instagram", "linkedin", "x", "youtube"],
  ],
  ["packages/desktop/src/lib/outbox.ts", ["facebook", "instagram", "x"]],
  [
    "packages/desktop/src/lib/provider-auth-lifecycle.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/desktop/src/lib/provider-health.ts",
    ["facebook", "instagram", "linkedin", "x", "youtube"],
  ],
  ["packages/desktop/src/lib/rss-poller.ts", ["other"]],
  ["packages/desktop/src/lib/rss-refresh-plan.ts", ["other"]],
  ["packages/desktop/src/lib/rss-runtime-state.ts", ["other"]],
  [
    "packages/desktop/src/lib/scraper-prefs.ts",
    ["facebook", "instagram", "linkedin", "x", "youtube"],
  ],
  ["packages/desktop/src/lib/secure-storage.ts", ["other"]],
  [
    "packages/desktop/src/lib/semantic-classifier.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/desktop/src/lib/social-auth-transient-errors.ts",
    ["facebook", "instagram", "linkedin", "youtube"],
  ],
  [
    "packages/desktop/src/lib/social-outbox-state.ts",
    ["facebook", "instagram", "x"],
  ],
  [
    "packages/desktop/src/lib/store.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/desktop/src/lib/sync.ts", ["other"]],
  ["packages/desktop/src/lib/x-login-reset-controller.ts", ["x"]],
  ["packages/pwa/src/App.tsx", ["other"]],
  ["packages/pwa/src/lib/automerge-types.ts", ["other"]],
  ["packages/pwa/src/lib/automerge.ts", ["other"]],
  ["packages/pwa/src/lib/automerge.worker.ts", ["other"]],
  ["packages/pwa/src/lib/factory-reset-coordinator.ts", ["other"]],
  ["packages/pwa/src/lib/store.ts", ["other"]],
  ["packages/shared/src/contact-sync-state.ts", ["other"]],
  ["packages/shared/src/preferences.ts", ["other"]],
  [
    "packages/shared/src/sync-write-policy.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/sync/src/storage/indexeddb.ts", ["other"]],
  [
    "packages/ui/src/components/SettingsDialog.tsx",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/ui/src/components/settings/AISection.tsx", ["other"]],
  ["packages/ui/src/hooks/useContactSync.ts", ["other"]],
  ["packages/ui/src/lib/device-ai-preferences.ts", ["other"]],
  [
    "packages/ui/src/lib/factory-reset.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
]);

export const PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES = [
  "packages/capture-linkedin/",
  "packages/capture-youtube/",
  "packages/sync/src/cloud/",
];

// In any capture package (including non-social ones like capture-save), these
// files own navigation, DOM selection, contact frequency, or endpoint choice.
export const CAPTURE_PROVIDER_CONTACT_FILE_PATTERN =
  /^packages\/capture-[^/]+\/src\/(browser|selectors|rate-limit|endpoints)\.[cm]?ts$/;

export function normalizeProviderPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isProviderVisiblePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return false;
  }
  const normalizedPath = normalizeProviderPath(filePath);

  if (
    SOCIAL_PROVIDER_DESKTOP_FILES.has(normalizedPath) ||
    PROVIDER_VISIBLE_EXTRA_FILES.has(normalizedPath) ||
    PROVIDER_VISIBLE_ORCHESTRATION_FILES.has(normalizedPath) ||
    PROVIDER_VISIBLE_EXACT_SCOPES.has(normalizedPath)
  ) {
    return true;
  }

  if (
    SOCIAL_PROVIDER_PACKAGE_PREFIXES.some((prefix) =>
      normalizedPath.startsWith(prefix),
    ) ||
    PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES.some((prefix) =>
      normalizedPath.startsWith(prefix),
    )
  ) {
    return true;
  }

  return CAPTURE_PROVIDER_CONTACT_FILE_PATTERN.test(normalizedPath);
}

const PROVIDER_APPROVAL_SCHEMA_VERSION = 1;
const PROVIDER_APPROVAL_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_APPROVAL_CLOCK_SKEW_MS = 5 * 60 * 1000;
const PROVIDER_APPROVAL_PROVIDER_IDS = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "other",
  "x",
  "youtube",
]);
const PROVIDER_APPROVAL_SOURCE_KINDS = new Set([
  "control-task",
  "owner-confirmation",
]);
const PROVIDER_APPROVAL_TASK_STATES = new Set([
  "approved_for_pr",
  "implemented",
  "validated",
  "merged",
  "installed",
  "soaking",
  "verified_effective",
  "verified_neutral",
  "regressed",
  "inconclusive",
]);
const PROVIDER_APPROVAL_TASK_AUTHORITY_RANK = Object.freeze({
  "observe-only": 0,
  "plan-only": 1,
  "pr-only": 2,
  "merge-safe": 3,
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => key !== "authorizationDigest")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function providerApprovalAuthorizationDigest(record) {
  return `sha256:${createHash("sha256").update(canonicalJson(record)).digest("hex")}`;
}

export function providerIdsForPath(filePath) {
  const canonicalPath = normalizeProviderPath(filePath);
  const exactScope = PROVIDER_VISIBLE_EXACT_SCOPES.get(canonicalPath);
  if (exactScope) return [...exactScope];
  const normalizedPath = canonicalPath.toLowerCase();
  if (
    normalizedPath === "packages/desktop/src/lib/legal-consent.ts" ||
    normalizedPath === "packages/shared/src/legal.ts"
  ) {
    return ["facebook", "instagram", "linkedin", "x", "youtube"];
  }
  if (
    normalizedPath.startsWith("packages/capture-facebook/") ||
    /\/(?:fb|facebook)(?:[-_.\/]|$)/.test(normalizedPath)
  )
    return ["facebook"];
  if (
    normalizedPath.startsWith("packages/capture-instagram/") ||
    /\/(?:ig|instagram)(?:[-_.\/]|$)/.test(normalizedPath)
  )
    return ["instagram"];
  if (
    normalizedPath.startsWith("packages/capture-linkedin/") ||
    /\/(?:li|linkedin)(?:[-_.\/]|$)/.test(normalizedPath)
  )
    return ["linkedin"];
  if (
    normalizedPath.startsWith("packages/capture-x/") ||
    /\/x(?:[-_.\/]|$)/.test(normalizedPath)
  )
    return ["x"];
  if (
    normalizedPath.startsWith("packages/capture-youtube/") ||
    normalizedPath.includes("youtube")
  )
    return ["youtube"];
  if (
    normalizedPath.startsWith("packages/sync/src/cloud/") ||
    normalizedPath.startsWith("packages/pwa/api/oauth/google") ||
    normalizedPath.startsWith("packages/pwa/src/components/oauthcallback") ||
    normalizedPath.startsWith("packages/pwa/src/components/pwasyncsettings") ||
    normalizedPath.startsWith(
      "packages/pwa/src/components/syncconnectdialog",
    ) ||
    normalizedPath.startsWith("packages/pwa/src/lib/cloud-oauth") ||
    normalizedPath.startsWith("packages/pwa/src/lib/contacts") ||
    normalizedPath.startsWith("packages/pwa/src/lib/oauth-redirect") ||
    normalizedPath.startsWith("packages/pwa/src/lib/sync") ||
    normalizedPath.startsWith("packages/shared/src/google-contacts") ||
    /\/(?:google|gdrive|dropbox)(?:[-_.\/]|$)/.test(normalizedPath)
  )
    return ["other"];
  return [];
}

function requireApprovalText(record, field, errors) {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function parseApprovalTime(record, field, errors) {
  const value = requireApprovalText(record, field, errors);
  if (!value) return Number.NaN;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    errors.push(`${field} must be an ISO-8601 timestamp`);
  }
  return timestamp;
}

/**
 * Validate a scoped owner approval record for a provider-visible path set.
 *
 * This is intentionally independent from Git so callers can validate the
 * same record before a local commit or after one. The exact path set and the
 * expiration make approvals narrow instead of reusable permission slips.
 */
export function validateProviderRiskApproval(
  record,
  providerVisiblePaths,
  {
    now = Date.now(),
    diffSha = null,
    controlManifest = null,
    controlEvents = null,
    requireControlTask = true,
  } = {},
) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Provider risk approval must be a JSON object.");
  }

  if (record.schemaVersion !== PROVIDER_APPROVAL_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must equal ${PROVIDER_APPROVAL_SCHEMA_VERSION.toLocaleString()}`,
    );
  }

  const approvalId = requireApprovalText(record, "approvalId", errors);
  const approvedBy = requireApprovalText(record, "approvedBy", errors);
  if (approvedBy && approvedBy !== "AubreyF") {
    errors.push("approvedBy must identify the repository owner AubreyF");
  }
  const ownerApprovalReference = requireApprovalText(
    record,
    "ownerApprovalReference",
    errors,
  );
  const observableBehavior = requireApprovalText(
    record,
    "observableBehavior",
    errors,
  );
  const fingerprintingRisk = requireApprovalText(
    record,
    "fingerprintingRisk",
    errors,
  );
  const lowestProfileAlternative = requireApprovalText(
    record,
    "lowestProfileAlternative",
    errors,
  );
  const approvedAt = parseApprovalTime(record, "approvedAt", errors);
  const expiresAt = parseApprovalTime(record, "expiresAt", errors);
  const approvedDiffSha = requireApprovalText(
    record,
    "diffSha",
    errors,
  ).toLowerCase();
  if (approvedDiffSha && !/^[0-9a-f]{40,64}$/.test(approvedDiffSha)) {
    errors.push(
      "diffSha must be a 40 to 64 character hexadecimal Git diff hash",
    );
  }
  if (diffSha && approvedDiffSha !== String(diffSha).toLowerCase()) {
    errors.push(`approval diffSha does not match the current diff: ${diffSha}`);
  }

  if (Number.isFinite(approvedAt) && Number.isFinite(expiresAt)) {
    if (approvedAt > now + PROVIDER_APPROVAL_CLOCK_SKEW_MS) {
      errors.push("approvedAt cannot be in the future");
    }
    if (expiresAt <= approvedAt) {
      errors.push("expiresAt must be later than approvedAt");
    }
    if (expiresAt - approvedAt > PROVIDER_APPROVAL_MAX_LIFETIME_MS) {
      errors.push("approval lifetime cannot exceed 7 days");
    }
    if (expiresAt <= now) {
      errors.push("approval has expired");
    }
  }

  const providers = Array.isArray(record.providers)
    ? [
        ...new Set(
          record.providers
            .map((provider) => String(provider).trim())
            .filter(Boolean),
        ),
      ].sort()
    : [];
  if (providers.length === 0) {
    errors.push("providers must contain at least one provider id");
  }
  for (const provider of providers) {
    if (!PROVIDER_APPROVAL_PROVIDER_IDS.has(provider)) {
      errors.push(`unsupported provider id '${provider}'`);
    }
  }

  const approvedPaths = Array.isArray(record.paths)
    ? [
        ...new Set(
          record.paths
            .map((filePath) => normalizeProviderPath(String(filePath)))
            .filter(Boolean),
        ),
      ].sort()
    : [];
  if (approvedPaths.length === 0) {
    errors.push("paths must contain at least one provider-visible path");
  }
  for (const filePath of approvedPaths) {
    if (!isProviderVisiblePath(filePath)) {
      errors.push(`approved path is not provider-visible: ${filePath}`);
    }
  }

  const approvalSource = record.approvalSource;
  if (
    !approvalSource ||
    typeof approvalSource !== "object" ||
    Array.isArray(approvalSource)
  ) {
    errors.push("approvalSource must be an object");
  } else {
    if (!PROVIDER_APPROVAL_SOURCE_KINDS.has(approvalSource.kind)) {
      errors.push(
        "approvalSource.kind must be control-task or owner-confirmation",
      );
    }
    requireApprovalText(approvalSource, "reference", errors);
  }

  const rawPathScopes = Array.isArray(record.pathScopes)
    ? record.pathScopes
    : [];
  if (rawPathScopes.length === 0) {
    errors.push("pathScopes must map every approved path to its providers");
  }
  const normalizedPathScopes = [];
  const scopedPaths = new Set();
  const scopedProviders = new Set();
  for (const [index, rawScope] of rawPathScopes.entries()) {
    if (!rawScope || typeof rawScope !== "object" || Array.isArray(rawScope)) {
      errors.push(`pathScopes[${index.toLocaleString()}] must be an object`);
      continue;
    }
    const scopedPath = normalizeProviderPath(String(rawScope.path ?? ""));
    if (!scopedPath || !isProviderVisiblePath(scopedPath)) {
      errors.push(
        `pathScopes[${index.toLocaleString()}].path must be provider-visible`,
      );
      continue;
    }
    if (scopedPaths.has(scopedPath)) {
      errors.push(`pathScopes contains duplicate path: ${scopedPath}`);
      continue;
    }
    scopedPaths.add(scopedPath);
    const scopeProviders = Array.isArray(rawScope.providers)
      ? [
          ...new Set(
            rawScope.providers
              .map((provider) => String(provider).trim())
              .filter(Boolean),
          ),
        ].sort()
      : [];
    if (scopeProviders.length === 0) {
      errors.push(`pathScopes entry has no providers: ${scopedPath}`);
    }
    for (const provider of scopeProviders) {
      if (!PROVIDER_APPROVAL_PROVIDER_IDS.has(provider)) {
        errors.push(
          `unsupported provider id '${provider}' in pathScopes for ${scopedPath}`,
        );
      }
      scopedProviders.add(provider);
    }
    const inferredProviders = providerIdsForPath(scopedPath);
    if (
      inferredProviders.length > 0 &&
      JSON.stringify(scopeProviders) !== JSON.stringify(inferredProviders)
    ) {
      errors.push(
        `pathScopes providers for ${scopedPath} must equal inferred provider scope: ${inferredProviders.join(", ")}`,
      );
    }
    normalizedPathScopes.push({ path: scopedPath, providers: scopeProviders });
  }
  for (const approvedPath of approvedPaths) {
    if (!scopedPaths.has(approvedPath)) {
      errors.push(`pathScopes does not cover approved path: ${approvedPath}`);
    }
  }
  for (const scopedPath of scopedPaths) {
    if (!approvedPaths.includes(scopedPath)) {
      errors.push(
        `pathScopes includes a path absent from paths: ${scopedPath}`,
      );
    }
  }
  if (
    JSON.stringify([...scopedProviders].sort()) !== JSON.stringify(providers)
  ) {
    errors.push("providers must equal the union of pathScopes providers");
  }

  const requiredPaths = [
    ...new Set(
      providerVisiblePaths
        .map((filePath) => normalizeProviderPath(String(filePath)))
        .filter(Boolean)
        .filter(isProviderVisiblePath),
    ),
  ].sort();
  const approvedPathSet = new Set(approvedPaths);
  const requiredPathSet = new Set(requiredPaths);
  for (const filePath of requiredPaths) {
    if (!approvedPathSet.has(filePath)) {
      errors.push(`approval does not cover provider-visible path: ${filePath}`);
    }
  }
  for (const filePath of approvedPaths) {
    if (!requiredPathSet.has(filePath)) {
      errors.push(
        `approval includes a provider-visible path absent from the current diff: ${filePath}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid provider risk approval:\n- ${errors.join("\n- ")}`,
    );
  }

  const approval = {
    schemaVersion: PROVIDER_APPROVAL_SCHEMA_VERSION,
    approvalId,
    approvedBy,
    ownerApprovalReference,
    approvalSource: {
      kind: approvalSource.kind,
      reference: approvalSource.reference.trim(),
    },
    approvedAt: new Date(approvedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    providers,
    observableBehavior,
    fingerprintingRisk,
    lowestProfileAlternative,
    diffSha: approvedDiffSha,
    paths: approvedPaths,
    pathScopes: normalizedPathScopes.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
  const authorizationErrors = [];
  const authorizationDigest = providerApprovalAuthorizationDigest(approval);
  const requiresControlTaskAuthorization =
    requireControlTask && approval.approvalSource.kind === "control-task";
  if (
    requireControlTask &&
    approval.approvalSource.kind === "owner-confirmation" &&
    record.authorizationDigest !== authorizationDigest
  ) {
    authorizationErrors.push(
      `owner-confirmation approval must contain the exact authorizationDigest ${authorizationDigest}`,
    );
  }
  if (
    requiresControlTaskAuthorization &&
    (controlManifest?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
      !Number.isSafeInteger(controlManifest?.revision) ||
      !Array.isArray(controlManifest?.tasks))
  ) {
    authorizationErrors.push(
      "recovered control task manifest has an unsupported schema",
    );
  }
  const controlTask = Array.isArray(controlManifest?.tasks)
    ? controlManifest.tasks.find(
        (task) => task?.taskId === approval.approvalSource.reference,
      )
    : null;
  if (requiresControlTaskAuthorization && !controlTask) {
    authorizationErrors.push(
      `approvalSource control task was not found: ${approval.approvalSource.reference}`,
    );
  } else if (requiresControlTaskAuthorization) {
    if (
      controlTask.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
      !Number.isSafeInteger(controlTask.revision) ||
      controlTask.revision <= 0
    ) {
      authorizationErrors.push(
        `control task ${controlTask.taskId} has an unsupported schema or revision`,
      );
    }
    if (
      (PROVIDER_APPROVAL_TASK_AUTHORITY_RANK[controlTask.observerAuthority] ??
        -1) < PROVIDER_APPROVAL_TASK_AUTHORITY_RANK["pr-only"]
    ) {
      authorizationErrors.push(
        `control task ${controlTask.taskId} does not have a pr-only lifecycle ceiling`,
      );
    }
    if (!PROVIDER_APPROVAL_TASK_STATES.has(controlTask.state)) {
      authorizationErrors.push(
        `control task ${controlTask.taskId} must be approved_for_pr or later before provider publication`,
      );
    }
    if (controlTask.providerAuthority !== "approved") {
      authorizationErrors.push(
        `control task ${controlTask.taskId} does not have approved provider authority`,
      );
    }
    if (controlTask.providerApprovalReference !== authorizationDigest) {
      authorizationErrors.push(
        `control task ${controlTask.taskId} does not authorize approval digest ${authorizationDigest}`,
      );
    }
    const ownerAuthorizationEvent = Array.isArray(controlEvents)
      ? controlEvents.find((event) => {
          const provenance = event?.data?.authorizationProvenance;
          const ownerLeaseEvent = controlEvents.find(
            (candidate) =>
              candidate?.schemaVersion === AUTOMATION_CONTROL_SCHEMA_VERSION &&
              ["lease_acquired", "lease_taken_over"].includes(
                candidate?.type,
              ) &&
              candidate?.actor === "freed-owner" &&
              candidate?.leaseName === "owner-governance" &&
              candidate?.data?.credentialKind === "owner-signed-capability" &&
              candidate?.data?.ownerCapabilityId ===
                provenance?.ownerCapabilityId &&
              candidate?.data?.ownerCapabilityTaskId === controlTask.taskId &&
              candidate?.data?.ownerCapabilityTaskId ===
                provenance?.ownerCapabilityTaskId &&
              candidate?.data?.ownerCapabilityIntentDigest ===
                provenance?.ownerCapabilityIntentDigest &&
              candidate?.ts === provenance?.leaseAcquiredAt,
          );
          return (
            event?.schemaVersion === AUTOMATION_CONTROL_SCHEMA_VERSION &&
            ["task_authority_updated", "task_created"].includes(event?.type) &&
            event?.actor === "freed-owner" &&
            event?.taskId === controlTask.taskId &&
            Number.isSafeInteger(event?.taskRevision) &&
            event.taskRevision <= controlTask.revision &&
            Number.isSafeInteger(event?.manifestRevision) &&
            event.manifestRevision <= controlManifest.revision &&
            event?.providerAuthority === "approved" &&
            event?.providerApprovalReference === authorizationDigest &&
            provenance?.leaseName === "owner-governance" &&
            provenance?.credentialKind === "owner-signed-capability" &&
            typeof provenance?.ownerCapabilityId === "string" &&
            provenance.ownerCapabilityId.length > 0 &&
            provenance?.ownerCapabilityTaskId === controlTask.taskId &&
            typeof provenance?.ownerCapabilityIntentDigest === "string" &&
            /^[0-9a-f]{64}$/.test(
              provenance.ownerCapabilityIntentDigest,
            ) &&
            Number.isFinite(
              Date.parse(String(provenance?.leaseAcquiredAt ?? "")),
            ) &&
            ownerLeaseEvent &&
            Date.parse(ownerLeaseEvent.ts) <= Date.parse(event.ts)
          );
        })
      : null;
    if (!ownerAuthorizationEvent) {
      authorizationErrors.push(
        `control task ${controlTask.taskId} has no owner-signed-capability authorization event for ${authorizationDigest}`,
      );
    }
  }

  if (authorizationErrors.length > 0) {
    throw new Error(
      `Invalid provider risk approval:\n- ${authorizationErrors.join("\n- ")}`,
    );
  }

  return { ...approval, authorizationDigest };
}

function readRecoveredControlState(stateRoot) {
  const manifest = readTaskManifest({ stateRoot });
  const eventsPath = automationControlPaths(stateRoot).events;
  const events = existsSync(eventsPath)
    ? readFileSync(eventsPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line, index) => {
          try {
            return JSON.parse(line);
          } catch {
            throw new Error(
              `Control event log contains invalid JSON at line ${(index + 1).toLocaleString()}.`,
            );
          }
        })
    : [];
  return { manifest, events };
}

// CLI: print the provider-visible subset of the given paths, one per line.
//   node scripts/lib/provider-visible-paths.mjs <path>...
//   git diff --name-only ... | node scripts/lib/provider-visible-paths.mjs --stdin
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const approvalDigestFlagIndex = args.indexOf("--approval-digest");
  const approvalDigestFile =
    approvalDigestFlagIndex >= 0 ? args[approvalDigestFlagIndex + 1] : null;
  const approvalFlagIndex = args.indexOf("--validate-approval");
  const approvalFile =
    approvalFlagIndex >= 0 ? args[approvalFlagIndex + 1] : null;
  const diffShaFlagIndex = args.indexOf("--diff-sha");
  const diffSha = diffShaFlagIndex >= 0 ? args[diffShaFlagIndex + 1] : null;
  const controlStateRootFlagIndex = args.indexOf("--control-state-root");
  const controlStateRoot =
    controlStateRootFlagIndex >= 0 ? args[controlStateRootFlagIndex + 1] : null;
  if (approvalDigestFlagIndex >= 0 && !approvalDigestFile) {
    throw new Error("--approval-digest requires a JSON file path.");
  }
  if (approvalDigestFile) {
    const record = JSON.parse(readFileSync(approvalDigestFile, "utf8"));
    const approval = validateProviderRiskApproval(record, record.paths ?? [], {
      now: Date.parse(record.approvedAt),
      diffSha: record.diffSha ?? null,
      requireControlTask: false,
    });
    process.stdout.write(`${approval.authorizationDigest}\n`);
    process.exit(0);
  }
  if (approvalFlagIndex >= 0 && !approvalFile) {
    throw new Error("--validate-approval requires a JSON file path.");
  }
  if (approvalFlagIndex >= 0 && !diffSha) {
    throw new Error(
      "--validate-approval requires --diff-sha for the committed branch diff.",
    );
  }
  if (approvalFlagIndex >= 0 && !controlStateRoot) {
    throw new Error(
      "--validate-approval requires --control-state-root for owner authentication.",
    );
  }

  const pathArgs = args.filter((arg, index) => {
    if (arg === "--stdin") return false;
    if (
      approvalFlagIndex >= 0 &&
      (index === approvalFlagIndex || index === approvalFlagIndex + 1)
    )
      return false;
    if (
      diffShaFlagIndex >= 0 &&
      (index === diffShaFlagIndex || index === diffShaFlagIndex + 1)
    )
      return false;
    if (
      controlStateRootFlagIndex >= 0 &&
      (index === controlStateRootFlagIndex ||
        index === controlStateRootFlagIndex + 1)
    )
      return false;
    return true;
  });
  const candidates = args.includes("--stdin")
    ? readFileSync(0, "utf8").split(/\r?\n/)
    : pathArgs;

  const matches = candidates
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isProviderVisiblePath);

  if (approvalFile) {
    const record = JSON.parse(readFileSync(approvalFile, "utf8"));
    const controlState = readRecoveredControlState(controlStateRoot);
    const approval = validateProviderRiskApproval(record, matches, {
      diffSha,
      controlManifest: controlState.manifest,
      controlEvents: controlState.events,
    });
    process.stdout.write(`${JSON.stringify(approval, null, 2)}\n`);
    process.exit(0);
  }

  if (matches.length > 0) {
    process.stdout.write(`${matches.join("\n")}\n`);
  }
}
