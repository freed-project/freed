import type { Metadata } from "next";
import QrGallery from "./QrGallery";

export const metadata: Metadata = {
  title: "Scan Freed",
  description:
    "Scan to open Freed and take back your feed.",
  alternates: {
    canonical: "/qr",
  },
};

export default function QrPage() {
  return <QrGallery />;
}
