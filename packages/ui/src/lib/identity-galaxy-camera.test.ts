import { describe, expect, it } from "vitest";
import {
  identityGalaxyCameraPose,
  viewportPointToIdentityGalaxyPlane,
} from "./identity-galaxy-camera.js";

describe("identity galaxy camera", () => {
  it("keeps the world point beneath the viewport center while zooming", () => {
    const transform = { x: -120, y: 80, scale: 1.6 };
    const pose = identityGalaxyCameraPose(transform, 1_200, 800);
    const center = viewportPointToIdentityGalaxyPlane(600, 400, transform);

    expect(pose.targetX).toBeCloseTo(center.x);
    expect(pose.targetY).toBeCloseTo(-center.y);
    expect(pose.z).toBeGreaterThan(0);
  });

  it("round trips points between the viewport and galactic plane", () => {
    const transform = { x: 240, y: -90, scale: 0.72 };
    const viewportPoint = { x: 715, y: 412 };
    const planePoint = viewportPointToIdentityGalaxyPlane(
      viewportPoint.x,
      viewportPoint.y,
      transform,
    );

    expect({
      x: planePoint.x * transform.scale + transform.x,
      y: planePoint.y * transform.scale + transform.y,
    }).toEqual(viewportPoint);
  });

  it("moves the camera closer as scale increases", () => {
    const closePose = identityGalaxyCameraPose({ x: 0, y: 0, scale: 2 }, 390, 844);
    const farPose = identityGalaxyCameraPose({ x: 0, y: 0, scale: 0.5 }, 390, 844);
    expect(closePose.z).toBeLessThan(farPose.z);
  });
});
