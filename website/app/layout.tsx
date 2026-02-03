import type { Metadata } from "next";
import { NewsletterProvider } from "@/context/NewsletterContext";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import NewsletterModal from "@/components/NewsletterModal";
import "@/index.css";

export const metadata: Metadata = {
  title: {
    default: "FREED - Take Back Your Feed",
    template: "%s | FREED",
  },
  description:
    "Take back your feed. FREED is open-source software that puts you in control of your social media experience. Local-first, private, and free forever.",
  keywords: [
    "social media",
    "RSS reader",
    "privacy",
    "local-first",
    "open source",
    "feed aggregator",
  ],
  authors: [{ name: "FREED Team" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://freed.wtf",
    siteName: "FREED",
    title: "FREED - Take Back Your Feed",
    description:
      "Take back your feed. FREED is open-source software that puts you in control of your social media experience.",
  },
  twitter: {
    card: "summary_large_image",
    title: "FREED - Take Back Your Feed",
    description:
      "Take back your feed. FREED is open-source software that puts you in control of your social media experience.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <NewsletterProvider>
          <div className="min-h-screen flex flex-col overflow-x-hidden">
            {/* Noise texture overlay */}
            <div className="noise-overlay" />

            {/* Background gradient orbs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-glow-purple/10 blur-[120px]" />
              <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-glow-blue/10 blur-[100px]" />
              <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] rounded-full bg-glow-cyan/5 blur-[80px]" />
            </div>

            <Navigation />

            <main className="flex-grow relative z-10">{children}</main>

            <Footer />
          </div>
          <NewsletterModal />
        </NewsletterProvider>
      </body>
    </html>
  );
}
