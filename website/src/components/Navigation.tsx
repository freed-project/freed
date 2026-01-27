import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'

const WTF_CAPTIONS = [
  "What They Fear",
  "Why Trust Facebook?",
  "Wreck Their Fuckery",
  "Where's The Friend?",
  "Withdraw The Feed",
  "Watch Them Fall",
  "We Took Freedom",
  "Without Their Filters",
  "Wrest The Feed",
  "Why They're Fucked",
  "We're Taking Freedom",
  "Withhold Their Feed",
]

export default function Navigation() {
  const location = useLocation()
  const [captionIndex, setCaptionIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  
  const handleMouseEnter = () => {
    setCaptionIndex((prev) => (prev + 1) % WTF_CAPTIONS.length)
    setIsHovering(true)
  }
  
  const navItems = [
    { path: '/', label: 'Home' },
    { path: '/manifesto', label: 'Manifesto' },
  ]
  
  return (
    <motion.nav 
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 py-4"
    >
      {/* Frosted glass background */}
      <div className="absolute inset-0 bg-freed-black/70 backdrop-blur-xl border-b border-freed-border" />
      
      <div className="max-w-6xl mx-auto flex items-center justify-between relative z-10">
        {/* Logo with rotating WTF caption */}
        <Link 
          to="/" 
          className="flex items-baseline gap-0.5 group relative"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setIsHovering(false)}
        >
          <span className="relative text-xl sm:text-2xl font-bold text-text-primary">
            FREED
            <span 
              className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
              style={{ background: 'linear-gradient(to right, #3b82f6, #8b5cf6, #ec4899, #ef4444, #f97316, #eab308, #22c55e, #3b82f6)' }}
            />
          </span>
          <span className="text-sm sm:text-base font-bold gradient-text">.WTF</span>
          
          {/* WTF caption tooltip - changes on each hover, hidden on mobile */}
          {isHovering && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden sm:block absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 rounded-lg bg-freed-surface border border-freed-border whitespace-nowrap"
            >
              <span className="text-sm text-text-secondary">
                {WTF_CAPTIONS[captionIndex]}
              </span>
            </motion.div>
          )}
        </Link>
        
        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`text-sm font-medium transition-colors ${
                location.pathname === item.path
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {item.label}
            </Link>
          ))}
          
          <a
            href="https://github.com/freed-project"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            GitHub
          </a>
          
          <button className="btn-primary text-sm">
            Get FREED
          </button>
        </div>

        {/* Mobile Hamburger Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5"
          aria-label="Toggle menu"
        >
          <motion.span
            animate={{ rotate: mobileMenuOpen ? 45 : 0, y: mobileMenuOpen ? 6 : 0 }}
            className="w-6 h-0.5 bg-text-primary rounded-full"
          />
          <motion.span
            animate={{ opacity: mobileMenuOpen ? 0 : 1 }}
            className="w-6 h-0.5 bg-text-primary rounded-full"
          />
          <motion.span
            animate={{ rotate: mobileMenuOpen ? -45 : 0, y: mobileMenuOpen ? -6 : 0 }}
            className="w-6 h-0.5 bg-text-primary rounded-full"
          />
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden absolute top-full left-0 right-0 bg-freed-black/95 backdrop-blur-xl border-b border-freed-border overflow-hidden"
          >
            <div className="px-4 py-6 flex flex-col gap-4">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`text-lg font-medium transition-colors py-2 ${
                    location.pathname === item.path
                      ? 'text-text-primary'
                      : 'text-text-secondary'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              
              <a
                href="https://github.com/freed-project"
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-medium text-text-secondary py-2"
              >
                GitHub
              </a>
              
              <button className="btn-primary text-base mt-2 w-full">
                Get FREED
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
