import type { Metadata } from "next";
import ManifestoContent from "./ManifestoContent";

export const metadata: Metadata = {
  title: "Manifesto",
  description:
    "The Freed Manifesto: A declaration of digital independence. Why we built Freed and what we believe about the future of social media.",
};

export default function ManifestoPage() {
  return <ManifestoContent />;
}
