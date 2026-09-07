import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import CTA from "@/components/CTA";
import ProductShowcase from "@/components/ProductShowcase";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6" aria-label="Try Freed live">
        <ProductShowcase />
      </section>
      <Features />
      <HowItWorks />
      <CTA />
    </>
  );
}
