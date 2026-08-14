"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      className={`relative inline-flex items-center text-sm transition-colors ${
        isCurrent
          ? "text-text-primary"
          : "text-text-secondary hover:text-text-primary"
      }`}
    >
      {isCurrent && (
        <span
          aria-hidden="true"
          className="absolute -left-4 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-current"
        />
      )}
      <span>{children}</span>
    </Link>
  );
}
