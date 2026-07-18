import * as THREE from "three/webgpu";
import { instancedBufferAttribute } from "three/tsl";
import { identityGalaxyCameraPose } from "../../src/lib/identity-galaxy-camera.js";
import type {
  GalaxyLabBackend,
  GalaxyLabBackendMetrics,
} from "./backend.js";
import { hexToRgb } from "./backend.js";
import {
  galaxyLabSemanticColor,
  type GalaxyLabFixture,
  type GalaxyLabPalette,
  type GalaxyLabTransform,
} from "./scene-fixture.js";

interface GalaxySpriteBatch {
  sprite: THREE.Sprite;
  material: THREE.PointsNodeMaterial;
  texture: THREE.CanvasTexture;
  colorAttribute: THREE.InstancedBufferAttribute;
}

function adapterLabel(adapter: GPUAdapter): string {
  const info = adapter.info;
  return [info.vendor, info.architecture, info.device, info.description]
    .filter((value): value is string => Boolean(value))
    .join(" ") || "WebGPU adapter";
}

function paletteLuminance(palette: GalaxyLabPalette): number {
  const [red, green, blue] = hexToRgb(palette.background);
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
  return { sprite, material, texture, colorAttribute };
}

export class ThreeWebGpuBackend implements GalaxyLabBackend {
  readonly id = "three-webgpu" as const;
  private renderer: THREE.WebGPURenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 20_000);
  private fixture: GalaxyLabFixture | null = null;
  private semanticBatch: GalaxySpriteBatch | null = null;
  private backgroundBatch: GalaxySpriteBatch | null = null;
  private semanticColors: Float32Array | null = null;
  private backgroundColors: Float32Array | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private drawCalls = 0;
  private bufferUploadCount = 0;
  private adapterDescription: string | null = null;

  async initialize(
    canvas: HTMLCanvasElement,
    fixture: GalaxyLabFixture,
    palette: GalaxyLabPalette,
  ): Promise<void> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable in this browser.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter was available.");
    const device = await adapter.requestDevice();
    this.adapterDescription = adapterLabel(adapter);
    this.fixture = fixture;
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      device,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(palette.background, 1);
    await this.renderer.init();

    const semanticSizes = new Float32Array(fixture.scene.pointSizes.length);
    for (let index = 0; index < semanticSizes.length; index += 1) {
      semanticSizes[index] = Math.max(3.5, fixture.scene.pointSizes[index]! * 0.34);
    }
    const backgroundSizes = new Float32Array(fixture.backgroundStarCount);
    for (let index = 0; index < backgroundSizes.length; index += 1) {
      backgroundSizes[index] = 0.42 + fixture.backgroundBrightness[index]! * 1.08;
    }
    this.semanticColors = new Float32Array(fixture.scene.nodeIds.length * 3);
    this.backgroundColors = new Float32Array(fixture.backgroundStarCount * 3);
    this.writePalette(palette);
    this.semanticBatch = makeSpriteBatch(
      fixture.scene.positions,
      semanticSizes,
      this.semanticColors,
      0.94,
    );
    this.backgroundBatch = makeSpriteBatch(
      fixture.backgroundPositions,
      backgroundSizes,
      this.backgroundColors,
      0.62,
    );
    this.scene.add(this.backgroundBatch.sprite, this.semanticBatch.sprite);
    this.applyMaterialOpacity(palette);
    this.bufferUploadCount = 2;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.renderer) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = Math.min(2, Math.max(1, pixelRatio));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  setPalette(palette: GalaxyLabPalette): void {
    if (!this.renderer || !this.fixture || !this.semanticColors || !this.backgroundColors) return;
    this.renderer.setClearColor(palette.background, 1);
    this.applyMaterialOpacity(palette);
    this.writePalette(palette);
    if (this.semanticBatch) this.semanticBatch.colorAttribute.needsUpdate = true;
    if (this.backgroundBatch) this.backgroundBatch.colorAttribute.needsUpdate = true;
    this.bufferUploadCount += 2;
  }

  render(transform: GalaxyLabTransform, _timeMs: number): void {
    if (!this.renderer) return;
    const pose = identityGalaxyCameraPose(transform, this.width, this.height, this.camera.fov);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    this.renderer.render(this.scene, this.camera);
    this.drawCalls = this.renderer.info.render.drawCalls;
  }

  metrics(): GalaxyLabBackendMetrics {
    return {
      id: this.id,
      label: "Three.js WebGPU",
      api: "Three.js WebGPU",
      semanticStarCount: this.fixture?.scene.nodeIds.length ?? 0,
      decorativeStarCount: this.fixture?.backgroundStarCount ?? 0,
      drawCalls: this.drawCalls,
      bufferUploadCount: this.bufferUploadCount,
      fallbackReason: null,
      adapterDescription: this.adapterDescription,
    };
  }

  dispose(): void {
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
    this.renderer?.dispose();
    this.renderer = null;
    this.fixture = null;
    this.semanticBatch = null;
    this.backgroundBatch = null;
    this.semanticColors = null;
    this.backgroundColors = null;
  }

  private writePalette(palette: GalaxyLabPalette): void {
    if (!this.fixture || !this.semanticColors || !this.backgroundColors) return;
    for (let index = 0; index < this.fixture.scene.nodeIds.length; index += 1) {
      const [red, green, blue] = hexToRgb(galaxyLabSemanticColor(this.fixture, palette, index));
      const brightness = this.fixture.scene.brightness[index]!;
      const offset = index * 3;
      this.semanticColors[offset] = red * brightness;
      this.semanticColors[offset + 1] = green * brightness;
      this.semanticColors[offset + 2] = blue * brightness;
    }
    const [red, green, blue] = hexToRgb(palette.mutedText);
    for (let index = 0; index < this.fixture.backgroundStarCount; index += 1) {
      const brightness = this.fixture.backgroundBrightness[index]! * 0.72;
      const offset = index * 3;
      this.backgroundColors[offset] = red * brightness;
      this.backgroundColors[offset + 1] = green * brightness;
      this.backgroundColors[offset + 2] = blue * brightness;
    }
  }

  private applyMaterialOpacity(palette: GalaxyLabPalette): void {
    const lightSurface = paletteLuminance(palette) > 0.58;
    if (this.semanticBatch) this.semanticBatch.material.opacity = lightSurface ? 0.86 : 0.96;
    if (this.backgroundBatch) this.backgroundBatch.material.opacity = lightSurface ? 0.2 : 0.48;
  }
}
