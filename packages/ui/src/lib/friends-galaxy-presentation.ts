import { galaxyNodeLabel, truncateGalaxyNodeLabel } from "./identity-graph-atlas.js";
import { IdentityGalaxyNodeKindCode } from "./identity-galaxy-scene.js";
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
  // Close views retain every visible identity, rather than swapping a ranked
  // handful of avatars whenever another identity enters the viewport.
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
      160,
    );
  };
  // Selection can arrive before the worker's next metadata atlas. As with
  // labels, defer the selected avatar until its presentation is admitted.
  const selectedAdmitted = presentationCandidateSource(scene, candidateSource) !== "atlas" ||
    scene.atlas.nodes.some(node => node.id === selectedPersonId);
  const selectedVisible = selectedIndex !== null && selectedAdmitted && visible(selectedIndex);
  const ranked: Array<{ nodeIndex: number; rank: number }> = [];
  const insertCandidate = (nodeIndex: number, rank: number): void => {
    ranked.push({ nodeIndex, rank });
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
      size: (compact ? 24 : 28) + Math.max(0, Math.min(4,
        (scene.scene.radii[nodeIndex]! - 48) / 8)) * 6 + (selected ? 6 : 0),
      priority: presentation.priority + scene.scene.prominence[nodeIndex]! * 1_000,
      selected,
      color: friendsGalaxySemanticColor(scene.scene, palette, nodeIndex),
    };
  };
  // The former tiny top-N roster used insertion sorting. With all visible
  // avatars admitted, sort once instead of shifting the array for every node.
  ranked.sort((left, right) => right.rank - left.rank || left.nodeIndex - right.nodeIndex);
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
  loadedImagesOnly = false,
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
  return createFriendsGalaxyAvatarAtlas(loadedImagesOnly ? avatars.filter((avatar) => images.has(avatar.nodeId)) : avatars, palette, images, fontFamily);
}

function truncateLabel(value: string): string {
  return truncateGalaxyNodeLabel(value, 44);
}

export function friendsGalaxyLabelCap(
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
): number {
  return detail === "overview"
    ? compact ? 8 : 13
    : detail === "middle"
      ? compact ? 20 : 36
      : Infinity;
}

export function friendsGalaxyLabelSourceKey(
  scene: FriendsGalaxyRendererScene,
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  selectedNodeId: string | null,
): string {
  return [
    compact ? "compact" : "wide",
    detail,
    selectedNodeId ?? "",
    ...scene.atlas.nodes.map((node) => [
      node.id,
      node.label,
      node.kind,
      node.priority.toFixed(2),
      node.initials ?? "",
    ].join(":")),
    ...scene.atlas.labels.map((label) => [
      label.id,
      label.nodeId,
      label.text,
      label.kind,
      label.x.toFixed(2),
      label.y.toFixed(2),
      label.priority.toFixed(2),
    ].join(":")),
  ].join("\u0000");
}

export function selectFriendsGalaxyVisibleLabelSeeds<
  Label extends FriendsGalaxyLabelSeed,
>(
  seeds: readonly Label[],
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  projection?: FriendsGalaxyViewportProjection,
): readonly Label[] {
  const cap = friendsGalaxyLabelCap(compact, detail);
  const projectionScratch = new Float32Array(2);
  const labelIsVisible = (label: Label): boolean => !projection ||
    projectFriendsGalaxyWorldPoint(
      projectionScratch,
      projection,
      label.anchorX,
      label.anchorY,
      label.anchorZ,
      160,
    );
  const hovered = seeds.find(label => label.priority >= 2_000_000 && labelIsVisible(label));
  const bounds = (label: Label) => {
    const point = new Float32Array([label.anchorX, label.anchorY]);
    if (projection) projectFriendsGalaxyWorldPoint(point, projection, label.anchorX, label.anchorY, label.anchorZ, 160);
    const width = "width" in label ? Number(label.width) : label.text.length * label.fontSize * 0.65 + 16;
    const height = "height" in label ? Number(label.height) : label.fontSize * 1.42 + 10;
    return { x: point[0]!, y: point[1]! - (label.centered ? 0 : label.gapY + height / 2), width, height };
  };
  const emphasized = seeds.filter(label => label.priority >= 1_000_000 && labelIsVisible(label));
  const protectedBounds = emphasized.map(bounds);
  const available = protectedBounds.length ? seeds.filter(label => {
    if (emphasized.includes(label)) return true;
    const box = bounds(label);
    return protectedBounds.every(protectedBox =>
      Math.abs(box.x - protectedBox.x) >= (box.width + protectedBox.width) / 2 + 40 ||
      Math.abs(box.y - protectedBox.y) >= (box.height + protectedBox.height) / 2 + 40);
  }) : seeds;
  const providers = available.filter((label) => label.provider && labelIsVisible(label));
  const semantic = available
    .filter((label) => !label.provider && labelIsVisible(label))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  // At close range a linked profile must not disappear behind its identity's
  // priority or spacing budget. Admission and projection already bound this set.
  if (detail === "close") return [...providers, ...semantic];
  const semanticCap = Math.max(hovered ? 1 : 0, cap - providers.length);
  if (semanticCap === 0) return providers;
  const minimumDistance = (detail === "overview" ? 760 : detail === "middle" ? 280 : 90) *
    (compact ? 1.3 : 1);
  const minimumScreenDistance = (detail === "overview" ? 96 : detail === "middle" ? 92 : 82) *
    (compact ? 1.08 : 1);
  const selectedSemantic: Label[] = [];
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

function buildFriendsGalaxyLabelSeeds(
  scene: FriendsGalaxyRendererScene,
  resolvePresentation: FriendsGalaxyNodePresentationResolver,
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  selectedNodeId: string | null = null,
  projection?: FriendsGalaxyViewportProjection,
  candidateSource?: FriendsGalaxyPresentationCandidateSource,
  selectVisible = true,
  hoveredNodeId: string | null = null,
): readonly FriendsGalaxyLabelSeed[] {
  const cap = friendsGalaxyLabelCap(compact, detail);
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
    const identity = label.kind === "friend_person" || label.kind === "connection_person";
    const fontSize = provider ? compact ? 15 : 18 : identity ? compact ? 16 : 18 : compact ? 14 : 15;
    const pointSize = nodeIndex === null
      ? 8
      : Math.max(3.5, scene.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: label.id,
      nodeId: label.nodeId,
      text: nodeIndex !== null && scene.scene.linkedPersonIds[nodeIndex]
        ? galaxyNodeLabel("", "account", scene.scene.providers[nodeIndex] ?? undefined).trim()
        : truncateLabel(label.text),
      anchorX: nodeIndex === null ? label.x : scene.scene.positions[nodeIndex * 3]!,
      anchorY: nodeIndex === null ? -label.y : scene.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: nodeIndex === null ? -100 : scene.scene.positions[nodeIndex * 3 + 2]!,
      fontSize,
      gapY: !provider && !identity ? 2 : detail === "close" && identity
        ? pointSize * 0.5 + 2
        : pointSize * 0.5 + 2,
      priority: label.priority +
        (provider ? 100_000 : scene.scene.prominence[nodeIndex ?? 0]! * 1_000) +
        (label.nodeId === selectedPersonId ? 1_000_000 : 0),
      provider,
      centered: label.centered,
    };
  };
  const seedForIdentityNode = (nodeIndex: number): FriendsGalaxyLabelSeed => {
    const presentation = resolvePresentation(scene, nodeIndex);
    const nodeId = scene.scene.nodeIds[nodeIndex]!;
    const pointSize = Math.max(3.5, scene.scene.pointSizes[nodeIndex]! * 0.34);
    const identity = scene.scene.kinds[nodeIndex] === IdentityGalaxyNodeKindCode.FriendPerson ||
      scene.scene.kinds[nodeIndex] === IdentityGalaxyNodeKindCode.ConnectionPerson;
    return {
      id: `label:visible:${nodeId}`,
      nodeId,
      text: truncateLabel(galaxyNodeLabel(
        scene.scene.linkedPersonIds[nodeIndex] ? "" : presentation.label,
        scene.scene.kinds[nodeIndex] === IdentityGalaxyNodeKindCode.FriendPerson
          ? "friend_person"
          : scene.scene.kinds[nodeIndex] === IdentityGalaxyNodeKindCode.ConnectionPerson
            ? "connection_person"
            : scene.scene.kinds[nodeIndex] === IdentityGalaxyNodeKindCode.Feed ? "feed" : "account",
        scene.scene.providers[nodeIndex] ?? undefined,
      )),
      anchorX: scene.scene.positions[nodeIndex * 3]!,
      anchorY: scene.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: scene.scene.positions[nodeIndex * 3 + 2]!,
      fontSize: identity ? compact ? 16 : 18 : compact ? 14 : 15,
      gapY: !identity ? 2 : detail === "close"
        ? pointSize * 0.5 + 2
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

  if (!projection && detail === "close") {
    const seeded = new Set(seeds.map((seed) => seed.nodeId));
    // Worker label LOD can lag the camera. Every admitted profile still has
    // metadata, so retain its label in the pool for projection to decide.
    for (const node of scene.atlas.nodes) {
      if (node.kind === "provider_cluster" || seeded.has(node.id)) continue;
      const nodeIndex = findFriendsGalaxySceneNodeIndex(scene.scene, scene.interactionIndex, node.id);
      if (nodeIndex === null) continue;
      seeds.push(seedForIdentityNode(nodeIndex));
      seeded.add(node.id);
    }
  }

  if (projection && detail !== "overview") {
    const candidateCapacity = Math.max(1, (cap - providerSeeds.length) * 4);
    const ranked: Array<{ nodeIndex: number; rank: number }> = [];
    const screen = new Float32Array(2);
    const considerNode = (nodeIndex: number): void => {
      if (!scene.scene.personIds[nodeIndex] && !scene.scene.accountIds[nodeIndex]) return;
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
      if (detail === "close") {
        ranked.push({ nodeIndex, rank });
        return;
      }
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
    for (const candidate of ranked) seeds.push(seedForIdentityNode(candidate.nodeIndex));
  }

  if (selectedPersonId && !seeds.some((label) => label.nodeId === selectedPersonId)) {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      scene.scene,
      scene.interactionIndex,
      selectedPersonId,
    );
    // Interaction can select a resident node before the worker admits its
    // metadata. Keep selection responsive and add its label on the next atlas.
    if (nodeIndex !== null && (presentationCandidateSource(scene, candidateSource) !== "atlas" ||
      scene.atlas.nodes.some(node => node.id === selectedPersonId))) {
      seeds.push(seedForIdentityNode(nodeIndex));
    }
  }
  if (hoveredNodeId) {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(scene.scene, scene.interactionIndex, hoveredNodeId);
    if (nodeIndex !== null && (scene.presentationCandidateSource !== "atlas" || scene.atlas.nodes.some(node => node.id === hoveredNodeId))) {
      const existing = seeds.findIndex(label => label.nodeId === hoveredNodeId);
      const hovered = { ...(existing >= 0 ? seeds[existing]! : seedForIdentityNode(nodeIndex)), priority: 2_000_000 };
      if (existing >= 0) seeds[existing] = hovered;
      else seeds.push(hovered);
    }
  }
  return selectVisible
    ? selectFriendsGalaxyVisibleLabelSeeds(seeds, compact, detail, projection)
    : seeds;
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
  return buildFriendsGalaxyLabelSeeds(
    scene,
    resolvePresentation,
    compact,
    detail,
    selectedNodeId,
    projection,
    candidateSource,
    true,
  );
}

export function createFriendsGalaxyRendererLabelPoolAtlas(
  scene: FriendsGalaxyRendererScene,
  palette: FriendsGalaxyRendererPalette,
  resolvePresentation: FriendsGalaxyNodePresentationResolver,
  compact: boolean,
  detail: FriendsGalaxyViewDetail,
  selectedNodeId: string | null = null,
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
  retainLabels?: (labels: readonly FriendsGalaxyLabelSeed[]) => readonly FriendsGalaxyLabelSeed[],
  hoveredNodeId: string | null = null,
): FriendsGalaxyLabelAtlas {
  const avatars = selectFriendsGalaxyAvatars(
    scene,
    palette,
    resolvePresentation,
    selectedNodeId,
    compact,
    detail,
    undefined,
    scene.presentationCandidateSource,
  );
  const seeds = placeFriendsGalaxyLabelsAroundAvatars(
    buildFriendsGalaxyLabelSeeds(
      scene,
      resolvePresentation,
      compact,
      detail,
      selectedNodeId,
      undefined,
      scene.presentationCandidateSource,
      false,
      hoveredNodeId,
    ),
    avatars,
    detail === "close",
  );
  const tinted = seeds.map(label => {
    const index = findFriendsGalaxySceneNodeIndex(scene.scene, scene.interactionIndex, label.nodeId);
    return index === null ? label : { ...label, color: friendsGalaxySemanticColor(scene.scene, palette, index) };
  });
  return createFriendsGalaxyLabelAtlas(retainLabels ? retainLabels(tinted) : tinted, palette, fontFamily);
}
