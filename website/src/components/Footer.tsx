import Link from "next/link";
import ThemeSelector from "@/components/ThemeSelector";

export default function Footer() {
  return (
    <footer
      aria-label="Site footer"
      className="relative z-10 border-t border-freed-border bg-freed-black px-8 pt-8 sm:px-8 sm:pt-12 lg:px-8 xl:px-12"
      style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Brand */}
          <div>
            <Link
              href="/"
              className="mb-4 hidden items-baseline gap-0.5 sm:inline-flex"
            >
              <span className="relative text-xl font-bold text-text-primary font-logo">
                FREED
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{
                    background: "var(--theme-logo-spectrum)",
                  }}
                />
              </span>
              <span className="text-sm font-bold gradient-text font-logo">
                .WTF
              </span>
            </Link>
            <div className="max-w-[18rem] sm:mt-6">
              <ThemeSelector compact />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 lg:contents">
            {/* Links */}
            <div>
              <h4 className="text-text-primary font-semibold mb-4">Product</h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="/"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Home
                  </Link>
                </li>
                <li>
                  <Link
                    href="/manifesto"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Manifesto
                  </Link>
                </li>
                <li>
                  <Link
                    href="/roadmap"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Roadmap
                  </Link>
                </li>
                <li>
                  <Link
                    href="/updates"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Updates
                  </Link>
                </li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="text-text-primary font-semibold mb-4">Resources</h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="/terms"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Terms of Use
                  </Link>
                </li>
                <li>
                  <Link
                    href="/privacy"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    href="/eula"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Desktop EULA
                  </Link>
                </li>
                <li>
                  <Link
                    href="/qr"
                    className="text-text-secondary text-sm hover:text-text-primary transition-colors"
                  >
                    Sharing QR
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-freed-border pt-8 text-center lg:flex-row lg:text-left">
          <p className="text-text-muted text-sm">
            &copy; 2025-{new Date().getFullYear()} Freed contributors. Open source under MIT
            License.
          </p>
          <p className="text-text-muted text-sm">
            Built for humans, not algorithms.
            <br />
            An{" "}
            <a
              href="https://AubreyFalconer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline hover:text-white transition-colors"
            >
              Aubrey Falconer
            </a>{" "}
            project.
          </p>
        </div>
      </div>
    </footer>
  );
}
