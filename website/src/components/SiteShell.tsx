"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import NewsletterModal from "@/components/NewsletterModal";
import BackgroundGradients from "@/components/BackgroundGradients";

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isQrGallery = pathname === "/qr";
  const isNewsletterEmbed = pathname === "/newsletter/embed";
  const isStandaloneSurface = isQrGallery || isNewsletterEmbed;

  useEffect(() => {
    try {
      const currentPath = sessionStorage.getItem("freed-current-path");

      if (currentPath && currentPath !== pathname) {
        sessionStorage.setItem("freed-previous-path", currentPath);
      }

      sessionStorage.setItem("freed-current-path", pathname);
    } catch {}
  }, [pathname]);

  return (
    <>
      {!isStandaloneSurface && <Navigation />}

      <div className="theme-shell flex flex-col overflow-hidden relative">
        <BackgroundGradients />

        <main
          id="main-content"
          className={`relative z-10 flex-grow ${isStandaloneSurface ? "min-h-screen" : ""}`}
        >
          {children}
        </main>

        {!isStandaloneSurface && <Footer />}
      </div>

      {!isStandaloneSurface && <NewsletterModal />}
    </>
  );
}
