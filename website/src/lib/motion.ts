const HERO_SLOWDOWN = 3.9375;

export function slowHeroMotion(value: number): number {
  return value * HERO_SLOWDOWN;
}

export function slowHeroDelay(value: number): number {
  return value * HERO_SLOWDOWN;
}

export function slowHeroInterval(value: number): number {
  return value * HERO_SLOWDOWN;
}

export function slowHeroSpeed(value: number): number {
  return value / HERO_SLOWDOWN;
}
