import {
  galaxyLabNodePresentation,
  type GalaxyLabPalette,
} from "./scene-fixture.js";
import type { GalaxyLabViewDetail } from "./backend.js";
import type { FriendsGalaxyRendererScene } from "../../src/lib/friends-galaxy-renderer.js";
import {
  galaxyLabSelectedPersonNodeId,
  selectGalaxyLabAvatars,
} from "./avatar-atlas.js";
import { findFriendsGalaxySceneNodeIndex } from "../../src/lib/friends-galaxy-scene-interaction-index.js";
import {
  createFriendsGalaxyLabelAtlas,
  placeFriendsGalaxyLabelsAroundAvatars,
  type FriendsGalaxyLabelAtlas,
  type FriendsGalaxyLabelSeed,
} from "../../src/lib/friends-galaxy-billboard-atlas.js";
import {
  projectFriendsGalaxyWorldPoint,
  type FriendsGalaxyViewportProjection,
} from "../../src/lib/friends-galaxy-projection.js";

function truncateLabel(value: string): string {
  const characters = Array.from(value.trim());
  return characters.length <= 28 ? value.trim() : `${characters.slice(0, 27).join("")}...`;
}

export function selectGalaxyLabLabels(
  fixture: FriendsGalaxyRendererScene,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  selectedNodeId: string | null = null,
  projection?: FriendsGalaxyViewportProjection,
): readonly FriendsGalaxyLabelSeed[] {
  const cap = detail === "overview"
    ? compact ? 8 : 13
    : detail === "middle"
      ? compact ? 20 : 36
      : compact ? 32 : 64;
  const selectedPersonId = galaxyLabSelectedPersonNodeId(fixture, selectedNodeId);
  const seedForAtlasLabel = (
    label: FriendsGalaxyRendererScene["atlas"]["labels"][number],
  ): FriendsGalaxyLabelSeed => {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      fixture.scene,
      fixture.interactionIndex,
      label.nodeId,
    );
    const provider = label.kind === "provider_cluster";
    const fontSize = provider ? compact ? 15 : 18 : compact ? 12 : 14;
    const pointSize = nodeIndex === null ? 8 : Math.max(3.5, fixture.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: label.id,
      nodeId: label.nodeId,
      text: truncateLabel(label.text),
      anchorX: nodeIndex === null ? label.x : fixture.scene.positions[nodeIndex * 3]!,
      anchorY: nodeIndex === null ? -label.y : fixture.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: nodeIndex === null ? -72 : fixture.scene.positions[nodeIndex * 3 + 2]! + 5,
      fontSize,
      gapY: detail === "close" && !provider
        ? Math.max(pointSize * 0.5, compact ? 21 : 25) + 2
        : pointSize * 0.5 + 2,
      priority: label.priority + (provider ? 100_000 : fixture.scene.prominence[nodeIndex ?? 0]! * 1_000) +
        (label.nodeId === selectedPersonId ? 1_000_000 : 0),
      provider,
    };
  };
  const seedForPersonNode = (nodeIndex: number): FriendsGalaxyLabelSeed => {
    const presentation = galaxyLabNodePresentation(fixture, nodeIndex);
    const nodeId = fixture.scene.nodeIds[nodeIndex]!;
    const pointSize = Math.max(3.5, fixture.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: `label:visible:${nodeId}`,
      nodeId,
      text: truncateLabel(presentation.label),
      anchorX: fixture.scene.positions[nodeIndex * 3]!,
      anchorY: fixture.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: fixture.scene.positions[nodeIndex * 3 + 2]! + 5,
      fontSize: compact ? 12 : 14,
      gapY: detail === "close"
        ? Math.max(pointSize * 0.5, compact ? 21 : 25) + 2
        : pointSize * 0.5 + 2,
      priority: presentation.priority + fixture.scene.prominence[nodeIndex]! * 1_000 +
        (nodeId === selectedPersonId ? 1_000_000 : 0),
      provider: false,
    };
  };
  const providerSeeds = fixture.atlas.labels
    .filter((label) => label.kind === "provider_cluster")
    .map(seedForAtlasLabel);
  const seeds: FriendsGalaxyLabelSeed[] = projection && detail !== "overview"
    ? [...providerSeeds]
    : fixture.atlas.labels.map(seedForAtlasLabel);

  if (projection && detail !== "overview") {
    const candidateCapacity = Math.max(1, (cap - providerSeeds.length) * 4);
    const ranked: Array<{ nodeIndex: number; rank: number }> = [];
    const screen = new Float32Array(2);
    for (let nodeIndex = 0; nodeIndex < fixture.scene.nodeIds.length; nodeIndex += 1) {
      if (!fixture.scene.personIds[nodeIndex]) continue;
      const offset = nodeIndex * 3;
      if (!projectFriendsGalaxyWorldPoint(
        screen,
        projection,
        fixture.scene.positions[offset]!,
        fixture.scene.positions[offset + 1]!,
        fixture.scene.positions[offset + 2]!,
        160,
      )) continue;
      const rank = fixture.scene.prominence[nodeIndex]! +
        (fixture.scene.nodeIds[nodeIndex] === selectedPersonId ? 10 : 0);
      const last = ranked[ranked.length - 1];
      if (
        ranked.length >= candidateCapacity && last &&
        (rank < last.rank || (rank === last.rank && nodeIndex > last.nodeIndex))
      ) continue;
      let insertionIndex = ranked.length;
      while (insertionIndex > 0) {
        const previous = ranked[insertionIndex - 1]!;
        if (previous.rank > rank || (previous.rank === rank && previous.nodeIndex < nodeIndex)) break;
        insertionIndex -= 1;
      }
      ranked.splice(insertionIndex, 0, { nodeIndex, rank });
      if (ranked.length > candidateCapacity) ranked.pop();
    }
    for (const candidate of ranked) seeds.push(seedForPersonNode(candidate.nodeIndex));
  }

  if (selectedPersonId && !seeds.some((label) => label.nodeId === selectedPersonId)) {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      fixture.scene,
      fixture.interactionIndex,
      selectedPersonId,
    );
    if (nodeIndex !== null) seeds.push(seedForPersonNode(nodeIndex));
  }
  const projectionScratch = new Float32Array(2);
  const labelIsVisible = (label: FriendsGalaxyLabelSeed): boolean => !projection ||
    projectFriendsGalaxyWorldPoint(
      projectionScratch,
      projection,
      label.anchorX,
      label.anchorY,
      label.anchorZ,
      160,
    );
  const providers = seeds.filter((label) => label.provider && labelIsVisible(label));
  const semantic = seeds
    .filter((label) => !label.provider && labelIsVisible(label))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const semanticCap = Math.max(0, cap - providers.length);
  const minimumDistance = (detail === "overview" ? 760 : detail === "middle" ? 280 : 90) *
    (compact ? 1.3 : 1);
  const minimumScreenDistance = (detail === "overview" ? 96 : detail === "middle" ? 92 : 82) *
    (compact ? 1.08 : 1);
  const selectedSemantic: FriendsGalaxyLabelSeed[] = [];
  const selectedScreenPositions = new Float32Array(semanticCap * 2);
  for (const candidate of semantic) {
    let separated = true;
    if (projection) {
      projectFriendsGalaxyWorldPoint(
        projectionScratch,
        projection,
        candidate.anchorX,
        candidate.anchorY,
        candidate.anchorZ,
        160,
      );
      for (let index = 0; index < selectedSemantic.length; index += 1) {
        if (Math.hypot(
          projectionScratch[0]! - selectedScreenPositions[index * 2]!,
          projectionScratch[1]! - selectedScreenPositions[index * 2 + 1]!,
        ) < minimumScreenDistance) {
          separated = false;
          break;
        }
      }
    } else {
      separated = selectedSemantic.every((selected) => Math.hypot(
        candidate.anchorX - selected.anchorX,
        candidate.anchorY - selected.anchorY,
      ) >= minimumDistance);
    }
    if (!separated) continue;
    if (projection) {
      selectedScreenPositions[selectedSemantic.length * 2] = projectionScratch[0]!;
      selectedScreenPositions[selectedSemantic.length * 2 + 1] = projectionScratch[1]!;
    }
    selectedSemantic.push(candidate);
    if (selectedSemantic.length >= semanticCap) break;
  }
  return [...providers, ...selectedSemantic];
}

export function createGalaxyLabLabelAtlas(
  fixture: FriendsGalaxyRendererScene,
  palette: GalaxyLabPalette,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  selectedNodeId: string | null = null,
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
  projection?: FriendsGalaxyViewportProjection,
): FriendsGalaxyLabelAtlas {
  const avatars = selectGalaxyLabAvatars(
    fixture,
    palette,
    selectedNodeId,
    compact,
    detail,
    projection,
  );
  const seeds = placeFriendsGalaxyLabelsAroundAvatars(
    selectGalaxyLabLabels(fixture, compact, detail, selectedNodeId, projection),
    avatars,
  );
  return createFriendsGalaxyLabelAtlas(seeds, palette, fontFamily);
}
