import type { Metadata } from "next";
import ManifestoContent from "./ManifestoContent";

export const metadata: Metadata = {
  title: "Manifesto",
  description:
    "The FREED Manifesto: A declaration of digital independence. Why we built FREED and what we believe about the future of social media.",
};

export default function ManifestoPage() {
  return <ManifestoContent />;
}
