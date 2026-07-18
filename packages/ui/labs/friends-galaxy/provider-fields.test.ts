import { describe, expect, it } from "vitest";
import { providerGalaxyArmCount } from "../../src/lib/identity-galaxy-provider-field.js";
import { createGalaxyLabProviderFields } from "./provider-fields.js";
import {
  createGalaxyLabFixture,
  GALAXY_LAB_PROVIDERS,
  GALAXY_LAB_THEMES,
} from "./scene-fixture.js";

describe("Friends Galaxy provider fields", () => {
  const fixture = createGalaxyLabFixture({
    personCount: 5_000,
    accountCount: 25_000,
    backgroundStarCount: 0,
  });

  it("packs one core field and one field per provider into a stable batch", () => {
    const first = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.scriptorium, "nebula");
    const second = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.scriptorium, "nebula");

    expect(first.count).toBe(6);
    expect(first.instanceData).toHaveLength(72);
    expect(first.instanceData).toEqual(second.instanceData);
    expect(first.instanceData[11]).toBe(0);
  });

  it("encodes every development variation without changing field geometry", () => {
    const nebula = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.neon, "nebula");
    const streams = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.neon, "rings");
    const blend = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.neon, "nebula-rings");

    for (let offset = 0; offset < nebula.instanceData.length; offset += 12) {
      expect(nebula.instanceData[offset + 11]).toBe(0);
      expect(streams.instanceData[offset + 11]).toBe(1);
      expect(blend.instanceData[offset + 11]).toBe(2);
      expect(nebula.instanceData.slice(offset, offset + 11)).toEqual(
        streams.instanceData.slice(offset, offset + 11),
      );
    }
  });

  it("uses the same stable arm count as each provider constellation", () => {
    const fields = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.neon, "nebula");
    const encodedCounts = GALAXY_LAB_PROVIDERS.map((provider, index) => {
      const encoded = fields.instanceData[(index + 1) * 12 + 10];
      expect(encoded).toBe(providerGalaxyArmCount(provider));
      return encoded;
    });

    expect(new Set(encodedCounts).size).toBeGreaterThan(1);
  });

  it("uses stronger field opacity for dark themes while preserving provider color roles", () => {
    const light = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.scriptorium, "nebula");
    const dark = createGalaxyLabProviderFields(fixture, GALAXY_LAB_THEMES.neon, "nebula");

    expect(dark.instanceData[20]).toBeGreaterThan(light.instanceData[20]!);
    expect(light.instanceData.slice(17, 20)).not.toEqual(light.instanceData.slice(29, 32));
  });
});
