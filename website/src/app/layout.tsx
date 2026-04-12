import type { Metadata, Viewport } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import {
  THEME_DEFINITIONS,
  getThemeCssVariables,
} from "@freed/shared/themes";
import { NewsletterProvider } from "@/context/NewsletterContext";
import { ThemeProvider } from "@/context/ThemeContext";
import SiteShell from "@/components/SiteShell";
import "../index.css";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const THEME_BOOTSTRAP_VARS = Object.fromEntries(
  THEME_DEFINITIONS.map((theme) => [theme.id, getThemeCssVariables(theme.id)]),
);

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0a0a0a",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://freed.wtf"),
  title: {
    default: "Freed - Take Back Your Feed",
    template: "%s | Freed",
  },
  description:
    "Take back your feed. Freed is open-source software that puts you in control of your social media experience. Local-first, private, and free forever.",
  keywords: [
    "social media",
    "RSS reader",
    "privacy",
    "local-first",
    "open source",
    "feed aggregator",
  ],
  authors: [{ name: "Freed Team" }],
  creator: "Freed Team",
  publisher: "Freed",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": "/feed.xml",
      "application/atom+xml": "/atom.xml",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://freed.wtf",
    siteName: "Freed",
    title: "Freed - Take Back Your Feed",
    description:
      "Take back your feed. Freed is open-source software that puts you in control of your social media experience.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Freed - Take Back Your Feed",
    description:
      "Take back your feed. Freed is open-source software that puts you in control of your social media experience.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${spaceGrotesk.variable}`}>
      <body className={manrope.className}>
        <Script id="freed-theme-bootstrap" strategy="beforeInteractive">{`
          (function() {
            try {
              var theme = localStorage.getItem("freed-theme") || "neon";
              var root = document.documentElement;
              var themeVars = ${JSON.stringify(THEME_BOOTSTRAP_VARS)};
              root.dataset.theme = theme;
              root.style.colorScheme = theme === "scriptorium" ? "light" : "dark";
              var vars = themeVars[theme] || themeVars.neon;
              Object.keys(vars).forEach(function(name) {
                root.style.setProperty(name, vars[name]);
              });
            } catch (error) {}
          })();
        `}</Script>
        <ThemeProvider>
          <NewsletterProvider>
            {/* Skip to main content link for accessibility */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:text-text-primary focus:rounded-lg focus:outline-none"
              style={{ background: "var(--theme-heading-accent)" }}
            >
              Skip to main content
            </a>

            <SiteShell>{children}</SiteShell>
          </NewsletterProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
