/**
 * TauriTitleBar — desktop-only title bar with native window chrome
 *
 * Provides the macOS-style drag region and FREED branding that sits
 * above the main content area. Only rendered in the Tauri deployment.
 */

export function TauriTitleBar() {
  return (
    <div
      className="h-9 shrink-0 flex items-center border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0a]/80"
      data-tauri-drag-region
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="pl-[72px]">
        <span className="text-lg font-bold gradient-text">FREED</span>
      </div>
    </div>
  );
}
