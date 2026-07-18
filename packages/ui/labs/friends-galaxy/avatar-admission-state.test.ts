import { describe, expect, it } from "vitest";
import { FriendsGalaxyAvatarAdmissionState } from "../../src/lib/friends-galaxy-avatar-admission.js";

describe("Friends Galaxy retained avatar admission", () => {
  it("reuses an applied admission for the same owner and key", () => {
    const owner = {};
    const state = new FriendsGalaxyAvatarAdmissionState<object>();

    expect(state.begin(owner, "close:wide:none", 1)).toBe("start");
    expect(state.commit(owner, "close:wide:none", 1)).toBe(true);
    expect(state.begin(owner, "close:wide:none", 2)).toBe("applied");
  });

  it("coalesces matching work and advances its accepted generation", () => {
    const owner = {};
    const state = new FriendsGalaxyAvatarAdmissionState<object>();

    expect(state.begin(owner, "close:compact:person:1", 3)).toBe("start");
    expect(state.begin(owner, "close:compact:person:1", 4)).toBe("pending");
    expect(state.canCommit(owner, "close:compact:person:1", 3)).toBe(false);
    expect(state.commit(owner, "close:compact:person:1", 4)).toBe(true);
  });

  it("rejects a stale completion after the active generation changes", () => {
    const owner = {};
    const state = new FriendsGalaxyAvatarAdmissionState<object>();

    state.begin(owner, "close:wide:person:2", 5);

    expect(state.canCommit(owner, "close:wide:person:2", 6)).toBe(false);
    expect(state.discard(owner, "close:wide:person:2")).toBe(true);
    expect(state.begin(owner, "close:wide:person:2", 6)).toBe("start");
  });

  it("does not let superseded work discard a newer request", () => {
    const firstOwner = {};
    const secondOwner = {};
    const state = new FriendsGalaxyAvatarAdmissionState<object>();

    state.begin(firstOwner, "close:wide:person:3", 7);
    state.begin(secondOwner, "close:wide:person:3", 8);

    expect(state.discard(firstOwner, "close:wide:person:3")).toBe(false);
    expect(state.commit(secondOwner, "close:wide:person:3", 8)).toBe(true);
  });

  it("releases applied and pending owners during backend replacement", () => {
    const appliedOwner = {};
    const pendingOwner = {};
    const state = new FriendsGalaxyAvatarAdmissionState<object>();
    state.begin(appliedOwner, "hidden", 9);
    state.commit(appliedOwner, "hidden", 9);
    state.begin(pendingOwner, "close:wide:person:4", 10);

    state.reset();

    expect(state.begin(appliedOwner, "hidden", 11)).toBe("start");
    expect(state.canCommit(pendingOwner, "close:wide:person:4", 10)).toBe(false);
  });
});
