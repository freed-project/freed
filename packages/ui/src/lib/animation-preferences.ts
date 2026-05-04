import type { AnimationIntensity } from "@freed/shared";

export const DEFAULT_ANIMATION_INTENSITY: AnimationIntensity = "detailed";

export function resolveAnimationIntensity(value: unknown): AnimationIntensity {
  return value === "none" || value === "light" || value === "detailed"
    ? value
    : DEFAULT_ANIMATION_INTENSITY;
}

export function applyAnimationIntensityToDocument(intensity: AnimationIntensity): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.animation = resolveAnimationIntensity(intensity);
}

export function getDocumentAnimationIntensity(): AnimationIntensity {
  if (typeof document === "undefined") return DEFAULT_ANIMATION_INTENSITY;
  return resolveAnimationIntensity(document.documentElement.dataset.animation);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function shouldEliminateMotion(): boolean {
  return getDocumentAnimationIntensity() === "none" || prefersReducedMotion();
}

export function animationAwareScrollBehavior(
  requested: ScrollBehavior = "smooth",
): "auto" | "smooth" {
  if (shouldEliminateMotion()) return "auto";
  return requested === "smooth" ? "smooth" : "auto";
}
