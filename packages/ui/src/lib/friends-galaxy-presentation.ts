import {
  createFriendsGalaxyAvatarAtlas,
  type FriendsGalaxyAvatarAtlas,
  type FriendsGalaxyAvatarSeed,
} from "./friends-galaxy-avatar-atlas.js";
import {
  createFriendsGalaxyLabelAtlas,
  placeFriendsGalaxyLabelsAroundAvatars,
  type FriendsGalaxyLabelAtlas,
  type FriendsGalaxyLabelSeed,
} from "./friends-galaxy-billboard-atlas.js";
import {
  friendsGalaxySemanticColor,
  type FriendsGalaxyRendererPalette,
} from "./friends-galaxy-palette.js";
import {
  projectFriendsGalaxyWorldPoint,
  type FriendsGalaxyViewportProjection,
} from "./friends-galaxy-projection.js";
import type {
  FriendsGalaxyPresentationCandidateSource,
  FriendsGalaxyRendererScene,
  FriendsGalaxyViewDetail,
} from "./friends-galaxy-renderer.js";
import { findFriendsGalaxySceneNodeIndex } from "./friends-galaxy-scene-interaction-index.js";

export interface FriendsGalaxyNodePresentation {
  label: string;
  initials: string;
  priority: number;
}

export type FriendsGalaxyNodePresentationResolver = (
  scene: FriendsGalaxyRendererScene,
  nodeIndex: number,
) => FriendsGalaxyNodePresentation;

export type FriendsGalaxyAvatarCandidateSource =
  FriendsGalaxyPresentationCandidateSource;

function presentationCandidateSource(
  scene: FriendsGalaxyRendererScene,
  requested?: FriendsGalaxyPresentationCandidateSource,
): FriendsGalaxyPresentationCandidateSource {
  return requested ?? scene.presentationCandidateSource ?? "scene";
}

export function friendsGalaxyAvatarAtlasRosterKey(
  atlas: FriendsGalaxyAvatarAtlas,
): string {
  return atlas.avatars.map((avatar) => avatar.nodeId).join("\u0000");
}

function friendsGalaxySelectedPersonNodeId(
  scene: FriendsGalaxyRendererScene,
  selectedNodeId: string | null,
): string | null {
  if (!selectedNodeId) return null;
  const selectedIndex = findFriendsGalaxySceneNodeIndex(
    scene.scene,
    scene.interactionIndex,
    selectedNodeId,
  );
  if (selectedIndex === null) return null;
  const personId = scene.scene.personIds[selectedIndex] ??
    scene.scene.linkedPersonIds[selectedIndex];
  return personId ? `person:${personId}` : null;
}

export function selectFriendsGalaxyAvatars(
  scene: FriendsGalaxyRendererScene,
  palette: FriendsGalaxyRendererPalette,
  resolvePresentation: FriendsGalaxyNodePresentationResolver,
  selectedNodeId: string | null,
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  projection?: FriendsGalaxyViewportProjection,
  candidateSource?: FriendsGalaxyAvatarCandidateSource,
): readonly FriendsGalaxyAvatarSeed[] {
  if (detail !== "close") return [];
  const selectedPersonId = friendsGalaxySelectedPersonNodeId(scene, selectedNodeId);
  const cap = compact ? 6 : 12;
  const selectedIndex = findFriendsGalaxySceneNodeIndex(
    scene.scene,
    scene.interactionIndex,
    selectedPersonId,
  );
  const screen = new Float32Array(2);
  const visible = (nodeIndex: number): boolean => {
    if (!projection) return true;
    const offset = nodeIndex * 3;
    return projectFriendsGalaxyWorldPoint(
      screen,
      projection,
      scene.scene.positions[offset]!,
      scene.scene.positions[offset + 1]!,
      scene.scene.positions[offset + 2]!,
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
      if (
        previous.rank > rank ||
        (previous.rank === rank && previous.nodeIndex < nodeIndex)
      ) break;
      insertionIndex -= 1;
    }
    ranked.splice(insertionIndex, 0, { nodeIndex, rank });
    if (ranked.length > candidateCap) ranked.pop();
  };

  const considerNode = (nodeIndex: number): void => {
    if (
      !scene.scene.personIds[nodeIndex] ||
      nodeIndex === selectedIndex ||
      !visible(nodeIndex)
    ) return;
    insertCandidate(nodeIndex, scene.scene.prominence[nodeIndex]!);
  };
  if (presentationCandidateSource(scene, candidateSource) === "atlas") {
    for (const node of scene.atlas.nodes) {
      const nodeIndex = findFriendsGalaxySceneNodeIndex(
        scene.scene,
        scene.interactionIndex,
        node.id,
      );
      if (nodeIndex !== null) considerNode(nodeIndex);
    }
  } else {
    for (let nodeIndex = 0; nodeIndex < scene.scene.nodeIds.length; nodeIndex += 1) {
      considerNode(nodeIndex);
    }
  }

  const createSeed = (nodeIndex: number, selected: boolean): FriendsGalaxyAvatarSeed => {
    const presentation = resolvePresentation(scene, nodeIndex);
    const offset = nodeIndex * 3;
    return {
      nodeId: scene.scene.nodeIds[nodeIndex]!,
      initials: presentation.initials,
      anchorX: scene.scene.positions[offset]!,
      anchorY: scene.scene.positions[offset + 1]!,
      anchorZ: scene.scene.positions[offset + 2]! + 7,
      size: selected ? compact ? 42 : 48 : compact ? 34 : 40,
      priority: presentation.priority + scene.scene.prominence[nodeIndex]! * 1_000,
      selected,
      color: friendsGalaxySemanticColor(scene.scene, palette, nodeIndex),
    };
  };
  const accepted = ranked.map(({ nodeIndex }) => createSeed(nodeIndex, false));
  if (selectedVisible && selectedIndex !== null) {
    accepted.push(createSeed(selectedIndex, true));
  }
  return accepted;
}

export function createFriendsGalaxyRendererAvatarAtlas(
  scene: FriendsGalaxyRendererScene,
  palette: FriendsGalaxyRendererPalette,
  resolvePresentation: FriendsGalaxyNodePresentationResolver,
  selectedNodeId: string | null,
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  images: ReadonlyMap<string, CanvasImageSource> = new Map(),
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
  projection?: FriendsGalaxyViewportProjection,
  candidateSource: FriendsGalaxyAvatarCandidateSource = "scene",
): FriendsGalaxyAvatarAtlas {
  const avatars = selectFriendsGalaxyAvatars(
    scene,
    palette,
    resolvePresentation,
    selectedNodeId,
    compact,
    detail,
    projection,
    candidateSource,
  );
  return createFriendsGalaxyAvatarAtlas(avatars, palette, images, fontFamily);
}

function truncateLabel(value: string): string {
  const characters = Array.from(value.trim());
  return characters.length <= 28
    ? value.trim()
    : `${characters.slice(0, 27).join("")}...`;
}

export function selectFriendsGalaxyLabels(
  scene: FriendsGalaxyRendererScene,
  resolvePresentation: FriendsGalaxyNodePresentationResolver,
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  selectedNodeId: string | null = null,
  projection?: FriendsGalaxyViewportProjection,
  candidateSource?: FriendsGalaxyPresentationCandidateSource,
): readonly FriendsGalaxyLabelSeed[] {
  const cap = detail === "overview"
    ? compact ? 8 : 13
    : detail === "middle"
      ? compact ? 20 : 36
      : compact ? 32 : 64;
  const selectedPersonId = friendsGalaxySelectedPersonNodeId(scene, selectedNodeId);
  const seedForAtlasLabel = (
    label: FriendsGalaxyRendererScene["atlas"]["labels"][number],
  ): FriendsGalaxyLabelSeed => {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      scene.scene,
      scene.interactionIndex,
      label.nodeId,
    );
    const provider = label.kind === "provider_cluster";
    const fontSize = provider ? compact ? 15 : 18 : compact ? 12 : 14;
    const pointSize = nodeIndex === null
      ? 8
      : Math.max(3.5, scene.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: label.id,
      nodeId: label.nodeId,
      text: truncateLabel(label.text),
      anchorX: nodeIndex === null ? label.x : scene.scene.positions[nodeIndex * 3]!,
      anchorY: nodeIndex === null ? -label.y : scene.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: nodeIndex === null ? -72 : scene.scene.positions[nodeIndex * 3 + 2]! + 5,
      fontSize,
      gapY: detail === "close" && !provider
        ? Math.max(pointSize * 0.5, compact ? 21 : 25) + 2
        : pointSize * 0.5 + 2,
      priority: label.priority +
        (provider ? 100_000 : scene.scene.prominence[nodeIndex ?? 0]! * 1_000) +
        (label.nodeId === selectedPersonId ? 1_000_000 : 0),
      provider,
    };
  };
  const seedForPersonNode = (nodeIndex: number): FriendsGalaxyLabelSeed => {
    const presentation = resolvePresentation(scene, nodeIndex);
    const nodeId = scene.scene.nodeIds[nodeIndex]!;
    const pointSize = Math.max(3.5, scene.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: `label:visible:${nodeId}`,
      nodeId,
      text: truncateLabel(presentation.label),
      anchorX: scene.scene.positions[nodeIndex * 3]!,
      anchorY: scene.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: scene.scene.positions[nodeIndex * 3 + 2]! + 5,
      fontSize: compact ? 12 : 14,
      gapY: detail === "close"
        ? Math.max(pointSize * 0.5, compact ? 21 : 25) + 2
        : pointSize * 0.5 + 2,
      priority: presentation.priority + scene.scene.prominence[nodeIndex]! * 1_000 +
        (nodeId === selectedPersonId ? 1_000_000 : 0),
      provider: false,
    };
  };
  const providerSeeds = scene.atlas.labels
    .filter((label) => label.kind === "provider_cluster")
    .map(seedForAtlasLabel);
  const seeds: FriendsGalaxyLabelSeed[] = projection && detail !== "overview"
    ? [...providerSeeds]
    : scene.atlas.labels.map(seedForAtlasLabel);

  if (projection && detail !== "overview") {
    const candidateCapacity = Math.max(1, (cap - providerSeeds.length) * 4);
    const ranked: Array<{ nodeIndex: number; rank: number }> = [];
    const screen = new Float32Array(2);
    const considerNode = (nodeIndex: number): void => {
      if (!scene.scene.personIds[nodeIndex]) return;
      const offset = nodeIndex * 3;
      if (!projectFriendsGalaxyWorldPoint(
        screen,
        projection,
        scene.scene.positions[offset]!,
        scene.scene.positions[offset + 1]!,
        scene.scene.positions[offset + 2]!,
        160,
      )) return;
      const rank = scene.scene.prominence[nodeIndex]! +
        (scene.scene.nodeIds[nodeIndex] === selectedPersonId ? 10 : 0);
      const last = ranked[ranked.length - 1];
      if (
        ranked.length >= candidateCapacity && last &&
        (rank < last.rank || (rank === last.rank && nodeIndex > last.nodeIndex))
      ) return;
      let insertionIndex = ranked.length;
      while (insertionIndex > 0) {
        const previous = ranked[insertionIndex - 1]!;
        if (
          previous.rank > rank ||
          (previous.rank === rank && previous.nodeIndex < nodeIndex)
        ) break;
        insertionIndex -= 1;
      }
      ranked.splice(insertionIndex, 0, { nodeIndex, rank });
      if (ranked.length > candidateCapacity) ranked.pop();
    };
    if (presentationCandidateSource(scene, candidateSource) === "atlas") {
      for (const node of scene.atlas.nodes) {
        const nodeIndex = findFriendsGalaxySceneNodeIndex(
          scene.scene,
          scene.interactionIndex,
          node.id,
        );
        if (nodeIndex !== null) considerNode(nodeIndex);
      }
    } else {
      for (let nodeIndex = 0; nodeIndex < scene.scene.nodeIds.length; nodeIndex += 1) {
        considerNode(nodeIndex);
      }
    }
    for (const candidate of ranked) seeds.push(seedForPersonNode(candidate.nodeIndex));
  }

  if (selectedPersonId && !seeds.some((label) => label.nodeId === selectedPersonId)) {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      scene.scene,
      scene.interactionIndex,
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

export function createFriendsGalaxyRendererLabelAtlas(
  scene: FriendsGalaxyRendererScene,
  palette: FriendsGalaxyRendererPalette,
  resolvePresentation: FriendsGalaxyNodePresentationResolver,
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  selectedNodeId: string | null = null,
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
  projection?: FriendsGalaxyViewportProjection,
): FriendsGalaxyLabelAtlas {
  const avatars = selectFriendsGalaxyAvatars(
    scene,
    palette,
    resolvePresentation,
    selectedNodeId,
    compact,
    detail,
    projection,
    scene.presentationCandidateSource,
  );
  const seeds = placeFriendsGalaxyLabelsAroundAvatars(
    selectFriendsGalaxyLabels(
      scene,
      resolvePresentation,
      compact,
      detail,
      selectedNodeId,
      projection,
      scene.presentationCandidateSource,
    ),
    avatars,
  );
  return createFriendsGalaxyLabelAtlas(seeds, palette, fontFamily);
}
