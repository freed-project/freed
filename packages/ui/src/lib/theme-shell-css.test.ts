import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  THEME_DEFINITIONS,
  getThemeCssVariables,
  getThemeDefinition,
  type ThemeId,
} from "@freed/shared/themes";
import { FRIENDS_GALAXY_THEME_PALETTES } from "./friends-galaxy-theme-palettes";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, "../index.css");
const referenceDir = resolve(here, "../theme-reference");

function cssBlock(selector: string): string {
  const css = readFileSync(cssPath, "utf8");
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`Missing CSS block: ${selector}`);
  }
  return match[1];
}

describe("theme shell CSS", () => {
  it("does not keep the whole app shell permanently composited", () => {
    const idleBlock = cssBlock(".theme-shell,\n.app-theme-shell");

    expect(idleBlock).not.toContain("filter:");
    expect(idleBlock).not.toContain("will-change:");
    expect(idleBlock).not.toContain("transition:");
  });

  it("scopes shell filter compositing to active theme transitions", () => {
    const transitionBlock = cssBlock("html[data-theme-transition] .theme-shell,\nhtml[data-theme-transition] .app-theme-shell");

    expect(transitionBlock).toContain("filter:");
    expect(transitionBlock).toContain("opacity: var(--theme-transition-opacity)");
    expect(transitionBlock).toContain("will-change: filter, opacity");
  });
});

// ---------------------------------------------------------------------------------------------
// Vorton theme reference
//
// Vorton authors the six shared themes. Its generated reference is vendored in
// ../theme-reference by scripts/sync-vorton-theme-reference.mjs. These checks fail when a
// Freed palette value drifts from the reference, unless the difference is declared below.
// ---------------------------------------------------------------------------------------------

interface ReferenceTheme {
  roles: Record<string, string>;
  palette: Record<string, string>;
}
interface Reference {
  themes: Record<string, ReferenceTheme>;
}

const referenceText = readFileSync(resolve(referenceDir, "vorton-theme-reference.json"), "utf8");
const reference = JSON.parse(referenceText) as Reference;
const referenceSource = JSON.parse(
  readFileSync(resolve(referenceDir, "vorton-theme-reference.source.json"), "utf8"),
) as { commit: string; sha256: string };
const referenceRevision = referenceSource.commit.slice(0, 7);

/** Freed theme IDs keyed by Vorton's. */
const FREED_THEME_IDS: Record<string, ThemeId> = {
  "starship-light": "starship",
  "starship-dark": "dark-star",
  scriptorium: "scriptorium",
  midas: "midas",
  ember: "ember",
  neon: "neon",
};
/** Vorton authors these four palettes with Freed's own `--theme-*` names. */
const SHARED_PALETTES = ["neon", "midas", "ember", "scriptorium"] as const;
/** Freed adapts these two from Vorton's `--aub-*` roles. */
const ADAPTED_PALETTES = ["starship-light", "starship-dark"] as const;

/**
 * Status and destructive roles. Status text, badges and dots read `--theme-feedback-*-rgb`
 * through the `--theme-icon-*` tokens; destructive is a separate, stronger red.
 */
const STATUS_ROLE_TOKENS: Record<string, readonly string[]> = {
  success: ["--theme-success", "--theme-icon-success"],
  warning: ["--theme-icon-warning"],
  danger: ["--theme-icon-danger"],
  destructive: ["--theme-destructive"],
};

/** Reference role to the Freed tokens that must carry it in Starship and Dark Star. */
const ROLE_TOKENS: Record<string, readonly string[]> = {
  background: ["--theme-bg-root"],
  surfaceDeep: ["--theme-bg-deep"],
  surface: ["--theme-bg-surface"],
  surfaceRaised: ["--theme-bg-elevated"],
  text: ["--theme-text-primary"],
  textSecondary: ["--theme-text-secondary"],
  textMuted: ["--theme-text-muted"],
  border: ["--theme-border-subtle"],
  accent: [
    "--theme-accent-primary",
    "--theme-control-accent",
    "--theme-heading-accent-color",
    "--theme-button-primary-background",
  ],
  accentForeground: ["--theme-button-primary-text", "--theme-accent-foreground"],
  accentDecorative: ["--theme-accent-primary-tint", "--theme-accent-secondary-tint"],
  focusRing: ["--theme-focus-ring"],
  selection: ["--theme-selection"],
  ...STATUS_ROLE_TOKENS,
};

/**
 * Reference roles the four shared palettes must also carry in Freed's own tokens. Their
 * `--theme-*` palette check covers the status colors only as written in Vorton's stylesheet;
 * this pins what Freed's consumers read. Freed's raised surface is `--theme-bg-elevated`, and
 * flat accent fills carry `--theme-accent-foreground` (the primary button is a gradient there).
 */
const SHARED_ROLE_TOKENS: Record<string, readonly string[]> = {
  surfaceRaised: ["--theme-bg-elevated"],
  accentForeground: ["--theme-accent-foreground"],
  ...STATUS_ROLE_TOKENS,
};

/**
 * Every deliberate difference from the reference, keyed `theme:token` for the four shared
 * palettes and `theme:role:token` for Starship and Dark Star. `freed` pins Freed's value, so an
 * edit to a declared difference is reviewed too, and a difference that stops differing fails
 * until it is removed from this list.
 */
const DECLARED_DIFFERENCES: Record<string, { freed: string; reason: string }> = {
  "neon:--theme-header-background": {
    freed: "rgb(10 10 10 / 0.7)",
    reason: "D1: Freed keeps see-through glass headers; Vorton made its toolbars opaque.",
  },
  "midas:--theme-header-background": {
    freed: "rgb(55 45 36 / 0.98)",
    reason: "D1: Freed keeps see-through glass headers.",
  },
  "ember:--theme-header-background": {
    freed: "rgb(24 15 13 / 0.72)",
    reason: "D1: Freed keeps see-through glass headers.",
  },
  "scriptorium:--theme-header-background": {
    freed: "rgb(249 241 226 / 0.985)",
    reason: "D1: Freed keeps see-through glass headers.",
  },
  "neon:--theme-control-accent": {
    freed: "#8b5cf6",
    reason:
      "Freed's control accent carries the accent role, Neon's violet (owner decision 2026-11-14). Vorton's own --theme-control-accent still holds the text color; Vorton's interface reads --aub-accent and nothing reads its control accent.",
  },
  "starship-dark:accentDecorative:--theme-accent-secondary-tint": {
    freed: "#64d2ff",
    reason: "Dark Star's secondary accent is Freed's cyan; its tints follow it.",
  },
};

/**
 * Freed-only tokens with no Vorton role. Freed owns them; this list keeps an adapter rewrite
 * from dropping them. Map palettes and Friends Galaxy palettes are checked separately below.
 */
const FREED_OWNED_TOKENS = [
  "thumbnail-tint-rgb", "bg-card", "bg-card-hover", "bg-input", "bg-sidebar", "bg-muted",
  "border-strong", "border-quiet", "text-soft", "accent-secondary", "accent-tertiary",
  "accent-primary-rgb", "accent-secondary-rgb", "accent-tertiary-rgb", "shell-rgb",
  "atmosphere-base-opacity", "atmosphere-overlay-opacity", "card-texture", "shell-background",
  "button-primary-shadow", "button-primary-shadow-hover", "button-secondary-background",
  "button-secondary-hover", "gradient-text-start", "gradient-text-mid", "gradient-text-end",
  "heading-accent-fill", "heading-accent-text-fill", "heading-accent-clip", "metric-value",
  "logo-spectrum", "media-icon", "hero-media-icon", "status-complete-border", "status-complete-bg",
  "status-complete-text", "status-active-progress", "card-top-glint", "card-top-glint-hover",
  "attached-topbar-background", "header-border", "header-shadow", "header-background",
  "overlay-scrim", "code-background", "feedback-info-rgb", "feedback-success-rgb",
  "feedback-warning-rgb", "feedback-danger-rgb", "media-facebook", "media-instagram", "media-x",
  "media-rss", "media-youtube", "media-linkedin", "platform-surface-fill",
  "platform-surface-fill-active", "platform-ring-fill", "platform-ring-fill-active",
  "platform-ring-stroke", "platform-ring-stroke-active", "control-accent-rgb", "glow-sm",
  "glow-md", "glow-lg", "transition-duration",
] as const;

function declarations(body: string): Record<string, string> {
  const values: Record<string, string> = {};
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([\s\S]*?);/g)) {
    values[match[1]] = match[2];
  }
  return values;
}

/** The custom properties `html[data-theme=...]` ends up with, including the runtime ones. */
function freedTheme(vortonId: string): Record<string, string> {
  const freedId = FREED_THEME_IDS[vortonId];
  const values = declarations(cssBlock(':root,\nhtml[data-theme="neon"]'));
  if (freedId !== "neon") Object.assign(values, declarations(cssBlock(`html[data-theme="${freedId}"]`)));
  // Freed sets these from its theme recipes at runtime (lib/theme.ts).
  Object.assign(values, getThemeCssVariables(freedId));
  values["--theme-atmosphere-base-opacity"] ??= String(
    getThemeDefinition(freedId).background.baseOpacity,
  );
  return values;
}

function resolveVars(values: Record<string, string>, value: string): string {
  let current = value;
  for (let depth = 0; depth < 20; depth += 1) {
    const next = current.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (whole, name, fallback) =>
      name in values ? values[name] : (fallback?.trim() ?? whole),
    );
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Compares colors written as hex, `rgb(r g b / a)` or `rgba(r, g, b, a)`. */
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/#([0-9a-f]{6})\b/g, (_whole, hex: string) => {
      const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
      return `rgb(${r} ${g} ${b})`;
    })
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .replace(/rgba\(/g, "rgb(")
    .replace(/rgb\(([\d.\s,/]+)\)/g, (_whole, inner: string) => {
      const [r, g, b, a] = inner.split(/[\s,/]+/).filter(Boolean);
      return a === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${Number(a)})`;
    });
}

function freedValue(values: Record<string, string>, token: string): string | undefined {
  return token in values ? normalize(resolveVars(values, values[token])) : undefined;
}

describe("Vorton theme reference", () => {
  it("is the file the sync script recorded", () => {
    const sha256 = createHash("sha256").update(referenceText).digest("hex");
    expect(sha256, "The vendored reference was edited by hand. Rerun scripts/sync-vorton-theme-reference.mjs.").toBe(
      referenceSource.sha256,
    );
  });

  it("matches Freed's palettes except declared differences", () => {
    const drift: string[] = [];
    const used = new Set<string>();
    const check = (key: string, label: string, expected: string, actual: string | undefined) => {
      const declared = DECLARED_DIFFERENCES[key];
      if (declared) {
        used.add(key);
        if (actual !== normalize(declared.freed)) {
          drift.push(`${label} is ${actual ?? "missing"}, but its declared difference pins ${declared.freed}. Update DECLARED_DIFFERENCES.`);
        } else if (actual === normalize(expected)) {
          drift.push(`${label} now matches the reference. Remove its entry from DECLARED_DIFFERENCES.`);
        }
        return;
      }
      if (actual !== normalize(expected)) {
        drift.push(`${label} is ${actual ?? "missing"}, the reference has ${normalize(expected)}.`);
      }
    };

    for (const theme of SHARED_PALETTES) {
      const values = freedTheme(theme);
      const { palette, roles } = reference.themes[theme];
      for (const [token, expected] of Object.entries(palette)) {
        if (!token.startsWith("--theme-")) continue;
        check(`${theme}:${token}`, `${theme} ${token}`, expected, freedValue(values, token));
      }
      check(`${theme}:accent:--theme-control-accent`, `${theme} accent (--theme-control-accent)`, roles.accent, freedValue(values, "--theme-control-accent"));
      for (const [role, tokens] of Object.entries(SHARED_ROLE_TOKENS)) {
        for (const token of tokens) {
          check(`${theme}:${role}:${token}`, `${theme} ${role} (${token})`, roles[role], freedValue(values, token));
        }
      }
    }
    for (const theme of ADAPTED_PALETTES) {
      const values = freedTheme(theme);
      const { roles } = reference.themes[theme];
      for (const [role, tokens] of Object.entries(ROLE_TOKENS)) {
        for (const token of tokens) {
          check(`${theme}:${role}:${token}`, `${theme} ${role} (${token})`, roles[role], freedValue(values, token));
        }
      }
    }

    const unused = Object.keys(DECLARED_DIFFERENCES).filter((key) => !used.has(key));
    expect(unused, "Declared differences that no longer name a checked value").toEqual([]);
    expect(
      drift,
      `Freed theme drifted from Vorton ${referenceRevision}. Change the reference in Vorton and re-vendor it, or declare the difference with a reason.`,
    ).toEqual([]);
  });

  it("keeps Freed-owned tokens and palettes in every theme", () => {
    for (const theme of ADAPTED_PALETTES) {
      const block = declarations(cssBlock(`html[data-theme="${FREED_THEME_IDS[theme]}"]`));
      const missing = FREED_OWNED_TOKENS.filter((token) => !(`--theme-${token}` in block));
      expect(missing, `${theme} lost Freed-owned tokens`).toEqual([]);
    }
    for (const definition of THEME_DEFINITIONS) {
      expect(Object.keys(definition.map), `${definition.id} map palette`).toHaveLength(15);
      expect(FRIENDS_GALAXY_THEME_PALETTES[definition.id], `${definition.id} galaxy palette`).toBeDefined();
    }
  });
});
