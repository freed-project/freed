import * as THREE from "three/webgpu";
import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  instancedBufferAttribute,
  positionGeometry,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import { identityGalaxyCameraPose } from "../../src/lib/identity-galaxy-camera.js";
import type {
  FriendsGalaxyRendererBackend,
  FriendsGalaxyRendererMetrics,
  FriendsGalaxyRendererScene,
  FriendsGalaxyViewDetail,
} from "../../src/lib/friends-galaxy-renderer.js";
import { friendsGalaxyRenderPixelRatio } from "../../src/lib/friends-galaxy-renderer.js";
import {
  friendsGalaxyHexToRgb,
  friendsGalaxySemanticColor,
  type FriendsGalaxyRendererPalette,
} from "../../src/lib/friends-galaxy-palette.js";
import { FriendsGalaxyBackendHealth } from "../../src/lib/friends-galaxy-backend-health.js";
import type { FriendsGalaxyBillboardAtlas } from "../../src/lib/friends-galaxy-billboard-atlas.js";
import {
  createFriendsGalaxyRendererAvatarAtlas,
  createFriendsGalaxyRendererLabelAtlas,
  type FriendsGalaxyNodePresentationResolver,
} from "../../src/lib/friends-galaxy-presentation.js";
import type { FriendsGalaxyTransform } from "../../src/lib/friends-galaxy-viewport.js";
import {
  FriendsGalaxySceneIndex,
  type FriendsGalaxyInteraction,
  type FriendsGalaxyInteractionRole,
  type FriendsGalaxyInteractionState,
} from "../../src/lib/friends-galaxy-scene-index.js";

interface GalaxySpriteBatch {
  sprite: THREE.Sprite;
  material: THREE.PointsNodeMaterial;
  texture: THREE.CanvasTexture;
  colorAttribute: THREE.InstancedBufferAttribute;
  sizeAttribute: THREE.InstancedBufferAttribute;
}

interface GalaxyBillboardBatch {
  atlas: FriendsGalaxyBillboardAtlas;
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.NodeMaterial;
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  viewport: THREE.Vector2;
}

interface GalaxyAttributeUpdateRange {
  start: number;
  count: number;
}

function adapterLabel(adapter: GPUAdapter): string {
  const info = adapter.info;
  return [info.vendor, info.architecture, info.device, info.description]
    .filter((value): value is string => Boolean(value))
    .join(" ") || "WebGPU adapter";
}

function paletteLuminance(palette: FriendsGalaxyRendererPalette): number {
  const [red, green, blue] = friendsGalaxyHexToRgb(palette.background);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for the WebGPU star texture.");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  context.fillStyle = "#000000";
  context.fillRect(0, 0, 64, 64);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.16, "#ffffff");
  gradient.addColorStop(0.48, "#767676");
  gradient.addColorStop(1, "#000000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function makeSpriteBatch(
  positions: Float32Array,
  sizes: Float32Array,
  colors: Float32Array,
  opacity: number,
): GalaxySpriteBatch {
  const positionAttribute = new THREE.InstancedBufferAttribute(positions, 3);
  const sizeAttribute = new THREE.InstancedBufferAttribute(sizes, 1);
  const colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
  const texture = makeGlowTexture();
  const material = new THREE.PointsNodeMaterial({
    alphaMap: texture,
    alphaTest: 0.015,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    opacity,
    sizeAttenuation: false,
    blending: THREE.NormalBlending,
  });
  material.positionNode = instancedBufferAttribute(positionAttribute, "vec3");
  material.sizeNode = instancedBufferAttribute(sizeAttribute, "float");
  material.colorNode = instancedBufferAttribute(colorAttribute, "vec3");
  const sprite = new THREE.Sprite(material as unknown as THREE.SpriteMaterial);
  sprite.count = positions.length / 3;
  sprite.frustumCulled = false;
  return { sprite, material, texture, colorAttribute, sizeAttribute };
}

function makeBillboardBatch(
  atlas: FriendsGalaxyBillboardAtlas,
  renderOrder: number,
): GalaxyBillboardBatch {
  const itemCount = atlas.itemCount;
  const anchors = new Float32Array(itemCount * 3);
  const offsets = new Float32Array(itemCount * 2);
  const sizes = new Float32Array(itemCount * 2);
  const uvRects = new Float32Array(itemCount * 4);
  for (let index = 0; index < itemCount; index += 1) {
    const sourceOffset = index * 11;
    anchors.set(atlas.instanceData.subarray(sourceOffset, sourceOffset + 3), index * 3);
    offsets.set(atlas.instanceData.subarray(sourceOffset + 3, sourceOffset + 5), index * 2);
    sizes.set(atlas.instanceData.subarray(sourceOffset + 5, sourceOffset + 7), index * 2);
    uvRects.set(atlas.instanceData.subarray(sourceOffset + 7, sourceOffset + 11), index * 4);
  }
  const anchorAttribute = new THREE.InstancedBufferAttribute(anchors, 3);
  const offsetAttribute = new THREE.InstancedBufferAttribute(offsets, 2);
  const sizeAttribute = new THREE.InstancedBufferAttribute(sizes, 2);
  const uvRectAttribute = new THREE.InstancedBufferAttribute(uvRects, 4);
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(plane.getIndex());
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  plane.dispose();
  geometry.setAttribute("instanceAnchor", anchorAttribute);
  geometry.setAttribute("instanceOffset", offsetAttribute);
  geometry.setAttribute("instanceSize", sizeAttribute);
  geometry.setAttribute("instanceUvRect", uvRectAttribute);
  geometry.instanceCount = itemCount;
  const canvasTexture = new THREE.CanvasTexture(atlas.canvas);
  canvasTexture.flipY = false;
  canvasTexture.colorSpace = THREE.SRGBColorSpace;
  canvasTexture.generateMipmaps = false;
  canvasTexture.minFilter = THREE.LinearFilter;
  canvasTexture.magFilter = THREE.LinearFilter;
  canvasTexture.needsUpdate = true;
  const viewport = new THREE.Vector2(1, 1);
  const viewportNode = uniform(viewport);
  const anchorNode = vec3(instancedBufferAttribute<"vec3">(anchorAttribute, "vec3"));
  const offsetNode = vec2(instancedBufferAttribute<"vec2">(offsetAttribute, "vec2"));
  const sizeNode = vec2(instancedBufferAttribute<"vec2">(sizeAttribute, "vec2"));
  const uvRectNode = vec4(instancedBufferAttribute<"vec4">(uvRectAttribute, "vec4"));
  const centerClip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(anchorNode, 1)));
  const pixelPosition = offsetNode.add(positionGeometry.xy.mul(sizeNode));
  const clipOffset = pixelPosition.mul(2).div(viewportNode).mul(centerClip.w);
  const material = new THREE.NodeMaterial();
  material.vertexNode = centerClip.add(vec4(clipOffset, 0, 0));
  const topLeftUv = vec2(uv().x, uv().y.oneMinus());
  const atlasUv = uvRectNode.xy.add(topLeftUv.mul(uvRectNode.zw.sub(uvRectNode.xy)));
  const atlasSample = texture(canvasTexture, atlasUv);
  material.colorNode = atlasSample.rgb;
  material.opacityNode = atlasSample.a;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.alphaTest = 0.015;
  material.blending = THREE.NormalBlending;
  material.toneMapped = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return { atlas, geometry, material, mesh, texture: canvasTexture, viewport };
}

export class ThreeWebGpuBackend implements FriendsGalaxyRendererBackend {
  constructor(
    private readonly resolvePresentation: FriendsGalaxyNodePresentationResolver,
  ) {}

  readonly id = "three-webgpu" as const;
  private renderer: THREE.WebGPURenderer | null = null;
  private device: GPUDevice | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 20_000);
  private readonly viewProjection = new THREE.Matrix4();
  private readonly settledTransform: FriendsGalaxyTransform = { x: 0, y: 0, scale: 0.12 };
  private readonly settledProjection = {
    viewProjection: this.viewProjection.elements,
    width: 1,
    height: 1,
  };
  private settledProjectionValid = false;
  private fixture: FriendsGalaxyRendererScene | null = null;
  private sceneIndex: FriendsGalaxySceneIndex | null = null;
  private semanticBatch: GalaxySpriteBatch | null = null;
  private backgroundBatch: GalaxySpriteBatch | null = null;
  private labelBatch: GalaxyBillboardBatch | null = null;
  private avatarBatch: GalaxyBillboardBatch | null = null;
  private avatarImages: ReadonlyMap<string, CanvasImageSource> = new Map();
  private edgeGeometry: LineSegmentsGeometry | null = null;
  private edgeMaterial: THREE.Line2NodeMaterial | null = null;
  private edgeLines: LineSegments2 | null = null;
  private edgePositions = new Float32Array(0);
  private semanticColors: Float32Array | null = null;
  private baseSemanticColors: Float32Array | null = null;
  private semanticSizes: Float32Array | null = null;
  private baseSemanticSizes: Float32Array | null = null;
  private backgroundColors: Float32Array | null = null;
  private palette: FriendsGalaxyRendererPalette | null = null;
  private interaction: FriendsGalaxyInteraction = { selectedNodeId: null, hoveredNodeId: null };
  private readonly touchedInteractionIndices = new Set<number>();
  private readonly changedInteractionIndices = new Set<number>();
  private colorUpdateRangeScratch: GalaxyAttributeUpdateRange[] = [];
  private sizeUpdateRangeScratch: GalaxyAttributeUpdateRange[] = [];
  private interactionColor: readonly [number, number, number] = [1, 1, 1];
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private drawCalls = 0;
  private contextualEdgeCount = 0;
  private compactLabels: boolean | null = null;
  private viewDetail: FriendsGalaxyViewDetail = "overview";
  private bufferUploadCount = 0;
  private labelAtlasBuildCount = 0;
  private avatarAtlasBuildCount = 0;
  private adapterDescription: string | null = null;
  private fallbackReason: string | null = null;
  private readonly backendHealth = new FriendsGalaxyBackendHealth();
  private disposed = false;

  async initialize(
    canvas: HTMLCanvasElement,
    fixture: FriendsGalaxyRendererScene,
    palette: FriendsGalaxyRendererPalette,
  ): Promise<void> {
    this.disposed = false;
    this.backendHealth.clear();
    this.fallbackReason = null;
    if (!navigator.gpu) throw new Error("WebGPU is unavailable in this browser.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter was available.");
    const device = await adapter.requestDevice();
    this.device = device;
    void device.lost.then((info) => {
      if (this.disposed || this.device !== device) return;
      const detail = info.message.trim();
      const reason = `Three.js WebGPU device lost (${info.reason})${detail ? `: ${detail}` : "."}`;
      this.fallbackReason = reason;
      this.backendHealth.reportFatalError(reason);
    });
    this.adapterDescription = adapterLabel(adapter);
    this.fixture = fixture;
    this.sceneIndex = new FriendsGalaxySceneIndex(fixture.scene, fixture.interactionIndex);
    this.palette = palette;
    this.interactionColor = friendsGalaxyHexToRgb(palette.selection);
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      device,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(palette.background, 1);
    await this.renderer.init();

    this.baseSemanticSizes = new Float32Array(fixture.scene.pointSizes.length);
    for (let index = 0; index < this.baseSemanticSizes.length; index += 1) {
      this.baseSemanticSizes[index] = Math.max(4.5, fixture.scene.pointSizes[index]! * 0.42);
    }
    this.semanticSizes = new Float32Array(this.baseSemanticSizes);
    const backgroundSizes = new Float32Array(fixture.backgroundStarCount);
    for (let index = 0; index < backgroundSizes.length; index += 1) {
      backgroundSizes[index] = 0.42 + fixture.backgroundBrightness[index]! * 1.08;
    }
    this.baseSemanticColors = new Float32Array(fixture.scene.nodeIds.length * 3);
    this.semanticColors = new Float32Array(fixture.scene.nodeIds.length * 3);
    this.backgroundColors = new Float32Array(fixture.backgroundStarCount * 3);
    this.writePalette(palette);
    this.semanticBatch = makeSpriteBatch(
      fixture.scene.positions,
      this.semanticSizes,
      this.semanticColors,
      0.94,
    );
    this.backgroundBatch = makeSpriteBatch(
      fixture.backgroundPositions,
      backgroundSizes,
      this.backgroundColors,
      0.62,
    );
    this.edgeGeometry = new LineSegmentsGeometry();
    this.edgePositions = new Float32Array(
      Math.max(1, this.sceneIndex.contextualEdgeCapacity) * 6,
    );
    const updateRangeCapacity = Math.max(4, (this.sceneIndex.contextualEdgeCapacity + 2) * 2);
    this.colorUpdateRangeScratch = Array.from(
      { length: updateRangeCapacity },
      () => ({ start: 0, count: 3 }),
    );
    this.sizeUpdateRangeScratch = Array.from(
      { length: updateRangeCapacity },
      () => ({ start: 0, count: 1 }),
    );
    this.edgeGeometry.setPositions(this.edgePositions);
    this.edgeGeometry.instanceCount = 0;
    this.edgeMaterial = new THREE.Line2NodeMaterial({
      color: palette.selection,
      linewidth: 2.4,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      depthTest: false,
      worldUnits: false,
    });
    this.edgeLines = new LineSegments2(this.edgeGeometry, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    this.edgeLines.renderOrder = 5;
    this.edgeLines.visible = false;
    this.scene.add(this.backgroundBatch.sprite, this.semanticBatch.sprite, this.edgeLines);
    this.rebuildLabels(canvas.clientWidth < 720);
    this.rebuildAvatars(canvas.clientWidth < 720);
    this.applyMaterialOpacity(palette);
    this.bufferUploadCount += 3;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.renderer) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = friendsGalaxyRenderPixelRatio(pixelRatio, this.width, false);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.settledProjectionValid) this.updateViewProjection(this.settledTransform);
    this.labelBatch?.viewport.set(this.width, this.height);
    this.avatarBatch?.viewport.set(this.width, this.height);
    const compactLabels = this.width < 720;
    if (compactLabels !== this.compactLabels) {
      this.rebuildLabels(compactLabels);
      this.rebuildAvatars(compactLabels);
    }
  }

  setPalette(palette: FriendsGalaxyRendererPalette): void {
    if (!this.renderer || !this.fixture || !this.semanticColors || !this.backgroundColors) return;
    this.palette = palette;
    this.interactionColor = friendsGalaxyHexToRgb(palette.selection);
    this.renderer.setClearColor(palette.background, 1);
    this.edgeMaterial?.color.set(palette.selection);
    this.applyMaterialOpacity(palette);
    this.writePalette(palette);
    const state = this.sceneIndex?.interactionState(this.interaction) ?? null;
    if (state) {
      this.applyInteractionRoles(state.roles);
      this.touchedInteractionIndices.clear();
      for (const index of state.roles.keys()) this.touchedInteractionIndices.add(index);
      this.writeContextEdges(state.contextualEdgeIndices, state.contextualEdgeCount);
    }
    if (this.semanticBatch) {
      this.semanticBatch.colorAttribute.clearUpdateRanges();
      this.semanticBatch.sizeAttribute.clearUpdateRanges();
      this.semanticBatch.colorAttribute.needsUpdate = true;
      this.semanticBatch.sizeAttribute.needsUpdate = true;
    }
    if (this.backgroundBatch) this.backgroundBatch.colorAttribute.needsUpdate = true;
    this.bufferUploadCount += 3;
    this.rebuildLabels(this.compactLabels ?? this.width < 720);
    this.rebuildAvatars(this.compactLabels ?? this.width < 720);
  }

  setViewDetail(detail: FriendsGalaxyViewDetail): void {
    if (detail === this.viewDetail) return;
    this.viewDetail = detail;
    this.rebuildLabels(this.compactLabels ?? this.width < 720);
    this.rebuildAvatars(this.compactLabels ?? this.width < 720);
  }

  setSettledView(detail: FriendsGalaxyViewDetail, transform: FriendsGalaxyTransform): void {
    this.viewDetail = detail;
    this.settledTransform.x = transform.x;
    this.settledTransform.y = transform.y;
    this.settledTransform.scale = transform.scale;
    this.settledProjectionValid = true;
    this.updateViewProjection(this.settledTransform);
    this.rebuildLabels(this.compactLabels ?? this.width < 720);
    this.rebuildAvatars(this.compactLabels ?? this.width < 720);
  }

  setAvatarImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.avatarImages = images;
    if (this.viewDetail === "close") {
      this.rebuildAvatars(this.compactLabels ?? this.width < 720);
    }
  }

  pickNode(viewportX: number, viewportY: number): string | null {
    if (!this.sceneIndex) return null;
    return this.sceneIndex.pickNode(
      this.viewProjection.elements,
      this.width,
      this.height,
      viewportX,
      viewportY,
    );
  }

  setInteraction(interaction: FriendsGalaxyInteraction): void {
    this.interaction = interaction;
    if (!this.sceneIndex) return;
    this.writeInteraction(this.sceneIndex.interactionState(interaction));
  }

  render(transform: FriendsGalaxyTransform, _timeMs: number): void {
    if (!this.renderer) return;
    this.updateViewProjection(transform);
    this.renderer.render(this.scene, this.camera);
    this.drawCalls = this.renderer.info.render.drawCalls;
  }

  takeFatalError(): string | null {
    return this.backendHealth.takeFatalError();
  }

  simulateDeviceLoss(): void {
    this.device?.destroy();
  }

  metrics(): FriendsGalaxyRendererMetrics {
    return {
      id: this.id,
      label: "Three.js WebGPU",
      api: "Three.js WebGPU",
      semanticStarCount: this.fixture?.scene.nodeIds.length ?? 0,
      decorativeStarCount: this.fixture?.backgroundStarCount ?? 0,
      drawCalls: this.drawCalls,
      labelCount: this.labelBatch?.atlas.itemCount ?? 0,
      avatarCount: this.avatarBatch?.atlas.itemCount ?? 0,
      labelAtlasBuildCount: this.labelAtlasBuildCount,
      avatarAtlasBuildCount: this.avatarAtlasBuildCount,
      contextualEdgeCount: this.contextualEdgeCount,
      bufferUploadCount: this.bufferUploadCount,
      pickCandidateCount: this.sceneIndex?.lastPickCandidateCount,
      pickSourceNodeCount: this.sceneIndex?.pickSourceNodeCount,
      renderPixelRatio: this.pixelRatio,
      fallbackReason: this.fallbackReason,
      adapterDescription: this.adapterDescription,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.backendHealth.clear();
    if (this.semanticBatch) {
      this.scene.remove(this.semanticBatch.sprite);
      this.semanticBatch.material.dispose();
      this.semanticBatch.texture.dispose();
    }
    if (this.backgroundBatch) {
      this.scene.remove(this.backgroundBatch.sprite);
      this.backgroundBatch.material.dispose();
      this.backgroundBatch.texture.dispose();
    }
    if (this.labelBatch) {
      this.scene.remove(this.labelBatch.mesh);
      this.labelBatch.geometry.dispose();
      this.labelBatch.material.dispose();
      this.labelBatch.texture.dispose();
    }
    if (this.avatarBatch) {
      this.scene.remove(this.avatarBatch.mesh);
      this.avatarBatch.geometry.dispose();
      this.avatarBatch.material.dispose();
      this.avatarBatch.texture.dispose();
    }
    if (this.edgeLines) this.scene.remove(this.edgeLines);
    this.edgeGeometry?.dispose();
    this.edgeMaterial?.dispose();
    this.renderer?.dispose();
    this.device?.destroy();
    this.renderer = null;
    this.device = null;
    this.fixture = null;
    this.sceneIndex = null;
    this.semanticBatch = null;
    this.backgroundBatch = null;
    this.labelBatch = null;
    this.avatarBatch = null;
    this.avatarImages = new Map();
    this.edgeGeometry = null;
    this.edgeMaterial = null;
    this.edgeLines = null;
    this.edgePositions = new Float32Array(0);
    this.semanticColors = null;
    this.baseSemanticColors = null;
    this.semanticSizes = null;
    this.baseSemanticSizes = null;
    this.backgroundColors = null;
    this.palette = null;
    this.touchedInteractionIndices.clear();
    this.changedInteractionIndices.clear();
    this.colorUpdateRangeScratch = [];
    this.sizeUpdateRangeScratch = [];
    this.contextualEdgeCount = 0;
    this.labelAtlasBuildCount = 0;
    this.avatarAtlasBuildCount = 0;
    this.settledProjectionValid = false;
  }

  private rebuildLabels(compact: boolean): void {
    if (!this.fixture || !this.palette) return;
    this.compactLabels = compact;
    if (this.labelBatch) {
      this.scene.remove(this.labelBatch.mesh);
      this.labelBatch.geometry.dispose();
      this.labelBatch.material.dispose();
      this.labelBatch.texture.dispose();
    }
    const atlas = createFriendsGalaxyRendererLabelAtlas(
      this.fixture,
      this.palette,
      this.resolvePresentation,
      compact,
      this.viewDetail,
      this.interaction.selectedNodeId,
      undefined,
      this.settledProjectionValid ? this.settledProjection : undefined,
    );
    this.labelAtlasBuildCount += 1;
    this.labelBatch = makeBillboardBatch(atlas, 10);
    this.labelBatch.viewport.set(this.width, this.height);
    this.scene.add(this.labelBatch.mesh);
    this.bufferUploadCount += 2;
  }

  private rebuildAvatars(compact: boolean): void {
    if (!this.fixture || !this.palette) return;
    if (this.avatarBatch) {
      this.scene.remove(this.avatarBatch.mesh);
      this.avatarBatch.geometry.dispose();
      this.avatarBatch.material.dispose();
      this.avatarBatch.texture.dispose();
      this.avatarBatch = null;
    }
    const atlas = createFriendsGalaxyRendererAvatarAtlas(
      this.fixture,
      this.palette,
      this.resolvePresentation,
      this.interaction.selectedNodeId,
      compact,
      this.viewDetail,
      this.avatarImages,
      undefined,
      this.settledProjectionValid ? this.settledProjection : undefined,
    );
    this.avatarAtlasBuildCount += 1;
    if (atlas.itemCount === 0) return;
    this.avatarBatch = makeBillboardBatch(atlas, 8);
    this.avatarBatch.viewport.set(this.width, this.height);
    this.scene.add(this.avatarBatch.mesh);
    this.bufferUploadCount += 2;
  }

  private updateViewProjection(transform: FriendsGalaxyTransform): void {
    const pose = identityGalaxyCameraPose(transform, this.width, this.height, this.camera.fov);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    this.camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.settledProjection.width = this.width;
    this.settledProjection.height = this.height;
  }

  private writeInteraction(state: FriendsGalaxyInteractionState): void {
    if (
      !this.semanticBatch || !this.semanticColors || !this.baseSemanticColors ||
      !this.semanticSizes || !this.baseSemanticSizes
    ) return;
    this.changedInteractionIndices.clear();
    for (const index of this.touchedInteractionIndices) this.changedInteractionIndices.add(index);
    for (const index of state.roles.keys()) this.changedInteractionIndices.add(index);
    for (const index of this.changedInteractionIndices) {
      const colorOffset = index * 3;
      this.semanticColors[colorOffset] = this.baseSemanticColors[colorOffset]!;
      this.semanticColors[colorOffset + 1] = this.baseSemanticColors[colorOffset + 1]!;
      this.semanticColors[colorOffset + 2] = this.baseSemanticColors[colorOffset + 2]!;
      this.semanticSizes[index] = this.baseSemanticSizes[index]!;
    }
    this.applyInteractionRoles(state.roles);
    if (this.changedInteractionIndices.size > 0) {
      const colorUpdateRanges = this.semanticBatch.colorAttribute.updateRanges;
      const sizeUpdateRanges = this.semanticBatch.sizeAttribute.updateRanges;
      colorUpdateRanges.length = 0;
      sizeUpdateRanges.length = 0;
      let rangeIndex = 0;
      for (const index of this.changedInteractionIndices) {
        const colorRange = this.colorUpdateRangeScratch[rangeIndex]!;
        const sizeRange = this.sizeUpdateRangeScratch[rangeIndex]!;
        colorRange.start = index * 3;
        sizeRange.start = index;
        colorUpdateRanges.push(colorRange);
        sizeUpdateRanges.push(sizeRange);
        rangeIndex += 1;
      }
      this.semanticBatch.colorAttribute.needsUpdate = true;
      this.semanticBatch.sizeAttribute.needsUpdate = true;
      this.bufferUploadCount += 2;
    }
    this.touchedInteractionIndices.clear();
    for (const index of state.roles.keys()) this.touchedInteractionIndices.add(index);
    this.writeContextEdges(state.contextualEdgeIndices, state.contextualEdgeCount);
  }

  private applyInteractionRoles(roles: ReadonlyMap<number, FriendsGalaxyInteractionRole>): void {
    if (!this.semanticColors || !this.semanticSizes) return;
    const [selectionRed, selectionGreen, selectionBlue] = this.interactionColor;
    for (const [index, role] of roles) {
      const sizeScale = role === "selected" ? 1.58 : role === "hovered" ? 1.36 : 1.16;
      const colorMix = role === "linked" ? 0.62 : 1;
      const colorOffset = index * 3;
      this.semanticSizes[index] *= sizeScale;
      this.semanticColors[colorOffset] = this.semanticColors[colorOffset]! * (1 - colorMix) +
        selectionRed * colorMix;
      this.semanticColors[colorOffset + 1] = this.semanticColors[colorOffset + 1]! * (1 - colorMix) +
        selectionGreen * colorMix;
      this.semanticColors[colorOffset + 2] = this.semanticColors[colorOffset + 2]! * (1 - colorMix) +
        selectionBlue * colorMix;
    }
  }

  private writeContextEdges(edgeIndices: Uint32Array, activeEdgeCount: number): void {
    if (!this.fixture || !this.edgeGeometry || !this.edgeLines) return;
    const edgeCount = Math.min(activeEdgeCount, this.edgePositions.length / 6);
    this.contextualEdgeCount = edgeCount;
    if (edgeCount === 0) {
      this.edgeGeometry.instanceCount = 0;
      this.edgeLines.visible = false;
      return;
    }
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
      const sourceIndex = edgeIndices[edgeIndex * 2]!;
      const targetIndex = edgeIndices[edgeIndex * 2 + 1]!;
      const targetOffset = edgeIndex * 6;
      const sourceOffset = sourceIndex * 3;
      const linkedOffset = targetIndex * 3;
      this.edgePositions[targetOffset] = this.fixture.scene.positions[sourceOffset]!;
      this.edgePositions[targetOffset + 1] = this.fixture.scene.positions[sourceOffset + 1]!;
      this.edgePositions[targetOffset + 2] = this.fixture.scene.positions[sourceOffset + 2]!;
      this.edgePositions[targetOffset + 3] = this.fixture.scene.positions[linkedOffset]!;
      this.edgePositions[targetOffset + 4] = this.fixture.scene.positions[linkedOffset + 1]!;
      this.edgePositions[targetOffset + 5] = this.fixture.scene.positions[linkedOffset + 2]!;
    }
    const startAttribute = this.edgeGeometry.getAttribute("instanceStart");
    if (startAttribute instanceof THREE.InterleavedBufferAttribute) {
      startAttribute.data.needsUpdate = true;
    }
    this.edgeGeometry.instanceCount = edgeCount;
    this.edgeLines.visible = true;
    this.bufferUploadCount += 1;
  }

  private writePalette(palette: FriendsGalaxyRendererPalette): void {
    if (
      !this.fixture || !this.semanticColors || !this.baseSemanticColors || !this.backgroundColors
    ) return;
    for (let index = 0; index < this.fixture.scene.nodeIds.length; index += 1) {
      const [red, green, blue] = friendsGalaxyHexToRgb(
        friendsGalaxySemanticColor(this.fixture.scene, palette, index),
      );
      const brightness = this.fixture.scene.brightness[index]!;
      const offset = index * 3;
      this.baseSemanticColors[offset] = red * brightness;
      this.baseSemanticColors[offset + 1] = green * brightness;
      this.baseSemanticColors[offset + 2] = blue * brightness;
    }
    const [red, green, blue] = friendsGalaxyHexToRgb(palette.mutedText);
    for (let index = 0; index < this.fixture.backgroundStarCount; index += 1) {
      const brightness = this.fixture.backgroundBrightness[index]! * 0.72;
      const offset = index * 3;
      this.backgroundColors[offset] = red * brightness;
      this.backgroundColors[offset + 1] = green * brightness;
      this.backgroundColors[offset + 2] = blue * brightness;
    }
    this.semanticColors.set(this.baseSemanticColors);
    if (this.semanticSizes && this.baseSemanticSizes) {
      this.semanticSizes.set(this.baseSemanticSizes);
    }
  }

  private applyMaterialOpacity(palette: FriendsGalaxyRendererPalette): void {
    const lightSurface = paletteLuminance(palette) > 0.58;
    if (this.semanticBatch) this.semanticBatch.material.opacity = lightSurface ? 0.86 : 0.96;
    if (this.backgroundBatch) this.backgroundBatch.material.opacity = lightSurface ? 0.2 : 0.48;
  }
}
