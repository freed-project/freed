import { useMemo, useState } from "react";
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
}: {
  artifact: BugReportArtifactDefinition;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-[rgba(255,255,255,0.2)] bg-white/5 text-[#8b5cf6] focus:ring-[#8b5cf6] focus:ring-offset-0"
      />
      <div className="min-w-0">
        <p className="text-sm text-white">{artifact.label}</p>
        <p className="mt-1 text-xs text-[#71717a]">{artifact.description}</p>
      </div>
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
  const [working, setWorking] = useState<null | "export" | "github" | "private-share" | "screenshot">(null);
  const [lastBundleName, setLastBundleName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const privacyTier = getReportPrivacyTier(draft.selectedArtifacts, draft.screenshot);

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

  if (!bugReporting) return null;

  const updateDraft = <K extends keyof BugReportDraft>(key: K, value: BugReportDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleExport = async (tier: "public-safe" | "private") => {
    setWorking("export");
    setStatusMessage(null);
    try {
      const bundle = await bugReporting.generateBundle({ draft, privacyTier: tier });
      setLastBundleName(bundle.manifest.filename);
      if (bugReporting.exportBundle) {
        await bugReporting.exportBundle(bundle);
      } else {
        downloadBundle(bundle);
      }
      setStatusMessage(
        tier === "public-safe"
          ? "Public-safe bundle exported."
          : "Private bundle exported. Email it instead of posting it publicly.",
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
      const url = await githubUrl();
      (bugReporting.openUrl ?? openUrl ?? ((href) => window.open(href, "_blank", "noopener,noreferrer")))(url);
      setStatusMessage("Opened a public GitHub issue draft with sanitized details.");
    } finally {
      setWorking(null);
    }
  };

  const handlePrivateShare = async () => {
    setWorking("private-share");
    setStatusMessage(null);
    try {
      await handleExport("private");
      if (bugReporting.privateShareEmail) {
        const params = new URLSearchParams({
          subject: `Freed private bug report: ${draft.title || draft.issueType}`,
          body: [
            "I generated a private diagnostics bundle from Freed.",
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
    } finally {
      setWorking(null);
    }
  };

  const handleCaptureScreenshot = async () => {
    if (!bugReporting.captureScreenshot) return;
    setWorking("screenshot");
    setStatusMessage(null);
    try {
      const screenshot = await bugReporting.captureScreenshot();
      if (screenshot) {
        setDraft((current) => ({
          ...current,
          screenshot,
          selectedArtifacts: current.selectedArtifacts.includes("screenshot")
            ? current.selectedArtifacts
            : [...current.selectedArtifacts, "screenshot"],
        }));
      }
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
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-1 text-sm text-[#71717a]">
          Default exports are safe for public GitHub issues. Private diagnostics are opt-in and should be emailed instead.
        </p>
      </div>

      <div
        className={`rounded-2xl border px-4 py-3 ${
          privacyTier === "public-safe"
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-amber-500/20 bg-amber-500/5"
        }`}
      >
        <p className="text-sm font-medium text-white">
          Privacy mode: {privacyTier === "public-safe" ? "Public-safe" : "Private"}
        </p>
        <p className="mt-1 text-xs text-[#a1a1aa]">
          {privacyTier === "public-safe"
            ? "This bundle is intended to be safe for a public GitHub issue."
            : "This bundle may include details you may not want to post publicly. Use email or private sharing."}
        </p>
      </div>

      <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        <label className="block">
          <span className="mb-1 block text-xs text-[#71717a]">Issue type</span>
          <select
            value={draft.issueType}
            onChange={(event) => updateDraft("issueType", event.target.value as BugReportIssueType)}
            className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-[#8b5cf6]/50 focus:outline-none"
          >
            {issueTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[#71717a]">Title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(event) => updateDraft("title", event.target.value)}
            placeholder="Short summary"
            className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-[#52525b] focus:border-[#8b5cf6]/50 focus:outline-none"
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
          <p className="text-sm font-medium text-white">Included in the public-safe bundle</p>
          <p className="mt-1 text-xs text-[#71717a]">These are enabled by default and designed for public sharing.</p>
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
          <p className="text-sm font-medium text-white">Private diagnostics</p>
          <p className="mt-1 text-xs text-[#71717a]">
            Turning these on may expose more of your local environment. Email these bundles instead of posting them publicly.
          </p>
        </div>
        {PRIVATE_ARTIFACTS.filter((artifact) => artifact.id !== "screenshot").map((artifact) => (
          <ArtifactToggle
            key={artifact.id}
            artifact={artifact}
            checked={draft.selectedArtifacts.includes(artifact.id)}
            onChange={(checked) => toggleArtifact(artifact.id, checked)}
          />
        ))}
        <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white">Screenshot</p>
              <p className="mt-1 text-xs text-[#71717a]">
                Capture a screenshot only after reviewing what it shows.
              </p>
            </div>
            <button
              onClick={handleCaptureScreenshot}
              disabled={working === "screenshot" || !bugReporting.captureScreenshot}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#a1a1aa] transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working === "screenshot" ? "Capturing..." : "Capture screenshot"}
            </button>
          </div>
          {draft.screenshot ? (
            <div className="mt-3 space-y-3">
              <img
                src={draft.screenshot.dataUrl}
                alt="Captured screenshot preview"
                className="max-h-56 w-full rounded-xl border border-[rgba(255,255,255,0.08)] object-contain"
              />
              <label className="flex items-start gap-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-black/20 p-3">
                <input
                  type="checkbox"
                  checked={draft.screenshot.safeForPublic}
                  onChange={(event) =>
                    updateDraft("screenshot", {
                      ...draft.screenshot!,
                      safeForPublic: event.target.checked,
                    })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-[rgba(255,255,255,0.2)] bg-white/5 text-[#8b5cf6] focus:ring-[#8b5cf6] focus:ring-offset-0"
                />
                <div>
                  <p className="text-sm text-white">This screenshot is safe to post publicly.</p>
                  <p className="mt-1 text-xs text-[#71717a]">
                    Leave this off if it shows private content, account names, or anything sensitive.
                  </p>
                </div>
              </label>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-4">
        <p className="text-sm font-medium text-white">Review before export</p>
        <p className="mt-1 text-xs text-[#71717a]">
          Bundle type: {privacyTier === "public-safe" ? "Public-safe zip" : "Private zip"}
        </p>
        <p className="mt-2 text-xs text-[#71717a]">
          Included artifacts: {draft.selectedArtifacts.length.toLocaleString()}
        </p>
        {lastBundleName ? (
          <p className="mt-2 text-xs text-[#71717a]">Last exported: {lastBundleName}</p>
        ) : null}
        {statusMessage ? <p className="mt-2 text-xs text-[#8b5cf6]">{statusMessage}</p> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => handleExport("public-safe")}
          disabled={working !== null}
          className="rounded-xl bg-[#8b5cf6] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#7c3aed] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export public-safe bundle
        </button>
        <button
          onClick={handleOpenGitHub}
          disabled={working !== null}
          className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-[#a1a1aa] transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Open GitHub issue
        </button>
        <button
          onClick={handlePrivateShare}
          disabled={working !== null}
          className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export private bundle for email
        </button>
      </div>

      {privacyTier === "private" ? (
        <p className="text-xs text-amber-300">
          This bundle may include information you may not want to post publicly. Use email or private sharing, not a public GitHub attachment.
        </p>
      ) : (
        <p className="text-xs text-[#71717a]">
          GitHub issues created from this screen always use a sanitized public-safe summary.
        </p>
      )}
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
      <span className="mb-1 block text-xs text-[#71717a]">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-[#52525b] focus:border-[#8b5cf6]/50 focus:outline-none"
      />
    </label>
  );
}
