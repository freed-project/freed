import type {
  GalaxyLabBackend,
  GalaxyLabBackendMetrics,
  GalaxyLabFieldStyle,
  GalaxyLabInteraction,
  GalaxyLabViewDetail,
} from "./backend.js";
import { galaxyLabRenderPixelRatio, hexToRgb } from "./backend.js";
import type { GalaxyActivityScenePatchBatch } from "./activity-scene-patches.js";
import { GalaxyLabBackendHealth } from "./backend-health.js";
import {
  createGalaxyLabAvatarAtlas,
  type GalaxyLabAvatarAtlas,
} from "./avatar-atlas.js";
import { writeGalaxyLabWebGpuViewProjection } from "./camera-math.js";
import {
  createGalaxyLabLabelAtlas,
  GALAXY_LAB_BILLBOARD_INSTANCE_STRIDE,
  type GalaxyLabLabelAtlas,
} from "./billboard-labels.js";
import {
  type GalaxyLabFixture,
  type GalaxyLabPalette,
  type GalaxyLabTransform,
} from "./scene-fixture.js";
import {
  GALAXY_LAB_STAR_INSTANCE_FLOATS,
  GALAXY_LAB_STAR_PALETTE_ROLE_COUNT,
  GalaxyLabStarColorRole,
} from "./star-instance-data.js";
import {
  GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT,
  GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET,
  writeGalaxyLabStarPaletteUniforms,
} from "./star-palette.js";
import {
  createGalaxyLabProviderFields,
  GALAXY_LAB_PROVIDER_FIELD_INSTANCE_STRIDE,
  type GalaxyLabProviderFields,
} from "./provider-fields.js";
import {
  GalaxyLabSceneIndex,
  type GalaxyLabInteractionRole,
  type GalaxyLabInteractionState,
} from "./scene-index.js";

const INSTANCE_FLOATS = GALAXY_LAB_STAR_INSTANCE_FLOATS;
const INSTANCE_STRIDE = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const EDGE_INSTANCE_FLOATS = 10;
const EDGE_INSTANCE_STRIDE = EDGE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const MAX_CONTEXTUAL_EDGES = 16;

const PROVIDER_FIELD_SHADER = /* wgsl */ `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  time: f32,
  cameraScale: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) corner: vec2<f32>,
  @location(1) center: vec3<f32>,
  @location(2) halfSize: vec2<f32>,
  @location(3) color: vec4<f32>,
  @location(4) parameters: vec3<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) parameters: vec3<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let world = input.center + vec3<f32>(input.corner * input.halfSize, 0.0);
  output.position = uniforms.viewProjection * vec4<f32>(world, 1.0);
  output.local = input.corner;
  output.color = input.color;
  output.parameters = input.parameters;
  return output;
}

fn hash21(point: vec2<f32>) -> f32 {
  var value = fract(point * vec2<f32>(123.34, 456.21));
  value += dot(value, value + 45.32);
  return fract(value.x * value.y);
}

fn noise(point: vec2<f32>) -> f32 {
  let cell = floor(point);
  var local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash21(cell), hash21(cell + vec2<f32>(1.0, 0.0)), local.x),
    mix(hash21(cell + vec2<f32>(0.0, 1.0)), hash21(cell + vec2<f32>(1.0, 1.0)), local.x),
    local.y,
  );
}

fn fbm(pointInput: vec2<f32>) -> f32 {
  var point = pointInput;
  var value = 0.0;
  var amplitude = 0.54;
  for (var octave = 0; octave < 4; octave += 1) {
    value += noise(point) * amplitude;
    point = point * 2.03 + vec2<f32>(11.7, 7.9);
    amplitude *= 0.48;
  }
  return value;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let seed = input.parameters.x;
  let arms = input.parameters.y;
  let style = input.parameters.z;
  let point = input.local;
  let drift = vec2<f32>(uniforms.time * 0.0024, -uniforms.time * 0.0017);
  let warp = vec2<f32>(
    fbm(point * 1.72 + vec2<f32>(seed * 9.1, seed * 4.3) + drift),
    fbm(point * 1.72 + vec2<f32>(seed * 5.7 + 19.4, seed * 11.3) - drift),
  ) - 0.5;
  let warpedPoint = point + warp * 0.36;
  let radius = length(warpedPoint);
  let angle = atan2(warpedPoint.y, warpedPoint.x);
  let boundaryNoise = fbm(warpedPoint * 2.08 + vec2<f32>(seed * 17.0, seed * 7.0));
  let edgeRadius = radius + (boundaryNoise - 0.5) * 0.3 +
    sin(angle * 3.0 + seed * 19.0) * 0.035;
  let envelope = 1.0 - smoothstep(0.48, 1.07, edgeRadius);

  let cloudLow = fbm(warpedPoint * 2.52 + vec2<f32>(seed * 23.0, seed * 31.0));
  let cloudHigh = fbm(
    (warpedPoint + warp * 0.18) * 5.1 + vec2<f32>(seed * 37.0, seed * 13.0),
  );
  let cloud = smoothstep(0.32, 0.82, cloudLow * 0.7 + cloudHigh * 0.3);
  let wisps = smoothstep(
    0.52,
    0.84,
    fbm(warpedPoint * 6.3 + vec2<f32>(seed * 43.0, seed * 29.0)),
  );
  let core = 1.0 - smoothstep(0.02, 0.52, radius);
  let nebula = envelope *
    (pow(cloud, 1.28) * 0.74 + wisps * 0.13 + core * 0.13) *
    (0.64 + boundaryNoise * 0.36);

  let armFade = smoothstep(0.18, 0.48, radius) *
    (1.0 - smoothstep(0.82, 1.08, radius));
  let armPhase = angle * arms - radius * 9.2 + seed * 6.28318 + warp.x * 3.2;
  let secondaryPhase = angle * (arms + 1.0) - radius * 12.8 + seed * 11.0 - warp.y * 2.4;
  let primaryArm = smoothstep(0.63, 0.94, 0.5 + 0.5 * cos(armPhase));
  let secondaryArm = smoothstep(0.76, 0.97, 0.5 + 0.5 * cos(secondaryPhase));
  let streamBreakup = smoothstep(
    0.34,
    0.82,
    fbm(warpedPoint * 3.8 + vec2<f32>(seed * 53.0, seed * 41.0)),
  );
  let streams = envelope * armFade *
    (primaryArm * 0.76 + secondaryArm * 0.24) *
    (0.24 + streamBreakup * 0.76);

  var density = nebula * 0.62;
  if (style > 1.5) {
    density = nebula * 0.52 + streams * 0.42;
  } else if (style > 0.5) {
    density = streams * 0.7 + nebula * 0.1;
  }

  let detailFade = mix(1.0, 0.22, smoothstep(0.24, 1.2, uniforms.cameraScale));
  let alpha = clamp(
    density * input.color.a * 0.82 * detailFade,
    0.0,
    0.28,
  );
  if (alpha < 0.004) {
    discard;
  }
  let darkTheme = step(0.24, input.color.a);
  var fieldColor = mix(input.color.rgb * 0.68, input.color.rgb, cloud * 0.62 + core * 0.12);
  fieldColor = mix(
    fieldColor,
    vec3<f32>(1.0),
    cloudHigh * mix(0.035, 0.16, darkTheme),
  );
  return vec4<f32>(fieldColor, alpha);
}
`;

const STAR_SHADER = /* wgsl */ `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  time: f32,
  pixelRatio: f32,
  starColors: array<vec4<f32>, ${String(GALAXY_LAB_STAR_PALETTE_ROLE_COUNT)}>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) corner: vec2<f32>,
  @location(1) center: vec3<f32>,
  @location(2) size: f32,
  @location(3) appearance: vec4<f32>,
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
  let role = u32(clamp(round(input.appearance.y), 0.0, ${String(GalaxyLabStarColorRole.Selection)}.0));
  let baseColor = uniforms.starColors[role];
  let selectionColor = uniforms.starColors[${String(GalaxyLabStarColorRole.Selection)}u];
  output.color = vec4<f32>(
    mix(baseColor.rgb, selectionColor.rgb, input.appearance.z) * input.appearance.x,
    mix(baseColor.a, selectionColor.a, input.appearance.z) * input.appearance.w,
  );
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

export class RawWebGpuBackend implements GalaxyLabBackend {
  readonly id = "raw-webgpu" as const;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private providerFieldPipeline: GPURenderPipeline | null = null;
  private providerFieldBindGroup: GPUBindGroup | null = null;
  private staticRenderBundle: GPURenderBundle | null = null;
  private readonly staticRenderBundles: GPURenderBundle[] = [];
  private edgePipeline: GPURenderPipeline | null = null;
  private edgeBindGroup: GPUBindGroup | null = null;
  private labelPipeline: GPURenderPipeline | null = null;
  private labelBindGroup: GPUBindGroup | null = null;
  private avatarBindGroup: GPUBindGroup | null = null;
  private quadBuffer: GPUBuffer | null = null;
  private semanticBuffer: GPUBuffer | null = null;
  private backgroundBuffer: GPUBuffer | null = null;
  private providerFieldBuffer: GPUBuffer | null = null;
  private edgeBuffer: GPUBuffer | null = null;
  private labelBuffer: GPUBuffer | null = null;
  private labelTexture: GPUTexture | null = null;
  private avatarBuffer: GPUBuffer | null = null;
  private avatarTexture: GPUTexture | null = null;
  private labelSampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private fixture: GalaxyLabFixture | null = null;
  private sceneIndex: GalaxyLabSceneIndex | null = null;
  private semanticData: Float32Array | null = null;
  private backgroundData: Float32Array | null = null;
  private activitySizeScales: Float32Array | null = null;
  private activityBrightnessScales: Float32Array | null = null;
  private providerFields: GalaxyLabProviderFields | null = null;
  private edgeData = new Float32Array(MAX_CONTEXTUAL_EDGES * EDGE_INSTANCE_FLOATS);
  private labelAtlas: GalaxyLabLabelAtlas | null = null;
  private avatarAtlas: GalaxyLabAvatarAtlas | null = null;
  private avatarImages: ReadonlyMap<string, CanvasImageSource> = new Map();
  private palette: GalaxyLabPalette | null = null;
  private interaction: GalaxyLabInteraction = { selectedNodeId: null, hoveredNodeId: null };
  private readonly touchedInteractionIndices = new Set<number>();
  private readonly changedInteractionIndices = new Set<number>();
  private interactionRoles: ReadonlyMap<number, GalaxyLabInteractionRole> = new Map();
  private readonly interactionScratch = new Float32Array(INSTANCE_FLOATS);
  private interactionColor: readonly [number, number, number] = [1, 1, 1];
  private readonly viewProjection = new Float32Array(16);
  private readonly uniformData = new Float32Array(
    GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT,
  );
  private colorAttachment: GPURenderPassColorAttachment | null = null;
  private renderPassDescriptor: GPURenderPassDescriptor | null = null;
  private readonly commandBuffers: GPUCommandBuffer[] = [];
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private format: GPUTextureFormat | null = null;
  private compactLabels: boolean | null = null;
  private viewDetail: GalaxyLabViewDetail = "overview";
  private fieldStyle: GalaxyLabFieldStyle = "nebula";
  private contextualEdgeCount = 0;
  private appliedActivityNodeCount = 0;
  private clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 1 };
  private bufferUploadCount = 0;
  private residentStarUploadCount = 0;
  private fallbackReason: string | null = null;
  private adapterDescription: string | null = null;
  private readonly backendHealth = new GalaxyLabBackendHealth();
  private disposed = false;

  async initialize(
    canvas: HTMLCanvasElement,
    fixture: GalaxyLabFixture,
    palette: GalaxyLabPalette,
  ): Promise<void> {
    this.disposed = false;
    this.backendHealth.clear();
    this.fallbackReason = null;
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

    this.semanticData = fixture.packedStarInstances.semantic;
    this.backgroundData = fixture.packedStarInstances.background;
    this.activitySizeScales = new Float32Array(fixture.scene.nodeIds.length);
    this.activitySizeScales.fill(1);
    this.activityBrightnessScales = new Float32Array(fixture.scene.nodeIds.length);
    this.activityBrightnessScales.fill(1);
    this.writePaletteUniforms(palette);

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
    this.residentStarUploadCount = 2;
    this.providerFields = createGalaxyLabProviderFields(fixture, palette, this.fieldStyle);
    this.providerFieldBuffer = createBuffer(
      device,
      this.providerFields.instanceData,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
    this.bufferUploadCount = 3;
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
    const providerFieldShaderModule = device.createShaderModule({ code: PROVIDER_FIELD_SHADER });
    this.providerFieldPipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: {
        module: providerFieldShaderModule,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          },
          {
            arrayStride: GALAXY_LAB_PROVIDER_FIELD_INSTANCE_STRIDE,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 1, offset: 0, format: "float32x3" },
              { shaderLocation: 2, offset: 12, format: "float32x2" },
              { shaderLocation: 3, offset: 20, format: "float32x4" },
              { shaderLocation: 4, offset: 36, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: {
        module: providerFieldShaderModule,
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
    this.providerFieldBindGroup = device.createBindGroup({
      layout: this.providerFieldPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
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
            arrayStride: GALAXY_LAB_BILLBOARD_INSTANCE_STRIDE,
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
    this.rebuildStaticRenderBundle();
    this.colorAttachment = {
      view: context.getCurrentTexture().createView(),
      clearValue: this.clearColor,
      loadOp: "clear",
      storeOp: "store",
    };
    this.renderPassDescriptor = {
      label: "Friends Galaxy render pass",
      colorAttachments: [this.colorAttachment],
    };
    this.rebuildLabels(canvas.clientWidth < 720);
    this.rebuildAvatars(canvas.clientWidth < 720);
    void device.lost.then((info) => {
      if (this.disposed || this.device !== device) return;
      const detail = info.message.trim();
      const reason = `Raw WebGPU device lost (${info.reason})${detail ? `: ${detail}` : "."}`;
      this.fallbackReason = reason;
      this.backendHealth.reportFatalError(reason);
    });
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.canvas) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = galaxyLabRenderPixelRatio(pixelRatio, this.width, false);
    this.canvas.width = Math.max(1, Math.floor(this.width * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.floor(this.height * this.pixelRatio));
    const compactLabels = this.width < 720;
    if (compactLabels !== this.compactLabels) {
      this.rebuildLabels(compactLabels);
      this.rebuildAvatars(compactLabels);
    }
  }

  setPalette(palette: GalaxyLabPalette): void {
    if (!this.device || !this.semanticBuffer || !this.backgroundBuffer) return;
    this.palette = palette;
    this.interactionColor = hexToRgb(palette.selection);
    this.writePaletteUniforms(palette);
    this.writeProviderFields();
    this.rebuildLabels(this.compactLabels ?? this.width < 720);
    this.rebuildAvatars(this.compactLabels ?? this.width < 720);
    if (this.sceneIndex) this.writeInteraction(this.sceneIndex.interactionState(this.interaction));
  }

  setFieldStyle(style: GalaxyLabFieldStyle): void {
    if (style === this.fieldStyle) return;
    this.fieldStyle = style;
    this.writeProviderFields();
  }

  applyActivityPatches(patches: GalaxyActivityScenePatchBatch): void {
    if (
      !this.device || !this.semanticBuffer || !this.semanticData || !this.fixture ||
      !this.activitySizeScales || !this.activityBrightnessScales
    ) return;
    const patchCount = patches.nodeIndices.length;
    if (
      patches.sizeScales.length !== patchCount ||
      patches.brightnessScales.length !== patchCount
    ) {
      throw new Error("A Friends Galaxy GPU activity patch has mismatched typed-array lengths.");
    }
    for (let patchIndex = 0; patchIndex < patchCount; patchIndex += 1) {
      const nodeIndex = patches.nodeIndices[patchIndex]!;
      if (nodeIndex >= this.fixture.scene.nodeIds.length) {
        throw new Error(
          `Friends Galaxy activity node ${nodeIndex.toLocaleString()} is outside the resident scene.`,
        );
      }
      this.activitySizeScales[nodeIndex] = patches.sizeScales[patchIndex]!;
      this.activityBrightnessScales[nodeIndex] = patches.brightnessScales[patchIndex]!;
      this.writeSemanticBase(nodeIndex);
      this.writeSemanticInteraction(nodeIndex, this.interactionRoles.get(nodeIndex) ?? null);
      this.appliedActivityNodeCount += 1;
    }
  }

  setAvatarImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.avatarImages = images;
    if (this.viewDetail === "close") {
      this.rebuildAvatars(this.compactLabels ?? this.width < 720);
    }
  }

  setViewDetail(detail: GalaxyLabViewDetail): void {
    if (detail === this.viewDetail) return;
    this.viewDetail = detail;
    this.rebuildLabels(this.compactLabels ?? this.width < 720);
    this.rebuildAvatars(this.compactLabels ?? this.width < 720);
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
    const selectionChanged = interaction.selectedNodeId !== this.interaction.selectedNodeId;
    this.interaction = interaction;
    if (!this.sceneIndex) return;
    this.writeInteraction(this.sceneIndex.interactionState(interaction));
    if (selectionChanged && this.viewDetail === "close") {
      this.rebuildLabels(this.compactLabels ?? this.width < 720);
      this.rebuildAvatars(this.compactLabels ?? this.width < 720);
    }
  }

  render(transform: GalaxyLabTransform, timeMs: number): void {
    if (
      !this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer ||
      !this.quadBuffer || !this.semanticBuffer || !this.backgroundBuffer || !this.fixture ||
      !this.staticRenderBundle || !this.colorAttachment || !this.renderPassDescriptor
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
    this.uniformData[19] = transform.scale;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder({ label: "Friends Galaxy frame" });
    this.colorAttachment.view = this.context.getCurrentTexture().createView();
    this.colorAttachment.clearValue = this.clearColor;
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.executeBundles(this.staticRenderBundles);
    if (
      this.contextualEdgeCount > 0 && this.edgePipeline && this.edgeBindGroup && this.edgeBuffer
    ) {
      pass.setPipeline(this.edgePipeline);
      pass.setBindGroup(0, this.edgeBindGroup);
      pass.setVertexBuffer(0, this.edgeBuffer);
      pass.draw(6, this.contextualEdgeCount);
    }
    if (
      this.avatarAtlas && this.avatarAtlas.itemCount > 0 && this.labelPipeline &&
      this.avatarBindGroup && this.avatarBuffer
    ) {
      pass.setPipeline(this.labelPipeline);
      pass.setBindGroup(0, this.avatarBindGroup);
      pass.setVertexBuffer(0, this.quadBuffer);
      pass.setVertexBuffer(1, this.avatarBuffer);
      pass.draw(6, this.avatarAtlas.itemCount);
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
    this.commandBuffers[0] = encoder.finish();
    this.device.queue.submit(this.commandBuffers);
  }

  takeFatalError(): string | null {
    return this.backendHealth.takeFatalError();
  }

  simulateDeviceLoss(): void {
    this.device?.destroy();
  }

  metrics(): GalaxyLabBackendMetrics {
    return {
      id: this.id,
      label: "Raw WebGPU",
      api: "WebGPU WGSL",
      semanticStarCount: this.fixture?.scene.nodeIds.length ?? 0,
      decorativeStarCount: this.fixture?.backgroundStarCount ?? 0,
      drawCalls: 2 + (this.providerFields && this.providerFields.count > 0 ? 1 : 0) +
        (this.labelAtlas && this.labelAtlas.labels.length > 0 ? 1 : 0) +
        (this.avatarAtlas && this.avatarAtlas.itemCount > 0 ? 1 : 0) +
        (this.contextualEdgeCount > 0 ? 1 : 0),
      labelCount: this.labelAtlas?.labels.length ?? 0,
      avatarCount: this.avatarAtlas?.itemCount ?? 0,
      contextualEdgeCount: this.contextualEdgeCount,
      bufferUploadCount: this.bufferUploadCount,
      residentStarUploadCount: this.residentStarUploadCount,
      appliedActivityNodeCount: this.appliedActivityNodeCount,
      pickCandidateCount: this.sceneIndex?.lastPickCandidateCount,
      pickSourceNodeCount: this.sceneIndex?.pickSourceNodeCount,
      renderPixelRatio: this.pixelRatio,
      trackedGpuDataBytes: this.trackedGpuDataBytes(),
      submissionMode: "Pre-recorded world bundle",
      fallbackReason: this.fallbackReason,
      adapterDescription: this.adapterDescription,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.backendHealth.clear();
    this.quadBuffer?.destroy();
    this.semanticBuffer?.destroy();
    this.backgroundBuffer?.destroy();
    this.providerFieldBuffer?.destroy();
    this.edgeBuffer?.destroy();
    this.labelBuffer?.destroy();
    this.labelTexture?.destroy();
    this.avatarBuffer?.destroy();
    this.avatarTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.device?.destroy();
    this.canvas = null;
    this.context = null;
    this.adapter = null;
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.providerFieldPipeline = null;
    this.providerFieldBindGroup = null;
    this.staticRenderBundle = null;
    this.staticRenderBundles.length = 0;
    this.edgePipeline = null;
    this.edgeBindGroup = null;
    this.labelPipeline = null;
    this.labelBindGroup = null;
    this.avatarBindGroup = null;
    this.quadBuffer = null;
    this.semanticBuffer = null;
    this.backgroundBuffer = null;
    this.providerFieldBuffer = null;
    this.edgeBuffer = null;
    this.labelBuffer = null;
    this.labelTexture = null;
    this.avatarBuffer = null;
    this.avatarTexture = null;
    this.labelSampler = null;
    this.uniformBuffer = null;
    this.colorAttachment = null;
    this.renderPassDescriptor = null;
    this.commandBuffers.length = 0;
    this.fixture = null;
    this.sceneIndex = null;
    this.semanticData = null;
    this.backgroundData = null;
    this.activitySizeScales = null;
    this.activityBrightnessScales = null;
    this.providerFields = null;
    this.labelAtlas = null;
    this.avatarAtlas = null;
    this.avatarImages = new Map();
    this.palette = null;
    this.touchedInteractionIndices.clear();
    this.changedInteractionIndices.clear();
    this.interactionRoles = new Map();
    this.contextualEdgeCount = 0;
    this.appliedActivityNodeCount = 0;
    this.residentStarUploadCount = 0;
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
      this.interaction.selectedNodeId,
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

  private trackedGpuDataBytes(): number {
    let bytes = 12 * Float32Array.BYTES_PER_ELEMENT;
    bytes += this.uniformData.byteLength;
    bytes += this.edgeData.byteLength;
    bytes += this.semanticData?.byteLength ?? 0;
    bytes += this.backgroundData?.byteLength ?? 0;
    bytes += this.providerFields?.instanceData.byteLength ?? 0;
    if (this.labelAtlas && this.labelTexture) {
      bytes += this.labelAtlas.instanceData.byteLength;
      bytes += this.labelAtlas.canvas.width * this.labelAtlas.canvas.height * 4;
    }
    if (this.avatarAtlas && this.avatarTexture) {
      bytes += this.avatarAtlas.instanceData.byteLength;
      bytes += this.avatarAtlas.canvas.width * this.avatarAtlas.canvas.height * 4;
    }
    return bytes;
  }

  private rebuildAvatars(compact: boolean): void {
    if (
      !this.device || !this.fixture || !this.palette || !this.labelPipeline ||
      !this.uniformBuffer || !this.labelSampler
    ) return;
    this.avatarBuffer?.destroy();
    this.avatarTexture?.destroy();
    this.avatarBuffer = null;
    this.avatarTexture = null;
    this.avatarBindGroup = null;
    const atlas = createGalaxyLabAvatarAtlas(
      this.fixture,
      this.palette,
      this.interaction.selectedNodeId,
      compact,
      this.viewDetail,
      this.avatarImages,
    );
    this.avatarAtlas = atlas;
    if (atlas.itemCount === 0) return;
    this.avatarBuffer = createBuffer(
      this.device,
      atlas.instanceData,
      GPUBufferUsage.VERTEX,
    );
    this.avatarTexture = this.device.createTexture({
      size: [atlas.canvas.width, atlas.canvas.height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: atlas.canvas },
      { texture: this.avatarTexture },
      [atlas.canvas.width, atlas.canvas.height],
    );
    this.avatarBindGroup = this.device.createBindGroup({
      layout: this.labelPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.avatarTexture.createView() },
        { binding: 2, resource: this.labelSampler },
      ],
    });
    this.bufferUploadCount += 2;
  }

  private writeInteraction(state: GalaxyLabInteractionState): void {
    if (!this.device || !this.semanticBuffer || !this.semanticData || !this.fixture) return;
    this.interactionRoles = state.roles;
    this.changedInteractionIndices.clear();
    for (const index of this.touchedInteractionIndices) this.changedInteractionIndices.add(index);
    for (const index of state.roles.keys()) this.changedInteractionIndices.add(index);
    for (const index of this.changedInteractionIndices) {
      this.writeSemanticInteraction(index, state.roles.get(index) ?? null);
    }
    this.touchedInteractionIndices.clear();
    for (const index of state.roles.keys()) this.touchedInteractionIndices.add(index);
    this.writeContextEdges(state.contextualEdgeIndices, state.contextualEdgeCount);
  }

  private writeSemanticInteraction(index: number, role: GalaxyLabInteractionRole | null): void {
    if (!this.device || !this.semanticBuffer || !this.semanticData) return;
    const sourceOffset = index * INSTANCE_FLOATS;
    for (let component = 0; component < INSTANCE_FLOATS; component += 1) {
      this.interactionScratch[component] = this.semanticData[sourceOffset + component]!;
    }
    if (role) {
      const sizeScale = role === "selected" ? 1.58 : role === "hovered" ? 1.36 : 1.16;
      const colorMix = role === "linked" ? 0.62 : 1;
      this.interactionScratch[3] *= sizeScale;
      this.interactionScratch[6] = colorMix;
      this.interactionScratch[7] = 1;
    }
    this.device.queue.writeBuffer(
      this.semanticBuffer,
      index * INSTANCE_STRIDE,
      this.interactionScratch,
    );
    this.bufferUploadCount += 1;
  }

  private writeContextEdges(edgeIndices: Uint32Array, activeEdgeCount: number): void {
    if (!this.device || !this.edgeBuffer || !this.fixture) return;
    const edgeCount = Math.min(MAX_CONTEXTUAL_EDGES, activeEdgeCount);
    this.edgeData.fill(0);
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
      const sourceIndex = edgeIndices[edgeIndex * 2]!;
      const targetIndex = edgeIndices[edgeIndex * 2 + 1]!;
      const targetOffset = edgeIndex * EDGE_INSTANCE_FLOATS;
      const sourceOffset = sourceIndex * 3;
      const linkedOffset = targetIndex * 3;
      this.edgeData[targetOffset] = this.fixture.scene.positions[sourceOffset]!;
      this.edgeData[targetOffset + 1] = this.fixture.scene.positions[sourceOffset + 1]!;
      this.edgeData[targetOffset + 2] = this.fixture.scene.positions[sourceOffset + 2]!;
      this.edgeData[targetOffset + 3] = this.fixture.scene.positions[linkedOffset]!;
      this.edgeData[targetOffset + 4] = this.fixture.scene.positions[linkedOffset + 1]!;
      this.edgeData[targetOffset + 5] = this.fixture.scene.positions[linkedOffset + 2]!;
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

  private writeProviderFields(): void {
    if (!this.device || !this.providerFieldBuffer || !this.fixture || !this.palette) return;
    this.providerFields = createGalaxyLabProviderFields(
      this.fixture,
      this.palette,
      this.fieldStyle,
    );
    this.device.queue.writeBuffer(
      this.providerFieldBuffer,
      0,
      this.providerFields.instanceData.buffer as ArrayBuffer,
      this.providerFields.instanceData.byteOffset,
      this.providerFields.instanceData.byteLength,
    );
    this.bufferUploadCount += 1;
  }

  private writeSemanticBase(index: number): void {
    if (
      !this.fixture || !this.semanticData ||
      !this.activitySizeScales || !this.activityBrightnessScales
    ) return;
    const sourceOffset = index * INSTANCE_FLOATS;
    const brightness = Math.min(
      1.18,
      this.fixture.scene.brightness[index]! * this.activityBrightnessScales[index]!,
    );
    this.semanticData[sourceOffset + 3] = Math.max(
      4.5,
      this.fixture.scene.pointSizes[index]! * 0.42 * this.activitySizeScales[index]!,
    );
    this.semanticData[sourceOffset + 4] = brightness;
  }

  private rebuildStaticRenderBundle(): void {
    if (
      !this.device || !this.format || !this.providerFieldPipeline ||
      !this.providerFieldBindGroup || !this.providerFieldBuffer || !this.providerFields ||
      !this.pipeline || !this.bindGroup || !this.quadBuffer || !this.backgroundBuffer ||
      !this.semanticBuffer || !this.fixture
    ) return;
    const encoder = this.device.createRenderBundleEncoder({
      label: "Friends Galaxy static world bundle",
      colorFormats: [this.format],
    });
    encoder.setPipeline(this.providerFieldPipeline);
    encoder.setBindGroup(0, this.providerFieldBindGroup);
    encoder.setVertexBuffer(0, this.quadBuffer);
    encoder.setVertexBuffer(1, this.providerFieldBuffer);
    encoder.draw(6, this.providerFields.count);
    encoder.setPipeline(this.pipeline);
    encoder.setBindGroup(0, this.bindGroup);
    encoder.setVertexBuffer(0, this.quadBuffer);
    encoder.setVertexBuffer(1, this.backgroundBuffer);
    encoder.draw(6, this.fixture.backgroundStarCount);
    encoder.setVertexBuffer(1, this.semanticBuffer);
    encoder.draw(6, this.fixture.scene.nodeIds.length);
    this.staticRenderBundle = encoder.finish();
    this.staticRenderBundles[0] = this.staticRenderBundle;
  }

  private writePaletteUniforms(palette: GalaxyLabPalette): void {
    const { clearColor } = writeGalaxyLabStarPaletteUniforms(this.uniformData, palette);
    this.clearColor = { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: 1 };
  }
}
