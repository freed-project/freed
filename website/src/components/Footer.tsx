import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-freed-border py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-glow-blue to-glow-purple flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="text-xl font-bold text-text-primary">FREED</span>
            </div>
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
