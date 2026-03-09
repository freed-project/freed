import type { Metadata } from "next";
import UpdatesContent from "./UpdatesContent";

export const metadata: Metadata = {
  title: "Blog | Freed",
  description:
    "Progress reports, technical deep-dives, and the occasional philosophical rant about the attention economy.",
};

export default function BlogPage() {
  return <UpdatesContent />;
}
