import { useState, useEffect, useRef, useMemo } from "react";

import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import {
  BASE_SECTION_METAS,
  UPDATES_SECTION_META,
  DANGER_SECTION_META,
  X_SECTION_META,
  FB_SECTION_META,
  IG_SECTION_META,
  LI_SECTION_META,
  type SectionMeta,
} from "../../lib/settings-sections.js";
import { SearchField } from "../SearchField.js";

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

export function SearchJumpField() {
  const {
    checkForUpdates,
    factoryReset,
    XSettingsContent,
    FacebookSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
  } = usePlatform();
  const openSettingsTo = useSettingsStore((s) => s.openTo);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const sections: SectionMeta[] = [
      ...BASE_SECTION_METAS,
      ...(XSettingsContent ? [X_SECTION_META] : []),
      ...(FacebookSettingsContent ? [FB_SECTION_META] : []),
      ...(InstagramSettingsContent ? [IG_SECTION_META] : []),
      ...(LinkedInSettingsContent ? [LI_SECTION_META] : []),
      ...(checkForUpdates ? [UPDATES_SECTION_META] : []),
      ...(factoryReset ? [DANGER_SECTION_META] : []),
    ];
    return buildSettingsActions(sections, openSettingsTo);
  }, [
    FacebookSettingsContent,
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

  const showPalette = isFocused && filteredActions.length > 0;

  function clearSearch() {
    setInputValue("");
    setSearchQuery("");
  }

  function handleActionSelect(action: CommandAction) {
    setIsFocused(false);
    setActiveIndex(-1);
    action.onSelect();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (showPalette) {
        setIsFocused(false);
        setActiveIndex(-1);
      } else {
        clearSearch();
        e.currentTarget.blur();
      }
      return;
    }

    if (!showPalette) return;

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
      />

      {showPalette && (
        <div
          role="listbox"
          aria-label="Quick actions"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] py-1 shadow-2xl shadow-black/50"
        >
          {!inputValue && (
            <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-soft)]">
              Quick actions
            </p>
          )}
          {filteredActions.map((action, i) => (
            <button
              key={action.id}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleActionSelect(action)}
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
        </div>
      )}
    </div>
  );
}
