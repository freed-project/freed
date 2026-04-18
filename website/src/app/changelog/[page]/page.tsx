import type { Metadata } from "next";
import ChangelogContent from "../ChangelogContent";
import {
  buildChangelogMetadata,
  getChangelogPageRange,
  getChangelogPageSlice,
  getChangelogPaginationStaticParams,
  getLatestChangelogTagName,
  getChangelogTotalPages,
  parseChangelogPage,
} from "../pagination";

interface Props {
  params: Promise<{ page: string }>;
}

export function generateStaticParams(): Array<{ page: string }> {
  return getChangelogPaginationStaticParams("production");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await params;
  return buildChangelogMetadata(parseChangelogPage(page, "production"));
}

export default async function ChangelogPaginationPage({ params }: Props) {
  const { page } = await params;
  const mode = "production";
  const currentPage = parseChangelogPage(page, mode);

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
