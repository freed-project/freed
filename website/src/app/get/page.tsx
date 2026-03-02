import type { Metadata } from "next";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import CTA from "@/components/CTA";

export const metadata: Metadata = {
  title: "Get Freed",
  description:
    "Download Freed for your platform or use the web app. Take back your feed with local-first, private, open-source software.",
  openGraph: {
    title: "Get Freed - Take Back Your Feed",
    description:
      "Download Freed for your platform or use the web app. Local-first, private, and free forever.",
  },
};

export default function GetPage() {
  return (
    <>
      <Hero />
      <Features />
      <HowItWorks />
      <CTA />
    </>
  );
}
