import type { Metadata } from "next";
import NewsletterEmbedForm from "@/components/NewsletterEmbedForm";

export const metadata: Metadata = {
  title: "Freed Newsletter",
  robots: { index: false, follow: false },
};

export default function NewsletterEmbedPage() {
  return <NewsletterEmbedForm />;
}
