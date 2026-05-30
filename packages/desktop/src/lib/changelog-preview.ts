import type { ReleaseChannel } from "@freed/shared";
import type { ChangelogPreviewRelease } from "@freed/ui/context";

interface ReleaseNote {
  tag?: string;
  version?: string;
  channel?: ReleaseChannel;
  dayKey?: string;
  approved?: boolean;
  generatedAt?: string;
  release?: {
    deck?: string;
    features?: ReleaseNoteItem[];
    fixes?: ReleaseNoteItem[];
    followUps?: ReleaseNoteItem[];
  };
}

type ReleaseNoteItem = string | { text?: string };

const RELEASE_NOTES = import.meta.glob<ReleaseNote>(
  "../../../../release-notes/releases/*.json",
  { eager: true, import: "default" },
);

function parseVersion(version: string): {
  yy: number;
  month: number;
  patch: number;
  channelRank: number;
} {
  const normalized = version.replace(/^v/, "");
  const isDev = normalized.endsWith("-dev");
  const baseVersion = isDev ? normalized.slice(0, -"-dev".length) : normalized;
  const [yy = "0", month = "0", patch = "0"] = baseVersion.split(".");

  return {
    yy: Number(yy),
    month: Number(month),
    patch: Number(patch),
    channelRank: isDev ? 0 : 1,
  };
}

function compareVersionsDescending(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);

  if (leftVersion.yy !== rightVersion.yy) {
    return rightVersion.yy - leftVersion.yy;
  }

  if (leftVersion.month !== rightVersion.month) {
    return rightVersion.month - leftVersion.month;
  }

  if (leftVersion.patch !== rightVersion.patch) {
    return rightVersion.patch - leftVersion.patch;
  }

  return rightVersion.channelRank - leftVersion.channelRank;
}

function getReleaseItems(note: ReleaseNote): string[] {
  return [
    ...(note.release?.features ?? []),
    ...(note.release?.fixes ?? []),
    ...(note.release?.followUps ?? []),
  ]
    .map((item) => (typeof item === "string" ? item : item.text ?? "").trim())
    .filter(Boolean);
}

export function buildChangelogPreviewFromNotes(
  notes: ReleaseNote[],
  limit = 5,
): ChangelogPreviewRelease[] {
  const seenDayChannels = new Set<string>();
  const previews: ChangelogPreviewRelease[] = [];

  for (const note of [...notes].sort((left, right) => {
    const versionSort = compareVersionsDescending(left.version ?? "", right.version ?? "");
    if (versionSort !== 0) {
      return versionSort;
    }

    return Date.parse(right.generatedAt ?? "") - Date.parse(left.generatedAt ?? "");
  })) {
    if (note.approved === false || !note.version || !note.channel) {
      continue;
    }

    const dayChannelKey = `${note.dayKey ?? note.version}:${note.channel}`;
    if (seenDayChannels.has(dayChannelKey)) {
      continue;
    }

    const items = getReleaseItems(note);
    const summary = note.release?.deck?.trim() || items[0] || `Freed v${note.version}`;

    seenDayChannels.add(dayChannelKey);
    previews.push({
      version: note.version,
      channel: note.channel,
      date: note.generatedAt ?? null,
      summary,
      items: items.filter((item) => item !== summary).slice(0, 2),
    });

    if (previews.length >= limit) {
      break;
    }
  }

  return previews;
}

export const DESKTOP_CHANGELOG_PREVIEW = buildChangelogPreviewFromNotes(
  Object.values(RELEASE_NOTES),
  Number.POSITIVE_INFINITY,
);
