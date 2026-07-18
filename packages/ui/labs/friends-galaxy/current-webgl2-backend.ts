import { IdentityGalaxyEngine } from "../../src/lib/identity-galaxy-engine.js";
import type {
  GalaxyLabBackend,
  GalaxyLabBackendMetrics,
} from "./backend.js";
import { hexToRgb } from "./backend.js";
import type {
  GalaxyLabFixture,
  GalaxyLabPalette,
  GalaxyLabTransform,
} from "./scene-fixture.js";

function cssRgb(value: string): string {
  return hexToRgb(value).map((part) => Math.round(part * 255)).join(" ");
}

function applyPalette(element: HTMLElement, palette: GalaxyLabPalette): void {
  element.style.setProperty("--theme-shell-rgb", cssRgb(palette.background));
  element.style.setProperty("--theme-accent-primary-rgb", cssRgb(palette.friend));
  element.style.setProperty("--theme-accent-secondary-rgb", cssRgb(palette.selection));
  element.style.setProperty("--theme-accent-tertiary-rgb", cssRgb(palette.account));
  element.style.setProperty("--theme-text-primary", palette.text);
  element.style.setProperty("--theme-text-muted", palette.mutedText);
  element.style.fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif";
}

export class CurrentWebGl2Backend implements GalaxyLabBackend {
  readonly id = "current-webgl2" as const;
  private engine: IdentityGalaxyEngine | null = null;
  private fixture: GalaxyLabFixture | null = null;
  private paletteElement: HTMLElement | null = null;
  private decorativeStarCount = 0;
  private bufferUploadCount = 0;
  private adapterDescription: string | null = null;
  private fallbackReason: string | null = null;
  private compactViewport: boolean | null = null;

  async initialize(
    canvas: HTMLCanvasElement,
    fixture: GalaxyLabFixture,
    palette: GalaxyLabPalette,
  ): Promise<void> {
    this.fixture = fixture;
    this.paletteElement = canvas.parentElement ?? document.documentElement;
    applyPalette(this.paletteElement, palette);
    this.engine = new IdentityGalaxyEngine(canvas, this.paletteElement);
    this.fallbackReason = this.engine.rendererType === "canvas-starfield-fallback"
      ? "WebGL2 is unavailable, so the production canvas fallback is active."
      : null;
    const context = canvas.getContext("webgl2");
    if (context) {
      this.adapterDescription = String(context.getParameter(context.RENDERER) ?? "WebGL2 adapter");
    }
    this.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
  }

  resize(width: number, height: number, _pixelRatio: number): void {
    if (!this.engine || !this.fixture) return;
    this.engine.resize(width, height);
    const compactViewport = width <= 720 || height <= 620;
    if (compactViewport === this.compactViewport) return;
    this.compactViewport = compactViewport;
    this.decorativeStarCount = compactViewport ? 7_000 : 12_000;
    this.syncScene();
  }

  setPalette(palette: GalaxyLabPalette): void {
    if (!this.paletteElement) return;
    applyPalette(this.paletteElement, palette);
    this.syncScene();
  }

  render(transform: GalaxyLabTransform, _timeMs: number): void {
    this.engine?.render(transform);
  }

  metrics(): GalaxyLabBackendMetrics {
    return {
      id: this.id,
      label: "Current production engine",
      api: this.engine?.rendererType === "canvas-starfield-fallback"
        ? "Canvas 2D fallback"
        : "Three.js WebGL2",
      semanticStarCount: this.fixture?.scene.nodeIds.length ?? 0,
      decorativeStarCount: this.decorativeStarCount,
      drawCalls: null,
      bufferUploadCount: this.bufferUploadCount,
      fallbackReason: this.fallbackReason,
      adapterDescription: this.adapterDescription,
    };
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
    this.fixture = null;
    this.paletteElement = null;
  }

  private syncScene(): void {
    if (!this.engine || !this.fixture) return;
    this.engine.syncScene(this.fixture.atlas, this.fixture.scene, {
      variation: "nebula",
      quality: "settled",
    });
    this.bufferUploadCount += 1;
  }
}
