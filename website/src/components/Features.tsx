import { motion } from 'framer-motion'

// Custom SVG icons with gradient styling
const PrivacyIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="privacyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <path
      d="M24 4L6 12v12c0 11.1 7.7 21.5 18 24 10.3-2.5 18-12.9 18-24V12L24 4z"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="22" r="4" fill="url(#privacyGrad)" />
    <path
      d="M24 26v6"
      stroke="url(#privacyGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
)

const UnifiedFeedIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="feedGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="60%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    {/* Great wave - Hokusai inspired */}
    <path 
      d="M4 44 L4 34 Q8 32 12 28 Q18 22 24 14 Q28 8 34 6 Q40 4 44 8 Q46 12 44 18 L42 20 Q38 18 36 22 Q34 26 30 28 L26 30 Q22 32 18 36 Q12 42 8 44 Z" 
      fill="url(#feedGrad)"
    />
    {/* Curling crest */}
    <path 
      d="M44 8 Q48 6 48 12 Q48 18 44 22 Q40 26 36 24" 
      fill="none" 
      stroke="#a855f7" 
      strokeWidth="2.5" 
      strokeLinecap="round"
    />
    {/* Inner curl detail */}
    <path 
      d="M44 12 Q46 14 44 18 Q42 20 40 20" 
      fill="none" 
      stroke="#8b5cf6" 
      strokeWidth="1.5" 
      strokeLinecap="round"
      opacity="0.8"
    />
    {/* Foam/spray */}
    <circle cx="46" cy="8" r="2" fill="#a855f7" />
    <circle cx="42" cy="4" r="1.5" fill="#8b5cf6" opacity="0.8" />
    <circle cx="48" cy="14" r="1.5" fill="#6366f1" opacity="0.6" />
  </svg>
)

const FriendMapIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="mapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <path
      d="M24 4C16.27 4 10 10.27 10 18c0 10.5 14 26 14 26s14-15.5 14-26c0-7.73-6.27-14-14-14z"
      fill="none"
      stroke="url(#mapGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="18" r="5" fill="url(#mapGrad)" />
    <circle cx="12" cy="36" r="2" fill="#6366f1" opacity="0.6" />
    <circle cx="36" cy="32" r="2" fill="#a855f7" opacity="0.6" />
    <circle cx="40" cy="40" r="1.5" fill="#8b5cf6" opacity="0.4" />
  </svg>
)

const UlyssesIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="ulyssesGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    {/* Siren silhouette */}
    {/* Flowing hair */}
    <path d="M16 6 Q12 10 10 18 Q9 22 10 26" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M18 4 Q16 12 14 20" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    <path d="M32 6 Q36 10 38 18 Q39 22 38 26" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M30 4 Q32 12 34 20" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    {/* Head */}
    <circle cx="24" cy="10" r="5" fill="url(#ulyssesGrad)" opacity="0.9" />
    {/* Curved feminine torso */}
    <path d="M24 15 Q20 18 21 22 Q22 26 24 28" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M24 15 Q28 18 27 22 Q26 26 24 28" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="2.5" strokeLinecap="round" />
    {/* Elegant S-curve tail */}
    <path d="M24 28 Q18 32 20 38 Q22 42 28 44 Q34 45 40 42" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="3" strokeLinecap="round" />
    {/* Flowing tail fin */}
    <path d="M40 42 Q44 38 46 40" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M40 42 Q44 46 46 44" fill="none" stroke="url(#ulyssesGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

const SyncIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="syncGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    {/* Laptop */}
    <rect x="2" y="14" width="18" height="12" rx="1" fill="none" stroke="url(#syncGrad)" strokeWidth="2" />
    <path d="M0 26 L4 30 L18 30 L22 26" fill="none" stroke="url(#syncGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    {/* Phone */}
    <rect x="34" y="12" width="10" height="18" rx="2" fill="none" stroke="url(#syncGrad)" strokeWidth="2" />
    <circle cx="39" cy="26" r="1.5" fill="url(#syncGrad)" />
    {/* Sync arrows */}
    <path d="M24 18 L32 18" fill="none" stroke="url(#syncGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M29 15 L32 18 L29 21" fill="none" stroke="url(#syncGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M32 26 L24 26" fill="none" stroke="url(#syncGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M27 23 L24 26 L27 29" fill="none" stroke="url(#syncGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const OpenSourceIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="ossGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    <path
      d="M24 8C14.06 8 6 16.06 6 26c0 7.18 4.69 13.27 11.18 15.38.82.15 1.12-.36 1.12-.79v-2.77c-4.55.99-5.51-2.19-5.51-2.19-.74-1.89-1.81-2.39-1.81-2.39-1.48-1.01.11-.99.11-.99 1.64.12 2.5 1.68 2.5 1.68 1.46 2.5 3.82 1.78 4.75 1.36.15-1.06.57-1.78 1.04-2.19-3.63-.41-7.45-1.82-7.45-8.08 0-1.78.64-3.24 1.68-4.38-.17-.41-.73-2.07.16-4.32 0 0 1.37-.44 4.48 1.67 1.3-.36 2.69-.54 4.08-.55 1.38.01 2.78.19 4.08.55 3.11-2.11 4.47-1.67 4.47-1.67.89 2.25.33 3.91.16 4.32 1.05 1.14 1.68 2.6 1.68 4.38 0 6.28-3.82 7.66-7.46 8.07.59.51 1.11 1.5 1.11 3.03v4.49c0 .44.29.95 1.13.79C37.31 39.27 42 33.18 42 26c0-9.94-8.06-18-18-18z"
      fill="url(#ossGrad)"
    />
  </svg>
)

const features = [
  {
    icon: <PrivacyIcon />,
    title: 'Local-First Privacy',
    description: 'All your data stays on your device. No servers, no tracking, no telemetry. Your feed, your control.',
  },
  {
    icon: <UnifiedFeedIcon />,
    title: 'Unified Feed',
    description: 'One feed to rule them all. X, Facebook, Instagram—combined and weighted by what matters to you.',
  },
  {
    icon: <FriendMapIcon />,
    title: 'Friend Map',
    description: 'See where your friends are in real life. Location extraction from posts and stories builds a live map.',
  },
  {
    icon: <UlyssesIcon />,
    title: 'Ulysses Mode',
    description: 'Bind yourself to your values. Block algorithmic feeds and only engage through FREED.',
  },
  {
    icon: <SyncIcon />,
    title: 'Cross-Device Sync',
    description: 'CRDT-powered sync across all your devices. No cloud required—peer-to-peer when you want it.',
  },
  {
    icon: <OpenSourceIcon />,
    title: 'Open Source',
    description: 'MIT licensed. Fork it, audit it, improve it. Built by humans who are Open to Source.',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-16 sm:py-24 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        {/*<motion.div*/}
        {/*  initial={{ opacity: 0, y: 20 }}*/}
        {/*  whileInView={{ opacity: 1, y: 0 }}*/}
        {/*  viewport={{ once: true }}*/}
        {/*  transition={{ duration: 0.6 }}*/}
        {/*  className="text-center mb-10 sm:mb-16"*/}
        {/*>*/}
        {/*  <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4">*/}
        {/*    Features for <span className="gradient-text">Freed</span>om*/}
        {/*  </h2>*/}
        {/*  <p className="text-text-secondary text-base sm:text-lg max-w-2xl mx-auto px-4">*/}
        {/*    Everything you need to break free from algorithmic manipulation */}
        {/*    and build genuine human connections.*/}
        {/*  </p>*/}
        {/*</motion.div>*/}
        
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
                <div className="mb-4">{feature.icon}</div>
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
