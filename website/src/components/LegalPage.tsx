import type { ReactNode } from "react";
import { MarketingPageShell } from "@/components/MarketingPageShell";

interface LegalPageSection {
  title: string;
  content: ReactNode;
}

interface LegalPageProps {
  title: string;
  effectiveDate: string;
  intro: ReactNode;
  sections: LegalPageSection[];
}

export function LegalPage({
  title,
  effectiveDate,
  intro,
  sections,
}: LegalPageProps) {
  return (
    <MarketingPageShell>
        <article className="prose prose-invert prose-base sm:prose-lg">
          <header className="text-center mb-10 sm:mb-16">
            <h1 className="theme-display-large text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6">
              <span className="theme-page-heading-accent">{title}</span>
            </h1>
            <p className="text-text-secondary text-lg sm:text-xl">
              Effective {effectiveDate}
            </p>
          </header>

          <div className="glass-card p-6 sm:p-8 mb-12 border border-freed-border">
            <div className="text-text-secondary text-sm sm:text-base leading-relaxed">
              {intro}
            </div>
          </div>

          <div className="space-y-10 text-text-secondary">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-2xl font-bold text-text-primary mb-4">
                  {section.title}
                </h2>
                <div>{section.content}</div>
              </section>
            ))}
          </div>
        </article>
    </MarketingPageShell>
  );
}
