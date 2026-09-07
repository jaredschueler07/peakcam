import assert from "node:assert/strict";
import { test } from "node:test";
import { compareSurface } from "../testing/surface-comparison";
import { localSnowSurface, simulationConfig } from "../core/config";
import { FIXED_DT } from "../core/clock";
import { V2_MODEL } from "./integrator-v2";
import { normal } from "./integrator-core";

for (const rider of ["skier", "snowboarder"] as const) test(`${rider}: powder scrubs speed, groomers grip, ice slides and brakes longer`, () => {
  const powder = compareSurface("powder", rider), packed = compareSurface("packed", rider), ice = compareSurface("ice", rider);
  assert.ok(powder.coastKmh < packed.coastKmh * .7);
  assert.ok(ice.brakingMetres > packed.brakingMetres * 2);
  assert.ok(ice.lateralAfterHalfSecond > packed.lateralAfterHalfSecond * 4);
  assert.ok(packed.turnDegrees > ice.turnDegrees * 2);
});
test("live snow follows groomed corridors and shaded ice while chosen Free Ride surfaces stay fixed", () => {
  const cfg = simulationConfig("powder", "v2", { powderDepthCm: 40, windSpeedMps: 0, morningIce: true, northSign: 1, visibilityM: 20000 });
  assert.equal(localSnowSurface(cfg, 0, .2), "powder");
  assert.equal(localSnowSurface(cfg, 1, -.2), "packed");
  assert.equal(localSnowSurface(cfg, 1, .2), "ice");
  assert.equal(localSnowSurface(simulationConfig("slush", "v2"), 1, .2), "slush");
});
test("starting assist crosses shallow wrinkles but never motors uphill or reverses the brake", () => {
  const cfg = simulationConfig("packed", "v2");
  const ctx = { steer: 0, tuck: 0, brake: 0, dt: FIXED_DT, flatSpeed: .2, forwardVelocity: -.2, rightVelocity: 0 };
  normal.y = Math.cos(5 * Math.PI / 180);
  assert.ok(V2_MODEL.groundDrive!(cfg, ctx, -.2, 0) > -.2);
  normal.y = Math.cos(20 * Math.PI / 180);
  assert.equal(V2_MODEL.groundDrive!(cfg, ctx, -.2, 0), -.2);
  ctx.brake = 1;
  assert.equal(V2_MODEL.groundDrive!(cfg, ctx, .001, 1), 0);
  assert.equal(V2_MODEL.groundDrive!(cfg, ctx, -.001, 1), -0);
});
