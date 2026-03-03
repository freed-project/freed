import type { Metadata } from "next";
import PrivacyContent from "./PrivacyContent";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Freed's privacy policy. The short version: we collect nothing. Your data lives on your device, not ours.",
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
