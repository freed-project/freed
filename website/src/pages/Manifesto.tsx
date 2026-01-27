import { motion } from 'framer-motion'

export default function Manifesto() {
  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6">
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
              <span className="gradient-text">The FREED Manifesto</span>
            </h1>
            <p className="text-text-secondary text-lg sm:text-xl">
              A declaration of digital independence.
            </p>
          </header>
          
          {/* Content */}
          <div className="space-y-8 text-text-secondary">
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Problem
              </h2>
              <p>
                Modern social media platforms have weaponized psychology against us. Their algorithms 
                don't serve our interests—they serve engagement metrics. They've discovered that 
                outrage, anxiety, and FOMO are more addictive than connection and joy.
              </p>
              <p>
                These platforms race to the bottom of the human brainstem, using dopamine as an 
                energy-extractive neurotoxin. We scroll endlessly, not because we want to, but 
                because we've been engineered to.
              </p>
            </section>
            
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Ulysses Pact
              </h2>
              <p>
                In Greek mythology, Odysseus knew he couldn't resist the Sirens' song. So he had 
                his crew bind him to the mast before they sailed past. He chose his constraints 
                <em>before</em> facing temptation.
              </p>
              <p>
                FREED is your mast. You configure it once—deciding what content matters to you, 
                how your feed should be weighted, which platforms to block—and then you engage 
                only through FREED. The algorithm that serves you best is the one you wrote yourself.
              </p>
            </section>
            
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                What We Believe
              </h2>
              <ul className="space-y-4">
                <li>
                  <strong className="text-text-primary">Your data belongs to you.</strong> FREED stores 
                  everything locally. We have no servers, collect no telemetry, and never see your content.
                </li>
                <li>
                  <strong className="text-text-primary">Algorithms should be transparent.</strong> FREED's 
                  ranking is open source. You can read, modify, and improve it.
                </li>
                <li>
                  <strong className="text-text-primary">Technology should connect us.</strong> The Friend 
                  Map exists because we believe social media should facilitate real human interaction, 
                  not replace it.
                </li>
                <li>
                  <strong className="text-text-primary">Freedom requires intentionality.</strong> Ulysses 
                  Mode isn't about restriction—it's about choosing your constraints before the Sirens start singing.
                </li>
              </ul>
            </section>
            
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Path Forward
              </h2>
              <p>
                We're not asking you to quit social media. We're offering a way to engage with it 
                on your terms. See the content from people you actually care about. Know where your 
                friends are. Break free from the infinite scroll.
              </p>
              <p>
                FREED is open source because we believe tools for liberation should belong to everyone. 
                Fork it, audit it, improve it. Build the future of social media with us.
              </p>
            </section>
            
            <section className="pt-8 border-t border-freed-border">
              <blockquote className="text-xl italic text-text-primary border-l-4 border-glow-purple pl-6">
                "The algorithm that serves you best is the one you wrote yourself."
                <footer className="text-text-secondary text-base mt-2 not-italic">
                  — The Codex of Digital Autonomy
                </footer>
              </blockquote>
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
              className="btn-primary text-base px-8 py-3"
            >
              Get FREED
            </motion.button>
          </motion.div>
        </motion.article>
      </div>
    </section>
  )
}
