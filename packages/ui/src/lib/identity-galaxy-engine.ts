import * as THREE from "three";
import { friendsGalaxyDecorativeStarScale } from "./friends-galaxy-decorative-star-scale.js";
import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasQuality,
  IdentityGraphAtlasRegion,
} from "./identity-graph-atlas.js";
import {
  compileIdentityGalaxyContextEdgeIndices,
  IdentityGalaxyColorRole,
  IdentityGalaxyNodeFlag,
  type IdentityGalaxyScene,
} from "./identity-galaxy-scene.js";
import {
  providerGalaxyArmCount,
  providerGalaxyLocalPoint,
  providerGalaxySeed,
} from "./identity-galaxy-provider-field.js";
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
  fontFamily: string;
  providerColors: Record<string, string>;
}

interface GalaxyLabelRecord {
  id: string;
  text: string;
  fontSize: number;
  offsetY: number;
  position: THREE.Vector3;
}

interface GlyphAtlasEntry {
  advance: number;
  uv: [number, number, number, number];
}

interface GlyphAtlas {
  texture: THREE.CanvasTexture;
  entries: Map<string, GlyphAtlasEntry>;
  fallback: GlyphAtlasEntry;
  cellSize: number;
  fontSize: number;
  texelSize: THREE.Vector2;
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
    fontFamily: style.fontFamily || "system-ui, sans-serif",
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
      decorativeScale: { value: 1 },
    },
    vertexShader: `
      attribute float pointSize;
      uniform float decorativeScale;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pointSize * decorativeScale;
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
      opacity: { value: 0.76 },
      resolution: { value: new THREE.Vector2(1, 1) },
      width: { value: 1.6 },
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

function makeProviderNebulaMaterial(color: THREE.Color, provider: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: {
      color: { value: color },
      seed: { value: providerGalaxySeed(provider) },
      arms: { value: providerGalaxyArmCount(provider) },
      opacity: { value: 0.3 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float seed;
      uniform float arms;
      uniform float opacity;
      varying vec2 vUv;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);
        return mix(
          mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x),
          mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0, 1.0)), local.x),
          local.y
        );
      }

      float fbm(vec2 point) {
        float value = 0.0;
        float amplitude = 0.54;
        for (int octave = 0; octave < 4; octave += 1) {
          value += noise(point) * amplitude;
          point = point * 2.03 + vec2(11.7, 7.9);
          amplitude *= 0.48;
        }
        return value;
      }

      void main() {
        vec2 point = (vUv - 0.5) * 2.0;
        float radius = length(point);
        float angle = atan(point.y, point.x);
        float turbulence = fbm(point * 3.1 + seed * 17.0);
        float warpedRadius = radius + (turbulence - 0.5) * 0.25 + sin(angle * 5.0 + seed * 19.0) * 0.045;
        float envelope = 1.0 - smoothstep(0.48, 1.08, warpedRadius);
        float spiral = 0.5 + 0.5 * cos(angle * arms - radius * 10.8 + seed * 6.28318);
        spiral = pow(spiral, 4.0);
        float core = 1.0 - smoothstep(0.02, 0.48, warpedRadius);
        float dust = envelope * (0.18 + spiral * 0.82) * (0.38 + turbulence * 0.86);
        vec2 starCell = floor((point + seed * 0.37) * 76.0);
        float speck = step(0.991, hash21(starCell)) * envelope;
        float alpha = clamp((dust * 0.72 + core * 0.2) * opacity + speck * 0.5, 0.0, 0.72);
        if (alpha < 0.012) discard;
        vec3 nebulaColor = mix(color * 0.72, color, spiral * 0.62 + core * 0.2);
        nebulaColor = mix(nebulaColor, vec3(1.0), speck * 0.72);
        gl_FragColor = vec4(nebulaColor, alpha);
      }
    `,
  });
}

function makeProviderStreamGeometry(region: IdentityGraphAtlasRegion): THREE.BufferGeometry {
  const positions: number[] = [];
  const armCount = providerGalaxyArmCount(region.provider);
  const seed = providerGalaxySeed(region.provider);
  const segmentCount = 58;
  for (let armIndex = 0; armIndex < armCount; armIndex += 1) {
    let previous = providerGalaxyLocalPoint(
      region.provider,
      armIndex,
      0.025,
      region.radiusX,
      region.radiusY,
    );
    for (let step = 1; step <= segmentCount; step += 1) {
      const progress = 0.025 + (step / segmentCount) * 0.94;
      const current = providerGalaxyLocalPoint(
        region.provider,
        armIndex,
        progress,
        region.radiusX,
        region.radiusY,
      );
      const gap = (step + armIndex * 5 + Math.floor(seed * 17)) % 14 === 0;
      if (!gap) {
        positions.push(
          region.x + previous.x,
          -region.y - previous.y,
          -126,
          region.x + current.x,
          -region.y - current.y,
          -126,
        );
      }
      previous = current;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function makeProviderDustGeometry(
  region: IdentityGraphAtlasRegion,
  color: THREE.Color,
): THREE.BufferGeometry {
  const count = Math.min(320, Math.max(120, Math.ceil(Math.sqrt(Math.max(1, region.count))) * 16));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const armCount = providerGalaxyArmCount(region.provider);
  for (let index = 0; index < count; index += 1) {
    const armIndex = index % armCount;
    const progress = Math.pow(seededUnit(`${region.provider}:dust:${index}:progress`), 0.82);
    const angularOffset = (seededUnit(`${region.provider}:dust:${index}:angle`) - 0.5) * 0.42;
    const point = providerGalaxyLocalPoint(
      region.provider,
      armIndex,
      progress,
      region.radiusX,
      region.radiusY,
      angularOffset,
    );
    const scatter = 0.9 + seededUnit(`${region.provider}:dust:${index}:scatter`) * 0.2;
    positions[index * 3] = region.x + point.x * scatter;
    positions[index * 3 + 1] = -region.y - point.y * scatter;
    positions[index * 3 + 2] = -118 - seededUnit(`${region.provider}:dust:${index}:depth`) * 44;
    const brightness = 0.34 + seededUnit(`${region.provider}:dust:${index}:brightness`) * 0.66;
    colors[index * 3] = color.r * brightness;
    colors[index * 3 + 1] = color.g * brightness;
    colors[index * 3 + 2] = color.b * brightness;
    sizes[index] = 1.4 + seededUnit(`${region.provider}:dust:${index}:size`) * 4.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pointSize", new THREE.BufferAttribute(sizes, 1));
  return geometry;
}

const LABEL_ATLAS_CELL_SIZE = 64;
const LABEL_ATLAS_FONT_SIZE = 42;
const LABEL_ATLAS_MAX_GLYPHS = 256;
const LABEL_TEXT_MAX_CHARACTERS = 44;
const LABEL_OUTLINE_ATLAS_PIXELS = 4.2;

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function truncateGalaxyLabel(text: string): string {
  const characters = Array.from(text.trim());
  if (characters.length <= LABEL_TEXT_MAX_CHARACTERS) return characters.join("");
  return `${characters.slice(0, LABEL_TEXT_MAX_CHARACTERS - 3).join("")}...`;
}

function makeTransparentTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function makeGalaxyLabelGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
    -0.5, 0.5, 0,
  ], 3));
  geometry.setAttribute("glyphUv", new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = 0;
  return geometry;
}

function makeGalaxyLabelMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    uniforms: {
      atlas: { value: texture },
      atlasTexel: { value: new THREE.Vector2(1, 1) },
      resolution: { value: new THREE.Vector2(1, 1) },
      textColor: { value: new THREE.Color("#f8fafc") },
      outlineColor: { value: new THREE.Color("#020617") },
    },
    vertexShader: `
      uniform vec2 resolution;
      attribute vec2 glyphUv;
      attribute vec3 instanceAnchor;
      attribute vec2 instanceOffset;
      attribute vec2 instanceGlyphSize;
      attribute vec4 instanceUvRect;
      varying vec2 vGlyphUv;

      void main() {
        vec4 centerClip = projectionMatrix * modelViewMatrix * vec4(instanceAnchor, 1.0);
        vec2 pixelPosition = instanceOffset + position.xy * instanceGlyphSize;
        centerClip.xy += pixelPosition * (2.0 / resolution) * centerClip.w;
        gl_Position = centerClip;
        vGlyphUv = mix(instanceUvRect.xy, instanceUvRect.zw, glyphUv);
      }
    `,
    fragmentShader: `
      uniform sampler2D atlas;
      uniform vec2 atlasTexel;
      uniform vec3 textColor;
      uniform vec3 outlineColor;
      varying vec2 vGlyphUv;

      void main() {
        float fill = texture2D(atlas, vGlyphUv).a;
        vec2 spread = atlasTexel * ${LABEL_OUTLINE_ATLAS_PIXELS.toFixed(1)};
        float outline = fill;
        outline = max(outline, texture2D(atlas, vGlyphUv + vec2(spread.x, 0.0)).a);
        outline = max(outline, texture2D(atlas, vGlyphUv - vec2(spread.x, 0.0)).a);
        outline = max(outline, texture2D(atlas, vGlyphUv + vec2(0.0, spread.y)).a);
        outline = max(outline, texture2D(atlas, vGlyphUv - vec2(0.0, spread.y)).a);
        outline = max(outline, texture2D(atlas, vGlyphUv + spread).a);
        outline = max(outline, texture2D(atlas, vGlyphUv - spread).a);
        outline = max(outline, texture2D(atlas, vGlyphUv + vec2(spread.x, -spread.y)).a);
        outline = max(outline, texture2D(atlas, vGlyphUv + vec2(-spread.x, spread.y)).a);
        float fillAlpha = smoothstep(0.14, 0.72, fill);
        float outlineAlpha = smoothstep(0.04, 0.46, outline) * 0.92;
        float alpha = max(fillAlpha, outlineAlpha);
        if (alpha < 0.02) discard;
        vec3 color = mix(outlineColor, textColor, fillAlpha);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function buildGlyphAtlas(records: readonly GalaxyLabelRecord[], fontFamily: string): GlyphAtlas {
  const uniqueCharacters = new Set<string>(["?", " "]);
  for (const record of records) {
    for (const character of Array.from(record.text)) {
      if (uniqueCharacters.size >= LABEL_ATLAS_MAX_GLYPHS) break;
      uniqueCharacters.add(character);
    }
  }
  const characters = [...uniqueCharacters];
  const requestedColumns = Math.max(4, Math.min(16, Math.ceil(Math.sqrt(characters.length))));
  const width = nextPowerOfTwo(requestedColumns * LABEL_ATLAS_CELL_SIZE);
  const columns = width / LABEL_ATLAS_CELL_SIZE;
  const rows = Math.ceil(characters.length / columns);
  const height = nextPowerOfTwo(Math.max(1, rows) * LABEL_ATLAS_CELL_SIZE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Friends galaxy label atlas is unavailable");
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.font = `600 ${String(LABEL_ATLAS_FONT_SIZE)}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const entries = new Map<string, GlyphAtlasEntry>();
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * LABEL_ATLAS_CELL_SIZE;
    const top = row * LABEL_ATLAS_CELL_SIZE;
    if (character.trim()) {
      context.fillText(
        character,
        left + LABEL_ATLAS_CELL_SIZE / 2,
        top + LABEL_ATLAS_CELL_SIZE / 2 + 2,
        LABEL_ATLAS_CELL_SIZE - 10,
      );
    }
    const measuredWidth = context.measureText(character).width;
    entries.set(character, {
      advance: Math.max(0.28, Math.min(1.28, measuredWidth / LABEL_ATLAS_FONT_SIZE)),
      uv: [
        left / width,
        1 - (top + LABEL_ATLAS_CELL_SIZE) / height,
        (left + LABEL_ATLAS_CELL_SIZE) / width,
        1 - top / height,
      ],
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return {
    texture,
    entries,
    fallback: entries.get("?")!,
    cellSize: LABEL_ATLAS_CELL_SIZE,
    fontSize: LABEL_ATLAS_FONT_SIZE,
    texelSize: new THREE.Vector2(1 / width, 1 / height),
  };
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

interface FallbackStarfieldBackground {
  canvas: HTMLCanvasElement;
  key: string;
}

const fallbackStarfieldBackgrounds = new WeakMap<HTMLCanvasElement, FallbackStarfieldBackground>();
let fallbackStarSeeds: Float32Array | null = null;

function getFallbackStarSeeds(): Float32Array {
  if (fallbackStarSeeds) return fallbackStarSeeds;
  fallbackStarSeeds = new Float32Array(2_800 * 3);
  for (let index = 0; index < 2_800; index += 1) {
    fallbackStarSeeds[index * 3] = seededUnit(`fallback-star-x:${index}`);
    fallbackStarSeeds[index * 3 + 1] = seededUnit(`fallback-star-y:${index}`);
    fallbackStarSeeds[index * 3 + 2] = seededUnit(`fallback-star-z:${index}`);
  }
  return fallbackStarSeeds;
}

function getFallbackStarfieldBackground(
  target: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio: number,
  palette: GraphPalette,
): HTMLCanvasElement {
  const key = [
    width,
    height,
    pixelRatio,
    palette.surface,
    palette.friendStroke,
    palette.mutedText,
  ].join("|");
  const cached = fallbackStarfieldBackgrounds.get(target);
  if (cached?.key === key) return cached.canvas;
  const canvas = cached?.canvas ?? document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(height * pixelRatio));
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  const gradient = context.createRadialGradient(
    width * 0.5,
    height * 0.45,
    0,
    width * 0.5,
    height * 0.45,
    Math.max(width, height) * 0.85,
  );
  gradient.addColorStop(0, palette.surface);
  gradient.addColorStop(1, "transparent");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const seeds = getFallbackStarSeeds();
  for (let index = 0; index < seeds.length / 3; index += 1) {
    const depth = seeds[index * 3 + 2]!;
    context.globalAlpha = 0.08 + depth * 0.34;
    context.fillStyle = index % 7 === 0 ? palette.friendStroke : palette.mutedText;
    context.fillRect(
      seeds[index * 3]! * width,
      seeds[index * 3 + 1]! * height,
      1 + depth * 1.8,
      1 + depth * 1.8,
    );
  }
  context.globalAlpha = 1;
  fallbackStarfieldBackgrounds.set(target, { canvas, key });
  return canvas;
}

function drawFallbackLabels(
  context: CanvasRenderingContext2D,
  atlas: IdentityGraphAtlas,
  transform: ViewTransform,
  palette: GraphPalette,
  width: number,
  height: number,
): number {
  const smallViewport = width < 720;
  const cap = smallViewport ? 24 : 72;
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const nodeById = new Map(atlas.nodes.map((node) => [node.id, node]));
  let visibleCount = 0;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  for (const label of atlas.labels.slice(0, cap)) {
    const fontSize = label.kind === "provider_cluster"
      ? smallViewport ? 16 : 19
      : label.kind === "friend_person"
        ? smallViewport ? 14 : 16
        : label.kind === "connection_person"
          ? smallViewport ? 13 : 15
          : smallViewport ? 12 : 13;
    const text = truncateGalaxyLabel(label.text);
    const screenX = transform.x + label.x * transform.scale;
    const parentNode = nodeById.get(label.nodeId);
    const starRadius = parentNode
      ? Math.max(5, parentNode.radius * 0.82 * transform.scale)
      : 5;
    const labelOffset = starRadius + fontSize * 0.68 + 3;
    const screenY = transform.y + label.y * transform.scale - labelOffset;
    context.font = `600 ${String(fontSize)}px ${palette.fontFamily}`;
    const textWidth = context.measureText(text).width;
    const bounds = {
      left: screenX - textWidth / 2 - 6,
      right: screenX + textWidth / 2 + 6,
      top: screenY - fontSize * 0.75,
      bottom: screenY + fontSize * 0.75,
    };
    const outside = bounds.left < 8 || bounds.right > width - 8 || bounds.top < 8 || bounds.bottom > height - 8;
    const collides = occupied.some((entry) =>
      bounds.left < entry.right &&
      bounds.right > entry.left &&
      bounds.top < entry.bottom &&
      bounds.bottom > entry.top,
    );
    if (outside || collides) continue;
    occupied.push(bounds);
    context.lineWidth = label.kind === "provider_cluster" ? 5.5 : 4.5;
    context.strokeStyle = palette.labelFill;
    context.fillStyle = palette.text;
    context.strokeText(text, screenX, screenY);
    context.fillText(text, screenX, screenY);
    visibleCount += 1;
  }
  return visibleCount;
}

function drawFallbackStarfield(
  canvas: HTMLCanvasElement,
  atlas: IdentityGraphAtlas,
  galaxyScene: IdentityGalaxyScene,
  transform: ViewTransform,
  palette: GraphPalette,
  selectedPersonId: string | null | undefined,
  selectedAccountId: string | null | undefined,
  variation: IdentityGalaxyVariation,
): number {
  const context = canvas.getContext("2d");
  if (!context) return 0;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  context.drawImage(
    getFallbackStarfieldBackground(canvas, width, height, pixelRatio, palette),
    0,
    0,
  );

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.scale, transform.scale);
  for (const region of atlas.regions) {
    const armCount = providerGalaxyArmCount(region.provider);
    const traceStreams = () => {
      context.beginPath();
      for (let armIndex = 0; armIndex < armCount; armIndex += 1) {
        for (let step = 0; step <= 58; step += 1) {
          const point = providerGalaxyLocalPoint(
            region.provider,
            armIndex,
            0.025 + (step / 58) * 0.94,
            region.radiusX,
            region.radiusY,
          );
          const x = region.x + point.x;
          const y = region.y + point.y;
          if (step === 0 || (step + armIndex * 5) % 14 === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
      }
    };
    if (variation === "nebula-rings" || variation === "nebula") {
      traceStreams();
      context.strokeStyle = providerColor(region.provider, palette);
      context.globalAlpha = 0.12;
      context.lineWidth = 34 / transform.scale;
      context.stroke();
    }
    if (variation === "nebula-rings" || variation === "rings") {
      traceStreams();
      context.strokeStyle = providerColor(region.provider, palette);
      context.globalAlpha = 0.48;
      context.lineWidth = 1.4 / transform.scale;
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  const contextualEdges = compileIdentityGalaxyContextEdgeIndices(galaxyScene);
  context.beginPath();
  for (let edgeOffset = 0; edgeOffset < contextualEdges.length; edgeOffset += 2) {
    const sourceOffset = contextualEdges[edgeOffset]! * 3;
    const targetOffset = contextualEdges[edgeOffset + 1]! * 3;
    context.moveTo(galaxyScene.positions[sourceOffset]!, -galaxyScene.positions[sourceOffset + 1]!);
    context.lineTo(galaxyScene.positions[targetOffset]!, -galaxyScene.positions[targetOffset + 1]!);
  }
  context.strokeStyle = palette.selection;
  context.lineWidth = 2 / transform.scale;
  context.globalAlpha = 0.9;
  context.stroke();
  context.globalAlpha = 1;
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
    context.fill();
    if (selected) {
      context.lineWidth = 4 / transform.scale;
      context.strokeStyle = palette.selection;
      context.stroke();
    }
  }
  context.restore();
  return drawFallbackLabels(context, atlas, transform, palette, width, height);
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
  private readonly labelGeometry: THREE.InstancedBufferGeometry;
  private readonly labelMaterial: THREE.ShaderMaterial;
  private readonly labelGlyphs: THREE.Mesh;
  private labelTexture: THREE.Texture;
  private starPoints: THREE.Points | null = null;
  private labelRecords: GalaxyLabelRecord[] = [];
  private glyphAtlas: GlyphAtlas | null = null;
  private labelSignature = "";
  private renderedLabelCount = 0;
  private indexedScene: IdentityGalaxyScene | null = null;
  private nodeIndexById = new Map<string, number>();
  private readonly projectedNode = new THREE.Vector3();
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
    this.labelTexture = makeTransparentTexture();
    this.labelGeometry = makeGalaxyLabelGeometry();
    this.labelMaterial = makeGalaxyLabelMaterial(this.labelTexture);
    this.labelGlyphs = new THREE.Mesh(this.labelGeometry, this.labelMaterial);
    this.labelGlyphs.frustumCulled = false;
    this.labelGlyphs.renderOrder = 10;
    this.labelGroup.add(this.labelGlyphs);
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
    this.labelMaterial.uniforms.resolution.value.set(this.width, this.height);
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
      palette.labelFill,
      palette.fontFamily,
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
    this.edgeMaterial.uniforms.color.value.copy(colorFromCss(palette.selection, "#67e8f9"));
    this.edgeMaterial.uniforms.opacity.value = quality === "interactive" ? 0.42 : 0.76;
    this.labelMaterial.uniforms.textColor.value.copy(colorFromCss(palette.text, "#f8fafc"));
    this.labelMaterial.uniforms.outlineColor.value.copy(colorFromCss(palette.labelFill, "#020617"));
    this.syncEdges(galaxyScene);
    this.syncNodes(galaxyScene, palette);
    this.syncLabels(atlas, galaxyScene, palette, quality);
  }

  updateInteraction(galaxyScene: IdentityGalaxyScene, palette: GraphPalette): void {
    this.syncEdges(galaxyScene);
    this.syncNodes(galaxyScene, palette);
  }

  render(transform: ViewTransform): void {
    if (this.disposed) return;
    this.applyCamera(transform);
    this.starMaterial.uniforms.decorativeScale.value =
      friendsGalaxyDecorativeStarScale(transform.scale);
    if (this.starPoints) {
      this.starPoints.visible = true;
    }
    this.regionGroup.visible = true;
    this.renderer.render(this.scene, this.camera);
  }

  get labelCount(): number {
    return this.labelRecords.length;
  }

  get readyLabelCount(): number {
    return this.renderedLabelCount;
  }

  get edgeCount(): number {
    return this.edgeGeometry.instanceCount;
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
    this.labelGeometry.dispose();
    this.labelMaterial.dispose();
    this.labelTexture.dispose();
    this.renderer.dispose();
  }

  private applyCamera(transform: ViewTransform): void {
    const pose = identityGalaxyCameraPose(transform, this.width, this.height, this.camera.fov);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
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

  private layoutLabels(): void {
    const glyphAtlas = this.glyphAtlas;
    if (!glyphAtlas || this.labelRecords.length === 0) {
      this.labelGeometry.instanceCount = 0;
      this.renderedLabelCount = 0;
      return;
    }
    const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const visibleLabels: GalaxyLabelRecord[] = [];
    const labelWidths = new Map<string, number>();
    for (const label of this.labelRecords) {
      this.projectedNode.copy(label.position).project(this.camera);
      if (this.projectedNode.z < -1 || this.projectedNode.z > 1) continue;
      const screenX = (this.projectedNode.x + 1) * this.width * 0.5;
      const screenY = (1 - this.projectedNode.y) * this.height * 0.5 - label.offsetY;
      let width = 0;
      for (const character of Array.from(label.text)) {
        const glyph = glyphAtlas.entries.get(character) ?? glyphAtlas.fallback;
        width += glyph.advance * label.fontSize;
      }
      labelWidths.set(label.id, width);
      const height = label.fontSize * 1.35;
      const bounds = {
        left: screenX - width / 2 - 6,
        right: screenX + width / 2 + 6,
        top: screenY - height / 2 - 4,
        bottom: screenY + height / 2 + 4,
      };
      const outside = bounds.left < 8 ||
        bounds.right > this.width - 8 ||
        bounds.top < 8 ||
        bounds.bottom > this.height - 8;
      const collides = occupied.some((entry) =>
        bounds.left < entry.right &&
        bounds.right > entry.left &&
        bounds.top < entry.bottom &&
        bounds.bottom > entry.top,
      );
      if (outside || collides) continue;
      occupied.push(bounds);
      visibleLabels.push(label);
    }

    let glyphCount = 0;
    for (const label of visibleLabels) {
      glyphCount += Array.from(label.text).filter((character) => character.trim()).length;
    }
    const anchors = new Float32Array(glyphCount * 3);
    const offsets = new Float32Array(glyphCount * 2);
    const sizes = new Float32Array(glyphCount * 2);
    const uvRects = new Float32Array(glyphCount * 4);
    const glyphScale = glyphAtlas.cellSize / glyphAtlas.fontSize;
    let glyphIndex = 0;
    for (const label of visibleLabels) {
      let cursor = -(labelWidths.get(label.id) ?? 0) / 2;
      for (const character of Array.from(label.text)) {
        const glyph = glyphAtlas.entries.get(character) ?? glyphAtlas.fallback;
        const advance = glyph.advance * label.fontSize;
        if (character.trim()) {
          anchors[glyphIndex * 3] = label.position.x;
          anchors[glyphIndex * 3 + 1] = label.position.y;
          anchors[glyphIndex * 3 + 2] = label.position.z;
          offsets[glyphIndex * 2] = cursor + advance / 2;
          offsets[glyphIndex * 2 + 1] = label.offsetY;
          sizes[glyphIndex * 2] = label.fontSize * glyphScale;
          sizes[glyphIndex * 2 + 1] = label.fontSize * glyphScale;
          uvRects.set(glyph.uv, glyphIndex * 4);
          glyphIndex += 1;
        }
        cursor += advance;
      }
    }
    this.labelGeometry.setAttribute("instanceAnchor", new THREE.InstancedBufferAttribute(anchors, 3));
    this.labelGeometry.setAttribute("instanceOffset", new THREE.InstancedBufferAttribute(offsets, 2));
    this.labelGeometry.setAttribute("instanceGlyphSize", new THREE.InstancedBufferAttribute(sizes, 2));
    this.labelGeometry.setAttribute("instanceUvRect", new THREE.InstancedBufferAttribute(uvRects, 4));
    this.labelGeometry.instanceCount = glyphIndex;
    this.renderedLabelCount = visibleLabels.length;
  }

  private clearRegions(): void {
    for (const child of this.regionGroup.children) {
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        continue;
      }
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
      const dust = new THREE.Points(makeProviderDustGeometry(region, color), this.starMaterial);
      dust.frustumCulled = false;
      dust.renderOrder = -1;
      this.regionGroup.add(dust);
      if (variation === "nebula-rings" || variation === "nebula") {
        const haze = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          makeProviderNebulaMaterial(color, region.provider),
        );
        haze.position.set(region.x, -region.y, -182);
        haze.scale.set(region.radiusX * 1.12, region.radiusY * 1.12, 1);
        haze.renderOrder = -2;
        this.regionGroup.add(haze);
      }
      if (variation === "nebula-rings" || variation === "rings") {
        const streams = new THREE.LineSegments(
          makeProviderStreamGeometry(region),
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.5,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: false,
          }),
        );
        streams.renderOrder = -1;
        this.regionGroup.add(streams);
      }
    }
  }

  private syncEdges(galaxyScene: IdentityGalaxyScene): void {
    const contextualEdges = compileIdentityGalaxyContextEdgeIndices(galaxyScene);
    const edgeCount = contextualEdges.length / 2;
    const sources = new Float32Array(edgeCount * 3);
    const targets = new Float32Array(edgeCount * 3);
    let edgeIndex = 0;
    for (let edgeOffset = 0; edgeOffset < contextualEdges.length; edgeOffset += 2) {
      const sourceOffset = contextualEdges[edgeOffset]! * 3;
      const targetOffset = contextualEdges[edgeOffset + 1]! * 3;
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
    this.labelRecords = [];
    this.labelSignature = "";
    this.renderedLabelCount = 0;
    this.labelGeometry.instanceCount = 0;
    this.glyphAtlas = null;
  }

  private syncLabels(
    atlas: IdentityGraphAtlas,
    galaxyScene: IdentityGalaxyScene,
    palette: GraphPalette,
    quality: IdentityGraphAtlasQuality,
  ): void {
    if (quality === "interactive") return;
    this.ensureSceneIndex(galaxyScene);
    const smallViewport = this.width < 720;
    const cap = smallViewport ? 24 : 96;
    const records = atlas.labels.slice(0, cap).map((label): GalaxyLabelRecord => {
      const fontSize = label.kind === "provider_cluster"
        ? smallViewport ? 16 : 19
        : label.kind === "friend_person"
          ? smallViewport ? 14 : 16
          : label.kind === "connection_person"
            ? smallViewport ? 13 : 15
            : smallViewport ? 12 : 13;
      const nodeIndex = this.nodeIndexById.get(label.nodeId);
      const nodeDepth = nodeIndex === undefined
        ? label.kind === "provider_cluster" ? -38 : 0
        : galaxyScene.positions[nodeIndex * 3 + 2]! + 6;
      const starRadius = nodeIndex === undefined
        ? 5
        : galaxyScene.pointSizes[nodeIndex]! * 0.5;
      const nodeX = nodeIndex === undefined
        ? label.x
        : galaxyScene.positions[nodeIndex * 3]!;
      const nodeY = nodeIndex === undefined
        ? -label.y
        : galaxyScene.positions[nodeIndex * 3 + 1]!;
      return {
        id: label.id,
        text: truncateGalaxyLabel(label.text),
        fontSize,
        offsetY: starRadius + fontSize * 0.68 + (label.kind === "provider_cluster" ? 4 : 3),
        position: new THREE.Vector3(nodeX, nodeY, nodeDepth),
      };
    });
    const signature = [
      palette.fontFamily,
      ...records.map((label) => [
        label.id,
        label.text,
        label.fontSize,
        label.position.x.toFixed(2),
        label.position.y.toFixed(2),
        label.position.z.toFixed(2),
      ].join(":")),
    ].join("|");
    if (signature !== this.labelSignature) {
      const nextGlyphAtlas = buildGlyphAtlas(records, palette.fontFamily);
      this.labelTexture.dispose();
      this.labelTexture = nextGlyphAtlas.texture;
      this.glyphAtlas = nextGlyphAtlas;
      this.labelMaterial.uniforms.atlas.value = this.labelTexture;
      this.labelMaterial.uniforms.atlasTexel.value.copy(nextGlyphAtlas.texelSize);
      this.labelRecords = records;
      this.labelSignature = signature;
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
  private variation: IdentityGalaxyVariation = "nebula";
  private fallbackLabelCount = 0;
  private fallbackReadyLabelCount = 0;

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
    return this.renderer?.labelCount ?? this.fallbackLabelCount;
  }

  get readyLabelCount(): number {
    return this.renderer?.readyLabelCount ?? this.fallbackReadyLabelCount;
  }

  get edgeCount(): number {
    if (this.renderer) return this.renderer.edgeCount;
    return this.scene ? compileIdentityGalaxyContextEdgeIndices(this.scene).length / 2 : 0;
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
    this.variation = options.variation;
    if (!this.renderer && options.quality === "settled") {
      this.fallbackLabelCount = Math.min(atlas.labels.length, this.canvas.clientWidth < 720 ? 24 : 72);
    }
    this.renderer?.syncScene(atlas, scene, palette, options.variation, options.quality);
  }

  updateInteraction(
    scene: IdentityGalaxyScene,
    selectedPersonId: string | null | undefined,
    selectedAccountId: string | null | undefined,
  ): void {
    this.scene = scene;
    this.selectedPersonId = selectedPersonId;
    this.selectedAccountId = selectedAccountId;
    if (this.renderer && this.palette) {
      this.renderer.updateInteraction(scene, this.palette);
    }
  }

  render(transform: ViewTransform): void {
    if (this.renderer) {
      this.renderer.render(transform);
      return;
    }
    if (!this.atlas || !this.scene || !this.palette) return;
    this.fallbackReadyLabelCount = drawFallbackStarfield(
      this.canvas,
      this.atlas,
      this.scene,
      transform,
      this.palette,
      this.selectedPersonId,
      this.selectedAccountId,
      this.variation,
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
    this.fallbackLabelCount = 0;
    this.fallbackReadyLabelCount = 0;
    fallbackStarfieldBackgrounds.delete(this.canvas);
  }
}
