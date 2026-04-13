"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

const MODAL_PATH = "/get";

interface NewsletterContextType {
  isOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const NewsletterContext = createContext<NewsletterContextType | undefined>(
  undefined,
);

export function NewsletterProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const returnPathRef = useRef("/");
  const suppressAutoOpenRef = useRef(false);

  useEffect(() => {
    if (!pathname || pathname === MODAL_PATH) return;
    returnPathRef.current = pathname;
    suppressAutoOpenRef.current = false;
  }, [pathname]);

  // Auto-open when landing on /get
  useEffect(() => {
    if (
      pathname === MODAL_PATH &&
      !isOpen &&
      !suppressAutoOpenRef.current
    ) {
      setIsOpen(true);
    }
  }, [pathname, isOpen]);

  const openModal = useCallback(() => {
    suppressAutoOpenRef.current = false;
    setIsOpen(true);
    if (pathname !== MODAL_PATH) {
      returnPathRef.current = pathname || "/";
      window.history.pushState(null, "", MODAL_PATH);
    }
  }, [pathname]);

  const closeModal = useCallback(() => {
    suppressAutoOpenRef.current = true;
    setIsOpen(false);
    if (window.location.pathname === MODAL_PATH) {
      const fallbackPath =
        returnPathRef.current && returnPathRef.current !== MODAL_PATH
          ? returnPathRef.current
          : "/";
      router.replace(fallbackPath);
    }
  }, [router]);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const onGetPath = window.location.pathname === MODAL_PATH;
      setIsOpen(onGetPath);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <NewsletterContext.Provider value={{ isOpen, openModal, closeModal }}>
      {children}
    </NewsletterContext.Provider>
  );
}

export function useNewsletter() {
  const context = useContext(NewsletterContext);
  if (context === undefined) {
    throw new Error("useNewsletter must be used within a NewsletterProvider");
  }
  return context;
}
