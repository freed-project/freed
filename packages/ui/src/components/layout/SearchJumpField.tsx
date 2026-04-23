import { createPortal } from "react-dom";
import { useState, useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { useAppStore } from "../../context/PlatformContext.js";
import { SearchField } from "../SearchField.js";
import { Tooltip } from "../Tooltip.js";

export function SearchJumpField({
  compactSidebar = false,
  narrowSidebar = false,
  variant = "inline",
}: {
  compactSidebar?: boolean;
  narrowSidebar?: boolean;
  variant?: "inline" | "trigger";
}) {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const [inputValue, setInputValue] = useState(searchQuery);
  const [isFocused, setIsFocused] = useState(false);
  const [isTriggerOpen, setIsTriggerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [palettePosition, setPalettePosition] = useState<CSSProperties>({
    left: 12,
    top: 12,
    visibility: "hidden",
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerPaletteRef = useRef<HTMLDivElement | null>(null);
  const hasActiveSearch = searchQuery.trim().length > 0;
  const inlinePlaceholder = narrowSidebar ? "Search" : "Search or run a command";
  const usesFloatingTrigger = variant === "trigger";
  const showFloatingField = usesFloatingTrigger && isTriggerOpen;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearchQuery(inputValue);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, setSearchQuery]);

  useEffect(() => {
    setInputValue((current) => {
      if (searchQuery === current) return current;
      if (searchQuery === "" || current === "") return searchQuery;
      return current;
    });
  }, [searchQuery]);

  useEffect(() => {
    if (!usesFloatingTrigger) {
      setIsTriggerOpen(false);
    }
  }, [usesFloatingTrigger]);

  useEffect(() => {
    if (!usesFloatingTrigger || !showFloatingField) {
      return undefined;
    }

    const updatePosition = () => {
      if (!triggerButtonRef.current || !triggerPaletteRef.current) return;

      const anchorRect = triggerButtonRef.current.getBoundingClientRect();
      const fieldRect = triggerPaletteRef.current.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 10;
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - viewportPadding - fieldRect.width,
      );
      const left = Math.min(anchorRect.right + gap, maxLeft);
      const maxTop = Math.max(
        viewportPadding,
        window.innerHeight - viewportPadding - fieldRect.height,
      );
      const top = Math.min(
        Math.max(viewportPadding, anchorRect.top),
        maxTop,
      );

      setPalettePosition({
        left,
        top,
        visibility: "visible",
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (
        triggerButtonRef.current?.contains(event.target as Node)
        || triggerPaletteRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setIsTriggerOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsTriggerOpen(false);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showFloatingField, usesFloatingTrigger]);

  function clearSearch() {
    setInputValue("");
    setSearchQuery("");
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;

    if (usesFloatingTrigger && showFloatingField) {
      setIsTriggerOpen(false);
      return;
    }

    if (inputValue) {
      clearSearch();
      return;
    }

    event.currentTarget.blur();
  }

  if (usesFloatingTrigger) {
    const triggerActive = showFloatingField || hasActiveSearch;

    return (
      <div className={compactSidebar ? "relative z-20 w-full" : "relative z-20 mb-3 flex justify-center"}>
        <Tooltip
          label="Search or run a command"
          side={compactSidebar ? "right" : undefined}
          className={compactSidebar ? "flex w-full" : undefined}
        >
          <button
            ref={triggerButtonRef}
            type="button"
            data-testid="compact-sidebar-search-trigger"
            onClick={() => setIsTriggerOpen((value) => !value)}
            className={compactSidebar
              ? `relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--card-radius)] border transition-colors ${
                  triggerActive
                    ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-text-primary)]"
                    : "border-transparent bg-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                }`
              : `relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--theme-border-subtle)] bg-transparent text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-border-quiet)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)] ${
                  showFloatingField ? "border-[var(--theme-border-strong)] bg-[var(--theme-bg-muted)] text-[var(--theme-text-primary)]" : ""
                }`}
            aria-label="Search or run a command"
            aria-expanded={showFloatingField}
            aria-pressed={triggerActive}
            aria-haspopup="dialog"
          >
            <svg
              className="h-[18px] w-[18px]"
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
          </button>
        </Tooltip>

        {mounted && showFloatingField
          ? createPortal(
              <div
                ref={triggerPaletteRef}
                data-testid="compact-sidebar-search-palette"
                className="theme-dialog-shell fixed z-[320] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--card-radius)] border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-2 shadow-2xl shadow-black/50"
                style={palettePosition}
              >
                <SearchField
                  autoFocus
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  onClear={clearSearch}
                  placeholder="Search or run a command"
                  aria-label="Search or run a command"
                />
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }

  return (
    <div className="relative z-20 mb-4">
      <SearchField
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setTimeout(() => setIsFocused(false), 150);
        }}
        onKeyDown={handleInputKeyDown}
        onClear={clearSearch}
        placeholder={inlinePlaceholder}
        aria-label="Search or run a command"
        inputClassName={
          compactSidebar
            ? "pl-7 pr-6"
            : narrowSidebar
              ? "pl-7 pr-4"
              : "pl-8 pr-5"
        }
        data-expanded={isFocused ? "true" : "false"}
      />
    </div>
  );
}
