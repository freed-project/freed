"use client";

import { motion } from "framer-motion";
import { useNewsletter } from "@/context/NewsletterContext";

export default function ManifestoContent() {
  const { openModal } = useNewsletter();

  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <motion.article
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="prose prose-invert prose-base sm:prose-lg"
        >
          {/* Header */}
          <header className="text-center mb-10 sm:mb-16">
            <h1 className="theme-display-large text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6">
              <span className="theme-heading-accent">The Freed Manifesto</span>
            </h1>
            <p className="text-text-secondary text-lg sm:text-xl">
              A declaration of digital independence.
            </p>
          </header>

          {/* Content */}
          <div className="space-y-10 text-text-secondary">
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Problem
              </h2>
              <p>
                Open your feed. Something else has already decided what's
                waiting. Not to serve you... to keep you in the system. The
                design is deliberate. Outrage travels faster than nuance.
                Anxiety keeps you scrolling. The machine is working perfectly.
                It's just not working for you.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Pact
              </h2>
              <p>
                To live well, we should make decisions in moments of strength to
                hold strong in moments of weakness. Ulysses lashed himself to
                the mast before his ship reached the Sirens. He heard their
                song. He survived. The secret: decide before temptation arrives.
                Install Freed now. Never doom-scroll again.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Solution
              </h2>
              <p>
                Freed browses your feeds in the background and strips out the
                noise. Posts land in a secure vault on your computer, and are
                live-synced to your phone. Freed curates a unified feed of
                everything you love, with you in control. Your algorithm, your
                rules. The platforms become players in your game.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                What We Believe
              </h2>
              <ul className="space-y-5">
                <li>
                  <strong className="text-text-primary block mb-1">
                    Your attention is priceless
                  </strong>
                  It's also finite. With Freed, your time, your focus, and your
                  data stay yours. Everything you read lives on your device. We
                  never see any of it. Read what you came for. Get back to your
                  life.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    You should own the algorithm
                  </strong>
                  Freed's ranking is open source. You can tune which sources
                  matter most to you. You can read exactly why a post appears
                  first. You're in control.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    This belongs to everyone
                  </strong>
                  The code is public. The roadmap is public. Fork it. Audit it.
                  Share it.
                  <br />
                  Resonate? Join the movement.
                </li>
              </ul>
            </section>

            <section className="not-prose text-center py-14">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={openModal}
                className="btn-primary text-base px-8 py-3"
              >
                Free My Feed
              </motion.button>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-6">
                Go Deeper
              </h2>
              <div className="space-y-3 not-prose">
                {[
                  {
                    href: "https://www.youtube.com/watch?v=Ma4VZ7rxGOw",
                    title: "The Slow Poison of Endless Fantasy",
                    source: "After Skool",
                    description:
                      "On escapism, variable reward loops, and what the attention economy is slowly doing to your capacity for sustained thought.",
                  },
                  {
                    href: "https://www.youtube.com/watch?v=v1eW62X5fiE",
                    title:
                      "What if we had fixed social media? An alternative history",
                    source: "Center for Humane Technology",
                    description:
                      "What if we'd optimized for human flourishing instead of engagement?",
                  },
                  {
                    href: "https://www.youtube.com/watch?v=0v5RiMdSqwk&t=2109s",
                    title: "War on Sensemaking V",
                    source: "Daniel Schmachtenberger, Rebel Wisdom",
                    description:
                      "How algorithmic feeds degrade our collective ability to reason about reality. The linked timestamp drops you into the key section.",
                  },
                  {
                    href: "https://www.youtube.com/watch?v=C74amJRp730",
                    title:
                      "How a handful of tech companies control billions of minds",
                    source: "Tristan Harris, TED",
                    description:
                      "Seventeen minutes. The clearest explanation of how this happened, by someone who was inside Google when it did.",
                  },
                  {
                    href: "https://www.eff.org/cyberspace-independence",
                    title: "A Declaration of the Independence of Cyberspace",
                    source: "John Perry Barlow, 1996",
                    description:
                      "The original. Written the day the U.S. government first tried to regulate the internet. Thirty years later, may we each do our part.",
                  },
                ].map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col gap-1 rounded-xl border border-freed-border bg-freed-surface/30 p-4 transition-all duration-200 hover:border-[color:var(--theme-heading-accent)] hover:bg-freed-surface/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold leading-snug text-text-primary transition-colors group-hover:text-[color:var(--theme-heading-accent)]">
                        {item.title}
                      </span>
                      <svg
                        className="w-3.5 h-3.5 text-text-muted group-hover:text-text-secondary transition-colors shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </div>
                    <span className="text-xs text-text-muted">
                      {item.source}
                    </span>
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                      {item.description}
                    </p>
                  </a>
                ))}
              </div>
            </section>
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="pt-24 pb-8 text-center"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={openModal}
              className="btn-primary text-base px-8 py-3"
            >
              Join the Movement
            </motion.button>
          </motion.div>
        </motion.article>
      </div>
    </section>
  );
}
