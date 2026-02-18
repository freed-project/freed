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
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6">
              <span className="gradient-text">The Freed Manifesto</span>
            </h1>
            <p className="text-text-secondary text-lg sm:text-xl">
              A declaration of digital independence.
            </p>
          </header>

          {/* Content */}
          <div className="space-y-10 text-text-secondary">
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Extraction
              </h2>
              <p>
                Every time you open a social media app, you are not a customer.
                You are the product. Your attention is being harvested, packaged,
                and sold to the highest bidder—and the platform's entire
                engineering budget is dedicated to maximizing the yield.
              </p>
              <p>
                These platforms didn't accidentally become addictive. They
                employed thousands of engineers, behavioral psychologists, and
                machine learning researchers specifically to exploit the gaps in
                human cognition. They discovered that outrage travels six times
                faster than measured reflection. That variable reward schedules
                create compulsive checking behaviors. That social comparison
                triggers anxiety that sends you back to the feed looking for
                relief.
              </p>
              <p>
                They race to the bottom of the brainstem. Your rational mind
                never gets a vote.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                What We Lost
              </h2>
              <p>
                It wasn't always like this. RSS readers existed. Chronological
                feeds existed. The early web was about publishing what you made
                and reading what others made, without a middleman deciding what
                you deserved to see.
              </p>
              <p>
                Then the platforms learned they could grow faster by hijacking
                the signal. They replaced chronological feeds with algorithmic
                ones optimized for engagement—not for your benefit, but for
                theirs. They introduced infinite scroll. They removed the ability
                to be "done." They made it technically impossible to simply read
                what the people you chose to follow had written.
              </p>
              <p>
                The cost has been enormous: the erosion of genuine discourse,
                the polarization of communities, the commodification of
                friendship, and billions of hours of human attention redirected
                from everything that matters toward a compulsive, joyless scroll.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Ulysses Pact
              </h2>
              <p>
                In Homer's <em>Odyssey</em>, Odysseus wanted to hear the
                Sirens' song—the most beautiful music in the world—without being
                lured to his death on the rocks below. He couldn't trust himself
                to resist in the moment. So he made a decision in advance: had
                his crew bind him to the mast and fill their own ears with wax.
                He heard the Sirens. He survived. He got what he wanted by
                choosing his constraints <em>before</em> the temptation arrived.
              </p>
              <p>
                This is a Ulysses Pact: a commitment made in advance, by your
                deliberate self, to protect you from the choices your impulsive
                self would make.
              </p>
              <p>
                Freed is your mast. You configure it once—deciding which
                creators matter to you, how much weight to give different
                sources, which platforms to access only through Freed's filtered
                lens—and then you engage with the internet only through that
                configuration. The algorithm that shapes your experience is one
                you wrote yourself, in a moment of clarity, rather than one
                written by engineers optimizing for your compulsion.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                What We Believe
              </h2>
              <ul className="space-y-6">
                <li>
                  <strong className="text-text-primary block mb-1">
                    Your data belongs to you.
                  </strong>
                  Freed stores everything locally on your device. We have no
                  servers. We collect no telemetry. We never see your content,
                  your follows, or your reading habits. When you sync between
                  your devices, the data travels through cloud storage you
                  already own—your Google Drive, your iCloud, your Dropbox—
                  without ever touching our infrastructure.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    Algorithms should be transparent and editable.
                  </strong>
                  Freed's ranking algorithm is open source. You can read exactly
                  how it decides what to show you first. You can edit the weights
                  yourself. You can fork it and build your own. This is not a
                  feature—it is a requirement for any tool that shapes your
                  information diet.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    Chronological is not naïve.
                  </strong>
                  Choosing to see content in the order it was published is a
                  legitimate preference, not a failure of curation. The people
                  you follow made decisions about what to share and when. You
                  should have the option to respect those decisions without a
                  platform overriding them.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    Attention is finite and precious.
                  </strong>
                  The platforms have forgotten this. We have not. Freed is
                  designed to help you finish your feed—to know when you've
                  read the things that matter and have permission to stop.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    Liberation tools should belong to everyone.
                  </strong>
                  Freed is MIT licensed. Fork it, audit it, distribute it,
                  improve it. Build the future you want to live in.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Vision
              </h2>
              <p>
                We're not asking you to quit social media. We're asking you to
                engage with it on your terms.
              </p>
              <p>
                A Freed user sees a clean timeline of posts from people they
                genuinely care about—writers, friends, researchers, journalists—
                ranked by criteria they defined: author authority, topic
                relevance, freshness. They read through it until they're done.
                Then they close the app. There is no infinite scroll. There is
                no algorithmic outrage-injection. There is no dark pattern
                designed to prevent them from leaving.
              </p>
              <p>
                They know when they've caught up. They can mark something as
                read, archive a conversation, save an article for later. They can
                enable Ulysses Mode and block themselves from accessing the raw
                platform until morning. They sync their reading state across
                their laptop and phone without any of it touching our servers.
              </p>
              <p>
                That's the whole vision. It's not revolutionary. It's just what
                the internet was supposed to be.
              </p>
            </section>

            <section className="pt-8 border-t border-freed-border">
              <blockquote className="text-xl italic text-text-primary border-l-4 border-glow-purple pl-6">
                "The algorithm that serves you best is the one you wrote
                yourself."
                <footer className="text-text-secondary text-base mt-2 not-italic">
                  — The Freed Manifesto
                </footer>
              </blockquote>
            </section>

            <section>
              <p>
                We're building this in the open. The roadmap is public. The code
                is public. The process is public. We'd love your help, your
                feedback, and your critique.
              </p>
              <p>
                And if this resonates with you—if you've been waiting for
                someone to build this—subscribe below. We'll let you know when
                it's ready to install.
              </p>
            </section>
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-16 text-center"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={openModal}
              className="btn-primary text-base px-8 py-3"
            >
              Get Freed
            </motion.button>
          </motion.div>
        </motion.article>
      </div>
    </section>
  );
}
