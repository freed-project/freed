import { motion, AnimatePresence } from 'framer-motion'

interface NewsletterModalProps {
  isOpen: boolean
  onClose: () => void
}

// TODO: Re-enable form submission when Brevo is configured
// See workers/README.md for setup instructions

export default function NewsletterModal({ isOpen, onClose }: NewsletterModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.5 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4"
          >
            <div className="relative glass-card p-8 overflow-hidden">
              {/* Decorative glow */}
              <div className="absolute top-0 left-1/4 w-32 h-32 bg-glow-purple/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-glow-blue/20 rounded-full blur-3xl" />

              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="relative z-10">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-text-primary mb-2">
                    Get <span className="gradient-text">FREED</span>
                  </h3>
                  <p className="text-text-secondary">
                    Be the first to know when we launch. Join the waitlist for early access.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <input
                      type="email"
                      placeholder="Enter your email"
                      disabled
                      className="w-full px-4 py-3 rounded-lg bg-freed-surface border border-freed-border text-text-primary placeholder:text-text-muted opacity-50 cursor-not-allowed"
                    />
                  </div>

                  <div className="relative group">
                    <motion.button
                      type="button"
                      disabled
                      className="w-full btn-primary py-3 opacity-60 cursor-not-allowed"
                    >
                      Join the Waitlist
                    </motion.button>
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-freed-surface border border-freed-border rounded-lg text-xs text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      COMING SOON
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-freed-border" />
                    </div>
                  </div>
                </div>

                <p className="text-text-muted text-xs text-center mt-4">
                  No spam. Unsubscribe anytime. We respect your privacy.
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
