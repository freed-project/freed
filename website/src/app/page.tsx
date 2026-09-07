import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import CTA from "@/components/CTA";
import DemoLink from "@/components/DemoLink";

export default function LandingPage() {
  // Local review can use newly captured assets without publishing a release.
  const showcaseBase = process.env.NODE_ENV === "development"
    ? process.env.FREED_SHOWCASE_PREVIEW_BASE_URL || "https://github.com/freed-project/freed/releases/latest/download"
    : "https://github.com/freed-project/freed/releases/latest/download";
  return (
    <>
      <Hero />
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6" aria-label="Try Freed live">
        <DemoLink className="demo-showcase" aria-label="Try Freed live in a new tab">
          <picture>
            <source media="(prefers-reduced-motion: reduce)" srcSet={`${showcaseBase}/freed-showcase-unified-midas.png`} />
            {/* Release assets are verified against their manifest before publication. */}
            <img src={`${showcaseBase}/freed-showcase.gif`} alt="Freed product preview showing its feed, reader, map, and Friends on desktop and mobile" width={1440} height={960} loading="lazy" className="h-auto w-full" />
          </picture>
          <span className="btn-primary demo-showcase-caption">Try it live</span>
        </DemoLink>
      </section>
      <Features />
      <HowItWorks />
      <CTA />
    </>
  );
}
