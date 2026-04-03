import type { ReactNode } from "react";
import type { SyncProviderSectionSurface as ProviderSurface } from "@freed/ui/context";

export function SyncProviderSectionSurface({
  surface = "settings",
  title,
  children,
}: {
  surface?: ProviderSurface;
  title?: string;
  children: ReactNode;
}) {
  if (surface === "debug-card") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="space-y-4">
          {title ? (
            <p className="text-sm font-medium text-white">{title}</p>
          ) : null}
          {children}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
