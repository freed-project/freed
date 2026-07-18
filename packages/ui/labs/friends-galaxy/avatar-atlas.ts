import type { GalaxyLabViewDetail } from "./backend.js";
import {
  galaxyLabNodePresentation,
  galaxyLabSemanticColor,
  type GalaxyLabPalette,
} from "./scene-fixture.js";
import type { FriendsGalaxyRendererScene } from "../../src/lib/friends-galaxy-renderer.js";
import { findFriendsGalaxySceneNodeIndex } from "../../src/lib/friends-galaxy-scene-interaction-index.js";
import {
  createFriendsGalaxyAvatarAtlas,
  type FriendsGalaxyAvatarAtlas,
  type FriendsGalaxyAvatarSeed,
} from "../../src/lib/friends-galaxy-avatar-atlas.js";
import {
  projectFriendsGalaxyWorldPoint,
  type FriendsGalaxyViewportProjection,
} from "../../src/lib/friends-galaxy-projection.js";

export function galaxyLabSelectedPersonNodeId(
  fixture: FriendsGalaxyRendererScene,
  selectedNodeId: string | null,
): string | null {
  if (!selectedNodeId) return null;
  const selectedIndex = findFriendsGalaxySceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    selectedNodeId,
  );
  if (selectedIndex === null) return null;
  const personId = fixture.scene.personIds[selectedIndex] ?? fixture.scene.linkedPersonIds[selectedIndex];
  return personId ? `person:${personId}` : null;
}

export function selectGalaxyLabAvatars(
  fixture: FriendsGalaxyRendererScene,
  palette: GalaxyLabPalette,
  selectedNodeId: string | null,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  projection?: FriendsGalaxyViewportProjection,
): readonly FriendsGalaxyAvatarSeed[] {
  if (detail !== "close") return [];
  const selectedPersonId = galaxyLabSelectedPersonNodeId(fixture, selectedNodeId);
  const cap = compact ? 6 : 12;
  const selectedIndex = findFriendsGalaxySceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    selectedPersonId,
  );
  const screen = new Float32Array(2);
  const visible = (nodeIndex: number): boolean => {
    if (!projection) return true;
    const offset = nodeIndex * 3;
    return projectFriendsGalaxyWorldPoint(
      screen,
      projection,
      fixture.scene.positions[offset]!,
      fixture.scene.positions[offset + 1]!,
      fixture.scene.positions[offset + 2]!,
      64,
    );
  };
  const selectedVisible = selectedIndex !== null && visible(selectedIndex);
  const candidateCap = Math.max(0, cap - (selectedVisible ? 1 : 0));
  const ranked: Array<{ nodeIndex: number; rank: number }> = [];
  const insertCandidate = (nodeIndex: number, rank: number): void => {
    if (candidateCap === 0) return;
    const last = ranked[ranked.length - 1];
    if (
      ranked.length >= candidateCap && last &&
      (rank < last.rank || (rank === last.rank && nodeIndex > last.nodeIndex))
    ) return;
    let insertionIndex = ranked.length;
    while (insertionIndex > 0) {
      const previous = ranked[insertionIndex - 1]!;
      if (previous.rank > rank || (previous.rank === rank && previous.nodeIndex < nodeIndex)) break;
      insertionIndex -= 1;
    }
    ranked.splice(insertionIndex, 0, { nodeIndex, rank });
    if (ranked.length > candidateCap) ranked.pop();
  };

  for (let nodeIndex = 0; nodeIndex < fixture.scene.nodeIds.length; nodeIndex += 1) {
    if (!fixture.scene.personIds[nodeIndex] || nodeIndex === selectedIndex || !visible(nodeIndex)) continue;
    insertCandidate(nodeIndex, fixture.scene.prominence[nodeIndex]!);
  }

  const createSeed = (nodeIndex: number, selected: boolean): FriendsGalaxyAvatarSeed => {
    const presentation = galaxyLabNodePresentation(fixture, nodeIndex);
    const offset = nodeIndex * 3;
    return {
      nodeId: fixture.scene.nodeIds[nodeIndex]!,
      initials: presentation.initials,
      anchorX: fixture.scene.positions[offset]!,
      anchorY: fixture.scene.positions[offset + 1]!,
      anchorZ: fixture.scene.positions[offset + 2]! + 7,
      size: selected ? compact ? 42 : 48 : compact ? 34 : 40,
      priority: presentation.priority + fixture.scene.prominence[nodeIndex]! * 1_000,
      selected,
      color: galaxyLabSemanticColor(fixture, palette, nodeIndex),
    };
  };
  const accepted = ranked.map(({ nodeIndex }) => createSeed(nodeIndex, false));
  if (selectedVisible && selectedIndex !== null) accepted.push(createSeed(selectedIndex, true));
  return accepted;
}

export function createGalaxyLabAvatarAtlas(
  fixture: FriendsGalaxyRendererScene,
  palette: GalaxyLabPalette,
  selectedNodeId: string | null,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  images: ReadonlyMap<string, CanvasImageSource> = new Map(),
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
  projection?: FriendsGalaxyViewportProjection,
): FriendsGalaxyAvatarAtlas {
  const avatars = selectGalaxyLabAvatars(
    fixture,
    palette,
    selectedNodeId,
    compact,
    detail,
    projection,
  );
  return createFriendsGalaxyAvatarAtlas(avatars, palette, images, fontFamily);
}
