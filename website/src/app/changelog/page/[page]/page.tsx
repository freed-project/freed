import type { Metadata } from "next";
import ChangelogContent from "../../ChangelogContent";
import {
  buildChangelogMetadata,
  getChangelogPageRange,
  getChangelogPageSlice,
  getChangelogPaginationStaticParams,
  getChangelogTotalPages,
  parseChangelogPage,
} from "../../pagination";

interface Props {
  params: Promise<{ page: string }>;
}

export function generateStaticParams(): Array<{ page: string }> {
  return getChangelogPaginationStaticParams();
}

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { page } = await params;
  return buildChangelogMetadata(parseChangelogPage(page));
}

export default async function ChangelogPaginationPage({
  params,
}: Props) {
  const { page } = await params;
  const currentPage = parseChangelogPage(page);

  return (
    <ChangelogContent
      releases={getChangelogPageSlice(currentPage)}
      currentPage={currentPage}
      totalPages={getChangelogTotalPages()}
      pageRange={getChangelogPageRange(currentPage)}
    />
  );
}
