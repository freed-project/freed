import { describe, expect, it } from "vitest";
import {
  SAVED_ITEM_NOTE_MARKER,
  getSavedItemNote,
  withSavedItemNote,
} from "./saved-item-note";

describe("saved item notes", () => {
  it("stores one whole-item note without disturbing text highlights", () => {
    const highlights = [{ text: "quoted text", note: "source note", createdAt: 10 }];
    const next = withSavedItemNote(highlights, "Remember this", 20);

    expect(next).toEqual([
      ...highlights,
      { text: SAVED_ITEM_NOTE_MARKER, note: "Remember this", createdAt: 20 },
    ]);
    expect(getSavedItemNote(next)).toBe("Remember this");
  });

  it("replaces and removes only the reserved note", () => {
    const original = withSavedItemNote(
      [{ text: "quoted text", createdAt: 10 }],
      "First",
      20,
    );
    const replaced = withSavedItemNote(original, "Second", 30);

    expect(getSavedItemNote(replaced)).toBe("Second");
    expect(replaced.filter((highlight) => highlight.text === SAVED_ITEM_NOTE_MARKER)).toHaveLength(1);
    expect(withSavedItemNote(replaced, "")).toEqual([
      { text: "quoted text", createdAt: 10 },
    ]);
  });
});
