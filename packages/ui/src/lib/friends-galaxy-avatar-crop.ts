import type { SampleAvatarFocalPoint } from "@freed/shared";

/** Crop a decoded demo portrait once. The admission cache owns this bounded canvas. */
export function cropDecodedGalaxyAvatar(
  image: CanvasImageSource,
  width: number,
  height: number,
  focal?: SampleAvatarFocalPoint,
): HTMLCanvasElement {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Avatar source has invalid dimensions.");
  }
  const clamp = (value: number | undefined, fallback: number, low: number, high: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
  const x = clamp(focal?.x, 0.5, 0, 1);
  const y = clamp(focal?.y, 0.5, 0, 1);
  const zoom = clamp(focal?.zoom, 1, 1, 4);
  const side = Math.min(width, height) / zoom;
  const left = Math.max(0, Math.min(width - side, width * x - side / 2));
  const top = Math.max(0, Math.min(height - side, height * y - side / 2));
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Avatar crop canvas is unavailable.");
  context.drawImage(image, left, top, side, side, 0, 0, 256, 256);
  return canvas;
}
