import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import HeroAnimation from './HeroAnimation'

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-6 pt-20">
      {/* Open Source badge - positioned under right edge of nav, hidden on mobile */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="hidden md:block absolute top-20 right-6 mt-4"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-freed-border bg-freed-surface/50">
          <span className="w-2 h-2 rounded-full bg-glow-purple animate-pulse" />
          <span className="text-sm text-text-secondary">Open Source & Free Forever</span>
        </div>
      </motion.div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Text Content */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6">
            <span className="gradient-text">Take Back</span>
            <br />
            <span className="text-text-primary">Your Feed</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-text-primary font-medium mb-4">
            The platforms built empires on your attention... You just walked out the door.
          </p>
          
          <p className="text-lg text-text-secondary max-w-xl mb-8">
            Mental sovereignty. Digital dignity. Your feed, your rules—ad-free, algorithm-free, with a live map of where your people actually are.
          </p>
          
          <div className="flex flex-wrap gap-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary text-base px-8 py-3"
            >
              Get FREED
            </motion.button>
            
            <Link to="/manifesto">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="btn-secondary text-base px-8 py-3"
              >
                Read the Manifesto
              </motion.button>
            </Link>
          </div>
          
          {/* Stats */}
          <div className="flex gap-8 mt-12 pt-8 border-t border-freed-border">
            <div>
              <p className="text-3xl font-bold text-text-primary">100%</p>
              <p className="text-sm text-text-secondary">Local Storage</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-text-primary">0</p>
              <p className="text-sm text-text-secondary">Data Collected</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-text-primary">∞</p>
              <p className="text-sm text-text-secondary">Freedom</p>
            </div>
          </div>
        </motion.div>
        
        {/* Animation */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="relative"
        >
          <HeroAnimation />
        </motion.div>
      </div>
      
      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-6 h-10 rounded-full border-2 border-text-muted flex items-start justify-center p-2"
        >
          <div className="w-1 h-2 rounded-full bg-text-muted" />
        </motion.div>
      </motion.div>
    </section>
  )
}
