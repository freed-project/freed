declare module "troika-three-text" {
  import type { ColorRepresentation, Material, Mesh } from "three";

  export class Text extends Mesh {
    text: string;
    font?: string;
    fontSize: number;
    maxWidth?: number;
    lineHeight?: number;
    letterSpacing?: number;
    textAlign?: "left" | "center" | "right" | "justify";
    anchorX?: number | "left" | "center" | "right";
    anchorY?: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
    color?: ColorRepresentation;
    outlineColor?: ColorRepresentation;
    outlineWidth?: number | string;
    fillOpacity?: number;
    material: Material;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
