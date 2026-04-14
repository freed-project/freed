import {
  getReleaseChannelFromVersion,
  inferReleaseChannelFromHostname,
  stripReleaseChannelSuffix,
  type ReleaseChannel,
} from "@freed/shared";

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/freed-project/freed/releases?per_page=100";

type GitHubAsset = {
  name: string;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  body: string | null;
  assets: GitHubAsset[];
};

type TauriPlatformManifest = {
  signature: string;
  url: string;
};

type TauriLatestManifest = {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, TauriPlatformManifest>;
};

type DownloadTarget = "mac-arm" | "mac-intel" | "windows" | "linux";

function parseVersionParts(version: string): {
  yy: number;
  month: number;
  patch: number;
} {
  const normalized = stripReleaseChannelSuffix(version.replace(/^v/, ""));
  const [yy = "0", month = "0", patch = "0"] = normalized.split(".");
  return {
    yy: Number(yy),
    month: Number(month),
    patch: Number(patch),
  };
}

function compareVersionsDescending(left: string, right: string): number {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);

  if (a.yy !== b.yy) {
    return b.yy - a.yy;
  }

  if (a.month !== b.month) {
    return b.month - a.month;
  }

  return b.patch - a.patch;
}

function githubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "freed-website",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token =
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.RELEASE_GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function releaseMatchesChannel(
  release: GitHubRelease,
  channel: ReleaseChannel,
): boolean {
  if (release.draft) {
    return false;
  }

  const releaseChannel = getReleaseChannelFromVersion(release.tag_name);

  if (channel === "dev") {
    return release.prerelease && releaseChannel === "dev";
  }

  return !release.prerelease && releaseChannel === "production";
}

export function getReleaseChannelForHostname(hostname: string): ReleaseChannel {
  return inferReleaseChannelFromHostname(hostname) ?? "production";
}

export async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: githubHeaders(),
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Failed to load GitHub releases: ${response.status}`);
  }

  return (await response.json()) as GitHubRelease[];
}

export async function getLatestReleaseForChannel(
  channel: ReleaseChannel,
): Promise<GitHubRelease> {
  const releases = await fetchGitHubReleases();
  const release = releases
    .filter((item) => releaseMatchesChannel(item, channel))
    .sort((left, right) => compareVersionsDescending(left.tag_name, right.tag_name))[0];

  if (!release) {
    throw new Error(`No ${channel} release found.`);
  }

  return release;
}

export async function fetchLatestManifestForRelease(
  release: GitHubRelease,
): Promise<TauriLatestManifest> {
  const latestAsset = release.assets.find((asset) => asset.name === "latest.json");
  if (!latestAsset) {
    throw new Error(`Release ${release.tag_name} is missing latest.json.`);
  }

  const response = await fetch(latestAsset.browser_download_url, {
    headers: { "User-Agent": "freed-website" },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Failed to load latest.json for ${release.tag_name}.`);
  }

  return (await response.json()) as TauriLatestManifest;
}

export async function buildDesktopUpdateManifest(
  target: string,
): Promise<TauriLatestManifest> {
  const [channel, ...rest] = target.split("-");
  if ((channel !== "production" && channel !== "dev") || rest.length === 0) {
    throw new Error("Invalid desktop update target.");
  }

  const platformTarget = rest.join("-");
  const release = await getLatestReleaseForChannel(channel);
  const latestManifest = await fetchLatestManifestForRelease(release);
  const platform = latestManifest.platforms[platformTarget];

  if (!platform) {
    throw new Error(`No updater artifact found for ${platformTarget}.`);
  }

  return {
    version: latestManifest.version,
    notes: latestManifest.notes,
    pub_date: latestManifest.pub_date ?? release.published_at,
    platforms: {
      [target]: platform,
    },
  };
}

function findAssetByPattern(
  release: GitHubRelease,
  exactNames: string[],
  pattern: RegExp,
): GitHubAsset | null {
  for (const name of exactNames) {
    const exact = release.assets.find((asset) => asset.name === name);
    if (exact) {
      return exact;
    }
  }

  return release.assets.find((asset) => pattern.test(asset.name)) ?? null;
}

export async function getDownloadAsset(
  channel: ReleaseChannel,
  target: DownloadTarget,
): Promise<GitHubAsset> {
  const release = await getLatestReleaseForChannel(channel);

  const asset =
    target === "mac-arm"
      ? findAssetByPattern(release, ["Freed-macOS-arm64.dmg"], /_aarch64\.dmg$/)
      : target === "mac-intel"
        ? findAssetByPattern(release, ["Freed-macOS-x64.dmg"], /_x64\.dmg$/)
        : target === "windows"
          ? findAssetByPattern(release, ["Freed-Windows-x64-setup.exe"], /_x64-setup\.exe$/)
          : findAssetByPattern(release, ["Freed-Linux-x64.AppImage"], /_amd64\.AppImage$/);

  if (!asset) {
    throw new Error(`No ${target} asset found for ${release.tag_name}.`);
  }

  return asset;
}
