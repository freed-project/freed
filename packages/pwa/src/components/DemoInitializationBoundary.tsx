import type { ReactNode } from "react";
import { LoadingState } from "@freed/ui/components/LoadingState";

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
        <LoadingState />
      </div>
    );
  }
  return children;
}
