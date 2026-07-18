import { describe, expect, it } from "vitest";
import { GALAXY_LAB_THEMES } from "./scene-fixture.js";
import {
  GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT,
  GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET,
  writeGalaxyLabStarPaletteUniforms,
} from "./star-palette.js";
import { FriendsGalaxyStarColorRole } from "../../src/lib/friends-galaxy-star-instances.js";

describe("Friends Galaxy GPU star palette", () => {
  it("resolves every theme role into one bounded uniform block", () => {
    const target = new Float32Array(
      GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT,
    );
    const state = writeGalaxyLabStarPaletteUniforms(
      target,
      GALAXY_LAB_THEMES.scriptorium,
    );
    const friendOffset =
      GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + FriendsGalaxyStarColorRole.Friend * 4;
    const backgroundOffset =
      GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + FriendsGalaxyStarColorRole.Background * 4;
    const selectionOffset =
      GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + FriendsGalaxyStarColorRole.Selection * 4;

    expect(state.lightSurface).toBe(true);
    expect(target.slice(friendOffset, friendOffset + 3)).not.toEqual(
      target.slice(selectionOffset, selectionOffset + 3),
    );
    expect(target[backgroundOffset + 3]).toBeCloseTo(0.2);
    expect(target[selectionOffset + 3]).toBe(1);
  });

  it("changes only the bounded palette block when the theme changes", () => {
    const target = new Float32Array(
      GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT,
    );
    target.fill(7, 0, GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET);
    writeGalaxyLabStarPaletteUniforms(target, GALAXY_LAB_THEMES.neon);

    expect(Array.from(target.slice(0, GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET))).toEqual(
      new Array(GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET).fill(7),
    );
    const backgroundOffset =
      GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + FriendsGalaxyStarColorRole.Background * 4;
    expect(target[backgroundOffset + 3]).toBeCloseTo(0.5);
  });

  it("produces finite shader colors for every active laboratory theme", () => {
    for (const palette of Object.values(GALAXY_LAB_THEMES)) {
      const target = new Float32Array(
        GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT,
      );
      writeGalaxyLabStarPaletteUniforms(target, palette);
      expect(
        Array.from(target.slice(GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET)).every(Number.isFinite),
      ).toBe(true);
    }
  });

  it("rejects undersized uniform storage", () => {
    expect(() => writeGalaxyLabStarPaletteUniforms(
      new Float32Array(GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET),
      GALAXY_LAB_THEMES.neon,
    )).toThrow("palette uniform storage is too small");
  });
});
