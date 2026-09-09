import type { Metadata } from "next";
import VisionVariants from "./VisionVariants";

export const metadata: Metadata = {
  title: "The Freed Vision",
  description:
    "How Freed can protect the minds of the next generation and help culture reclaim control of attention.",
  alternates: { canonical: "/vision" },
  openGraph: {
    title: "The Freed Vision",
    description:
      "Give the next generation authority over the information that shapes its minds.",
    url: "https://freed.wtf/vision",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Freed Vision",
    description:
      "Give the next generation authority over the information that shapes its minds.",
  },
};

export default function VisionPage() {
  return <VisionVariants />;
}
