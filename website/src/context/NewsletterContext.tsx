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
  isSubscribed: boolean;
  openModal: (options?: {
    email?: string;
    detailsOpen?: boolean;
  }) => void;
  closeModal: () => void;
  markSubscribed: () => void;
  prefillEmail: string;
  prefillDetailsOpen: boolean;
}

const NewsletterContext = createContext<NewsletterContextType | undefined>(
  undefined,
);

export function NewsletterProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState("");
  const [prefillDetailsOpen, setPrefillDetailsOpen] = useState(false);
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

  const openModal = useCallback((options?: {
    email?: string;
    detailsOpen?: boolean;
  }) => {
    suppressAutoOpenRef.current = false;
    setPrefillEmail(options?.email?.trim().toLowerCase() ?? "");
    setPrefillDetailsOpen(options?.detailsOpen ?? false);
    setIsOpen(true);
    if (pathname !== MODAL_PATH) {
      returnPathRef.current = pathname || "/";
      window.history.pushState(null, "", MODAL_PATH);
    }
  }, [pathname]);

  const closeModal = useCallback(() => {
    suppressAutoOpenRef.current = true;
    setIsOpen(false);
    setPrefillEmail("");
    setPrefillDetailsOpen(false);
    if (window.location.pathname === MODAL_PATH) {
      const fallbackPath =
        returnPathRef.current && returnPathRef.current !== MODAL_PATH
          ? returnPathRef.current
          : "/";
      router.replace(fallbackPath);
    }
  }, [router]);

  const markSubscribed = useCallback(() => {
    setIsSubscribed(true);
  }, []);

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
    <NewsletterContext.Provider
      value={{
        isOpen,
        isSubscribed,
        openModal,
        closeModal,
        markSubscribed,
        prefillEmail,
        prefillDetailsOpen,
      }}
    >
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
