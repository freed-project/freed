import type { ReactNode } from "react";

interface MarketingPageShellProps {
  children: ReactNode;
  maxWidthClassName?: string;
  className?: string;
}

export function MarketingPageShell({
  children,
  maxWidthClassName = "max-w-3xl",
  className = "",
}: MarketingPageShellProps) {
  const sectionClassName = [
    "py-24",
    "sm:py-32",
    "px-8",
    "sm:px-6",
    "md:px-12",
    "lg:px-8",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const containerClassName = [maxWidthClassName, "mx-auto"]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={sectionClassName}>
      <div className={containerClassName}>{children}</div>
    </section>
  );
}
