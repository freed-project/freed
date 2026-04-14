import { NextRequest, NextResponse } from "next/server";
import {
  getDownloadAsset,
  getReleaseChannelForHostname,
} from "@/lib/github-releases";

type DownloadTarget = "mac-arm" | "mac-intel" | "windows" | "linux";

function isDownloadTarget(value: string): value is DownloadTarget {
  return value === "mac-arm" || value === "mac-intel" || value === "windows" || value === "linux";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ target: string }> },
) {
  const { target } = await context.params;
  if (!isDownloadTarget(target)) {
    return NextResponse.json({ error: "Unknown download target." }, { status: 404 });
  }

  try {
    const channel = getReleaseChannelForHostname(request.nextUrl.hostname);
    const asset = await getDownloadAsset(channel, target);
    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resolve download asset.",
      },
      { status: 404 },
    );
  }
}
