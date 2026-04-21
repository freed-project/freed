import { createPortal } from "react-dom";
import { useState, useEffect, useRef, useMemo, type CSSProperties } from "react";

import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import {
  BASE_SECTION_METAS,
  UPDATES_SECTION_META,
  DANGER_SECTION_META,
  GOOGLE_CONTACTS_SECTION_META,
  AI_SECTION_META,
  X_SECTION_META,
  FB_SECTION_META,
  IG_SECTION_META,
  LI_SECTION_META,
  type SectionMeta,
} from "../../lib/settings-sections.js";
import { SearchField } from "../SearchField.js";
import { Tooltip } from "../Tooltip.js";

interface CommandAction {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  onSelect: () => void;
}

function buildSettingsActions(
  sections: readonly SectionMeta[],
  openTo: (id: string) => void,
): CommandAction[] {
  return sections.map((s) => ({
    id: `settings-${s.id}`,
    label: s.label,
    hint: "Settings",
    keywords: s.keywords,
    onSelect: () => openTo(s.id),
  }));
}

function CommandActionList({
  actions,
  activeIndex,
  inputValue,
  onSelect,
}: {
  actions: CommandAction[];
  activeIndex: number;
  inputValue: string;
  onSelect: (action: CommandAction) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <>
      {!inputValue && (
        <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-soft)]">
          Quick actions
        </p>
      )}
      {actions.map((action, i) => (
        <button
          key={action.id}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(action)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
            i === activeIndex
              ? "bg-[var(--theme-bg-muted)] text-[var(--theme-text-primary)]"
              : "text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
          }`}
        >
          <svg
            className="h-3.5 w-3.5 shrink-0 text-[var(--theme-text-soft)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="flex-1 truncate">{action.label}</span>
          <span className="shrink-0 text-xs text-[var(--theme-text-soft)]">
            {action.hint}
          </span>
        </button>
      ))}
    </>
  );
}

export function SearchJumpField({
  compactSidebar = false,
  narrowSidebar = false,
  variant = "inline",
}: {
  compactSidebar?: boolean;
  narrowSidebar?: boolean;
  variant?: "inline" | "trigger";
}) {
  const {
    checkForUpdates,
    factoryReset,
    XSettingsContent,
    FacebookSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
    GoogleContactsSettingsContent,
  } = usePlatform();
  const openSettingsTo = useSettingsStore((s) => s.openTo);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isTriggerOpen, setIsTriggerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const [palettePosition, setPalettePosition] = useState<CSSProperties>({
    left: 12,
    top: 12,
    visibility: "hidden",
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerPaletteRef = useRef<HTMLDivElement | null>(null);

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

  const allCommandActions = useMemo((): CommandAction[] => {
    const sectionById = Object.fromEntries(BASE_SECTION_METAS.map((section) => [section.id, section])) as Record<
      "appearance" | "legal" | "support" | "feeds" | "saved" | "sync",
      SectionMeta
    >;
    const sections: SectionMeta[] = [
      sectionById.appearance,
      sectionById.sync,
      ...(GoogleContactsSettingsContent ? [GOOGLE_CONTACTS_SECTION_META] : []),
      sectionById.saved,
      ...(XSettingsContent ? [X_SECTION_META] : []),
      ...(FacebookSettingsContent ? [FB_SECTION_META] : []),
      ...(InstagramSettingsContent ? [IG_SECTION_META] : []),
      ...(LinkedInSettingsContent ? [LI_SECTION_META] : []),
      sectionById.feeds,
      AI_SECTION_META,
      ...(checkForUpdates ? [UPDATES_SECTION_META] : []),
      sectionById.legal,
      sectionById.support,
      ...(factoryReset ? [DANGER_SECTION_META] : []),
    ];
    return buildSettingsActions(sections, openSettingsTo);
  }, [
    FacebookSettingsContent,
    GoogleContactsSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
    XSettingsContent,
    checkForUpdates,
    factoryReset,
    openSettingsTo,
  ]);

  const filteredActions = useMemo(() => {
    const q = inputValue.toLowerCase().trim();
    if (!q) return allCommandActions;
    return allCommandActions
      .filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.keywords.some((k) => k.includes(q)),
      )
      .slice(0, 6);
  }, [allCommandActions, inputValue]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [inputValue]);

  const usesFloatingTrigger = variant === "trigger";
  const showPalette = usesFloatingTrigger
    ? isTriggerOpen
    : isFocused && filteredActions.length > 0;

  useEffect(() => {
    if (!usesFloatingTrigger) {
      setIsTriggerOpen(false);
    }
  }, [usesFloatingTrigger]);

  useEffect(() => {
    if (!usesFloatingTrigger || !showPalette) {
      return undefined;
    }

    const updatePosition = () => {
      if (!triggerButtonRef.current || !triggerPaletteRef.current) return;

      const anchorRect = triggerButtonRef.current.getBoundingClientRect();
      const paletteRect = triggerPaletteRef.current.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 10;
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - viewportPadding - paletteRect.width,
      );
      const left = Math.min(anchorRect.right + gap, maxLeft);
      const maxTop = Math.max(
        viewportPadding,
        window.innerHeight - viewportPadding - paletteRect.height,
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
      setActiveIndex(-1);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsTriggerOpen(false);
      setActiveIndex(-1);
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
  }, [showPalette, usesFloatingTrigger]);

  function clearSearch() {
    setInputValue("");
    setSearchQuery("");
  }

  function handleActionSelect(action: CommandAction) {
    setIsFocused(false);
    setIsTriggerOpen(false);
    setActiveIndex(-1);
    action.onSelect();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (showPalette) {
        setIsFocused(false);
        setIsTriggerOpen(false);
        setActiveIndex(-1);
      } else {
        clearSearch();
        e.currentTarget.blur();
      }
      return;
    }

    if (filteredActions.length === 0) return;
    if (!showPalette && !usesFloatingTrigger) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filteredActions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? filteredActions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const action = filteredActions[activeIndex];
      if (action) handleActionSelect(action);
    }
  }

  if (usesFloatingTrigger) {
    return (
      <div className="relative z-20 w-full">
        <Tooltip label="Search or run a command" side="right" className="flex w-full">
          <button
            ref={triggerButtonRef}
            type="button"
            data-testid="compact-sidebar-search-trigger"
            onClick={() => {
              setIsTriggerOpen((value) => !value);
              setActiveIndex(-1);
            }}
            className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--card-radius)] bg-transparent text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)] ${
              showPalette ? "bg-[var(--theme-bg-muted)] text-[var(--theme-text-primary)]" : ""
            }`}
            aria-label="Search or run a command"
            aria-expanded={showPalette}
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

        {mounted && showPalette
          ? createPortal(
              <div
                ref={triggerPaletteRef}
                data-testid="compact-sidebar-search-palette"
                className="theme-dialog-shell fixed z-[320] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-2 shadow-2xl shadow-black/50"
                style={palettePosition}
              >
                <SearchField
                  autoFocus
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onClear={clearSearch}
                  placeholder="Search or jump to..."
                  aria-label="Search or run a command"
                />
                {filteredActions.length > 0 ? (
                  <div
                    role="listbox"
                    aria-label="Quick actions"
                    className="mt-1.5 overflow-hidden rounded-xl py-1"
                  >
                    <CommandActionList
                      actions={filteredActions}
                      activeIndex={activeIndex}
                      inputValue={inputValue}
                      onSelect={handleActionSelect}
                    />
                  </div>
                ) : null}
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
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setTimeout(() => setIsFocused(false), 150);
        }}
        onKeyDown={handleKeyDown}
        onClear={clearSearch}
        placeholder="Search or jump to..."
        aria-label="Search or run a command"
        aria-expanded={showPalette}
        aria-haspopup="listbox"
        inputClassName={
          compactSidebar
            ? "pl-7 pr-6"
            : narrowSidebar
              ? "pl-7 pr-4"
              : "pl-8 pr-5"
        }
      />

      {showPalette && (
        <div
          role="listbox"
          aria-label="Quick actions"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] py-1 shadow-2xl shadow-black/50"
        >
          <CommandActionList
            actions={filteredActions}
            activeIndex={activeIndex}
            inputValue={inputValue}
            onSelect={handleActionSelect}
          />
        </div>
      )}
    </div>
  );
}
