/**
 * lib/descent/testing/autopilot.ts
 * ────────────────────────────────
 * A steering bot that follows the course centreline — the "hands-off" rider
 * the sim tests and the e2e smoke run use. Steers toward a point a little way
 * ahead along the line and eases off when the skis already point there.
 */

import { pointAtArcLength, type ArcPoint } from "@/lib/game/terrain/real-course";
import type { InputState, RiderState, Course } from "../types";

const scratch: ArcPoint = { x: 0, y: 0, z: 0, heading: 0 };

export function autopilot(state: RiderState, course: Course, input: InputState, lookaheadM = 28): void {
  const target = pointAtArcLength(course.run.points, Math.min(course.lengthM, state.progressM + lookaheadM), scratch);
  const wanted = Math.atan2(target.x - state.x, target.z - state.z);
  let delta = wanted - state.yaw;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  // Positive yaw is a left turn, so a positive delta needs a negative (left) steer.
  input.steer = Math.max(-1, Math.min(1, -delta * 1.8));
  input.tuck = Math.abs(delta) < 0.25;
  input.brake = Math.abs(delta) > 1.1 && state.speed > 12;
}
