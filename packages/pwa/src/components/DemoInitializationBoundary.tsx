import type { ReactNode } from "react";

/** Do not mount routed Library consumers before the demo checkpoint is active. */
export function DemoInitializationBoundary({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  if (pending) {
    return (
      <div className="app-theme-shell flex h-screen items-center justify-center">
        <p role="status" className="text-sm text-[var(--theme-text-secondary)]">
          Preparing your demo…
        </p>
      </div>
    );
  }
  return children;
}
