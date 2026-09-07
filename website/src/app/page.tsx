import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import CTA from "@/components/CTA";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" aria-labelledby="demo-heading">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="demo-heading" className="theme-display-large text-3xl font-bold">See Freed in action</h2>
            <p className="mt-2 text-text-secondary">Explore the feed, Stories, map, and Friends with sample content.</p>
          </div>
          <a href="https://demo.freed.wtf" target="_blank" rel="noopener noreferrer" className="btn-primary whitespace-nowrap">Experience the live demo</a>
        </div>
        <a href="https://demo.freed.wtf" target="_blank" rel="noopener noreferrer" aria-label="Open the full Freed demo in a new tab">
          <picture>
            <source media="(prefers-reduced-motion: reduce)" srcSet="https://github.com/freed-project/freed/releases/latest/download/freed-showcase-unified-midas.png" />
            {/* Release assets are verified against their manifest before publication. */}
            <img src="https://github.com/freed-project/freed/releases/latest/download/freed-showcase.gif" alt="Freed product preview showing Unified Feed, Stories, Instagram, Map, and Friends" width={1440} height={960} loading="lazy" className="h-auto w-full rounded-2xl border border-freed-border" />
          </picture>
        </a>
      </section>
      <Features />
      <HowItWorks />
      <CTA />
    </>
  );
}
