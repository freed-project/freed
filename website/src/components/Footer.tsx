import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-freed-border py-8 sm:py-12 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-2">
            <Link to="/" className="inline-flex items-baseline gap-0.5 mb-4">
              <span className="relative text-xl font-bold text-text-primary">
                FREED
                <span 
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899)' }}
                />
              </span>
              <span className="text-sm font-bold gradient-text">.WTF</span>
            </Link>
            <p className="text-text-secondary text-sm max-w-md">
              Take back your feed. FREED is open-source software that puts you in control 
              of your social media experience.
            </p>
          </div>
          
          {/* Links */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4">Product</h4>
            <ul className="space-y-2">
              <li>
                <Link to="/" className="text-text-secondary text-sm hover:text-text-primary transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/manifesto" className="text-text-secondary text-sm hover:text-text-primary transition-colors">
                  Manifesto
                </Link>
              </li>
              <li>
                <a href="#features" className="text-text-secondary text-sm hover:text-text-primary transition-colors">
                  Features
                </a>
              </li>
            </ul>
          </div>
          
          {/* Resources */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4">Resources</h4>
            <ul className="space-y-2">
              <li>
                <a 
                  href="https://github.com/freed-project" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a href="#" className="text-text-secondary text-sm hover:text-text-primary transition-colors">
                  Documentation
                </a>
              </li>
              <li>
                <a href="#" className="text-text-secondary text-sm hover:text-text-primary transition-colors">
                  Privacy Policy
                </a>
              </li>
            </ul>
          </div>
        </div>
        
        {/* Bottom */}
        <div className="mt-12 pt-8 border-t border-freed-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-text-muted text-sm">
            &copy; {new Date().getFullYear()} FREED. Open source under MIT License.
          </p>
          <p className="text-text-muted text-sm">
            Built for humans, not algorithms.
          </p>
        </div>
      </div>
    </footer>
  )
}
