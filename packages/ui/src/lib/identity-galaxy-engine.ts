/// <reference path="../types/troika-three-text.d.ts" />

import * as THREE from "three";
import { Text as TroikaText } from "troika-three-text";
import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasQuality,
} from "./identity-graph-atlas.js";
import {
  IdentityGalaxyColorRole,
  IdentityGalaxyNodeFlag,
  type IdentityGalaxyScene,
} from "./identity-galaxy-scene.js";
import type { ViewTransform } from "./identity-graph-layout.js";
import {
  IDENTITY_GALAXY_CAMERA_FOV,
  identityGalaxyCameraPose,
} from "./identity-galaxy-camera.js";

export type IdentityGalaxyVariation = "nebula-rings" | "nebula" | "rings";
export type IdentityGalaxyRendererType = "three-starfield" | "canvas-starfield-fallback";

interface GraphPalette {
  surface: string;
  text: string;
  mutedText: string;
  edge: string;
  friendFill: string;
  friendStroke: string;
  connectionFill: string;
  connectionStroke: string;
  accountFill: string;
  feedFill: string;
  providerFill: string;
  selection: string;
  highlight: string;
  labelFill: string;
  labelStroke: string;
  providerColors: Record<string, string>;
}

export interface IdentityGalaxyEngineSceneOptions {
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  variation: IdentityGalaxyVariation;
  quality: IdentityGraphAtlasQuality;
}

function cssRgbVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = style.getPropertyValue(name).trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/).map((part) => Number(part)).filter(Number.isFinite);
  if (parts.length < 3) return fallback;
  return `${parts[0]} ${parts[1]} ${parts[2]}`;
}

function rgb(rgbParts: string, alpha = 1): string {
  return `rgb(${rgbParts} / ${alpha})`;
}

function readGraphPalette(element: HTMLElement | null): GraphPalette {
  const style = element ? getComputedStyle(element) : getComputedStyle(document.documentElement);
  const primary = cssRgbVar(style, "--theme-accent-primary-rgb", "59 130 246");
  const secondary = cssRgbVar(style, "--theme-accent-secondary-rgb", "139 92 246");
  const tertiary = cssRgbVar(style, "--theme-accent-tertiary-rgb", "6 182 212");
  const shell = cssRgbVar(style, "--theme-shell-rgb", "6 7 13");
  return {
    surface: rgb(shell, 0.2),
    text: style.getPropertyValue("--theme-text-primary") || rgb("255 255 255", 0.9),
    mutedText: style.getPropertyValue("--theme-text-muted") || rgb("255 255 255", 0.62),
    edge: rgb(primary, 0.32),
    friendFill: rgb(primary, 0.42),
    friendStroke: rgb(primary, 0.82),
    connectionFill: rgb(secondary, 0.34),
    connectionStroke: rgb(secondary, 0.72),
    accountFill: rgb(tertiary, 0.46),
    feedFill: rgb("245 158 11", 0.42),
    providerFill: rgb(secondary, 0.24),
    selection: rgb(tertiary, 0.92),
    highlight: rgb(secondary, 0.9),
    labelFill: rgb(shell, 0.86),
    labelStroke: rgb(primary, 0.34),
    providerColors: {
      instagram: rgb("236 72 153", 0.78),
      facebook: rgb("59 130 246", 0.78),
      linkedin: rgb("14 165 233", 0.78),
      x: rgb("226 232 240", 0.78),
      rss: rgb("245 158 11", 0.8),
      substack: rgb("249 115 22", 0.78),
      medium: rgb("34 197 94", 0.72),
      other: rgb(tertiary, 0.72),
    },
  };
}

function providerColor(provider: string | undefined, palette: GraphPalette): string {
  return palette.providerColors[provider ?? "other"] ?? palette.providerColors.other;
}

function hashValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash);
}

function seededUnit(value: string): number {
  return (hashValue(value) % 10_000) / 10_000;
}

function colorFromCss(value: string, fallback = "#7dd3fc"): THREE.Color {
  const normalized = value.trim();
  if (/^#[\da-f]{3,8}$/i.test(normalized)) return new THREE.Color(normalized);
  const match = normalized.match(/rgb\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
  if (!match) return new THREE.Color(fallback);
  return new THREE.Color(Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255);
}

function graphNodeColor(
  role: IdentityGalaxyColorRole,
  provider: string | null,
  flags: number,
  palette: GraphPalette,
): THREE.Color {
  const selected = (flags & IdentityGalaxyNodeFlag.Selected) !== 0;
  const linkedToSelected = (flags & IdentityGalaxyNodeFlag.LinkedToSelection) !== 0;
  const hovered = (flags & IdentityGalaxyNodeFlag.Hovered) !== 0;
  if (selected) return colorFromCss(palette.selection, "#67e8f9");
  if (hovered || linkedToSelected) return colorFromCss(palette.highlight, "#f0abfc");
  if (role === IdentityGalaxyColorRole.Friend) return colorFromCss(palette.friendStroke, "#60a5fa");
  if (role === IdentityGalaxyColorRole.Connection) return colorFromCss(palette.connectionStroke, "#c084fc");
  if (role === IdentityGalaxyColorRole.Feed) return new THREE.Color("#f59e0b");
  return colorFromCss(providerColor(provider ?? undefined, palette), "#38bdf8");
}

function makePointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      pixelRatio: { value: Math.min(1.5, window.devicePixelRatio || 1) },
    },
    vertexShader: `
      attribute float pointSize;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float depthScale = clamp(940.0 / max(280.0, -mvPosition.z), 0.68, 2.35);
        gl_PointSize = pointSize * depthScale;
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = clamp(pointSize / 48.0, 0.36, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(center);
        float core = 1.0 - smoothstep(0.02, 0.34, distanceFromCenter);
        float halo = (1.0 - smoothstep(0.08, 0.5, distanceFromCenter)) * 0.52;
        float alpha = max(core, halo) * vAlpha;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    vertexColors: true,
  });
}

function makeGalaxyStarGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
    -0.5, 0.5, 0,
  ], 3));
  geometry.setAttribute("starUv", new THREE.Float32BufferAttribute([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = 0;
  return geometry;
}

function makeGalaxyStarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      resolution: { value: new THREE.Vector2(1, 1) },
      lightSurface: { value: 0 },
    },
    vertexShader: `
      uniform vec2 resolution;
      attribute vec2 starUv;
      attribute vec3 instancePosition;
      attribute vec3 instanceColor;
      attribute float instanceSize;
      attribute float instanceProminence;
      attribute float instanceHighlight;
      varying vec2 vStarUv;
      varying vec3 vStarColor;
      varying float vProminence;
      varying float vHighlight;

      void main() {
        vec4 viewCenter = modelViewMatrix * vec4(instancePosition, 1.0);
        vec4 clipCenter = projectionMatrix * viewCenter;
        float depthScale = clamp(1000.0 / max(280.0, -viewCenter.z), 0.72, 1.8);
        vec2 pixelOffset = position.xy * instanceSize * depthScale;
        clipCenter.xy += pixelOffset * (2.0 / resolution) * clipCenter.w;
        gl_Position = clipCenter;
        vStarUv = starUv;
        vStarColor = instanceColor;
        vProminence = instanceProminence;
        vHighlight = instanceHighlight;
      }
    `,
    fragmentShader: `
      varying vec2 vStarUv;
      varying vec3 vStarColor;
      varying float vProminence;
      varying float vHighlight;
      uniform float lightSurface;

      void main() {
        float radius = length(vStarUv);
        if (radius > 1.0) discard;

        float core = 1.0 - smoothstep(0.16, 0.46, radius);
        float hotCore = 1.0 - smoothstep(0.0, 0.2, radius);
        float corona = (1.0 - smoothstep(0.18, 1.0, radius)) * (0.045 + vProminence * 0.085);
        float angle = atan(vStarUv.y, vStarUv.x);
        float rayShape = pow(abs(cos(angle * 2.0)), 24.0);
        float rays = rayShape * (1.0 - smoothstep(0.08, 0.94, radius)) * vProminence * 0.2;
        float outerRing = smoothstep(0.6, 0.68, radius) - smoothstep(0.74, 0.82, radius);
        float selectionRing = outerRing * vHighlight * 0.82;
        float alpha = clamp(core + corona + rays + selectionRing, 0.0, 1.0);
        vec3 hotColor = mix(vec3(1.0), vStarColor * 0.5, lightSurface);
        vec3 color = mix(vStarColor, hotColor, hotCore * 0.76 + rays * 0.22);
        color = mix(color, vec3(1.0), selectionRing * 0.5);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function makeGalaxyEdgeGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, -1, 0,
    1, -1, 0,
    1, 1, 0,
    0, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = 0;
  return geometry;
}

function makeGalaxyEdgeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    uniforms: {
      color: { value: new THREE.Color("#7dd3fc") },
      opacity: { value: 0.64 },
      resolution: { value: new THREE.Vector2(1, 1) },
      width: { value: 1.35 },
    },
    vertexShader: `
      uniform vec2 resolution;
      uniform float width;
      attribute vec3 edgeSource;
      attribute vec3 edgeTarget;
      varying float vAcross;
      varying float vAlong;

      void main() {
        vec4 sourceClip = projectionMatrix * modelViewMatrix * vec4(edgeSource, 1.0);
        vec4 targetClip = projectionMatrix * modelViewMatrix * vec4(edgeTarget, 1.0);
        vec2 sourceNdc = sourceClip.xy / sourceClip.w;
        vec2 targetNdc = targetClip.xy / targetClip.w;
        vec2 pixelDirection = (targetNdc - sourceNdc) * resolution;
        float directionLength = max(0.001, length(pixelDirection));
        vec2 normal = vec2(-pixelDirection.y, pixelDirection.x) / directionLength;
        vec4 centerClip = mix(sourceClip, targetClip, position.x);
        centerClip.xy += normal * position.y * width * (2.0 / resolution) * centerClip.w;
        gl_Position = centerClip;
        vAcross = position.y;
        vAlong = position.x;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying float vAcross;
      varying float vAlong;

      void main() {
        float crossFade = 1.0 - smoothstep(0.42, 1.0, abs(vAcross));
        float endFade = smoothstep(0.0, 0.13, vAlong) * (1.0 - smoothstep(0.87, 1.0, vAlong));
        float alpha = crossFade * mix(0.42, 1.0, endFade) * opacity;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function makeStarGeometry(count: number, width: number, height: number, palette: GraphPalette): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const themeColors = [
    colorFromCss(palette.text, "#f8fafc"),
    colorFromCss(palette.friendStroke, "#93c5fd"),
    colorFromCss(palette.connectionStroke, "#c4b5fd"),
    colorFromCss(palette.accountFill, "#67e8f9"),
    colorFromCss(palette.feedFill, "#fbbf24"),
  ];
  const span = Math.max(width, height, 1) * 8.5;
  for (let index = 0; index < count; index += 1) {
    const seed = `star:${index}`;
    const angle = seededUnit(`${seed}:angle`) * Math.PI * 2;
    const radius = Math.sqrt(seededUnit(`${seed}:radius`)) * span;
    const arm = Math.sin(angle * 3 + seededUnit(`${seed}:arm`) * 4) * span * 0.055;
    positions[index * 3] = Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * arm;
    positions[index * 3 + 1] = Math.sin(angle) * radius * 0.64 + Math.sin(angle + Math.PI / 2) * arm;
    positions[index * 3 + 2] = -360 - seededUnit(`${seed}:depth`) * 2_600;
    const color = themeColors[Math.floor(seededUnit(`${seed}:color`) * themeColors.length)] ?? themeColors[0]!;
    const brightness = 0.2 + seededUnit(`${seed}:brightness`) * 0.68;
    colors[index * 3] = color.r * brightness;
    colors[index * 3 + 1] = color.g * brightness;
    colors[index * 3 + 2] = color.b * brightness;
    sizes[index] = 1.2 + seededUnit(`${seed}:size`) * 4.4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pointSize", new THREE.BufferAttribute(sizes, 1));
  return geometry;
}

function drawFallbackStarfield(
  canvas: HTMLCanvasElement,
  atlas: IdentityGraphAtlas,
  galaxyScene: IdentityGalaxyScene,
  transform: ViewTransform,
  palette: GraphPalette,
  selectedPersonId: string | null | undefined,
  selectedAccountId: string | null | undefined,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  const gradient = context.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.85);
  gradient.addColorStop(0, palette.surface);
  gradient.addColorStop(1, "transparent");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < 2_800; index += 1) {
    const x = seededUnit(`fallback-star-x:${index}`) * width;
    const y = seededUnit(`fallback-star-y:${index}`) * height;
    const depth = seededUnit(`fallback-star-z:${index}`);
    context.globalAlpha = 0.08 + depth * 0.34;
    context.fillStyle = index % 7 === 0 ? palette.friendStroke : palette.mutedText;
    context.fillRect(x, y, 1 + depth * 1.8, 1 + depth * 1.8);
  }
  context.globalAlpha = 1;

  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.scale, transform.scale);
  for (const region of atlas.regions) {
    context.beginPath();
    context.ellipse(region.x, region.y, region.radiusX, region.radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = providerColor(region.provider, palette).replace(/\/ 0\.\d+\)/, "/ 0.12)");
    context.strokeStyle = providerColor(region.provider, palette).replace(/\/ 0\.\d+\)/, "/ 0.38)");
    context.lineWidth = 1.2 / transform.scale;
    context.fill();
    context.stroke();
  }
  for (let index = 0; index < atlas.nodes.length; index += 1) {
    const node = atlas.nodes[index]!;
    const selected =
      (!!node.personId && node.personId === selectedPersonId) ||
      (!!node.accountId && node.accountId === selectedAccountId);
    const depth = galaxyScene.positions[index * 3 + 2] ?? 0;
    const parallax = 1 + Math.max(-0.24, Math.min(0.42, depth / 260));
    const radius = Math.max(5, node.radius * 0.82 * parallax + (selected ? 7 : 0));
    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = node.kind === "friend_person"
      ? palette.friendStroke
      : node.kind === "connection_person"
        ? palette.connectionStroke
        : providerColor(node.provider, palette);
    context.shadowBlur = selected ? 20 / transform.scale : 8 / transform.scale;
    context.shadowColor = context.fillStyle;
    context.fill();
    context.shadowBlur = 0;
  }
  context.restore();
}

class StarfieldGraphRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(IDENTITY_GALAXY_CAMERA_FOV, 1, 1, 20_000);
  private readonly graphGroup = new THREE.Group();
  private readonly regionGroup = new THREE.Group();
  private readonly labelGroup = new THREE.Group();
  private readonly nodeGeometry = makeGalaxyStarGeometry();
  private readonly nodeMaterial = makeGalaxyStarMaterial();
  private readonly nodeStars: THREE.Mesh;
  private readonly edgeGeometry = makeGalaxyEdgeGeometry();
  private readonly edgeMaterial = makeGalaxyEdgeMaterial();
  private readonly edgeLines: THREE.Mesh;
  private readonly starMaterial = makePointMaterial();
  private starPoints: THREE.Points | null = null;
  private labels: TroikaText[] = [];
  private indexedScene: IdentityGalaxyScene | null = null;
  private nodeIndexById = new Map<string, number>();
  private readonly projectedNode = new THREE.Vector3();
  private lastTransform: ViewTransform | null = null;
  private labelRenderRaf = 0;
  private labelLayoutDirty = false;
  private width = 1;
  private height = 1;
  private starCount = 0;
  private paletteKey = "";
  private pixelRatio = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    }) as WebGL2RenderingContext | null;
    if (!context) {
      throw new Error("WebGL unavailable");
    }
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.sortObjects = false;
    this.scene.add(this.graphGroup);
    this.scene.add(this.labelGroup);
    this.graphGroup.add(this.regionGroup);
    this.edgeLines = new THREE.Mesh(this.edgeGeometry, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    this.graphGroup.add(this.edgeLines);
    this.nodeStars = new THREE.Mesh(this.nodeGeometry, this.nodeMaterial);
    this.nodeStars.frustumCulled = false;
    this.graphGroup.add(this.nodeStars);
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
    if (this.width === nextWidth && this.height === nextHeight && this.pixelRatio === pixelRatio) {
      return;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.nodeMaterial.uniforms.resolution.value.set(this.width, this.height);
    this.edgeMaterial.uniforms.resolution.value.set(this.width, this.height);
    this.starMaterial.uniforms.pixelRatio.value = pixelRatio;
  }

  syncScene(
    atlas: IdentityGraphAtlas,
    galaxyScene: IdentityGalaxyScene,
    palette: GraphPalette,
    variation: IdentityGalaxyVariation,
    quality: IdentityGraphAtlasQuality,
  ): void {
    if (this.disposed) return;
    this.ensureSceneIndex(galaxyScene);
    const nextPaletteKey = [
      palette.surface,
      palette.text,
      palette.friendStroke,
      palette.connectionStroke,
      palette.accountFill,
      palette.feedFill,
    ].join("|");
    const smallViewport = this.width <= 720 || this.height <= 620;
    const starBudget = smallViewport
      ? { min: 3_000, max: 7_000, perSource: 2 }
      : { min: 5_000, max: 12_000, perSource: 3 };
    const nextStarCount = Math.max(
      starBudget.min,
      Math.min(starBudget.max, atlas.metrics.sourceNodeCount * starBudget.perSource),
    );
    if (nextStarCount !== this.starCount || nextPaletteKey !== this.paletteKey || !this.starPoints) {
      if (this.starPoints) {
        this.scene.remove(this.starPoints);
        this.starPoints.geometry.dispose();
      }
      this.starPoints = new THREE.Points(makeStarGeometry(nextStarCount, this.width, this.height, palette), this.starMaterial);
      this.starPoints.frustumCulled = false;
      this.scene.add(this.starPoints);
      this.starCount = nextStarCount;
      this.paletteKey = nextPaletteKey;
    }
    this.syncRegions(atlas, palette, variation);
    const surfaceColor = colorFromCss(palette.surface, "#06070d");
    const surfaceLuminance = surfaceColor.r * 0.2126 + surfaceColor.g * 0.7152 + surfaceColor.b * 0.0722;
    this.nodeMaterial.uniforms.lightSurface.value = THREE.MathUtils.smoothstep(surfaceLuminance, 0.55, 0.8);
    this.edgeMaterial.uniforms.color.value.copy(colorFromCss(palette.edge, "#7dd3fc"));
    this.edgeMaterial.uniforms.opacity.value = quality === "interactive" ? 0.28 : 0.64;
    this.syncEdges(galaxyScene);
    this.syncNodes(galaxyScene, palette);
    this.syncLabels(atlas, galaxyScene, palette, quality);
  }

  render(transform: ViewTransform): void {
    if (this.disposed) return;
    this.lastTransform = { ...transform };
    this.applyCamera(transform);
    if (this.starPoints) {
      this.starPoints.visible = true;
    }
    this.regionGroup.visible = true;
    this.renderer.render(this.scene, this.camera);
  }

  get labelCount(): number {
    return this.labels.length;
  }

  get readyLabelCount(): number {
    return this.labels.filter((label) => {
      const position = label.geometry.getAttribute("position");
      return position ? position.count > 0 : false;
    }).length;
  }

  pickNode(
    viewportX: number,
    viewportY: number,
    galaxyScene: IdentityGalaxyScene,
    candidateNodeIds: readonly string[],
  ): string | null {
    if (this.disposed) return null;
    this.ensureSceneIndex(galaxyScene);
    let bestId: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const nodeId of candidateNodeIds) {
      const nodeIndex = this.nodeIndexById.get(nodeId);
      if (nodeIndex === undefined) continue;
      const offset = nodeIndex * 3;
      this.projectedNode.set(
        galaxyScene.positions[offset]!,
        galaxyScene.positions[offset + 1]!,
        galaxyScene.positions[offset + 2]!,
      ).project(this.camera);
      if (this.projectedNode.z < -1 || this.projectedNode.z > 1) continue;
      const screenX = (this.projectedNode.x + 1) * this.width * 0.5;
      const screenY = (1 - this.projectedNode.y) * this.height * 0.5;
      const dx = screenX - viewportX;
      const dy = screenY - viewportY;
      const cameraDepth = this.camera.position.z - galaxyScene.positions[offset + 2]!;
      const depthScale = Math.max(0.72, Math.min(1.8, 1_000 / Math.max(280, cameraDepth)));
      const radius = Math.max(10, galaxyScene.pointSizes[nodeIndex]! * depthScale * 0.5);
      const normalizedDistance = (dx * dx + dy * dy) / (radius * radius);
      if (normalizedDistance > 1) continue;
      const score = normalizedDistance - galaxyScene.prominence[nodeIndex]! * 0.22;
      if (score < bestScore) {
        bestScore = score;
        bestId = nodeId;
      }
    }
    return bestId;
  }

  dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.labelRenderRaf);
    this.clearRegions();
    this.clearLabels();
    this.nodeGeometry.dispose();
    this.nodeMaterial.dispose();
    this.edgeGeometry.dispose();
    this.edgeMaterial.dispose();
    if (this.starPoints) {
      this.starPoints.geometry.dispose();
    }
    this.starMaterial.dispose();
    this.renderer.dispose();
  }

  private applyCamera(transform: ViewTransform): void {
    const pose = identityGalaxyCameraPose(transform, this.width, this.height, this.camera.fov);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    const billboardScale = 1 / Math.max(0.08, transform.scale);
    for (const label of this.labels) {
      label.quaternion.copy(this.camera.quaternion);
      label.scale.setScalar(billboardScale);
    }
    if (this.labelLayoutDirty) {
      this.layoutLabels();
      this.labelLayoutDirty = false;
    }
  }

  private ensureSceneIndex(galaxyScene: IdentityGalaxyScene): void {
    if (this.indexedScene === galaxyScene) return;
    this.indexedScene = galaxyScene;
    this.nodeIndexById = new Map(galaxyScene.nodeIds.map((id, index) => [id, index]));
  }

  private scheduleLabelRender(): void {
    if (this.disposed || this.labelRenderRaf || !this.lastTransform) return;
    this.labelRenderRaf = window.requestAnimationFrame(() => {
      this.labelRenderRaf = 0;
      if (this.lastTransform) this.render(this.lastTransform);
    });
  }

  private layoutLabels(): void {
    const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const focalLengthPixels = this.height / 2 /
      Math.tan((this.camera.fov * Math.PI) / 360);
    for (const label of this.labels) {
      this.projectedNode.copy(label.position).project(this.camera);
      const screenX = (this.projectedNode.x + 1) * this.width * 0.5;
      const screenY = (1 - this.projectedNode.y) * this.height * 0.5;
      const cameraDepth = this.camera.position.z - label.position.z;
      const fontPixels = label.fontSize * label.scale.x *
        focalLengthPixels / Math.max(1, cameraDepth);
      const labelText = typeof label.userData.labelText === "string" ? label.userData.labelText : "";
      const width = Math.min(220, Math.max(38, labelText.length * fontPixels * 0.54));
      const height = Math.max(16, fontPixels * 1.25);
      const bounds = {
        left: screenX - width / 2 - 5,
        right: screenX + width / 2 + 5,
        top: screenY - height / 2 - 4,
        bottom: screenY + height / 2 + 4,
      };
      const outside = bounds.right < 0 || bounds.left > this.width || bounds.bottom < 0 || bounds.top > this.height;
      const collides = occupied.some((entry) =>
        bounds.left < entry.right &&
        bounds.right > entry.left &&
        bounds.top < entry.bottom &&
        bounds.bottom > entry.top,
      );
      label.visible = !outside && !collides;
      if (label.visible) occupied.push(bounds);
    }
  }

  private clearRegions(): void {
    for (const child of this.regionGroup.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material.dispose();
        }
      }
    }
    this.regionGroup.clear();
  }

  private syncRegions(atlas: IdentityGraphAtlas, palette: GraphPalette, variation: IdentityGalaxyVariation): void {
    this.clearRegions();
    for (const region of atlas.regions) {
      const color = colorFromCss(providerColor(region.provider, palette), "#38bdf8");
      if (variation === "nebula-rings" || variation === "nebula") {
        const haze = new THREE.Mesh(
          new THREE.CircleGeometry(1, 128),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.105,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        haze.position.set(region.x, -region.y, -170);
        haze.scale.set(region.radiusX, region.radiusY, 1);
        this.regionGroup.add(haze);
      }
      if (variation === "nebula-rings" || variation === "rings") {
        const points = Array.from({ length: 97 }, (_, index) => {
          const angle = (index / 96) * Math.PI * 2;
          return new THREE.Vector3(
            region.x + Math.cos(angle) * region.radiusX,
            -region.y + Math.sin(angle) * region.radiusY,
            -92,
          );
        });
        const ring = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        this.regionGroup.add(ring);
      }
    }
  }

  private syncEdges(galaxyScene: IdentityGalaxyScene): void {
    const edgeCount = galaxyScene.edgeIndices.length / 2;
    const sources = new Float32Array(edgeCount * 3);
    const targets = new Float32Array(edgeCount * 3);
    let edgeIndex = 0;
    for (let edgeOffset = 0; edgeOffset < galaxyScene.edgeIndices.length; edgeOffset += 2) {
      const sourceOffset = galaxyScene.edgeIndices[edgeOffset]! * 3;
      const targetOffset = galaxyScene.edgeIndices[edgeOffset + 1]! * 3;
      const attributeOffset = edgeIndex * 3;
      sources[attributeOffset] = galaxyScene.positions[sourceOffset]!;
      sources[attributeOffset + 1] = galaxyScene.positions[sourceOffset + 1]!;
      sources[attributeOffset + 2] = galaxyScene.positions[sourceOffset + 2]! - 8;
      targets[attributeOffset] = galaxyScene.positions[targetOffset]!;
      targets[attributeOffset + 1] = galaxyScene.positions[targetOffset + 1]!;
      targets[attributeOffset + 2] = galaxyScene.positions[targetOffset + 2]! - 8;
      edgeIndex += 1;
    }
    this.edgeGeometry.setAttribute("edgeSource", new THREE.InstancedBufferAttribute(sources, 3));
    this.edgeGeometry.setAttribute("edgeTarget", new THREE.InstancedBufferAttribute(targets, 3));
    this.edgeGeometry.instanceCount = edgeCount;
  }

  private syncNodes(
    galaxyScene: IdentityGalaxyScene,
    palette: GraphPalette,
  ): void {
    const colors = new Float32Array(galaxyScene.nodeIds.length * 3);
    const highlights = new Float32Array(galaxyScene.nodeIds.length);
    for (let index = 0; index < galaxyScene.nodeIds.length; index += 1) {
      const color = graphNodeColor(
        galaxyScene.colorRoles[index]! as IdentityGalaxyColorRole,
        galaxyScene.providers[index] ?? null,
        galaxyScene.flags[index]!,
        palette,
      );
      const intensity = galaxyScene.brightness[index]! * galaxyScene.emphasis[index]!;
      colors[index * 3] = color.r * intensity;
      colors[index * 3 + 1] = color.g * intensity;
      colors[index * 3 + 2] = color.b * intensity;
      const flags = galaxyScene.flags[index]!;
      highlights[index] = (flags & (
        IdentityGalaxyNodeFlag.Selected |
        IdentityGalaxyNodeFlag.Hovered |
        IdentityGalaxyNodeFlag.LinkedToSelection
      )) !== 0 ? 1 : 0;
    }
    this.nodeGeometry.setAttribute(
      "instancePosition",
      new THREE.InstancedBufferAttribute(galaxyScene.positions, 3),
    );
    this.nodeGeometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(colors, 3));
    this.nodeGeometry.setAttribute(
      "instanceSize",
      new THREE.InstancedBufferAttribute(galaxyScene.pointSizes, 1),
    );
    this.nodeGeometry.setAttribute(
      "instanceProminence",
      new THREE.InstancedBufferAttribute(galaxyScene.prominence, 1),
    );
    this.nodeGeometry.setAttribute(
      "instanceHighlight",
      new THREE.InstancedBufferAttribute(highlights, 1),
    );
    this.nodeGeometry.instanceCount = galaxyScene.nodeIds.length;
  }

  private clearLabels(): void {
    for (const label of this.labels) {
      this.labelGroup.remove(label);
      label.dispose();
    }
    this.labels = [];
  }

  private syncLabels(
    atlas: IdentityGraphAtlas,
    galaxyScene: IdentityGalaxyScene,
    palette: GraphPalette,
    quality: IdentityGraphAtlasQuality,
  ): void {
    this.clearLabels();
    if (quality === "interactive") return;
    this.ensureSceneIndex(galaxyScene);
    const smallViewport = this.width < 720;
    const cap = smallViewport ? 24 : 96;
    for (const label of atlas.labels.slice(0, cap)) {
      const text = new TroikaText();
      text.text = label.text;
      text.fontSize = label.kind === "provider_cluster"
        ? smallViewport ? 16 : 19
        : label.kind === "friend_person"
          ? smallViewport ? 14 : 16
          : label.kind === "connection_person"
            ? smallViewport ? 13 : 15
            : smallViewport ? 12 : 13;
      text.anchorX = "center";
      text.anchorY = "middle";
      text.color = colorFromCss(palette.text, "#f8fafc");
      text.outlineColor = colorFromCss(palette.labelFill, "#020617");
      text.outlineWidth = label.kind === "provider_cluster" ? "8%" : "10%";
      text.frustumCulled = false;
      text.material.depthTest = false;
      text.material.depthWrite = false;
      text.material.transparent = true;
      const nodeIndex = this.nodeIndexById.get(label.nodeId);
      const nodeDepth = nodeIndex === undefined
        ? label.kind === "provider_cluster" ? -38 : 0
        : galaxyScene.positions[nodeIndex * 3 + 2]! + 6;
      text.position.set(
        label.x,
        -label.y - 24 / Math.max(0.7, label.priority / 600),
        nodeDepth,
      );
      text.renderOrder = 10;
      text.userData.labelText = label.text;
      text.sync(() => this.scheduleLabelRender());
      this.labels.push(text);
      this.labelGroup.add(text);
    }
    this.labelLayoutDirty = true;
  }
}

export class IdentityGalaxyEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly paletteElement: HTMLElement | null;
  private renderer: StarfieldGraphRenderer | null = null;
  private atlas: IdentityGraphAtlas | null = null;
  private scene: IdentityGalaxyScene | null = null;
  private palette: GraphPalette | null = null;
  private selectedPersonId: string | null | undefined;
  private selectedAccountId: string | null | undefined;

  constructor(canvas: HTMLCanvasElement, paletteElement: HTMLElement | null) {
    this.canvas = canvas;
    this.paletteElement = paletteElement;
    try {
      this.renderer = new StarfieldGraphRenderer(canvas);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "WebGL unavailable") throw error;
    }
  }

  get rendererType(): IdentityGalaxyRendererType {
    return this.renderer ? "three-starfield" : "canvas-starfield-fallback";
  }

  get labelCount(): number {
    return this.renderer?.labelCount ?? 0;
  }

  get readyLabelCount(): number {
    return this.renderer?.readyLabelCount ?? 0;
  }

  resize(width: number, height: number): void {
    this.renderer?.resize(width, height);
  }

  syncScene(
    atlas: IdentityGraphAtlas,
    scene: IdentityGalaxyScene,
    options: IdentityGalaxyEngineSceneOptions,
  ): void {
    const palette = readGraphPalette(this.paletteElement);
    this.atlas = atlas;
    this.scene = scene;
    this.palette = palette;
    this.selectedPersonId = options.selectedPersonId;
    this.selectedAccountId = options.selectedAccountId;
    this.renderer?.syncScene(atlas, scene, palette, options.variation, options.quality);
  }

  render(transform: ViewTransform): void {
    if (this.renderer) {
      this.renderer.render(transform);
      return;
    }
    if (!this.atlas || !this.scene || !this.palette) return;
    drawFallbackStarfield(
      this.canvas,
      this.atlas,
      this.scene,
      transform,
      this.palette,
      this.selectedPersonId,
      this.selectedAccountId,
    );
  }

  pickNode(
    viewportX: number,
    viewportY: number,
    candidateNodeIds: readonly string[],
  ): string | null {
    if (!this.renderer || !this.scene) return null;
    return this.renderer.pickNode(viewportX, viewportY, this.scene, candidateNodeIds);
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer = null;
    this.atlas = null;
    this.scene = null;
    this.palette = null;
  }
}
