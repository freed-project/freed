"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface NewsletterContextType {
  isOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const NewsletterContext = createContext<NewsletterContextType | undefined>(
  undefined
);

export function NewsletterProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openModal = () => setIsOpen(true);
  const closeModal = () => setIsOpen(false);

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
