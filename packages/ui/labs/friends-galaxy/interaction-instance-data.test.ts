import { describe, expect, it } from "vitest";
import { writeGalaxyLabInteractionInstances } from "./interaction-instance-data.js";
import { GALAXY_LAB_STAR_INSTANCE_FLOATS } from "./star-instance-data.js";

function semanticFixture(): Float32Array {
  return new Float32Array([
    10, 11, 12, 20, 0.8, 0, 0, 1,
    30, 31, 32, 10, 0.7, 1, 0, 1,
    50, 51, 52, 5, 0.6, 2, 0, 1,
  ]);
}

describe("Friends Galaxy interaction overlay instances", () => {
  it("packs selected and linked stars into one contiguous stream", () => {
    const target = new Float32Array(GALAXY_LAB_STAR_INSTANCE_FLOATS * 3);
    const count = writeGalaxyLabInteractionInstances(
      target,
      semanticFixture(),
      new Map([
        [0, "selected" as const],
        [2, "linked" as const],
      ]),
    );

    expect(count).toBe(2);
    expect(target.slice(0, 3)).toEqual(new Float32Array([10, 11, 12]));
    expect(target[3]).toBeCloseTo(31.6);
    expect(target[6]).toBe(1);
    expect(target.slice(8, 11)).toEqual(new Float32Array([50, 51, 52]));
    expect(target[11]).toBeCloseTo(5.8);
    expect(target[14]).toBeCloseTo(0.62);
    expect(target.slice(16)).toEqual(new Float32Array(8));
  });

  it("clears stale overlay slots while reusing the same target", () => {
    const target = new Float32Array(GALAXY_LAB_STAR_INSTANCE_FLOATS * 3);
    target.fill(99);

    const count = writeGalaxyLabInteractionInstances(
      target,
      semanticFixture(),
      new Map([[1, "hovered"]]),
    );

    expect(count).toBe(1);
    expect(target.slice(0, 3)).toEqual(new Float32Array([30, 31, 32]));
    expect(target[3]).toBeCloseTo(13.6);
    expect(target[6]).toBe(1);
    expect(target.slice(8)).toEqual(new Float32Array(16));
  });

  it("caps the packed overlay at its fixed capacity", () => {
    const target = new Float32Array(GALAXY_LAB_STAR_INSTANCE_FLOATS);
    const count = writeGalaxyLabInteractionInstances(
      target,
      semanticFixture(),
      new Map([
        [0, "selected" as const],
        [1, "hovered" as const],
      ]),
    );

    expect(count).toBe(1);
    expect(target.slice(0, 3)).toEqual(new Float32Array([10, 11, 12]));
  });

  it("rejects an interaction index outside the resident scene", () => {
    expect(() => {
      writeGalaxyLabInteractionInstances(
        new Float32Array(GALAXY_LAB_STAR_INSTANCE_FLOATS),
        semanticFixture(),
        new Map([[9, "selected"]]),
      );
    }).toThrow("interaction node 9 is outside the resident scene");
  });
});
