import type { FriendsGalaxyNodePresentationResolver } from "./friends-galaxy-presentation.js";
import type {
  FriendsGalaxyRendererBackend,
  FriendsGalaxyRendererId,
} from "./friends-galaxy-renderer.js";

export async function createFriendsGalaxyRendererBackend(
  id: FriendsGalaxyRendererId,
  resolvePresentation: FriendsGalaxyNodePresentationResolver,
): Promise<FriendsGalaxyRendererBackend> {
  if (id === "current-webgl2") {
    const { CurrentWebGl2Backend } = await import(
      "./friends-galaxy-current-webgl2-backend.js"
    );
    return new CurrentWebGl2Backend();
  }
  if (id === "three-webgpu") {
    const { ThreeWebGpuBackend } = await import(
      "./friends-galaxy-three-webgpu-backend.js"
    );
    return new ThreeWebGpuBackend(resolvePresentation);
  }
  const { RawWebGpuBackend } = await import(
    "./friends-galaxy-raw-webgpu-backend.js"
  );
  return new RawWebGpuBackend(resolvePresentation);
}
