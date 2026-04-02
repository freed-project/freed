import type { Metadata } from "next";
import changelogReleases from "@/content/changelog.generated.json";
import type { ParsedRelease } from "@/content/changelog";
import ChangelogContent from "./ChangelogContent";

export const metadata: Metadata = {
  title: "Log | Freed",
  description:
    "Every release, every fix, every new feature. The full build history of Freed Desktop.",
  openGraph: {
    title: "Log | Freed",
    description:
      "Every release, every fix, every new feature. The full build history of Freed Desktop.",
  },
};

export default function ChangelogPage() {
  return (
    <ChangelogContent releases={changelogReleases as ParsedRelease[]} />
  );
}
