import { motion } from 'framer-motion'

const steps = [
  {
    number: '01',
    title: 'Install the Extension',
    description: 'Add FREED to Chrome, Safari, or Firefox. Works on desktop and mobile browsers.',
  },
  {
    number: '02',
    title: 'Browse Normally',
    description: 'FREED captures posts and stories as you scroll through X, Facebook, and Instagram.',
  },
  {
    number: '03',
    title: 'Open Your FREED',
    description: 'Access your unified feed—weighted by your preferences, not their algorithms.',
  },
  {
    number: '04',
    title: 'Find Your People',
    description: 'Check the Friend Map to see where your friends are and when they were last there.',
  },
]

export default function HowItWorks() {
  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6 relative overflow-hidden">
      {/* Background accent */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-glow-purple/5 to-transparent" />
      
      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            How It <span className="gradient-text">Works</span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Four simple steps to digital sovereignty.
          </p>
        </motion.div>
        
        {/* Steps */}
        <div className="relative">
          {/* Connecting line */}
          <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-glow-purple/30 to-transparent -translate-y-1/2" />
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="relative"
              >
                <div className="glass-card p-6 h-full">
                  {/* Step number */}
                  <div className="relative z-10 mb-4">
                    <span className="text-5xl font-bold gradient-text opacity-50">
                      {step.number}
                    </span>
                  </div>
                  
                  <h3 className="text-xl font-semibold text-text-primary mb-2">
                    {step.title}
                  </h3>
                  <p className="text-text-secondary text-sm">
                    {step.description}
                  </p>
                </div>
                
                {/* Connector dot */}
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-4 w-2 h-2 rounded-full bg-glow-purple glow-sm -translate-y-1/2 z-20" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
