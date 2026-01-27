import { motion } from 'framer-motion'

const features = [
  {
    icon: '🔒',
    title: 'Local-First Privacy',
    description: 'All your data stays on your device. No servers, no tracking, no telemetry. Your feed, your control.',
  },
  {
    icon: '🌊',
    title: 'Unified Feed',
    description: 'One feed to rule them all. X, Facebook, Instagram—combined and weighted by what matters to you.',
  },
  {
    icon: '📍',
    title: 'Friend Map',
    description: 'See where your friends are in real life. Location extraction from posts and stories builds a live map.',
  },
  {
    icon: '⚓',
    title: 'Ulysses Mode',
    description: 'Bind yourself to your values. Block algorithmic feeds and only engage through FREED.',
  },
  {
    icon: '🔄',
    title: 'Cross-Device Sync',
    description: 'CRDT-powered sync across all your devices. No cloud required—peer-to-peer when you want it.',
  },
  {
    icon: '💜',
    title: 'Open Source',
    description: 'MIT licensed. Fork it, audit it, improve it. Built by humans who are Open to Source.',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-16 sm:py-24 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-16"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4">
            <span className="gradient-text">Features</span> for Freedom
          </h2>
          <p className="text-text-secondary text-base sm:text-lg max-w-2xl mx-auto px-4">
            Everything you need to break free from algorithmic manipulation 
            and build genuine human connections.
          </p>
        </motion.div>
        
        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="glass-card p-6 h-full transition-all duration-300 hover:glow-sm">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">
                  {feature.title}
                </h3>
                <p className="text-text-secondary">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
