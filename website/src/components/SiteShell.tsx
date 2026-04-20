"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { LocalPreviewBadge } from "@freed/ui/components/LocalPreviewBadge";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import NewsletterModal from "@/components/NewsletterModal";
import BackgroundGradients from "@/components/BackgroundGradients";

const LOCAL_PREVIEW_LABEL = process.env.NEXT_PUBLIC_FREED_PREVIEW_LABEL?.trim() || null;

export default function SiteShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isQrGallery = pathname === "/qr";

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
      <div className="theme-shell flex flex-col overflow-hidden relative">
        <BackgroundGradients />
        <LocalPreviewBadge label={LOCAL_PREVIEW_LABEL} />

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
