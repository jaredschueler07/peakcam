/**
 * lib/descent/sim/rider.ts
 * ────────────────────────
 * The rider simulation. One fixed 120 Hz step, no allocation on the hot path,
 * deterministic for a given (world, course, input stream).
 *
 * ## The model
 *
 * The rider is a point mass on a height field with a *ski axis* (`yaw`). On
 * snow, velocity is split into forward (along the skis) and lateral
 * components. Lateral speed is bled off by edge grip each step, and most of
 * what is bled is handed back to the forward component — that "carve
 * conservation" is what makes a turn feel like a swoop instead of a scrub. The
 * skis also relax toward the direction of travel, so a skid recovers on its
 * own and steering never fights the physics.
 *
 * Braking lowers grip and adds pivot: the classic power smear. Tucking drops
 * aerodynamic drag. Holding Space crouches and charges a pop; a convex lip
 * throws the rider at speed without any input. In the air, steer spins,
 * tuck / brake flip, and the four grab keys hold a grab. Landing more than a
 * tolerance off-axis, or too hard, crashes: a short tumble that keeps the
 * momentum sliding, then the rider stands back up. Trees crash on contact.
 */

import { prepareLiftPath, sampleLiftPath, type LiftPath, type LiftSample } from "@/lib/game/core/lifts";
import { createNearestRun, type NearestRun } from "@/lib/game/terrain/real-heightfield";
import { nearestPointOnRun, type NearestRunPoint } from "@/lib/game/terrain/real-course";
import { nearestJunction } from "@/lib/game/terrain/junctions";
import {
  clearRiderEvents, createRiderEvents, treeCellKey,
  type Course, type CrashReason, type GrabKind, type InputState, type RiderMode, type RiderState, type SnowboardStance, type SurfaceKind, type World, type WorldLift,
} from "../types";
import * as T from "./tuning";

const TAU = Math.PI * 2;

function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

/** Exponential approach: how much of the gap to close in `dt` at rate `lambda`. */
function damp(a: number, b: number, lambda: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

export function createRiderState(mode: RiderMode = "skier", stance: SnowboardStance = "regular"): RiderState {
  return {
    mode, stance,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, travelYaw: 0, edge: 0, crouch: 0, charge: 0, braking: false, tucking: false, held: false,
    onGround: true, airTime: 0, groundTime: 0, speed: 0, grade: 0, nx: 0, ny: 1, nz: 0, groundY: 0,
    spin: 0, spinVel: 0, flip: 0, flipVel: 0, grab: null, grabTime: 0,
    crash: 0, crashReason: null, crashCount: 0,
    surface: "packed", onTrail: false, nearRunIndex: -1, nearRunName: null, corridor: 0,
    courseIndex: 0, progressM: 0, progress: 0, lastGate: -1, finished: false, finishTime: 0,
    checkpoint: { x: 0, y: 0, z: 0, yaw: 0, gate: -1, progressM: 0 },
    liftIndex: -1, liftDistanceM: 0, liftSeat: { x: 0, y: 0, z: 0, heading: 0 },
    style: 0, combo: 1, comboTimer: 0, bestTrick: null,
    time: 0, runTime: 0, distance: 0, carveDistance: 0, startY: 0, verticalM: 0, stride: 0,
    events: createRiderEvents(),
  };
}

export interface RiderSim {
  readonly state: RiderState;
  readonly world: World;
  course: Course;
  /** Put the rider at the course start gate, standing still. */
  resetToStart(): void;
  /** Put the rider back at the last checkpoint. */
  resetToCheckpoint(): void;
  /** Select a different course and reset to its start. */
  setCourse(index: number): void;
  step(input: InputState, dt: number): void;
  /** The lift the rider is standing at, or null. */
  boardableLift(): WorldLift | null;
}

interface Scratch {
  normal: { x: number; y: number; z: number };
  nearest: NearestRun;
  nearestCourse: NearestRunPoint;
  liftSample: LiftSample;
}

export interface RiderSimOptions {
  riderMode?: RiderMode;
  stance?: SnowboardStance;
}

export function createRiderSim(world: World, courseIndex: number, options: RiderSimOptions = {}): RiderSim {
  const state = createRiderState(options.riderMode ?? "skier", options.stance ?? "regular");
  const kit = T.KITS[state.mode];
  const terrain = world.terrain;
  const scratch: Scratch = {
    normal: { x: 0, y: 1, z: 0 },
    nearest: createNearestRun(),
    nearestCourse: { distance: 0, progressM: 0, x: 0, z: 0 },
    liftSample: { x: 0, y: 0, z: 0, heading: 0 },
  };
  const liftPaths = new Map<number, LiftPath>();
  const heightAt = (x: number, z: number) => terrain.height(x, z);
  let invuln = 0;
  let liftCooldown = 0;
  let pendingAirStyle = 0;
  let pendingLabels: string[] = [];
  // Flips need a fresh press in the air: a tuck carried off a roller is not a front flip.
  let tuckArmed = false;
  let brakeArmed = false;
  // Lateral velocity created by turning the skis (as opposed to gravity or a skid).
  let carveW = 0;
  let lastJunctionId: string | null = null;

  const sim: RiderSim = {
    state,
    world,
    course: world.courses[courseIndex],
    resetToStart,
    resetToCheckpoint,
    setCourse,
    step,
    boardableLift,
  };

  function liftPath(lift: WorldLift): LiftPath {
    let path = liftPaths.get(lift.index);
    if (!path) { path = prepareLiftPath(lift.lift, heightAt); liftPaths.set(lift.index, path); }
    return path;
  }

  function place(x: number, z: number, yaw: number): void {
    state.held = true;
    state.x = x; state.z = z; state.y = terrain.height(x, z);
    state.groundY = state.y;
    state.vx = 0; state.vy = 0; state.vz = 0;
    state.yaw = yaw; state.travelYaw = yaw; state.edge = 0; state.crouch = 0; state.charge = 0;
    state.onGround = true; state.airTime = 0; state.groundTime = 0; state.speed = 0;
    state.spin = 0; state.spinVel = 0; state.flip = 0; state.flipVel = 0; state.grab = null; state.grabTime = 0;
    state.crash = 0; state.crashReason = null;
    state.liftIndex = -1; state.liftDistanceM = 0;
    state.comboTimer = 0; state.combo = 1;
    pendingAirStyle = 0; pendingLabels = []; carveW = 0;
    invuln = T.INVULN_TIME;
    sampleGround();
    sampleSnow();
  }

  function resetToStart(): void {
    const c = sim.course;
    place(c.start.x, c.start.z, c.start.yaw);
    state.style = 0; state.bestTrick = null; state.crashCount = 0;
    state.time = 0; state.runTime = 0; state.distance = 0; state.carveDistance = 0;
    state.startY = state.y; state.verticalM = 0;
    state.progressM = 0; state.progress = 0; state.lastGate = -1; state.finished = false; state.finishTime = 0;
    state.checkpoint = { x: state.x, y: state.y, z: state.z, yaw: state.yaw, gate: -1, progressM: 0 };
    lastJunctionId = null;
  }

  function resetToCheckpoint(): void {
    const cp = state.checkpoint;
    place(cp.x, cp.z, cp.yaw);
    state.lastGate = cp.gate;
    state.progressM = cp.progressM;
    state.finished = false;
    state.events.reset = true;
  }

  function setCourse(index: number): void {
    state.courseIndex = index;
    sim.course = world.courses[index];
    resetToStart();
  }

  function boardableLift(): WorldLift | null {
    if (!state.onGround || state.crash > 0 || state.liftIndex >= 0 || liftCooldown > 0) return null;
    for (const lift of world.lifts) {
      if (!lift.rideable) continue;
      const dx = state.x - lift.base.x, dz = state.z - lift.base.z;
      if (dx * dx + dz * dz <= T.LIFT_BOARD_RADIUS * T.LIFT_BOARD_RADIUS && Math.abs(state.y - lift.base.y) < 12) return lift;
    }
    return null;
  }

  // ─── Sampling ──────────────────────────────────────────────

  function sampleGround(): void {
    state.groundY = terrain.height(state.x, state.z);
    const n = terrain.normal(state.x, state.z, scratch.normal);
    state.nx = n.x; state.ny = n.y; state.nz = n.z;
    // The fall line runs along +(nx, nz) in the horizontal plane (n = (-∂h/∂x, 1, -∂h/∂z)); grade is |∇h|.
    state.grade = Math.hypot(n.x, n.z) / Math.max(1e-4, n.y);
  }

  function sampleSnow(): void {
    const nearest = terrain.nearestRun(state.x, state.z, scratch.nearest);
    const run = nearest.run;
    const previousIndex = state.nearRunIndex;
    if (run) {
      const halfWidth = run.halfWidthM;
      const t = 1 - clamp((nearest.d - halfWidth) / 10, 0, 1);
      state.corridor = t * t * (3 - 2 * t);
      state.onTrail = nearest.d <= halfWidth + 2;
      const index = state.onTrail ? nearest.i : -1;
      state.nearRunIndex = index;
      state.nearRunName = index >= 0 ? run.name : null;
    } else {
      state.corridor = 0; state.onTrail = false; state.nearRunIndex = -1; state.nearRunName = null;
    }
    if (state.nearRunIndex !== previousIndex) state.events.trailChanged = true;
    state.surface = localSurface(world, state.corridor, state.nz);
  }

  // ─── Step ──────────────────────────────────────────────────

  function step(input: InputState, dt: number): void {
    const s = state;
    clearRiderEvents(s.events);
    s.time += dt;
    if (!s.finished) s.runTime += dt;
    invuln = Math.max(0, invuln - dt);
    liftCooldown = Math.max(0, liftCooldown - dt);

    s.braking = input.brake; s.tucking = input.tuck;
    if (input.resetPressed) { resetToCheckpoint(); return; }
    if (s.held) {
      // Parked at the gate: the first touch of a control drops in.
      if (input.steer !== 0 || input.tuck || input.brake || input.jumpHeld || input.liftPressed) s.held = false;
      else { s.vx = 0; s.vy = 0; s.vz = 0; s.speed = 0; return; }
    }

    if (s.liftIndex >= 0) { stepLift(dt); return; }
    if (input.liftPressed) {
      const lift = boardableLift();
      if (lift) { boardLift(lift); return; }
    }

    if (s.crash > 0) { stepCrash(dt); return; }

    const snow = T.SNOW[s.surface];

    // Crouch: tuck depth or pop charge, whichever is deeper.
    if (s.onGround && input.jumpHeld) s.charge = Math.min(1, s.charge + dt / T.CHARGE_TIME);
    const crouchTarget = s.onGround ? Math.max(input.tuck ? 1 : 0, s.charge * 0.85) : (input.tuck ? 0.6 : 0.15);
    s.crouch = damp(s.crouch, crouchTarget, 1 / T.TUCK_LAG, dt);

    if (s.onGround) stepGround(input, snow, dt);
    else stepAir(input, dt);

    // Integrate.
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    const half = world.halfSizeM - 4;
    if (Math.abs(s.x) > half || Math.abs(s.z) > half) {
      s.x = clamp(s.x, -half, half); s.z = clamp(s.z, -half, half);
      s.vx *= 0.2; s.vz *= 0.2;
    }

    // Ground contact resolution.
    sampleGround();
    const gap = s.y - s.groundY;
    if (s.onGround) {
      const speed = Math.hypot(s.vx, s.vz);
      const lipGap = T.LIP_GAP_BASE + T.LIP_GAP_PER_MPS * speed;
      if (gap > lipGap && speed > T.LIP_MIN_SPEED) {
        // The surface fell away faster than the rider could follow: natural air.
        s.onGround = false; s.airTime = 0; s.groundTime = 0;
        tuckArmed = !input.tuck; brakeArmed = !input.brake;
      } else {
        s.y = s.groundY;
        s.groundTime += dt;
      }
    } else if (gap <= 0) {
      s.y = s.groundY;
      land(input);
    } else {
      s.airTime += dt;
    }

    s.speed = Math.hypot(s.vx, s.vy, s.vz);
    s.travelYaw = s.speed > 0.4 ? Math.atan2(s.vx, s.vz) : s.yaw;
    s.verticalM = Math.max(s.verticalM, s.startY - s.y);
    s.distance += Math.hypot(s.vx, s.vz) * dt;
    s.stride += (s.onGround ? Math.min(2.5, Math.hypot(s.vx, s.vz) * 0.35) : 0) * dt;

    sampleSnow();
    checkTrees();
    trackCourse();
    tickCombo(dt);
  }

  // ─── Ground ────────────────────────────────────────────────

  function stepGround(input: InputState, snow: T.SnowTuning, dt: number): void {
    const s = state;
    const nx = s.nx, ny = s.ny, nz = s.nz;

    // Ski axis projected onto the slope, and its side vector.
    let fx = Math.sin(s.yaw), fy = 0, fz = Math.cos(s.yaw);
    const fn = fx * nx + fy * ny + fz * nz;
    fx -= fn * nx; fy -= fn * ny; fz -= fn * nz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // side = n × f
    const sx = ny * fz - nz * fy, sy = nz * fx - nx * fz, sz = nx * fy - ny * fx;

    // Remove any normal velocity: we're on the snow.
    const vn = s.vx * nx + s.vy * ny + s.vz * nz;
    s.vx -= vn * nx; s.vy -= vn * ny; s.vz -= vn * nz;

    let u = s.vx * fx + s.vy * fy + s.vz * fz;      // forward
    let w = s.vx * sx + s.vy * sy + s.vz * sz;      // lateral
    const speed = Math.hypot(u, w);
    const speedT = clamp(speed / T.MAX_GROUND_SPEED, 0, 1);

    // Steering → edge angle. At low speed the edge is weak (you pivot, you don't carve).
    const steer = clamp(input.steer, -1, 1);
    const edgeTarget = steer * clamp(speed / 7, 0.15, 1);
    s.edge = damp(s.edge, edgeTarget, 1 / T.EDGE_LAG, dt);
    const edgeAbs = Math.abs(s.edge);

    // Yaw: steering turn rate falls with speed (sidecut), plus smear when braking.
    const turnRate = (T.TURN_RATE_SLOW + (T.TURN_RATE_FAST - T.TURN_RATE_SLOW) * Math.sqrt(speedT)) * snow.turn * kit.turn
      * Math.min(1, speed / 2.5);
    // Positive yaw turns left (toward +x when facing +z), so a right steer is a negative yaw rate.
    const travel = speed > 0.8 ? Math.atan2(w, u) : 0; // angle between skis and velocity, in ski frame
    // Already sideways? Pivoting further just makes a bigger skid, so steering authority fades.
    const skidLimit = 1 - 0.8 * clamp((Math.abs(travel) - 0.45) / 0.6, 0, 1);
    let yawRate = -steer * turnRate * (0.55 + 0.45 * edgeAbs) * skidLimit;
    if (input.brake) yawRate -= steer * T.SMEAR_YAW * skidLimit;
    // Skis relax toward the direction of travel; slower while actively carving.
    if (speed > 0.8) {
      // Standing still on a slope you hold your edges; alignment only matters once moving.
      const moving = Math.min(1, speed / 6);
      const align = (steer === 0 ? T.ALIGN_RATE : T.ALIGN_RATE_STEERING) * moving * moving;
      // A skid of `travel` radians (w > 0 = sliding to the skis' left) pulls yaw the same way.
      yawRate += travel * align * (input.brake ? 0.45 : 1);
    }
    const dyaw = yawRate * dt;
    s.yaw = wrapAngle(s.yaw + dyaw);

    // The ski frame turned under a fixed velocity: re-express (u, w) in the new frame. Pure
    // geometry, no energy change. The lateral component this creates is what the edge will
    // redirect — tracked separately in `carveW` so gravity-fed slip is never "carved" into speed.
    const c = Math.cos(dyaw), sn = Math.sin(dyaw);
    const uRot = u * c + w * sn;
    const wRot = -u * sn + w * c;
    carveW = carveW * c - u * sn;
    u = uRot; w = wRot;

    // Grip: bleed lateral velocity. Only the turn-generated share feeds forward speed
    // (carve conservation); slip from gravity or a skid is simply lost.
    let grip = snow.gripBase * kit.gripBase + snow.gripEdge * kit.gripEdge * edgeAbs;
    // Set edges hold at a standstill: no sideways creep while waiting at the gate.
    grip *= 1 + 4 * (1 - Math.min(1, speed / 3));
    if (input.brake) grip *= 0.42;
    const decay = Math.exp(-grip * dt);
    if (Math.abs(carveW) > Math.abs(w)) carveW = w;
    if (carveW * w < 0) carveW = 0;
    const redirected = Math.abs(carveW) * (1 - decay);
    carveW *= decay;
    u += redirected * Math.min(0.9, snow.carveKeep * kit.carveKeep) * (u >= 0 ? 1 : -1) * (input.brake ? 0.3 : 1);
    w *= decay;
    if (edgeAbs > 0.3 && speed > 4) s.carveDistance += speed * dt;

    // Gravity along the slope: g_t = g - (g·n)n with g = (0,-G,0).
    const gx = 0 - (-T.GRAVITY * ny) * nx;
    const gy = -T.GRAVITY - (-T.GRAVITY * ny) * ny;
    const gz = 0 - (-T.GRAVITY * ny) * nz;
    const gForward = gx * fx + gy * fy + gz * fz;
    u += gForward * dt;
    w += (gx * sx + gy * sy + gz * sz) * dt;

    // Friction, brake, aero drag along the forward axis.
    const normalLoad = T.GRAVITY * Math.max(0.2, ny);
    let decel = snow.friction * (s.surface === "powder" ? kit.powderFriction : kit.friction) * normalLoad;
    if (input.brake) decel += snow.brakeDecel * kit.brakeDecel * (0.6 + 0.4 * edgeAbs);
    const dragUpright = T.DRAG_UPRIGHT * kit.dragUpright, dragTuck = T.DRAG_TUCK * kit.dragTuck;
    const drag = input.brake ? T.DRAG_BRAKE : (input.tuck ? dragTuck + (dragUpright - dragTuck) * (1 - s.crouch) : dragUpright);
    const uAbs = Math.abs(u);
    let uNext = uAbs - (decel + drag * uAbs * uAbs) * dt;
    if (uNext < 0) uNext = 0;
    u = u >= 0 ? uNext : -uNext;

    // Skating: below walking speed, tucking pushes wherever gravity isn't already doing the work
    // (flats, and the shallow rises a mapped line sometimes starts on).
    if (input.tuck && speed < T.SKATE_MAX_SPEED && gForward < T.SKATE_MAX_ALONG_G) {
      u += (T.SKATE_PUSH * kit.skatePush + Math.max(0, -gForward)) * (1 - Math.max(0, u) / T.SKATE_MAX_SPEED) * dt;
    }

    // Speed ceiling (soft).
    const total = Math.hypot(u, w);
    if (total > T.MAX_GROUND_SPEED) { const k = T.MAX_GROUND_SPEED / total; u *= k; w *= k; }

    s.vx = u * fx + w * sx; s.vy = u * fy + w * sy; s.vz = u * fz + w * sz;

    // Pop.
    if (input.jumpReleased && s.charge > 0) {
      const pop = (T.POP_MIN + (T.POP_MAX - T.POP_MIN) * s.charge) * kit.pop;
      s.vx += nx * pop; s.vy += ny * pop; s.vz += nz * pop;
      s.charge = 0; s.onGround = false; s.airTime = 0;
      tuckArmed = !input.tuck; brakeArmed = !input.brake;
      s.events.popped = true;
      // Steering at takeoff seeds a spin.
      s.spinVel = -steer * T.SPIN_RATE * 0.5;
    } else if (!input.jumpHeld) {
      s.charge = 0;
    }
  }

  // ─── Air ───────────────────────────────────────────────────

  function stepAir(input: InputState, dt: number): void {
    const s = state;
    s.vy -= T.GRAVITY * dt;
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    if (speed > 0) {
      const k = Math.max(0, 1 - T.DRAG_AIR * speed * dt);
      s.vx *= k; s.vy *= k; s.vz *= k;
    }
    if (speed > T.MAX_AIR_SPEED) { const k = T.MAX_AIR_SPEED / speed; s.vx *= k; s.vy *= k; s.vz *= k; }

    const steer = clamp(input.steer, -1, 1);
    // Rotation needs real hang time: a roller under a tucked, steering rider must not throw a flip.
    const committed = s.airTime > T.AIR_ROTATION_DELAY;
    s.spinVel = damp(s.spinVel, committed ? -steer * T.SPIN_RATE * kit.spin * (1 + 0.35 * s.charge) : 0, 1 / T.SPIN_LAG, dt);
    if (!input.tuck) tuckArmed = true;
    if (!input.brake) brakeArmed = true;
    const flipTarget = !committed ? 0 : (input.tuck && tuckArmed) ? -T.FLIP_RATE : (input.brake && brakeArmed) ? T.FLIP_RATE : 0;
    s.flipVel = damp(s.flipVel, flipTarget, 1 / T.FLIP_LAG, dt);
    s.spin += s.spinVel * dt;
    s.flip += s.flipVel * dt;
    s.edge = damp(s.edge, 0, 6, dt);

    if (input.grab) {
      if (s.grab !== input.grab) { s.grab = input.grab; s.grabTime = 0; }
      s.grabTime += dt;
    } else if (s.grab) {
      bankGrab(s.grab, s.grabTime);
      s.grab = null; s.grabTime = 0;
    }
    s.charge = 0;
  }

  function bankGrab(grab: GrabKind, held: number): void {
    if (held < 0.18) return;
    const points = T.STYLE.grab[grab];
    pendingAirStyle += points;
    pendingLabels.push((state.mode === "snowboarder" ? BOARD_GRAB_LABELS : GRAB_LABELS)[grab]);
  }

  function land(input: InputState): void {
    const s = state;
    const nx = s.nx, ny = s.ny, nz = s.nz;
    const vn = s.vx * nx + s.vy * ny + s.vz * nz; // negative = into the slope
    const impact = Math.max(0, -vn);
    if (s.grab) { bankGrab(s.grab, s.grabTime); s.grab = null; s.grabTime = 0; }

    const spinOff = wrapAngle(s.spin);
    const flipOff = wrapAngle(s.flip);
    // Landing switch (180) is allowed: measure against the nearest half-turn.
    const spinErr = Math.min(Math.abs(spinOff), Math.abs(Math.abs(spinOff) - Math.PI));
    const flipErr = Math.abs(flipOff);
    const limit = T.LAND_IMPACT_LIMIT + T.LAND_IMPACT_CROUCH_BONUS * (input.jumpHeld ? 1 : 0);

    // Kill the normal component; keep a little of it as forward speed.
    s.vx -= vn * nx; s.vy -= vn * ny; s.vz -= vn * nz;
    const keep = impact * T.LAND_KEEP;
    const fl = Math.hypot(s.vx, s.vz) || 1;
    s.vx += (s.vx / fl) * keep; s.vz += (s.vz / fl) * keep;

    s.onGround = true; s.groundTime = 0; carveW = 0;
    s.events.landed = true; s.events.landingImpact = impact;
    const airTime = s.airTime;
    s.airTime = 0;

    if (flipErr > T.LAND_FLIP_TOLERANCE) { crash("rotation"); return; }
    if (spinErr > T.LAND_SPIN_TOLERANCE) { crash("rotation"); return; }
    if (impact > limit) { crash("landing"); return; }

    // Clean landing: the spin becomes the new heading (switch lands keep the skis backwards-forward).
    s.yaw = wrapAngle(s.yaw + Math.round(s.spin / Math.PI) * Math.PI);
    const halfSpins = Math.round(Math.abs(s.spin) / Math.PI);
    const flips = Math.round(Math.abs(s.flip) / TAU);
    let points = pendingAirStyle;
    const labels = pendingLabels.slice();
    if (halfSpins > 0) { points += halfSpins * T.STYLE.spinPer180; labels.unshift(`${halfSpins * 180}`); }
    if (flips > 0) { points += flips * T.STYLE.flipPer360; labels.unshift(s.flip < 0 ? (flips > 1 ? `${flips}× Front Flip` : "Front Flip") : (flips > 1 ? `${flips}× Back Flip` : "Back Flip")); }
    if (airTime > 0.6) { points += Math.round(airTime * T.STYLE.airPerSecond); if (labels.length === 0) labels.push(`${airTime.toFixed(1)}s Air`); }
    if (points > 0) {
      const clean = impact < limit * 0.5 ? T.STYLE.cleanLanding : 1;
      const total = Math.round(points * clean * s.combo);
      s.style += total;
      s.combo = Math.min(T.COMBO_MAX, s.combo + 1);
      s.comboTimer = T.COMBO_WINDOW;
      const trick = { label: labels.join(" + ") + (clean > 1 ? " · Clean" : ""), points: total };
      s.events.trick = trick;
      if (!s.bestTrick || total > s.bestTrick.points) s.bestTrick = trick;
    }
    s.spin = 0; s.spinVel = 0; s.flip = 0; s.flipVel = 0;
    pendingAirStyle = 0; pendingLabels = [];
  }

  // ─── Crash ─────────────────────────────────────────────────

  function crash(reason: CrashReason): void {
    const s = state;
    s.crash = T.CRASH_TIME; s.crashReason = reason; s.crashCount += 1;
    s.vx *= T.CRASH_SPEED_KEEP; s.vy = 0; s.vz *= T.CRASH_SPEED_KEEP;
    s.spin = 0; s.spinVel = 0; s.flip = 0; s.flipVel = 0; s.grab = null; s.charge = 0; s.edge = 0;
    s.combo = 1; s.comboTimer = 0;
    pendingAirStyle = 0; pendingLabels = [];
    s.onGround = true; s.airTime = 0;
    s.events.crashed = reason;
  }

  function stepCrash(dt: number): void {
    const s = state;
    s.crash = Math.max(0, s.crash - dt);
    sampleGround();
    const nx = s.nx, ny = s.ny, nz = s.nz;
    // Slide down the fall line under gravity with heavy friction.
    const gx = -(-T.GRAVITY * ny) * nx, gz = -(-T.GRAVITY * ny) * nz;
    s.vx += gx * dt; s.vz += gz * dt;
    const speed = Math.hypot(s.vx, s.vz);
    const decel = T.CRASH_FRICTION * dt;
    if (speed > decel) { const k = (speed - decel) / speed; s.vx *= k; s.vz *= k; } else { s.vx = 0; s.vz = 0; }
    s.x += s.vx * dt; s.z += s.vz * dt;
    s.y = terrain.height(s.x, s.z); s.groundY = s.y; s.vy = 0;
    s.speed = Math.hypot(s.vx, s.vz);
    s.crouch = damp(s.crouch, 0.4, 6, dt);
    s.stride += dt * 4;
    if (s.crash === 0) {
      // Stand up facing downhill, and be briefly safe from the tree you hit.
      s.yaw = Math.atan2(nx, nz);
      s.travelYaw = s.yaw;
      s.crashReason = null;
      s.vx *= 0.3; s.vz *= 0.3;
      invuln = T.INVULN_TIME;
    }
    sampleSnow();
    trackCourse();
  }

  function checkTrees(): void {
    const s = state;
    if (invuln > 0 || s.crash > 0 || s.liftIndex >= 0) return;
    if (s.y - s.groundY > 2.5) return; // sailing over the canopy is allowed
    const cell = world.treeCellM;
    const cx = Math.floor(s.x / cell), cz = Math.floor(s.z / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const list = world.treeCells.get(treeCellKey(cx + ox, cz + oz));
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const tree = world.trees[list[i]];
        const dx = s.x - tree.x, dz = s.z - tree.z;
        const r = tree.radiusM + T.TREE_RADIUS_PAD;
        if (dx * dx + dz * dz < r * r) {
          // Push out of the trunk and tumble.
          const d = Math.hypot(dx, dz) || 1;
          s.x = tree.x + (dx / d) * r; s.z = tree.z + (dz / d) * r;
          crash("tree");
          s.vx = (dx / d) * 2.5; s.vz = (dz / d) * 2.5;
          return;
        }
      }
    }
  }

  // ─── Lift ──────────────────────────────────────────────────

  let liftRideSpeed = 0;

  function boardLift(lift: WorldLift): void {
    const s = state;
    s.liftIndex = lift.index; s.liftDistanceM = 0;
    const path = liftPath(lift);
    const rideS = clamp(T.LIFT_RIDE_MIN_S + T.LIFT_RIDE_S_PER_KM * (path.lengthM / 1000), T.LIFT_RIDE_MIN_S, T.LIFT_RIDE_MAX_S);
    liftRideSpeed = path.lengthM / rideS;
    s.vx = 0; s.vy = 0; s.vz = 0; s.charge = 0; s.crouch = 0; s.edge = 0;
    s.grab = null; s.spin = 0; s.flip = 0; s.onGround = true; s.airTime = 0;
    s.events.liftBoarded = true;
  }

  function stepLift(dt: number): void {
    const s = state;
    const lift = world.lifts[s.liftIndex];
    const path = liftPath(lift);
    s.liftDistanceM = Math.min(path.lengthM, s.liftDistanceM + liftRideSpeed * dt);
    const p = sampleLiftPath(path, s.liftDistanceM, scratch.liftSample);
    s.liftSeat.x = p.x; s.liftSeat.y = p.y; s.liftSeat.z = p.z; s.liftSeat.heading = p.heading;
    s.x = p.x; s.z = p.z; s.y = p.y - 3.4 + 1.2; // seat height: rider sits a little below the cable
    s.yaw = p.heading; s.travelYaw = p.heading;
    s.vx = 0; s.vy = 0; s.vz = 0; s.speed = liftRideSpeed;
    s.progress = s.liftDistanceM / path.lengthM;
    if (s.liftDistanceM >= path.lengthM) {
      s.liftIndex = -1;
      liftCooldown = 4;
      s.y = terrain.height(s.x, s.z); s.groundY = s.y; s.onGround = true;
      sampleGround();
      // Off the chair, facing down the fall line with a gentle push.
      s.yaw = Math.atan2(s.nx, s.nz); s.travelYaw = s.yaw;
      s.vx = Math.sin(s.yaw) * 2.5; s.vz = Math.cos(s.yaw) * 2.5;
      invuln = 2;
      s.events.liftExited = true;
      sampleSnow();
    }
  }

  // ─── Course ────────────────────────────────────────────────

  function trackCourse(): void {
    const s = state;
    const course = sim.course;
    const near = nearestPointOnRun(course.run, s.x, s.z, scratch.nearestCourse);
    const onLine = near.distance <= course.run.halfWidthM * 3 + 10;
    if (onLine && near.progressM > s.progressM) {
      // Progress is monotonic and only counts while the rider is near the line,
      // so cutting across the mountain does not "complete" a course.
      if (near.progressM - s.progressM < 80) s.progressM = near.progressM;
    }
    s.progress = clamp(s.progressM / Math.max(1, course.lengthM), 0, 1);

    // Gates are checkpoints.
    const gates = course.gates;
    while (s.lastGate + 1 < gates.length && s.progressM >= gates[s.lastGate + 1].distanceM) {
      s.lastGate += 1;
      const gate = gates[s.lastGate];
      s.checkpoint = { x: gate.x, y: gate.y, z: gate.z, yaw: gate.heading, gate: s.lastGate, progressM: gate.distanceM };
      s.events.gatePassed = true;
      s.style += T.STYLE.gate;
    }

    if (!s.finished && s.progressM >= course.lengthM - 3 && near.distance <= course.run.halfWidthM * 2 + 6) {
      s.finished = true;
      s.finishTime = s.runTime;
      s.events.finished = true;
    }

    // Junction prompts are a HUD concern, but we keep the last one so the
    // renderer can drop a sign only once per junction.
    const junction = nearestJunction(world.junctions, s.x, s.z, 70);
    lastJunctionId = junction ? junction.id : null;
  }

  function tickCombo(dt: number): void {
    const s = state;
    if (s.comboTimer > 0) {
      s.comboTimer -= dt;
      if (s.comboTimer <= 0) { s.comboTimer = 0; s.combo = 1; }
    }
  }

  void lastJunctionId;
  return sim;
}

const GRAB_LABELS: Record<GrabKind, string> = { mute: "Mute", eagle: "Spread Eagle", daffy: "Daffy", twister: "Twister" };
const BOARD_GRAB_LABELS: Record<GrabKind, string> = { mute: "Indy", eagle: "Method", daffy: "Tail Grab", twister: "Nose Grab" };

/**
 * The snow under the rider. On a groomed corridor the surface is what the
 * groomers left (packed, or ice on a north-facing slope in the morning); off
 * it the day's snow decides: fresh powder if there is any, otherwise the
 * resort-wide surface.
 */
export function localSurface(world: World, corridor: number, nz: number): SurfaceKind {
  const env = world.conditions.environment;
  const base = world.conditions.surface;
  if (corridor >= 0.5) {
    if (env?.morningIce && nz * env.northSign > 0.08) return "ice";
    return base === "powder" ? "packed" : base;
  }
  if (env && env.powderDepthCm > 0) return "powder";
  return base;
}
