import { NextRequest, NextResponse } from "next/server";
import { buildDesktopUpdateManifest } from "@/lib/github-releases";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ target: string }> },
) {
  try {
    const { target } = await context.params;
    const manifest = await buildDesktopUpdateManifest(target);

    return NextResponse.json(manifest, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to build desktop update manifest.",
      },
      { status: 404 },
    );
  }
}
