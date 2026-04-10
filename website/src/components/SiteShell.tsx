"use client";

import { usePathname } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import NewsletterModal from "@/components/NewsletterModal";
import BackgroundGradients from "@/components/BackgroundGradients";

export default function SiteShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isQrGallery = pathname === "/qr";

  return (
    <>
      <div className="theme-shell flex flex-col overflow-hidden relative">
        <BackgroundGradients />

        {!isQrGallery && <Navigation />}

        <main
          id="main-content"
          className={`relative z-10 flex-grow ${isQrGallery ? "min-h-screen" : ""}`}
        >
          {children}
        </main>

        {!isQrGallery && <Footer />}
      </div>

      {!isQrGallery && <NewsletterModal />}
    </>
  );
}
