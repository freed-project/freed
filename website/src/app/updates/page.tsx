import type { Metadata } from "next";
import UpdatesContent from "./UpdatesContent";

export const metadata: Metadata = {
  title: "Updates",
  description:
    "FREED project updates, progress reports, technical deep-dives, and the occasional philosophical rant about the attention economy.",
};

export default function UpdatesPage() {
  return <UpdatesContent />;
}
