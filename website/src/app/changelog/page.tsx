import type { Metadata } from "next";
import ChangelogContent from "./ChangelogContent";
import {
  buildChangelogMetadata,
  getChangelogPageRange,
  getChangelogPageSlice,
  getLatestChangelogTagName,
  getChangelogTotalPages,
} from "./pagination";

export const metadata: Metadata = buildChangelogMetadata(1);

export default function ChangelogPage() {
  const currentPage = 1;
  const mode = "production";

  return (
    <ChangelogContent
      releases={getChangelogPageSlice(currentPage)}
      currentPage={currentPage}
      mode={mode}
      totalPages={getChangelogTotalPages(mode)}
      pageRange={getChangelogPageRange(currentPage, mode)}
      latestProductionTagName={getLatestChangelogTagName("production")}
      latestDevTagName={getLatestChangelogTagName("dev")}
    />
  );
}
