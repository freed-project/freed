import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";

import {
  CAPTURE_PROVIDER_CONTACT_FILE_PATTERN,
  isProviderVisiblePath,
  PROVIDER_VISIBLE_EXACT_SCOPES,
  PROVIDER_VISIBLE_EXTRA_FILES,
  PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES,
  PROVIDER_VISIBLE_ORCHESTRATION_FILES,
  providerApprovalAuthorizationDigest,
  providerIdsForPath,
  SOCIAL_PROVIDER_DESKTOP_FILES,
  SOCIAL_PROVIDER_PACKAGE_PREFIXES,
  validateProviderRiskApproval,
} from "./provider-visible-paths.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(moduleDir, "provider-visible-paths.mjs");
const repoRoot = path.resolve(moduleDir, "../..");

const EXACT_SCOPE_CASES = [
  [
    "packages/desktop/src-tauri/src/lib.rs",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/desktop/src/App.tsx",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/desktop/src/components/FacebookSettingsSection.tsx",
    ["facebook"],
  ],
  [
    "packages/desktop/src/components/InstagramSettingsSection.tsx",
    ["instagram"],
  ],
  [
    "packages/desktop/src/components/LinkedInSettingsSection.tsx",
    ["linkedin"],
  ],
  ["packages/desktop/src/components/MobileSyncTab.tsx", ["other"]],
  ["packages/desktop/src/components/XSettingsSection.tsx", ["x"]],
  [
    "packages/desktop/src/components/YouTubeSettingsSection.tsx",
    ["youtube"],
  ],
  ["packages/desktop/src/hooks/useCloudProviders.ts", ["other"]],
  [
    "packages/desktop/src/hooks/usePostLoginAutoSync.ts",
    ["facebook", "instagram", "linkedin"],
  ],
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
  [
    "packages/desktop/src/lib/capture.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/desktop/src/lib/contact-sync-storage.ts", ["other"]],
  ["packages/desktop/src/lib/content-fetcher.ts", ["other"]],
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
  [
    "packages/desktop/src/lib/reader-hydration.ts",
    ["facebook", "instagram", "other", "x"],
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
    "packages/desktop/src/lib/social-comment-hydration.ts",
    ["facebook", "instagram"],
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
    "packages/shared/src/schema.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/shared/src/sync-write-policy.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  ["packages/sync/src/storage/indexeddb.ts", ["other"]],
  [
    "packages/ui/src/components/SettingsDialog.tsx",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
  [
    "packages/ui/src/components/feed/ReaderView.tsx",
    ["facebook", "instagram", "other", "x"],
  ],
  ["packages/ui/src/components/settings/AISection.tsx", ["other"]],
  ["packages/ui/src/hooks/useContactSync.ts", ["other"]],
  ["packages/ui/src/lib/device-ai-preferences.ts", ["other"]],
  [
    "packages/ui/src/lib/factory-reset.ts",
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  ],
];

test("state, reset, and request boundaries have exact provider scopes", () => {
  assert.deepEqual(
    [...PROVIDER_VISIBLE_EXACT_SCOPES.keys()],
    EXACT_SCOPE_CASES.map(([filePath]) => filePath),
  );
  for (const [filePath, providers] of EXACT_SCOPE_CASES) {
    assert.equal(isProviderVisiblePath(filePath), true, filePath);
    assert.deepEqual(providerIdsForPath(filePath), providers, filePath);
  }
});

test("desktop capture, auth, and extractor files are provider-visible", () => {
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/fb-capture.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/li-auth.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src/lib/social-auth-cookie-state.ts",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src-tauri/src/fb-extract.js"),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src-tauri/src/ig-stories-extract.js",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/youtube-capture.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/youtube-playlist.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/legal-consent.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/dev-sync-triggers.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src-tauri/src/youtube-extract.js"),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src-tauri/src/youtube-playlist-action.js",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src-tauri/src/youtube.rs"),
    true,
  );
  assert.equal(isProviderVisiblePath("scripts/dev-sync-trigger.mjs"), true);
});

test("risk-only provider surfaces are provider-visible even without a focused test lane", () => {
  assert.equal(
    isProviderVisiblePath("packages/desktop/src-tauri/src/webkit-mask.js"),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src-tauri/capabilities/youtube-session.json",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src-tauri/capabilities/fb-scraper.json",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src-tauri/capabilities/ig-scraper.json",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src/components/YouTubeSettingsSection.tsx",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/user-agent.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/rss-refresh-plan.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/pwa/src/lib/youtube-handoff.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/pwa/src/lib/reader-cache.ts"),
    true,
  );
  assert.equal(isProviderVisiblePath("packages/shared/src/schema.ts"), true);
  assert.equal(isProviderVisiblePath("packages/shared/src/youtube.ts"), true);
  assert.equal(isProviderVisiblePath("packages/shared/src/legal.ts"), true);
  assert.equal(
    isProviderVisiblePath(
      "packages/ui/src/components/feed/YouTubeFocusPlayer.tsx",
    ),
    true,
  );
});

test("native provider orchestration and cadence callers are provider-visible", () => {
  assert.equal(
    isProviderVisiblePath("packages/desktop/src-tauri/src/lib.rs"),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src/lib/background-runtime-coordinator.ts",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/rss-poller.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/memory-monitor.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/dev-sync-triggers.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/outbox.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/platform-actions.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/side-effect-scheduler.ts"),
    true,
  );
  assert.equal(isProviderVisiblePath("packages/desktop/src/lib/sync.ts"), true);
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/google-drive.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("./packages/desktop/src-tauri/src/lib.rs"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages\\desktop\\src-tauri\\src\\lib.rs"),
    true,
  );
});

test("provider UI entry points and automatic hydration callers are provider-visible", () => {
  assert.equal(isProviderVisiblePath("packages/desktop/src/App.tsx"), true);
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/reader-hydration.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/hooks/usePostLoginAutoSync.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src/components/FacebookSettingsSection.tsx",
    ),
    true,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src/components/ProviderSyncActionButton.tsx",
    ),
    true,
  );
});

test("provider capture packages are provider-visible, including linkedin and youtube", () => {
  assert.equal(
    isProviderVisiblePath("packages/capture-facebook/src/selectors.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-instagram/src/rate-limit.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-x/src/endpoints.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-linkedin/src/browser.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-linkedin/src/normalize.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-youtube/src/browser.ts"),
    true,
  );
});

test("provider-contact files in non-social capture packages are provider-visible", () => {
  assert.equal(
    isProviderVisiblePath("packages/capture-save/src/browser.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-save/src/extract.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-rss/src/discovery.ts"),
    true,
  );
  assert.equal(
    CAPTURE_PROVIDER_CONTACT_FILE_PATTERN.test(
      "packages/capture-save/src/browser.ts",
    ),
    true,
  );
});

test("background media and Google sync network surfaces are provider-visible", () => {
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/media-vault.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/content-fetcher.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/desktop/src/lib/google-contacts.ts"),
    true,
  );
  assert.equal(isProviderVisiblePath("packages/pwa/api/oauth/google.ts"), true);
  assert.equal(isProviderVisiblePath("packages/pwa/src/lib/sync.ts"), true);
  assert.equal(
    isProviderVisiblePath("packages/shared/src/google-contacts.ts"),
    true,
  );
  assert.equal(
    isProviderVisiblePath("packages/sync/src/cloud/gdrive.ts"),
    true,
  );
});

test("non-provider paths are not provider-visible", () => {
  assert.equal(
    isProviderVisiblePath("packages/capture-save/src/normalize.ts"),
    false,
  );
  assert.equal(
    isProviderVisiblePath("packages/capture-rss/src/index.ts"),
    false,
  );
  assert.equal(
    isProviderVisiblePath(
      "packages/desktop/src/components/ProviderHealthSectionSummary.tsx",
    ),
    false,
  );
  assert.equal(isProviderVisiblePath("scripts/worktree-publish.sh"), false);
  assert.equal(isProviderVisiblePath("docs/STABILITY-PROGRAM.md"), false);
  assert.equal(isProviderVisiblePath(""), false);
  assert.equal(isProviderVisiblePath(undefined), false);
});

test("focused-surface exports stay aligned with the risk predicate", () => {
  for (const filePath of SOCIAL_PROVIDER_DESKTOP_FILES) {
    assert.equal(isProviderVisiblePath(filePath), true, filePath);
  }
  for (const filePath of PROVIDER_VISIBLE_EXTRA_FILES) {
    assert.equal(isProviderVisiblePath(filePath), true, filePath);
  }
  for (const filePath of PROVIDER_VISIBLE_ORCHESTRATION_FILES) {
    assert.equal(isProviderVisiblePath(filePath), true, filePath);
  }
  for (const prefix of SOCIAL_PROVIDER_PACKAGE_PREFIXES) {
    assert.equal(
      isProviderVisiblePath(`${prefix}src/anything.ts`),
      true,
      prefix,
    );
  }
  for (const prefix of PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES) {
    assert.equal(
      isProviderVisiblePath(`${prefix}src/anything.ts`),
      true,
      prefix,
    );
  }
});

function codeownerPatternMatches(pattern, filePath) {
  const normalizedPattern = pattern.replace(/^\//, "");
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = escaped.replace(/\*/g, "[^/]*");
  return normalizedPattern.endsWith("/")
    ? new RegExp(`^${regexPattern}`).test(filePath)
    : new RegExp(`^${regexPattern}$`).test(filePath);
}

test("every canonical provider-visible surface has an owner review rule", () => {
  const rules = readFileSync(path.join(repoRoot, ".github/CODEOWNERS"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners };
    });
  const samples = [
    ...SOCIAL_PROVIDER_DESKTOP_FILES,
    ...PROVIDER_VISIBLE_EXTRA_FILES,
    ...PROVIDER_VISIBLE_ORCHESTRATION_FILES,
    ...PROVIDER_VISIBLE_EXACT_SCOPES.keys(),
    ...PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES.map(
      (prefix) => `${prefix}provider-contact.ts`,
    ),
    "packages/capture-facebook/src/normalize.ts",
    "packages/capture-instagram/src/browser.ts",
    "packages/capture-linkedin/src/selectors.ts",
    "packages/capture-x/src/endpoints.ts",
    "packages/capture-save/src/browser.ts",
  ];
  for (const filePath of samples) {
    const owner = rules
      .filter((rule) => codeownerPatternMatches(rule.pattern, filePath))
      .at(-1);
    assert.ok(
      owner?.owners.includes("@AubreyF"),
      `missing CODEOWNER for ${filePath}`,
    );
  }
});

test("the governance trust base has owner review coverage", () => {
  const rules = readFileSync(path.join(repoRoot, ".github/CODEOWNERS"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners };
    });
  const trustBase = [
    "package.json",
    "release-notes/releases/v26.7.1000-dev.json",
    "packages/desktop/package.json",
    "packages/pwa/package.json",
    "packages/desktop/src/lib/runtime-health-events.ts",
    "packages/desktop/src/lib/legal-consent.ts",
    "packages/shared/src/legal.ts",
    "website/src/app/page.tsx",
    ".github/CODEOWNERS",
    ".github/rulesets/dev.json",
    ".github/workflows/ci.yml",
    "scripts/lib/automation-control.mjs",
    "scripts/automation-control.mjs",
    "scripts/record-outcome.mjs",
    "scripts/sync-github-rulesets.mjs",
    "scripts/validate-automation-specs.mjs",
    "scripts/validate-worktree.mjs",
    "scripts/worktree-publish.sh",
  ];
  for (const filePath of trustBase) {
    const owner = rules
      .filter((rule) => codeownerPatternMatches(rule.pattern, filePath))
      .at(-1);
    assert.ok(
      owner?.owners.includes("@AubreyF"),
      `missing CODEOWNER for ${filePath}`,
    );
  }
});

function validApproval(overrides = {}) {
  return {
    schemaVersion: 1,
    approvalId: "provider-risk-2026-07-10-native-provider-lifecycle",
    approvedBy: "AubreyF",
    ownerApprovalReference: "Owner confirmation in task 019f",
    approvalSource: { kind: "control-task", reference: "P1-04" },
    approvedAt: "2026-07-10T16:00:00.000Z",
    expiresAt: "2026-07-17T16:00:00.000Z",
    providers: ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
    observableBehavior:
      "Changes when existing provider work is coordinated by the native runtime.",
    fingerprintingRisk:
      "A more regular provider lifecycle could make the session pattern easier to distinguish.",
    lowestProfileAlternative:
      "Keep the current lifecycle and collect passive diagnostics.",
    diffSha: "a".repeat(40),
    paths: ["packages/desktop/src-tauri/src/lib.rs"],
    pathScopes: [
      {
        path: "packages/desktop/src-tauri/src/lib.rs",
        providers: [
          "facebook",
          "instagram",
          "linkedin",
          "other",
          "x",
          "youtube",
        ],
      },
    ],
    ...overrides,
  };
}

function authorizedControlState(
  record,
  taskOverrides = {},
  eventOverrides = {},
) {
  const authorizationDigest = providerApprovalAuthorizationDigest(record);
  const task = {
    schemaVersion: 1,
    taskId: record.approvalSource.reference,
    state: "approved_for_pr",
    revision: 2,
    observerAuthority: "pr-only",
    providerAuthority: "approved",
    providerApprovalReference: authorizationDigest,
    createdAt: "2026-07-10T15:59:00.000Z",
    updatedAt: "2026-07-10T16:00:00.000Z",
    details: {},
    ...taskOverrides,
  };
  const event = {
    schemaVersion: 1,
    eventId: "provider-owner-authorization-event",
    type: "task_authority_updated",
    ts: "2026-07-10T16:00:00.000Z",
    actor: "freed-owner",
    taskId: task.taskId,
    taskRevision: 2,
    manifestRevision: 2,
    observerAuthority: task.observerAuthority,
    providerAuthority: "approved",
    providerApprovalReference: authorizationDigest,
    data: {
      authorizationProvenance: {
        leaseName: "owner-governance",
        leaseAcquiredAt: "2026-07-10T15:59:30.000Z",
        credentialKind: "owner-signed-capability",
        ownerCapabilityId: "provider-owner-capability",
        ownerCapabilityTaskId: task.taskId,
        ownerCapabilityIntentDigest: "b".repeat(64),
      },
    },
    ...eventOverrides,
  };
  return {
    controlManifest: {
      schemaVersion: 1,
      revision: 2,
      updatedAt: task.updatedAt,
      tasks: [task],
    },
    controlEvents: [
      {
        schemaVersion: 1,
        eventId: "provider-owner-lease-event",
        type: "lease_acquired",
        ts: "2026-07-10T15:59:30.000Z",
        actor: "freed-owner",
        leaseName: "owner-governance",
        data: {
          credentialKind: "owner-signed-capability",
          ownerCapabilityId: "provider-owner-capability",
          ownerCapabilityTaskId: task.taskId,
          ownerCapabilityIntentDigest: "b".repeat(64),
        },
      },
      event,
    ],
  };
}

test("structured provider approval validates exact path scope and expiry", () => {
  const approval = validateProviderRiskApproval(
    validApproval(),
    ["packages/desktop/src-tauri/src/lib.rs"],
    {
      now: Date.parse("2026-07-11T00:00:00.000Z"),
      diffSha: "a".repeat(40),
      ...authorizedControlState(validApproval()),
    },
  );

  assert.equal(approval.schemaVersion, 1);
  assert.deepEqual(approval.providers, [
    "facebook",
    "instagram",
    "linkedin",
    "other",
    "x",
    "youtube",
  ]);
  assert.deepEqual(approval.paths, ["packages/desktop/src-tauri/src/lib.rs"]);
  assert.match(approval.authorizationDigest, /^sha256:[0-9a-f]{64}$/);
});

test("structured provider approval accepts an exact YouTube scope", () => {
  const record = validApproval({
    approvalId: "provider-risk-2026-07-10-youtube-capture",
    providers: ["youtube"],
    observableBehavior:
      "Changes when the existing YouTube capture session contacts YouTube.",
    fingerprintingRisk:
      "A changed YouTube capture pattern could make the session easier to distinguish.",
    lowestProfileAlternative:
      "Keep the current YouTube contact pattern and collect passive diagnostics.",
    paths: ["packages/desktop/src/lib/youtube-capture.ts"],
    pathScopes: [
      {
        path: "packages/desktop/src/lib/youtube-capture.ts",
        providers: ["youtube"],
      },
    ],
  });
  const approval = validateProviderRiskApproval(record, record.paths, {
    now: Date.parse("2026-07-11T00:00:00.000Z"),
    diffSha: record.diffSha,
    ...authorizedControlState(record),
  });

  assert.deepEqual(approval.providers, ["youtube"]);
  assert.deepEqual(approval.paths, [
    "packages/desktop/src/lib/youtube-capture.ts",
  ]);
});

test("structured provider approval rejects a self-attested owner claim", () => {
  assert.throws(
    () =>
      validateProviderRiskApproval(
        validApproval(),
        ["packages/desktop/src-tauri/src/lib.rs"],
        {
          now: Date.parse("2026-07-11T00:00:00.000Z"),
          diffSha: "a".repeat(40),
        },
      ),
    /approvalSource control task was not found/,
  );
});

test("structured provider approval accepts an exact owner-confirmed digest without broker state", () => {
  const packet = validApproval({
    approvalSource: {
      kind: "owner-confirmation",
      reference: "task-019f-provider-diff-confirmation",
    },
  });
  const record = {
    ...packet,
    authorizationDigest: providerApprovalAuthorizationDigest(packet),
  };
  const approval = validateProviderRiskApproval(record, record.paths, {
    now: Date.parse("2026-07-11T00:00:00.000Z"),
    diffSha: record.diffSha,
  });

  assert.equal(approval.authorizationDigest, record.authorizationDigest);
  assert.equal(approval.approvalSource.kind, "owner-confirmation");
});

test("structured owner confirmation rejects a missing or changed packet digest", () => {
  const packet = validApproval({
    approvalSource: {
      kind: "owner-confirmation",
      reference: "task-019f-provider-diff-confirmation",
    },
  });
  assert.throws(
    () =>
      validateProviderRiskApproval(packet, packet.paths, {
        now: Date.parse("2026-07-11T00:00:00.000Z"),
        diffSha: packet.diffSha,
      }),
    /owner-confirmation approval must contain the exact authorizationDigest/,
  );
  assert.throws(
    () =>
      validateProviderRiskApproval(
        { ...packet, authorizationDigest: `sha256:${"0".repeat(64)}` },
        packet.paths,
        {
          now: Date.parse("2026-07-11T00:00:00.000Z"),
          diffSha: packet.diffSha,
        },
      ),
    /owner-confirmation approval must contain the exact authorizationDigest/,
  );
});

test("structured provider approval requires pr lifecycle authority and owner event provenance", () => {
  const record = validApproval();
  assert.throws(
    () =>
      validateProviderRiskApproval(record, record.paths, {
        now: Date.parse("2026-07-11T00:00:00.000Z"),
        diffSha: record.diffSha,
        ...authorizedControlState(record, {
          state: "observed",
          observerAuthority: "observe-only",
        }),
      }),
    /does not have a pr-only lifecycle ceiling[\s\S]*must be approved_for_pr or later/,
  );
  assert.throws(
    () =>
      validateProviderRiskApproval(record, record.paths, {
        now: Date.parse("2026-07-11T00:00:00.000Z"),
        diffSha: record.diffSha,
        ...authorizedControlState(
          record,
          {},
          { actor: "freed-nightly-runner" },
        ),
      }),
    /has no owner-signed-capability authorization event/,
  );
  const withoutOwnerLease = authorizedControlState(record);
  withoutOwnerLease.controlEvents = withoutOwnerLease.controlEvents.slice(1);
  assert.throws(
    () =>
      validateProviderRiskApproval(record, record.paths, {
        now: Date.parse("2026-07-11T00:00:00.000Z"),
        diffSha: record.diffSha,
        ...withoutOwnerLease,
      }),
    /has no owner-signed-capability authorization event/,
  );
});

test("approval digest CLI produces the control-task authorization reference", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-provider-approval-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const approvalPath = path.join(dir, "approval.json");
  const record = validApproval();
  writeFileSync(approvalPath, JSON.stringify(record));
  const result = spawnSync(
    process.execPath,
    [cliPath, "--approval-digest", approvalPath],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    providerApprovalAuthorizationDigest(record),
  );
});

test("provider-specific paths infer the provider used to validate approval scope", () => {
  assert.deepEqual(
    providerIdsForPath("packages/desktop/src-tauri/src/fb-extract.js"),
    ["facebook"],
  );
  assert.deepEqual(
    providerIdsForPath("packages/capture-instagram/src/browser.ts"),
    ["instagram"],
  );
  assert.deepEqual(
    providerIdsForPath("packages/capture-linkedin/src/selectors.ts"),
    ["linkedin"],
  );
  assert.deepEqual(providerIdsForPath("packages/capture-x/src/index.ts"), [
    "x",
  ]);
  assert.deepEqual(
    providerIdsForPath("packages/capture-youtube/src/browser.ts"),
    ["youtube"],
  );
  assert.deepEqual(
    providerIdsForPath(
      "packages/desktop/src/components/YouTubeSettingsSection.tsx",
    ),
    ["youtube"],
  );
  assert.deepEqual(providerIdsForPath("packages/shared/src/legal.ts"), [
    "facebook",
    "instagram",
    "linkedin",
    "x",
    "youtube",
  ]);
  assert.deepEqual(
    providerIdsForPath("packages/desktop/src/lib/google-contacts.ts"),
    ["other"],
  );
  assert.deepEqual(providerIdsForPath("packages/sync/src/cloud/gdrive.ts"), [
    "other",
  ]);
  assert.deepEqual(
    providerIdsForPath("packages/desktop/src-tauri/src/lib.rs"),
    ["facebook", "instagram", "linkedin", "other", "x", "youtube"],
  );
});

test("structured provider approval rejects uncovered and expired scope", () => {
  assert.throws(
    () =>
      validateProviderRiskApproval(
        validApproval({
          expiresAt: "2026-07-10T17:00:00.000Z",
          paths: ["packages/desktop/src/lib/fb-capture.ts"],
        }),
        ["packages/desktop/src-tauri/src/lib.rs"],
        { now: Date.parse("2026-07-11T00:00:00.000Z") },
      ),
    /approval has expired[\s\S]*approval does not cover provider-visible path/,
  );
});

test("structured provider approval rejects a changed diff", () => {
  assert.throws(
    () =>
      validateProviderRiskApproval(
        validApproval(),
        ["packages/desktop/src-tauri/src/lib.rs"],
        {
          now: Date.parse("2026-07-11T00:00:00.000Z"),
          diffSha: "b".repeat(40),
        },
      ),
    /approval diffSha does not match the current diff/,
  );
});

test("structured provider approval rejects extra paths and reusable approval windows", () => {
  assert.throws(
    () =>
      validateProviderRiskApproval(
        validApproval({
          expiresAt: "2026-07-18T16:00:00.000Z",
          paths: [
            "packages/desktop/src-tauri/src/lib.rs",
            "packages/desktop/src/lib/fb-capture.ts",
          ],
        }),
        ["packages/desktop/src-tauri/src/lib.rs"],
        {
          now: Date.parse("2026-07-11T00:00:00.000Z"),
          diffSha: "a".repeat(40),
        },
      ),
    /approval lifetime cannot exceed 7 days[\s\S]*approval includes a provider-visible path absent from the current diff/,
  );
});

test("structured provider approval rejects a future approval timestamp", () => {
  assert.throws(
    () =>
      validateProviderRiskApproval(
        validApproval({
          approvedAt: "2026-07-11T01:00:00.000Z",
          expiresAt: "2026-07-12T01:00:00.000Z",
        }),
        ["packages/desktop/src-tauri/src/lib.rs"],
        {
          now: Date.parse("2026-07-11T00:00:00.000Z"),
          diffSha: "a".repeat(40),
        },
      ),
    /approvedAt cannot be in the future/,
  );
});

test("structured provider approval rejects provider names that contradict the path", () => {
  assert.throws(
    () =>
      validateProviderRiskApproval(
        validApproval({
          providers: ["x"],
          paths: ["packages/desktop/src-tauri/src/fb-extract.js"],
          pathScopes: [
            {
              path: "packages/desktop/src-tauri/src/fb-extract.js",
              providers: ["x"],
            },
          ],
        }),
        ["packages/desktop/src-tauri/src/fb-extract.js"],
        {
          now: Date.parse("2026-07-11T00:00:00.000Z"),
          diffSha: "a".repeat(40),
        },
      ),
    /must equal inferred provider scope: facebook/,
  );
  assert.throws(
    () =>
      validateProviderRiskApproval(
        validApproval({
          providers: ["facebook"],
          paths: ["packages/shared/src/legal.ts"],
          pathScopes: [
            { path: "packages/shared/src/legal.ts", providers: ["facebook"] },
          ],
        }),
        ["packages/shared/src/legal.ts"],
        {
          now: Date.parse("2026-07-11T00:00:00.000Z"),
          diffSha: "a".repeat(40),
        },
      ),
    /must equal inferred provider scope: facebook, instagram, linkedin, x, youtube/,
  );
});

test("CLI filters stdin to provider-visible paths only", () => {
  const input = [
    "packages/desktop/src-tauri/src/fb-extract.js",
    "docs/STABILITY-PROGRAM.md",
    "packages/capture-linkedin/src/browser.ts",
    "scripts/release.sh",
    "",
  ].join("\n");

  const result = spawnSync(process.execPath, [cliPath, "--stdin"], {
    input,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").filter(Boolean), [
    "packages/desktop/src-tauri/src/fb-extract.js",
    "packages/capture-linkedin/src/browser.ts",
  ]);
});

test("CLI prints nothing when no path is provider-visible", () => {
  const result = spawnSync(process.execPath, [cliPath, "--stdin"], {
    input: "docs/README.md\nscripts/release.sh\n",
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("CLI accepts paths as arguments", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "packages/desktop/src/lib/user-agent.ts", "docs/README.md"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").filter(Boolean), [
    "packages/desktop/src/lib/user-agent.ts",
  ]);
});
