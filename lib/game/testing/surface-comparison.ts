import { DROP_IN_GAME_PROFILES } from '../config/profiles';
import { FIXED_DT, FIXED_HZ } from '../core/clock';
import { simulationConfig, type SurfaceKind, type RiderMode } from '../core/config';
import { createSimulation } from '../core/simulation';
import type { InputFrame } from '../core/types';
import { createProceduralWorld } from '../terrain/obstacles';
import { integrateSkierV2 } from '../physics/integrator-v2';

/** Controlled slope, normal inputs, no obstacles: measures handling independently of course routing. */
export function compareSurface(surface: SurfaceKind, rider: RiderMode = 'snowboarder') {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  function setup(slope: number, speed: number) {
    const base = createProceduralWorld(profile, 42, simulationConfig(surface, 'v2', undefined, rider));
    const terrain = { ...base.terrain, height: (_x: number, z: number) => -z * slope,
      normal: (_x: number, _z: number, out: { x: number; y: number; z: number }) => {
        out.x = 0; out.y = 1 / Math.hypot(1, slope); out.z = slope / Math.hypot(1, slope); return out;
      } };
    const world = { ...base, terrain };
    const state = createSimulation(profile, 42, terrain);
    state.pos.x = 0; state.pos.y = 0; state.pos.z = 0; state.yaw = 0;
    state.vel.x = 0; state.vel.y = -speed * slope; state.vel.z = speed;
    state.invuln = 1e6;
    return { state, world };
  }
  const frame: InputFrame = { steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false, restartPressed: false, trailPressed: false };
  const coast = setup(Math.tan(15 * Math.PI / 180), 12);
  for (let tick = 0; tick < 8 * FIXED_HZ; tick++) integrateSkierV2(coast.state, frame, FIXED_DT, coast.world);
  const stop = setup(0, 20);
  frame.brake = 1;
  let stopTicks = 0;
  while (Math.hypot(stop.state.vel.x, stop.state.vel.z) > 1 && stopTicks < 20 * FIXED_HZ) {
    integrateSkierV2(stop.state, frame, FIXED_DT, stop.world); stopTicks++;
  }
  const slide = setup(0, 12);
  slide.state.vel.x = 8;
  frame.brake = 0;
  for (let tick = 0; tick < FIXED_HZ / 2; tick++) integrateSkierV2(slide.state, frame, FIXED_DT, slide.world);
  const turn = setup(0, 15);
  frame.steer = .5;
  for (let tick = 0; tick < FIXED_HZ; tick++) integrateSkierV2(turn.state, frame, FIXED_DT, turn.world);
  return { surface, rider, coastKmh: Math.hypot(coast.state.vel.x, coast.state.vel.z) * 3.6,
    brakingMetres: stop.state.pos.z, brakingSeconds: stopTicks * FIXED_DT,
    lateralAfterHalfSecond: slide.state.vel.x,
    turnDegrees: Math.atan2(turn.state.vel.x, turn.state.vel.z) * 180 / Math.PI };
}
