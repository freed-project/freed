export function shouldContinueGalaxyLabFrame(
  animationEnabled: boolean,
  rendererDirty: boolean,
  settlePending: boolean,
  presentationVisible = true,
): boolean {
  return presentationVisible &&
    (animationEnabled || rendererDirty || settlePending);
}
