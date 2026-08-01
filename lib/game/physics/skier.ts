import { createSimulationEvents } from "../core/events";
import type { SimulationState } from "../core/types";

export function createSkierState(): SimulationState {
  return {
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
    onGround: true, airTime: 0, spin: 0, crash: 0, score: 0, best: 0,
    combo: 1, comboTimer: 0, time: 0, startY: 0, carve: 0, lean: 0,
    crouch: 0, jumpCharge: 0, selectedTrail: 0, liftRide: 0, liftFromZ: 0,
    liftToZ: 0, invuln: 0, lastGateZ: -1e9, distance: 0, prevZ: 0,
    prevX: 0, passedGates: new Set(), events: createSimulationEvents(),
  };
}
