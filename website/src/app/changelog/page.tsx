import type { Metadata } from "next";
import ChangelogContent from "./ChangelogContent";
import {
  buildChangelogMetadata,
  getChangelogPageRange,
  getChangelogPageSlice,
  getChangelogTotalPages,
} from "./pagination";

export const metadata: Metadata = buildChangelogMetadata(1);

export default function ChangelogPage() {
  const currentPage = 1;

  return (
    <ChangelogContent
      releases={getChangelogPageSlice(currentPage)}
      currentPage={currentPage}
      totalPages={getChangelogTotalPages()}
      pageRange={getChangelogPageRange(currentPage)}
    />
  );
}
