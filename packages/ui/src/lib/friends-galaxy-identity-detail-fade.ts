import { FriendsGalaxyLabelFade } from "./friends-galaxy-label-fade.js";
import { friendsGalaxyViewDetailForScale } from "./friends-galaxy-renderer.js";

export interface FriendsGalaxyIdentityDetailFadeStep {
  opacity: number;
  targetOpacity: number;
  active: boolean;
  changed: boolean;
}

export function friendsGalaxyIdentityDetailTargetOpacity(scale: number): number {
  return friendsGalaxyViewDetailForScale(scale) === "close" ? 1 : 0;
}
const AVATAR_LAYER = [{ id: "avatars" }];
const VISIBLE = new Set(["avatars"]);
const HIDDEN = new Set<string>();

/** Use the same reversible timeline as labels, never scale-dependent opacity. */
export class FriendsGalaxyIdentityDetailFade {
  private readonly fade = new FriendsGalaxyLabelFade<{ id: string }>();
  private readonly result: FriendsGalaxyIdentityDetailFadeStep = {
    opacity: 0, targetOpacity: 0, active: false, changed: false,
  };
  get currentOpacity(): number { return this.result.opacity; }
  get isActive(): boolean { return this.fade.isActive; }
  restartFromHidden(): void {
    this.fade.clear();
    Object.assign(this.result, { opacity: 0, targetOpacity: 0, active: false, changed: false });
  }
  step(scale: number, timeMs: number, motionEnabled: boolean): FriendsGalaxyIdentityDetailFadeStep {
    const target = friendsGalaxyIdentityDetailTargetOpacity(scale);
    const rows = this.fade.step(AVATAR_LAYER, target ? VISIBLE : HIDDEN, timeMs, motionEnabled);
    const opacity = rows[0]?.opacity ?? 0;
    this.result.changed = opacity !== this.result.opacity;
    this.result.opacity = opacity;
    this.result.targetOpacity = target;
    this.result.active = this.fade.isActive;
    return this.result;
  }
}
