import { getProviderStatusToneClass, type ProviderStatusTone } from "../lib/provider-status.js";

export function ProviderStatusIndicator({
  tone,
  syncing,
  label,
  testId,
  size = "sm",
}: {
  tone: ProviderStatusTone;
  syncing?: boolean;
  label: string;
  testId?: string;
  size?: "xxs" | "xs" | "sm";
}) {
  const isCoolingDown = label === "Cooling down";
  const dotClass =
    size === "xxs"
      ? "h-[5px] w-[5px]"
      : size === "xs"
        ? "h-2 w-2"
        : "h-2.5 w-2.5";
  const spinnerClass =
    size === "xxs"
      ? "h-[5px] w-[5px] border-[1px] border-t-transparent"
      : size === "xs"
        ? "h-2 w-2 border border-t-transparent"
        : "h-2.5 w-2.5 border-[1.5px] border-t-transparent";
  const spinnerToneClass =
    tone === "critical"
      ? "border-red-400"
      : tone === "warning"
        ? "border-amber-400"
        : "border-emerald-400";
  const activeLabel = syncing && tone === "healthy" ? "Syncing" : label;
  const emojiClass =
    size === "xxs"
      ? "text-[10px]"
      : size === "xs"
        ? "text-[11px]"
        : "text-xs";

  if (isCoolingDown) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center ${emojiClass} text-amber-400`}
        data-testid={testId}
        aria-label={label}
        title={label}
      >
        😴
      </span>
    );
  }

  if (syncing) {
    return (
      <span
        className={`${dotClass} inline-flex shrink-0 items-center justify-center`}
        data-testid={testId}
        aria-label={activeLabel}
        title={activeLabel}
      >
        <span className={`${spinnerClass} ${spinnerToneClass} rounded-full animate-spin`} />
      </span>
    );
  }

  return (
    <span
      className={`${dotClass} inline-block shrink-0 rounded-full ${getProviderStatusToneClass(tone)}`}
      data-testid={testId}
      aria-label={label}
      title={label}
    />
  );
}
