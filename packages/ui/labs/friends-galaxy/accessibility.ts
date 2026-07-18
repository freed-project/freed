export type GalaxyLabSelectionAnnouncementKind = "focus" | "selection";

const CAMERA_HELP =
  "Use arrow keys to pan, plus and minus to zoom, Home or zero to fit, Enter to open details, Shift plus F10 to open actions, and Escape to clear selection.";
const FALLBACK_LABEL = "Galaxy item";

function accessibleLabel(
  label: string | null,
  fallback = FALLBACK_LABEL,
): string {
  const normalized = label?.trim().slice(0, 160);
  return normalized || fallback;
}

export function galaxyLabGraphDescription(
  selectedLabel: string | null,
  reducedMotion: boolean,
): string {
  const selection = selectedLabel
    ? ` Selected ${accessibleLabel(selectedLabel)}.`
    : "";
  const motion = reducedMotion ? " Ambient animation is reduced." : "";
  return `Interactive Friends Galaxy.${selection} ${CAMERA_HELP}${motion}`;
}

export function galaxyLabSelectionAnnouncement(
  selectedLabel: string | null,
  kind: GalaxyLabSelectionAnnouncementKind,
): string {
  if (!selectedLabel) return "Selection cleared.";
  const label = accessibleLabel(selectedLabel);
  return kind === "focus"
    ? `${label} focused and selected.`
    : `${label} selected.`;
}

export function galaxyLabRecoveryAnnouncement(rendererLabel: string): string {
  return `Friends Galaxy recovered with ${accessibleLabel(rendererLabel, "the compatibility renderer")}.`;
}

export function galaxyLabUnavailableAnnouncement(): string {
  return "Friends Galaxy renderer unavailable.";
}
