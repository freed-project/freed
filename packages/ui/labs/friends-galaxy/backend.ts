import type { FriendsGalaxyFieldStyle } from "../../src/lib/friends-galaxy-provider-fields.js";
import type { FriendsGalaxyInteraction } from "../../src/lib/friends-galaxy-scene-index.js";
import type {
  FriendsGalaxyRendererBackend,
  FriendsGalaxyRendererId,
  FriendsGalaxyRendererMetrics,
  FriendsGalaxyViewDetail,
} from "../../src/lib/friends-galaxy-renderer.js";

export type GalaxyLabBackendId = FriendsGalaxyRendererId;
export type GalaxyLabViewDetail = FriendsGalaxyViewDetail;
export type GalaxyLabFieldStyle = FriendsGalaxyFieldStyle;
export type GalaxyLabBackendMetrics = FriendsGalaxyRendererMetrics;
export type GalaxyLabInteraction = FriendsGalaxyInteraction;
export type GalaxyLabBackend = FriendsGalaxyRendererBackend;
