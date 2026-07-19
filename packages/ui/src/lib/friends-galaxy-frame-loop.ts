export function shouldContinueFriendsGalaxyFrame(
  ambientMotionEnabled: boolean,
  rendererDirty: boolean,
  settlePending: boolean,
  presentationVisible = true,
): boolean {
  return presentationVisible &&
    (ambientMotionEnabled || rendererDirty || settlePending);
}
