export function shouldContinueGalaxyLabFrame(
  animationEnabled: boolean,
  rendererDirty: boolean,
  settlePending: boolean,
): boolean {
  return animationEnabled || rendererDirty || settlePending;
}
