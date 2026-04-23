import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BugReportArtifactDefinition,
  BugReportArtifactId,
  BugReportDraft,
  BugReportIssueType,
  GeneratedBugReportBundle,
} from "@freed/shared";
import {
  createDefaultBugReportDraft,
  createGithubIssueUrl,
  getReportPrivacyTier,
  PRIVATE_ARTIFACTS,
  PUBLIC_SAFE_ARTIFACTS,
} from "../../lib/bug-report.js";
import { usePlatform } from "../../context/PlatformContext.js";
import { toast } from "../Toast.js";
import { Tooltip } from "../Tooltip.js";

interface ReportComposerProps {
  initialIssueType?: BugReportIssueType;
  title?: string;
  compact?: boolean;
}

function downloadBundle(bundle: GeneratedBugReportBundle) {
  const url = URL.createObjectURL(bundle.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = bundle.manifest.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function ArtifactToggle({
  artifact,
  checked,
  onChange,
  disabled = false,
}: {
  artifact: BugReportArtifactDefinition;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`theme-dialog-section flex items-start gap-3 rounded-xl p-3 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-[color:var(--theme-border-subtle)] bg-[color:var(--theme-bg-input)] text-[var(--theme-accent-secondary)] focus:ring-[color:var(--theme-focus-ring)] focus:ring-offset-0"
      />
      <div className="min-w-0">
        <p className="text-sm text-[color:var(--theme-text-primary)]">{artifact.label}</p>
        <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">{artifact.description}</p>
      </div>
    </label>
  );
}

function ArtifactGroupCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!checkboxRef.current) return;
    checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="inline-flex cursor-pointer items-center gap-3">
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-[color:var(--theme-border-subtle)] bg-[color:var(--theme-bg-input)] text-[var(--theme-accent-secondary)] focus:ring-[color:var(--theme-focus-ring)] focus:ring-offset-0"
      />
      <span className="text-sm font-medium text-[color:var(--theme-text-primary)]">{label}</span>
    </label>
  );
}

export function ReportComposer({
  initialIssueType = "other",
  title = "Report a problem",
  compact = false,
}: ReportComposerProps) {
  const { bugReporting, openUrl } = usePlatform();
  const [draft, setDraft] = useState<BugReportDraft>(() => ({
    ...createDefaultBugReportDraft(initialIssueType),
    ...(bugReporting?.createDraft?.(initialIssueType) ?? {}),
  }));
  const [working, setWorking] = useState<null | "export" | "github" | "private-share">(null);
  const [lastBundleName, setLastBundleName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const privacyTier = getReportPrivacyTier(draft.selectedArtifacts);
  const selectedArtifactSet = useMemo(
    () => new Set(draft.selectedArtifacts),
    [draft.selectedArtifacts],
  );
  const allPrivateArtifactsSelected = PRIVATE_ARTIFACTS.every((artifact) =>
    selectedArtifactSet.has(artifact.id),
  );
  const somePrivateArtifactsSelected = PRIVATE_ARTIFACTS.some((artifact) =>
    selectedArtifactSet.has(artifact.id),
  );
  const exportButtonLabel =
    privacyTier === "public-safe"
      ? "Download Public Safe Bundle"
      : "Download Private Bundle";
  const githubIssueDisabledByPrivacy = privacyTier === "private";

  const toggleArtifact = (artifactId: BugReportArtifactId, nextChecked: boolean) => {
    setDraft((current) => {
      const selected = new Set(current.selectedArtifacts);
      if (nextChecked) {
        selected.add(artifactId);
      } else {
        selected.delete(artifactId);
      }
      return { ...current, selectedArtifacts: Array.from(selected) };
    });
  };

  const toggleArtifactGroup = (
    artifactIds: BugReportArtifactId[],
    nextChecked: boolean,
  ) => {
    setDraft((current) => {
      const selected = new Set(current.selectedArtifacts);
      for (const artifactId of artifactIds) {
        if (nextChecked) {
          selected.add(artifactId);
        } else {
          selected.delete(artifactId);
        }
      }
      return { ...current, selectedArtifacts: Array.from(selected) };
    });
  };

  const githubUrl = useMemo(() => {
    if (!bugReporting) return null;
    return async () => {
      const bundle = await bugReporting.generateBundle({
        draft,
        privacyTier: "public-safe",
      });
      return createGithubIssueUrl({
        repo: bugReporting.githubRepo,
        draft,
        bundle,
      });
    };
  }, [bugReporting, draft]);
  const githubIssueDisabled = working !== null || privacyTier === "private" || !githubUrl;

  if (!bugReporting) return null;

  const updateDraft = <K extends keyof BugReportDraft>(key: K, value: BugReportDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const exportBundleForTier = async (tier: "public-safe" | "private") => {
    const bundle = await bugReporting.generateBundle({ draft, privacyTier: tier });
    setLastBundleName(bundle.manifest.filename);
    if (bugReporting.exportBundle) {
      await bugReporting.exportBundle(bundle);
    } else {
      downloadBundle(bundle);
    }
    return bundle;
  };

  const handleExport = async (tier: "public-safe" | "private") => {
    setWorking("export");
    setStatusMessage(null);
    try {
      await exportBundleForTier(tier);
      setStatusMessage(
        tier === "public-safe"
          ? "Public-safe bundle exported."
          : "Private bundle exported. Email it instead of posting it publicly.",
      );
      toast.info(
        tier === "public-safe"
          ? "Downloaded bundle."
          : "Downloaded private bundle.",
      );
    } finally {
      setWorking(null);
    }
  };

  const handleOpenGitHub = async () => {
    if (!githubUrl) return;
    setWorking("github");
    setStatusMessage(null);
    try {
      await exportBundleForTier("public-safe");
      const url = await githubUrl();
      (bugReporting.openUrl ?? openUrl ?? ((href) => window.open(href, "_blank", "noopener,noreferrer")))(url);
      setStatusMessage("Downloaded a public-safe bundle and opened a sanitized GitHub issue draft.");
      toast.info("Downloaded bundle and opened a GitHub issue draft.");
    } finally {
      setWorking(null);
    }
  };

  const handlePrivateShare = async () => {
    setWorking("private-share");
    setStatusMessage(null);
    try {
      await exportBundleForTier(privacyTier);
      if (bugReporting.privateShareEmail) {
        const params = new URLSearchParams({
          subject: `Freed bug report: ${draft.title || draft.issueType}`,
          body: [
            `I generated a ${privacyTier === "private" ? "private" : "public-safe"} diagnostics bundle from Freed.`,
            "",
            "Summary:",
            draft.description || "(none provided)",
            "",
            "Please attach the exported zip bundle to this email before sending.",
          ].join("\n"),
        });
        const mailto = `mailto:${bugReporting.privateShareEmail}?${params.toString()}`;
        (bugReporting.openUrl ?? openUrl ?? ((href) => window.open(href, "_blank", "noopener,noreferrer")))(mailto);
      }
      setStatusMessage(
        privacyTier === "private"
          ? "Downloaded a private bundle and opened an email draft."
          : "Downloaded a public-safe bundle and opened an email draft.",
      );
      toast.info(
        privacyTier === "private"
          ? "Downloaded private bundle and opened an email draft."
          : "Downloaded public-safe bundle and opened an email draft.",
      );
    } finally {
      setWorking(null);
    }
  };

  const issueTypeOptions: Array<{ value: BugReportIssueType; label: string }> = [
    { value: "crash", label: "Crash" },
    { value: "broken-feature", label: "Broken feature" },
    { value: "sync-problem", label: "Sync problem" },
    { value: "performance", label: "Performance" },
    { value: "other", label: "Other" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-[color:var(--theme-text-primary)]">{title}</h3>
        <p className="mt-1 text-sm text-[color:var(--theme-text-muted)]">
          Default exports are safe for public GitHub issues. Private diagnostics are opt-in and should be emailed instead.
        </p>
      </div>

      <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        <label className="block">
          <span className="mb-1 block text-xs text-[color:var(--theme-text-muted)]">Issue type</span>
          <select
            value={draft.issueType}
            onChange={(event) => updateDraft("issueType", event.target.value as BugReportIssueType)}
            className="theme-input theme-select w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
          >
            {issueTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[color:var(--theme-text-muted)]">Title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(event) => updateDraft("title", event.target.value)}
            placeholder="Short summary"
            className="theme-input w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
          />
        </label>
      </div>

      <Field
        label="What happened?"
        value={draft.description}
        onChange={(value) => updateDraft("description", value)}
        placeholder="Describe the problem in plain language."
      />
      <Field
        label="Steps to reproduce"
        value={draft.reproSteps}
        onChange={(value) => updateDraft("reproSteps", value)}
        placeholder="Tell us how to trigger the issue."
      />
      <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        <Field
          label="Expected behavior"
          value={draft.expectedBehavior}
          onChange={(value) => updateDraft("expectedBehavior", value)}
          placeholder="What should have happened?"
          rows={3}
        />
        <Field
          label="Actual behavior"
          value={draft.actualBehavior}
          onChange={(value) => updateDraft("actualBehavior", value)}
          placeholder="What happened instead?"
          rows={3}
        />
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">Included in the public-safe bundle</p>
          <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">These are enabled by default and designed for public sharing.</p>
        </div>
        {PUBLIC_SAFE_ARTIFACTS.map((artifact) => (
          <ArtifactToggle
            key={artifact.id}
            artifact={artifact}
            checked={draft.selectedArtifacts.includes(artifact.id)}
            onChange={(checked) => toggleArtifact(artifact.id, checked)}
          />
        ))}
      </div>

      <div className="space-y-3">
        <div>
          <ArtifactGroupCheckbox
            checked={allPrivateArtifactsSelected}
            indeterminate={somePrivateArtifactsSelected && !allPrivateArtifactsSelected}
            onChange={(checked) =>
              toggleArtifactGroup(
                PRIVATE_ARTIFACTS.map((artifact) => artifact.id),
                checked,
              )
            }
            label="Private diagnostics"
          />
          <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
            Turning these on may expose more of your local environment. Email these bundles instead of posting them publicly.
          </p>
        </div>
        {PRIVATE_ARTIFACTS.map((artifact) => (
          <ArtifactToggle
            key={artifact.id}
            artifact={artifact}
            checked={draft.selectedArtifacts.includes(artifact.id)}
            onChange={(checked) => toggleArtifact(artifact.id, checked)}
          />
        ))}
      </div>

      <div
        className={`rounded-2xl p-4 ${
          privacyTier === "public-safe"
            ? "theme-feedback-panel-success"
            : "theme-feedback-panel-warning"
        }`}
      >
        <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
          Privacy mode: {privacyTier === "public-safe" ? "Public-safe" : "Private"}
        </p>
        <p className="mt-1 text-xs text-[color:var(--theme-text-secondary)]">
          {privacyTier === "public-safe"
            ? "This bundle is intended to be safe for a public GitHub issue."
            : "This bundle may include details you may not want to post publicly. Use email or private sharing."}
        </p>
        <p className="mt-3 text-xs text-[color:var(--theme-text-muted)]">
          Bundle type: {privacyTier === "public-safe" ? "Public-safe zip" : "Private zip"}
        </p>
        <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
          Included artifacts: {draft.selectedArtifacts.length.toLocaleString()}
        </p>
        {lastBundleName ? (
          <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">Last exported: {lastBundleName}</p>
        ) : null}
        {statusMessage ? <p className="theme-feedback-text-info mt-2 text-xs">{statusMessage}</p> : null}
        {privacyTier === "private" ? (
          <p className="theme-feedback-text-warning mt-3 text-xs">
            This bundle may include information you may not want to post publicly. Use email or private sharing, not a public GitHub attachment.
          </p>
        ) : (
          <p className="mt-3 text-xs text-[color:var(--theme-text-muted)]">
            GitHub issues created from this screen always use a sanitized public-safe summary.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => handleExport(privacyTier)}
          disabled={working !== null}
          className="btn-primary rounded-xl px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exportButtonLabel}
        </button>
        <button
          onClick={handlePrivateShare}
          disabled={working !== null}
          className="theme-feedback-button-warning rounded-xl px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download and email
        </button>
        {githubIssueDisabledByPrivacy ? (
          <Tooltip
            label="Turn off private diagnostics first"
            description="GitHub issues are public. Private bundles may expose local details, so email them instead."
            side="top"
          >
            <span className="inline-flex">
              <button
                onClick={handleOpenGitHub}
                disabled={githubIssueDisabled}
                aria-disabled="true"
                className="btn-secondary rounded-xl px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download and open GitHub issue
              </button>
            </span>
          </Tooltip>
        ) : (
          <button
            onClick={handleOpenGitHub}
            disabled={githubIssueDisabled}
            className="btn-secondary rounded-xl px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download and open GitHub issue
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[color:var(--theme-text-muted)]">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="theme-input w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
      />
    </label>
  );
}
