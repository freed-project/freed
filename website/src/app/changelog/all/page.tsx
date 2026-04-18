import type { Metadata } from "next";
import ChangelogContent from "../ChangelogContent";
import {
  buildChangelogMetadata,
  getChangelogPageRange,
  getChangelogPageSliceForMode,
  getLatestChangelogTagName,
  getChangelogTotalPages,
} from "../pagination";

const mode = "all";

export const metadata: Metadata = buildChangelogMetadata(1, mode);

export default function AllChangelogPage() {
  const currentPage = 1;

  return (
    <ChangelogContent
      releases={getChangelogPageSliceForMode(currentPage, mode)}
      currentPage={currentPage}
      mode={mode}
      totalPages={getChangelogTotalPages(mode)}
      pageRange={getChangelogPageRange(currentPage, mode)}
      latestProductionTagName={getLatestChangelogTagName("production")}
      latestDevTagName={getLatestChangelogTagName("dev")}
    />
  );
}
