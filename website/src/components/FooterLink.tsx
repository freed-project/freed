"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  NAV_INDICATOR_SPRING,
  NAV_INDICATOR_THICKNESS,
  NAV_INDICATOR_THICKNESS_TRANSITION,
} from "@/components/navigation-indicator";

function isCurrentPath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function FooterLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  const pathname = usePathname();
  const isCurrent = isCurrentPath(href, pathname);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      className={`relative inline-flex items-center text-sm transition-colors ${
        isCurrent
          ? "text-text-primary"
          : "text-text-secondary hover:text-text-primary"
      }`}
    >
      {isCurrent && (
        <motion.span
          aria-hidden="true"
          layoutId="footer-active-nav-indicator"
          className="pointer-events-none absolute right-[calc(100%+12px)] top-1/2 h-4 -translate-y-1/2 bg-text-primary"
          initial={false}
          animate={{
            width: isHovered
              ? NAV_INDICATOR_THICKNESS.hovered
              : NAV_INDICATOR_THICKNESS.resting,
          }}
          transition={{
            ...NAV_INDICATOR_SPRING,
            width: NAV_INDICATOR_THICKNESS_TRANSITION,
          }}
        />
      )}
      <span>{children}</span>
    </Link>
  );
}
