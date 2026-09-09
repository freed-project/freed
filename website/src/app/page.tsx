import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import CTA from "@/components/CTA";
import ProductShowcase from "@/components/ProductShowcase";
import type { CSSProperties } from "react";

export default function LandingPage() {
  return (
    <div style={{ "--landing-section-gap": "clamp(3rem, calc(2rem + 4vw + 5svh), 10rem)" } as CSSProperties}>
      <Hero />
      <section className="mx-auto max-w-4xl px-8 sm:px-6" style={{ paddingBlock: "var(--landing-section-gap)" }} aria-label="Try Freed live">
        <ProductShowcase />
      </section>
      <Features />
      <HowItWorks />
      <CTA />
    </div>
  );
}
