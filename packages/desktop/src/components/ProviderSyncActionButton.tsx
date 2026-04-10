import type { MouseEventHandler, ReactNode } from "react";

export function ProviderSyncActionButton({
  busy,
  disabled,
  onClick,
  busyLabel = "Syncing",
  children,
  testId,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  busyLabel?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="flex flex-1 items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-[#8b5cf6]/15 text-[#8b5cf6] hover:bg-[#8b5cf6]/25 disabled:opacity-50 transition-colors"
    >
      {busy ? (
        <>
          <span
            data-testid={testId ? `${testId}-spinner` : undefined}
            className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
          />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
