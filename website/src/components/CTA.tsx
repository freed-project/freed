import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useNewsletter } from '../context/NewsletterContext'

export default function CTA() {
  const { openModal } = useNewsletter()
  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          {/* Glow background */}
          <div className="absolute inset-0 bg-gradient-to-r from-glow-blue/20 via-glow-purple/20 to-glow-cyan/20 rounded-3xl blur-xl" />
          
          <div className="relative glass-card p-8 sm:p-12 md:p-16 text-center overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 left-1/4 w-32 h-32 bg-glow-purple/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-glow-blue/10 rounded-full blur-3xl" />
            
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 relative z-10"
            >
              Ready to be{' '}
              <span className="gradient-text">FREED</span>?
            </motion.h2>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="text-text-secondary text-base sm:text-lg max-w-xl mx-auto mb-6 sm:mb-8 relative z-10"
            >
              Join thousands who've taken back control of their digital lives. 
              Open source, free forever, built for humans.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center relative z-10"
            >
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={openModal}
                className="btn-primary text-base px-8 py-3 w-full sm:w-auto"
              >
                Download for Chrome
              </motion.button>
              
              <Link to="/manifesto" className="w-full sm:w-auto">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="btn-secondary text-base px-8 py-3 w-full"
                >
                  Why We Built This
                </motion.button>
              </Link>
            </motion.div>
            
            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.6 }}
              className="text-text-muted text-xs sm:text-sm mt-6 sm:mt-8 relative z-10"
            >
              Also available for Safari and Firefox • MIT License
            </motion.p>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
