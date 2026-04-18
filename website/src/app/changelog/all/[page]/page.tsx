import type { Metadata } from "next";
import ChangelogContent from "../../ChangelogContent";
import {
  buildChangelogMetadata,
  getChangelogPageRange,
  getChangelogPageSliceForMode,
  getChangelogPaginationStaticParams,
  getLatestChangelogTagName,
  getChangelogTotalPages,
  parseChangelogPage,
} from "../../pagination";

interface Props {
  params: Promise<{ page: string }>;
}

const mode = "all";

export function generateStaticParams(): Array<{ page: string }> {
  return getChangelogPaginationStaticParams(mode);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await params;
  return buildChangelogMetadata(parseChangelogPage(page, mode), mode);
}

export default async function AllChangelogPaginationPage({ params }: Props) {
  const { page } = await params;
  const currentPage = parseChangelogPage(page, mode);

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
