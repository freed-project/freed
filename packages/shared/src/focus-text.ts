/**
 * Focus Mode — bionic reading enhancement
 *
 * Bolds the beginning of each word to create visual fixation points,
 * allowing faster reading by guiding eye movement through text.
 */

export type FocusIntensity = "light" | "normal" | "strong";

export interface FocusOptions {
  enabled: boolean;
  intensity: FocusIntensity;
}

export interface TextSegment {
  text: string;
  emphasis: boolean;
}

/**
 * Number of characters to bold based on word length and intensity.
 */
function getEmphasisCount(wordLength: number, intensity: FocusIntensity): number {
  const ratios: Record<FocusIntensity, number> = {
    light: 0.25,
    normal: 0.4,
    strong: 0.6,
  };
  return Math.max(1, Math.ceil(wordLength * ratios[intensity]));
}

/**
 * Split text into segments with emphasis markers for focus mode rendering.
 * Non-alpha words (numbers, punctuation) are returned as-is without emphasis.
 */
export function applyFocusMode(
  text: string,
  options: FocusOptions,
): TextSegment[] {
  if (!options.enabled) {
    return [{ text, emphasis: false }];
  }

  const segments: TextSegment[] = [];
  // Split on whitespace, preserving the whitespace tokens
  const tokens = text.split(/(\s+)/);

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      // Whitespace — pass through
      segments.push({ text: token, emphasis: false });
    } else if (/^[a-zA-ZÀ-ÿ]+$/.test(token)) {
      // Pure alphabetic word — apply emphasis to beginning
      const count = getEmphasisCount(token.length, options.intensity);
      segments.push({ text: token.slice(0, count), emphasis: true });
      if (token.length > count) {
        segments.push({ text: token.slice(count), emphasis: false });
      }
    } else {
      // Mixed/punctuation/numbers — no emphasis
      segments.push({ text: token, emphasis: false });
    }
  }

  return segments;
}

export const DEFAULT_FOCUS_OPTIONS: FocusOptions = {
  enabled: false,
  intensity: "normal",
};
