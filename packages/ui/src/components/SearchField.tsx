import { forwardRef, type InputHTMLAttributes } from "react";

type SearchFieldDensity = "default" | "compact";

interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> {
  containerClassName?: string;
  inputClassName?: string;
  clearButtonAriaLabel?: string;
  density?: SearchFieldDensity;
  onClear?: () => void;
}

const DENSITY_CLASSES: Record<SearchFieldDensity, string> = {
  default: "rounded-lg py-2 pl-8 pr-7 text-sm",
  compact: "rounded-lg py-1.5 pl-8 pr-7 text-sm",
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    containerClassName,
    inputClassName,
    clearButtonAriaLabel = "Clear search",
    density = "default",
    onClear,
    type,
    value,
    ...inputProps
  },
  ref,
) {
  const hasValue =
    typeof value === "string" ? value.length > 0 : typeof value === "number";

  return (
    <div className={joinClasses("relative", containerClassName)}>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--theme-text-soft)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>

      <input
        {...inputProps}
        ref={ref}
        type={type ?? "text"}
        value={value}
        className={joinClasses(
          "w-full border border-[var(--theme-border-subtle)] bg-transparent text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-soft)] transition-colors hover:border-[var(--theme-border-quiet)] hover:bg-[var(--theme-bg-muted)] focus:border-[var(--theme-border-strong)] focus:bg-[var(--theme-bg-muted)] focus:outline-none",
          DENSITY_CLASSES[density],
          hasValue ? "pr-8" : "",
          inputClassName,
        )}
      />

      {hasValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearButtonAriaLabel}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[var(--theme-bg-muted)]"
        >
          <svg
            className="h-3 w-3 text-[var(--theme-text-soft)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
});
