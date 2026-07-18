import type {
  GalaxyLabBackend,
  GalaxyLabBackendMetrics,
  GalaxyLabInteraction,
  GalaxyLabViewDetail,
} from "./backend.js";
import { hexToRgb } from "./backend.js";
import { writeGalaxyLabWebGpuViewProjection } from "./camera-math.js";
import {
  createGalaxyLabLabelAtlas,
  GALAXY_LAB_LABEL_INSTANCE_STRIDE,
  type GalaxyLabLabelAtlas,
} from "./billboard-labels.js";
import {
  galaxyLabSemanticColor,
  type GalaxyLabFixture,
  type GalaxyLabPalette,
  type GalaxyLabTransform,
} from "./scene-fixture.js";
import {
  GalaxyLabSceneIndex,
  type GalaxyLabInteractionRole,
  type GalaxyLabInteractionState,
} from "./scene-index.js";

const INSTANCE_FLOATS = 8;
const INSTANCE_STRIDE = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const EDGE_INSTANCE_FLOATS = 10;
const EDGE_INSTANCE_STRIDE = EDGE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const MAX_CONTEXTUAL_EDGES = 16;

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

const EDGE_SHADER = /* wgsl */ `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  time: f32,
  pixelRatio: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) source: vec3<f32>,
  @location(1) destination: vec3<f32>,
  @location(2) color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) along: f32,
};

@vertex
fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  let sourceClip = uniforms.viewProjection * vec4<f32>(input.source, 1.0);
  let targetClip = uniforms.viewProjection * vec4<f32>(input.destination, 1.0);
  let screenDelta = (targetClip.xy / targetClip.w - sourceClip.xy / sourceClip.w) * uniforms.viewport;
  let safeLength = max(length(screenDelta), 0.001);
  let normal = vec2<f32>(-screenDelta.y, screenDelta.x) / safeLength;
  var along = 0.0;
  var side = -1.0;
  if (vertexIndex == 1u || vertexIndex == 2u || vertexIndex == 4u) {
    side = 1.0;
  }
  if (vertexIndex == 2u || vertexIndex == 4u || vertexIndex == 5u) {
    along = 1.0;
  }
  var clip = mix(sourceClip, targetClip, along);
  let width = 1.8;
  clip = vec4<f32>(clip.xy + normal * side * width * 2.0 / uniforms.viewport * clip.w, clip.zw);
  output.position = clip;
  output.color = input.color;
  output.along = along;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let endpointFade = smoothstep(0.0, 0.08, input.along) * smoothstep(0.0, 0.08, 1.0 - input.along);
  return vec4<f32>(input.color.rgb, input.color.a * (0.74 + endpointFade * 0.26));
}
`;

const LABEL_SHADER = /* wgsl */ `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  time: f32,
  pixelRatio: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var labelAtlas: texture_2d<f32>;
@group(0) @binding(2) var labelSampler: sampler;

struct VertexInput {
  @location(0) corner: vec2<f32>,
  @location(1) anchor: vec3<f32>,
  @location(2) offset: vec2<f32>,
  @location(3) size: vec2<f32>,
  @location(4) uvRect: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  var clip = uniforms.viewProjection * vec4<f32>(input.anchor, 1.0);
  let pixelPosition = input.offset + input.corner * input.size * 0.5;
  clip = vec4<f32>(clip.xy + pixelPosition * 2.0 / uniforms.viewport * clip.w, clip.zw);
  let localUv = vec2<f32>(input.corner.x * 0.5 + 0.5, 0.5 - input.corner.y * 0.5);
  output.position = clip;
  output.uv = mix(input.uvRect.xy, input.uvRect.zw, localUv);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let sample = textureSample(labelAtlas, labelSampler, input.uv);
  if (sample.a < 0.015) {
    discard;
  }
  return sample;
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
  private edgePipeline: GPURenderPipeline | null = null;
  private edgeBindGroup: GPUBindGroup | null = null;
  private labelPipeline: GPURenderPipeline | null = null;
  private labelBindGroup: GPUBindGroup | null = null;
  private quadBuffer: GPUBuffer | null = null;
  private semanticBuffer: GPUBuffer | null = null;
  private backgroundBuffer: GPUBuffer | null = null;
  private edgeBuffer: GPUBuffer | null = null;
  private labelBuffer: GPUBuffer | null = null;
  private labelTexture: GPUTexture | null = null;
  private labelSampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private fixture: GalaxyLabFixture | null = null;
  private sceneIndex: GalaxyLabSceneIndex | null = null;
  private semanticData: Float32Array | null = null;
  private backgroundData: Float32Array | null = null;
  private edgeData = new Float32Array(MAX_CONTEXTUAL_EDGES * EDGE_INSTANCE_FLOATS);
  private labelAtlas: GalaxyLabLabelAtlas | null = null;
  private palette: GalaxyLabPalette | null = null;
  private interaction: GalaxyLabInteraction = { selectedNodeId: null, hoveredNodeId: null };
  private touchedInteractionIndices = new Set<number>();
  private readonly interactionScratch = new Float32Array(INSTANCE_FLOATS);
  private interactionColor: readonly [number, number, number] = [1, 1, 1];
  private readonly viewProjection = new Float32Array(16);
  private readonly uniformData = new Float32Array(20);
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private format: GPUTextureFormat | null = null;
  private compactLabels: boolean | null = null;
  private viewDetail: GalaxyLabViewDetail = "overview";
  private contextualEdgeCount = 0;
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
    this.sceneIndex = new GalaxyLabSceneIndex(fixture);
    this.palette = palette;
    this.interactionColor = hexToRgb(palette.selection);
    this.adapterDescription = adapterLabel(adapter);
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: this.format,
      alphaMode: "premultiplied",
    });

    const semanticSizes = new Float32Array(fixture.scene.nodeIds.length);
    for (let index = 0; index < semanticSizes.length; index += 1) {
      semanticSizes[index] = Math.max(4.5, fixture.scene.pointSizes[index]! * 0.42);
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
    this.bufferUploadCount = 2;
    this.edgeBuffer = createBuffer(
      device,
      this.edgeData,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
    this.bufferUploadCount += 1;
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
    const edgeShaderModule = device.createShaderModule({ code: EDGE_SHADER });
    this.edgePipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: {
        module: edgeShaderModule,
        entryPoint: "vertexMain",
        buffers: [{
          arrayStride: EDGE_INSTANCE_STRIDE,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module: edgeShaderModule,
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
    this.edgeBindGroup = device.createBindGroup({
      layout: this.edgePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    const labelShaderModule = device.createShaderModule({ code: LABEL_SHADER });
    this.labelPipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: {
        module: labelShaderModule,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          },
          {
            arrayStride: GALAXY_LAB_LABEL_INSTANCE_STRIDE,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 1, offset: 0, format: "float32x3" },
              { shaderLocation: 2, offset: 12, format: "float32x2" },
              { shaderLocation: 3, offset: 20, format: "float32x2" },
              { shaderLocation: 4, offset: 28, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: {
        module: labelShaderModule,
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
    this.labelSampler = device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.rebuildLabels(canvas.clientWidth < 720);
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
    const compactLabels = this.width < 720;
    if (compactLabels !== this.compactLabels) this.rebuildLabels(compactLabels);
  }

  setPalette(palette: GalaxyLabPalette): void {
    if (!this.device || !this.semanticBuffer || !this.backgroundBuffer) return;
    this.palette = palette;
    this.interactionColor = hexToRgb(palette.selection);
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
    this.rebuildLabels(this.compactLabels ?? this.width < 720);
    if (this.sceneIndex) this.writeInteraction(this.sceneIndex.interactionState(this.interaction));
  }

  setViewDetail(detail: GalaxyLabViewDetail): void {
    if (detail === this.viewDetail) return;
    this.viewDetail = detail;
    this.rebuildLabels(this.compactLabels ?? this.width < 720);
  }

  pickNode(viewportX: number, viewportY: number): string | null {
    if (!this.sceneIndex) return null;
    return this.sceneIndex.pickNode(
      this.viewProjection,
      this.width,
      this.height,
      viewportX,
      viewportY,
      "zero-to-one",
    );
  }

  setInteraction(interaction: GalaxyLabInteraction): void {
    this.interaction = interaction;
    if (!this.sceneIndex) return;
    this.writeInteraction(this.sceneIndex.interactionState(interaction));
  }

  render(transform: GalaxyLabTransform, timeMs: number): void {
    if (
      !this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer ||
      !this.quadBuffer || !this.semanticBuffer || !this.backgroundBuffer || !this.fixture
    ) return;
    writeGalaxyLabWebGpuViewProjection(
      this.viewProjection,
      transform,
      this.width,
      this.height,
    );
    this.uniformData.set(this.viewProjection, 0);
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
    if (
      this.contextualEdgeCount > 0 && this.edgePipeline && this.edgeBindGroup && this.edgeBuffer
    ) {
      pass.setPipeline(this.edgePipeline);
      pass.setBindGroup(0, this.edgeBindGroup);
      pass.setVertexBuffer(0, this.edgeBuffer);
      pass.draw(6, this.contextualEdgeCount);
    }
    if (
      this.labelAtlas && this.labelAtlas.labels.length > 0 && this.labelPipeline &&
      this.labelBindGroup && this.labelBuffer
    ) {
      pass.setPipeline(this.labelPipeline);
      pass.setBindGroup(0, this.labelBindGroup);
      pass.setVertexBuffer(0, this.quadBuffer);
      pass.setVertexBuffer(1, this.labelBuffer);
      pass.draw(6, this.labelAtlas.labels.length);
    }
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
      drawCalls: 2 + (this.labelAtlas && this.labelAtlas.labels.length > 0 ? 1 : 0) +
        (this.contextualEdgeCount > 0 ? 1 : 0),
      labelCount: this.labelAtlas?.labels.length ?? 0,
      contextualEdgeCount: this.contextualEdgeCount,
      bufferUploadCount: this.bufferUploadCount,
      fallbackReason: this.fallbackReason,
      adapterDescription: this.adapterDescription,
    };
  }

  dispose(): void {
    this.quadBuffer?.destroy();
    this.semanticBuffer?.destroy();
    this.backgroundBuffer?.destroy();
    this.edgeBuffer?.destroy();
    this.labelBuffer?.destroy();
    this.labelTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.device?.destroy();
    this.canvas = null;
    this.context = null;
    this.adapter = null;
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.edgePipeline = null;
    this.edgeBindGroup = null;
    this.labelPipeline = null;
    this.labelBindGroup = null;
    this.quadBuffer = null;
    this.semanticBuffer = null;
    this.backgroundBuffer = null;
    this.edgeBuffer = null;
    this.labelBuffer = null;
    this.labelTexture = null;
    this.labelSampler = null;
    this.uniformBuffer = null;
    this.fixture = null;
    this.sceneIndex = null;
    this.semanticData = null;
    this.backgroundData = null;
    this.labelAtlas = null;
    this.palette = null;
    this.touchedInteractionIndices.clear();
    this.contextualEdgeCount = 0;
  }

  private rebuildLabels(compact: boolean): void {
    if (
      !this.device || !this.fixture || !this.palette || !this.labelPipeline ||
      !this.uniformBuffer || !this.labelSampler
    ) return;
    this.compactLabels = compact;
    const atlas = createGalaxyLabLabelAtlas(
      this.fixture,
      this.palette,
      compact,
      this.viewDetail,
    );
    this.labelBuffer?.destroy();
    this.labelTexture?.destroy();
    this.labelBuffer = createBuffer(
      this.device,
      atlas.instanceData,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
    this.labelTexture = this.device.createTexture({
      size: [atlas.canvas.width, atlas.canvas.height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: atlas.canvas },
      { texture: this.labelTexture },
      [atlas.canvas.width, atlas.canvas.height],
    );
    this.labelBindGroup = this.device.createBindGroup({
      layout: this.labelPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.labelTexture.createView() },
        { binding: 2, resource: this.labelSampler },
      ],
    });
    this.labelAtlas = atlas;
    this.bufferUploadCount += 2;
  }

  private writeInteraction(state: GalaxyLabInteractionState): void {
    if (!this.device || !this.semanticBuffer || !this.semanticData || !this.fixture) return;
    const nextTouched = new Set(state.roles.keys());
    const changedIndices = new Set([...this.touchedInteractionIndices, ...nextTouched]);
    for (const index of changedIndices) {
      this.writeSemanticInteraction(index, state.roles.get(index) ?? null);
    }
    this.touchedInteractionIndices = nextTouched;
    this.writeContextEdges(state.contextualEdgeIndices);
  }

  private writeSemanticInteraction(index: number, role: GalaxyLabInteractionRole | null): void {
    if (!this.device || !this.semanticBuffer || !this.semanticData) return;
    const sourceOffset = index * INSTANCE_FLOATS;
    this.interactionScratch.set(this.semanticData.subarray(sourceOffset, sourceOffset + INSTANCE_FLOATS));
    if (role) {
      const sizeScale = role === "selected" ? 1.58 : role === "hovered" ? 1.36 : 1.16;
      const colorMix = role === "linked" ? 0.62 : 1;
      this.interactionScratch[3] *= sizeScale;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = this.interactionScratch[4 + channel]!;
        const selected = this.interactionColor[channel]!;
        this.interactionScratch[4 + channel] = base * (1 - colorMix) + selected * colorMix;
      }
      this.interactionScratch[7] = 1;
    }
    this.device.queue.writeBuffer(
      this.semanticBuffer,
      index * INSTANCE_STRIDE,
      this.interactionScratch,
    );
    this.bufferUploadCount += 1;
  }

  private writeContextEdges(edgeIndices: Uint32Array): void {
    if (!this.device || !this.edgeBuffer || !this.fixture) return;
    const edgeCount = Math.min(MAX_CONTEXTUAL_EDGES, edgeIndices.length / 2);
    this.edgeData.fill(0);
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
      const sourceIndex = edgeIndices[edgeIndex * 2]!;
      const targetIndex = edgeIndices[edgeIndex * 2 + 1]!;
      const targetOffset = edgeIndex * EDGE_INSTANCE_FLOATS;
      this.edgeData.set(
        this.fixture.scene.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3),
        targetOffset,
      );
      this.edgeData.set(
        this.fixture.scene.positions.subarray(targetIndex * 3, targetIndex * 3 + 3),
        targetOffset + 3,
      );
      this.edgeData[targetOffset + 6] = this.interactionColor[0];
      this.edgeData[targetOffset + 7] = this.interactionColor[1];
      this.edgeData[targetOffset + 8] = this.interactionColor[2];
      this.edgeData[targetOffset + 9] = 0.82;
    }
    this.contextualEdgeCount = edgeCount;
    if (edgeCount === 0) return;
    this.device.queue.writeBuffer(
      this.edgeBuffer,
      0,
      this.edgeData.buffer as ArrayBuffer,
      this.edgeData.byteOffset,
      edgeCount * EDGE_INSTANCE_STRIDE,
    );
    this.bufferUploadCount += 1;
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
