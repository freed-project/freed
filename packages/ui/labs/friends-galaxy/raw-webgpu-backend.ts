import { Matrix4, PerspectiveCamera, Vector3 } from "three";
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

const INSTANCE_FLOATS = 8;
const INSTANCE_STRIDE = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

const STAR_SHADER = /* wgsl */ `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  time: f32,
  pixelRatio: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) corner: vec2<f32>,
  @location(1) center: vec3<f32>,
  @location(2) size: f32,
  @location(3) color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) twinkle: f32,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  var clip = uniforms.viewProjection * vec4<f32>(input.center, 1.0);
  let offset = input.corner * input.size * 2.0 / uniforms.viewport;
  clip = vec4<f32>(clip.xy + offset * clip.w, clip.zw);
  output.position = clip;
  output.corner = input.corner;
  output.color = input.color;
  let phase = input.center.x * 0.017 + input.center.y * 0.011 + input.center.z * 0.007;
  output.twinkle = 0.91 + sin(uniforms.time * 1.15 + phase) * 0.09;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let distance = length(input.corner);
  if (distance > 1.0) {
    discard;
  }
  let core = exp(-distance * distance * 10.0);
  let halo = pow(max(0.0, 1.0 - distance), 2.4) * 0.52;
  let alpha = min(1.0, core + halo) * input.color.a * input.twinkle;
  let radiance = 0.72 + core * 0.72;
  return vec4<f32>(input.color.rgb * radiance, alpha);
}
`;

function adapterLabel(adapter: GPUAdapter): string {
  const info = adapter.info;
  return [info.vendor, info.architecture, info.device, info.description]
    .filter((value): value is string => Boolean(value))
    .join(" ") || "WebGPU adapter";
}

function createBuffer(device: GPUDevice, data: Float32Array, usage: GPUBufferUsageFlags): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

function writeInstancePositions(
  target: Float32Array,
  positions: Float32Array,
  sizes: Float32Array,
  alpha: number,
): void {
  const count = positions.length / 3;
  for (let index = 0; index < count; index += 1) {
    const targetOffset = index * INSTANCE_FLOATS;
    const positionOffset = index * 3;
    target[targetOffset] = positions[positionOffset]!;
    target[targetOffset + 1] = positions[positionOffset + 1]!;
    target[targetOffset + 2] = positions[positionOffset + 2]!;
    target[targetOffset + 3] = sizes[index]!;
    target[targetOffset + 7] = alpha;
  }
}

export class RawWebGpuBackend implements GalaxyLabBackend {
  readonly id = "raw-webgpu" as const;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private quadBuffer: GPUBuffer | null = null;
  private semanticBuffer: GPUBuffer | null = null;
  private backgroundBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private fixture: GalaxyLabFixture | null = null;
  private semanticData: Float32Array | null = null;
  private backgroundData: Float32Array | null = null;
  private readonly camera = new PerspectiveCamera(42, 1, 1, 20_000);
  private readonly viewProjection = new Matrix4();
  private readonly cameraTarget = new Vector3();
  private readonly uniformData = new Float32Array(20);
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private format: GPUTextureFormat | null = null;
  private clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 1 };
  private bufferUploadCount = 0;
  private fallbackReason: string | null = null;
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
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("The browser did not provide a WebGPU canvas context.");
    this.canvas = canvas;
    this.context = context;
    this.adapter = adapter;
    this.device = device;
    this.fixture = fixture;
    this.adapterDescription = adapterLabel(adapter);
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: this.format,
      alphaMode: "premultiplied",
    });

    const semanticSizes = new Float32Array(fixture.scene.nodeIds.length);
    for (let index = 0; index < semanticSizes.length; index += 1) {
      semanticSizes[index] = Math.max(3.5, fixture.scene.pointSizes[index]! * 0.34);
    }
    const backgroundSizes = new Float32Array(fixture.backgroundStarCount);
    for (let index = 0; index < backgroundSizes.length; index += 1) {
      backgroundSizes[index] = 0.42 + fixture.backgroundBrightness[index]! * 1.08;
    }
    this.semanticData = new Float32Array(fixture.scene.nodeIds.length * INSTANCE_FLOATS);
    this.backgroundData = new Float32Array(fixture.backgroundStarCount * INSTANCE_FLOATS);
    writeInstancePositions(this.semanticData, fixture.scene.positions, semanticSizes, 0.96);
    writeInstancePositions(this.backgroundData, fixture.backgroundPositions, backgroundSizes, 0.68);
    this.writePalette(palette);

    const quadData = new Float32Array([
      -1, -1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1,
    ]);
    this.quadBuffer = createBuffer(device, quadData, GPUBufferUsage.VERTEX);
    this.semanticBuffer = createBuffer(
      device,
      this.semanticData,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
    this.backgroundBuffer = createBuffer(
      device,
      this.backgroundData,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
    this.uniformBuffer = device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const shaderModule = device.createShaderModule({ code: STAR_SHADER });
    this.pipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          },
          {
            arrayStride: INSTANCE_STRIDE,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 1, offset: 0, format: "float32x3" },
              { shaderLocation: 2, offset: 12, format: "float32" },
              { shaderLocation: 3, offset: 16, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
    });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.bufferUploadCount = 2;
    void device.lost.then((info) => {
      this.fallbackReason = `WebGPU device lost: ${info.reason}. ${info.message}`.trim();
    });
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.canvas) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = Math.min(2, Math.max(1, pixelRatio));
    this.canvas.width = Math.max(1, Math.floor(this.width * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.floor(this.height * this.pixelRatio));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  setPalette(palette: GalaxyLabPalette): void {
    if (!this.device || !this.semanticBuffer || !this.backgroundBuffer) return;
    this.writePalette(palette);
    if (this.semanticData) {
      this.device.queue.writeBuffer(
        this.semanticBuffer,
        0,
        this.semanticData.buffer as ArrayBuffer,
        this.semanticData.byteOffset,
        this.semanticData.byteLength,
      );
    }
    if (this.backgroundData) {
      this.device.queue.writeBuffer(
        this.backgroundBuffer,
        0,
        this.backgroundData.buffer as ArrayBuffer,
        this.backgroundData.byteOffset,
        this.backgroundData.byteLength,
      );
    }
    this.bufferUploadCount += 2;
  }

  render(transform: GalaxyLabTransform, timeMs: number): void {
    if (
      !this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer ||
      !this.quadBuffer || !this.semanticBuffer || !this.backgroundBuffer || !this.fixture
    ) return;
    const pose = identityGalaxyCameraPose(transform, this.width, this.height, this.camera.fov);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.cameraTarget.set(pose.targetX, pose.targetY, pose.targetZ);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.uniformData.set(this.viewProjection.elements, 0);
    this.uniformData[16] = this.width;
    this.uniformData[17] = this.height;
    this.uniformData[18] = timeMs / 1_000;
    this.uniformData[19] = this.pixelRatio;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder({ label: "Friends Galaxy frame" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: this.clearColor,
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.quadBuffer);
    pass.setVertexBuffer(1, this.backgroundBuffer);
    pass.draw(6, this.fixture.backgroundStarCount);
    pass.setVertexBuffer(1, this.semanticBuffer);
    pass.draw(6, this.fixture.scene.nodeIds.length);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  metrics(): GalaxyLabBackendMetrics {
    return {
      id: this.id,
      label: "Raw WebGPU",
      api: "WebGPU WGSL",
      semanticStarCount: this.fixture?.scene.nodeIds.length ?? 0,
      decorativeStarCount: this.fixture?.backgroundStarCount ?? 0,
      drawCalls: 2,
      bufferUploadCount: this.bufferUploadCount,
      fallbackReason: this.fallbackReason,
      adapterDescription: this.adapterDescription,
    };
  }

  dispose(): void {
    this.quadBuffer?.destroy();
    this.semanticBuffer?.destroy();
    this.backgroundBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.device?.destroy();
    this.canvas = null;
    this.context = null;
    this.adapter = null;
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.quadBuffer = null;
    this.semanticBuffer = null;
    this.backgroundBuffer = null;
    this.uniformBuffer = null;
    this.fixture = null;
    this.semanticData = null;
    this.backgroundData = null;
  }

  private writePalette(palette: GalaxyLabPalette): void {
    if (!this.fixture || !this.semanticData || !this.backgroundData) return;
    const [clearRed, clearGreen, clearBlue] = hexToRgb(palette.background);
    this.clearColor = { r: clearRed, g: clearGreen, b: clearBlue, a: 1 };
    const lightSurface = clearRed * 0.2126 + clearGreen * 0.7152 + clearBlue * 0.0722 > 0.58;
    for (let index = 0; index < this.fixture.scene.nodeIds.length; index += 1) {
      const [red, green, blue] = hexToRgb(galaxyLabSemanticColor(this.fixture, palette, index));
      const brightness = this.fixture.scene.brightness[index]!;
      const offset = index * INSTANCE_FLOATS + 4;
      this.semanticData[offset] = red * brightness;
      this.semanticData[offset + 1] = green * brightness;
      this.semanticData[offset + 2] = blue * brightness;
      this.semanticData[offset + 3] = lightSurface ? 0.88 : 0.97;
    }
    const [red, green, blue] = hexToRgb(palette.mutedText);
    for (let index = 0; index < this.fixture.backgroundStarCount; index += 1) {
      const brightness = this.fixture.backgroundBrightness[index]! * 0.72;
      const offset = index * INSTANCE_FLOATS + 4;
      this.backgroundData[offset] = red * brightness;
      this.backgroundData[offset + 1] = green * brightness;
      this.backgroundData[offset + 2] = blue * brightness;
      this.backgroundData[offset + 3] = lightSurface ? 0.2 : 0.5;
    }
  }
}
