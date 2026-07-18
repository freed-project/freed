import { describe, expect, it } from "vitest";
import { providerGalaxyArmCount } from "../../src/lib/identity-galaxy-provider-field.js";
import {
  createFriendsGalaxyProviderFields,
  FRIENDS_GALAXY_PROVIDER_FIELD_CULL_SCALE,
  FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS,
  writeFriendsGalaxyProviderFieldPresentation,
  type FriendsGalaxyFieldStyle,
} from "../../src/lib/friends-galaxy-provider-fields.js";
import { friendsGalaxyHexToRgb } from "../../src/lib/friends-galaxy-palette.js";
import {
  createGalaxyLabFixture,
  GALAXY_LAB_PROVIDERS,
  GALAXY_LAB_THEMES,
  type GalaxyLabPalette,
} from "./scene-fixture.js";

describe("Friends Galaxy provider fields", () => {
  const fixture = createGalaxyLabFixture({
    personCount: 5_000,
    accountCount: 25_000,
    backgroundStarCount: 0,
  });

  function createFields(
    palette: GalaxyLabPalette,
    style: FriendsGalaxyFieldStyle,
  ) {
    const fields = createFriendsGalaxyProviderFields({
      positions: fixture.scene.positions,
      personCount: fixture.personCount,
      regions: fixture.atlas.regions,
    });
    writeFriendsGalaxyProviderFieldPresentation(fields, palette, style);
    return fields;
  }

  it("packs one core field and one field per provider into a stable batch", () => {
    const first = createFields(GALAXY_LAB_THEMES.scriptorium, "nebula");
    const second = createFields(GALAXY_LAB_THEMES.scriptorium, "nebula");

    expect(first.count).toBe(6);
    expect(first.instanceData).toHaveLength(
      6 * FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS,
    );
    expect(first.instanceData).toEqual(second.instanceData);
    expect(first.instanceData[11]).toBe(0);
  });

  it("encodes every development variation without changing field geometry", () => {
    const fields = createFriendsGalaxyProviderFields({
      positions: fixture.scene.positions,
      personCount: fixture.personCount,
      regions: fixture.atlas.regions,
    });
    const instanceData = fields.instanceData;
    writeFriendsGalaxyProviderFieldPresentation(
      fields,
      GALAXY_LAB_THEMES.neon,
      "nebula",
    );
    const geometry = Array.from(fields.instanceData).filter((_, index) => {
      const fieldOffset = index % FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS;
      return fieldOffset <= 4 || fieldOffset === 9 || fieldOffset === 10;
    });

    for (
      let offset = 0;
      offset < fields.instanceData.length;
      offset += FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS
    ) {
      expect(fields.instanceData[offset + 11]).toBe(0);
    }

    writeFriendsGalaxyProviderFieldPresentation(
      fields,
      GALAXY_LAB_THEMES.neon,
      "rings",
    );
    expect(fields.instanceData).toBe(instanceData);
    for (
      let offset = 0;
      offset < fields.instanceData.length;
      offset += FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS
    ) {
      expect(fields.instanceData[offset + 11]).toBe(1);
    }
    expect(Array.from(fields.instanceData).filter((_, index) => {
      const fieldOffset = index % FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS;
      return fieldOffset <= 4 || fieldOffset === 9 || fieldOffset === 10;
    })).toEqual(geometry);

    writeFriendsGalaxyProviderFieldPresentation(
      fields,
      GALAXY_LAB_THEMES.neon,
      "nebula-rings",
    );
    expect(fields.instanceData[11]).toBe(2);
  });

  it("uses the same stable arm count as each provider constellation", () => {
    const fields = createFields(GALAXY_LAB_THEMES.neon, "nebula");
    const encodedCounts = GALAXY_LAB_PROVIDERS.map((provider, index) => {
      const encoded = fields.instanceData[
        (index + 1) * FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS + 10
      ];
      expect(encoded).toBe(providerGalaxyArmCount(provider));
      return encoded;
    });

    expect(new Set(encodedCounts).size).toBeGreaterThan(1);
  });

  it("uses stronger field opacity for dark themes while preserving provider color roles", () => {
    const light = createFields(GALAXY_LAB_THEMES.scriptorium, "nebula");
    const dark = createFields(GALAXY_LAB_THEMES.neon, "nebula");

    expect(dark.instanceData[20]).toBeGreaterThan(light.instanceData[20]!);
    expect(light.instanceData.slice(17, 20)).not.toEqual(light.instanceData.slice(29, 32));
  });

  it("contains empty identity geometry without non-finite field values", () => {
    const fields = createFriendsGalaxyProviderFields({
      positions: new Float32Array(),
      personCount: 5_000,
      regions: [],
    });
    writeFriendsGalaxyProviderFieldPresentation(
      fields,
      GALAXY_LAB_THEMES.scriptorium,
      "nebula",
    );

    expect(fields.count).toBe(1);
    expect(Array.from(fields.instanceData).every(Number.isFinite)).toBe(true);
    expect(Array.from(fields.instanceData.slice(0, 5))).toEqual([0, 0, -310, 1, 1]);
  });

  it("uses the account role for provider keys outside the active palette", () => {
    const region = { ...fixture.atlas.regions[0]!, provider: "unknown-provider" };
    const fields = createFriendsGalaxyProviderFields({
      positions: fixture.scene.positions,
      personCount: fixture.personCount,
      regions: [region],
    });
    writeFriendsGalaxyProviderFieldPresentation(
      fields,
      GALAXY_LAB_THEMES.scriptorium,
      "nebula",
    );

    const expectedColor = friendsGalaxyHexToRgb(
      GALAXY_LAB_THEMES.scriptorium.account,
    );
    for (let channel = 0; channel < 3; channel += 1) {
      expect(fields.instanceData[17 + channel]).toBeCloseTo(expectedColor[channel]!, 6);
    }
  });

  it("rejects malformed presentation storage before writing", () => {
    expect(() => writeFriendsGalaxyProviderFieldPresentation(
      {
        instanceData: new Float32Array(
          FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS,
        ),
        providerKeys: ["x"],
        count: 1,
      },
      GALAXY_LAB_THEMES.neon,
      "nebula",
    )).toThrow("provider field storage is malformed");
  });

  it("culls fields only beyond useful close detail", () => {
    expect(FRIENDS_GALAXY_PROVIDER_FIELD_CULL_SCALE).toBe(1.5);
  });
});
