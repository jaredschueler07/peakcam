import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureWorld } from "../testing/fixture-world";
import { createRiderSim } from "./rider";
import { createInputState, SIM_DT, SIM_HZ, type InputState } from "../types";
import { MAX_GROUND_SPEED } from "./tuning";
import { autopilot } from "../testing/autopilot";

const world = fixtureWorld("breckenridge");

function run(seconds: number, drive: (t: number, input: InputState) => void, courseIndex = 0) {
  const sim = createRiderSim(world, courseIndex);
  sim.resetToStart();
  const input = createInputState();
  const steps = Math.round(seconds * SIM_HZ);
  const trace: { t: number; x: number; z: number; y: number; speed: number; onGround: boolean; yaw: number; progress: number; crashed: boolean }[] = [];
  for (let i = 0; i < steps; i++) {
    input.jumpReleased = false; input.resetPressed = false; input.liftPressed = false;
    drive(i * SIM_DT, input);
    sim.step(input, SIM_DT);
    const s = sim.state;
    assert.ok(Number.isFinite(s.x + s.y + s.z + s.vx + s.vy + s.vz + s.yaw), `finite state at step ${i}`);
    if (i % 4 === 0) trace.push({ t: i * SIM_DT, x: s.x, z: s.z, y: s.y, speed: Math.hypot(s.vx, s.vz), onGround: s.onGround, yaw: s.yaw, progress: s.progress, crashed: s.crash > 0 || s.events.crashed !== null });
  }
  return { sim, trace };
}

test("the world has every profile trail as a course, Horseshoe Bowl first", () => {
  assert.ok(world.courses.length > 20);
  assert.equal(world.courses[0].name, "Horseshoe Bowl");
  assert.ok(world.courses[0].id.startsWith("osm:way:"));
  assert.ok(world.lifts.some((lift) => lift.rideable));
  assert.ok(world.trees.length > 1000);
});

test("a straight tuck accelerates and stays within the speed ceiling", () => {
  const { sim, trace } = run(20, (_t, input) => { input.tuck = true; });
  const top = Math.max(...trace.map((p) => p.speed));
  assert.ok(top > 12, `reached ${top.toFixed(1)} m/s`);
  assert.ok(top <= MAX_GROUND_SPEED + 0.01, `capped at ${top.toFixed(1)} m/s`);
  assert.ok(sim.state.verticalM > 40, `dropped ${sim.state.verticalM.toFixed(0)} m`);
});

test("the rider holds an edge at the gate instead of creeping sideways", () => {
  const { sim } = run(3, () => {});
  const start = world.courses[0].start;
  assert.ok(Math.hypot(sim.state.x - start.x, sim.state.z - start.z) < 1.5, "stayed at the gate");
  let delta = sim.state.yaw - start.yaw;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  assert.ok(Math.abs(delta) < 0.2, `yaw drifted ${delta.toFixed(2)}`);
});

for (const courseIndex of [0, 1, 3]) {
  test(`the autopilot can follow ${world.courses[courseIndex].name} gate to gate and finish`, () => {
    const sim = createRiderSim(world, courseIndex);
    sim.resetToStart();
    const input = createInputState();
    let finished = false;
    for (let i = 0; i < 240 * SIM_HZ && !finished; i++) {
      input.jumpReleased = false; input.resetPressed = false;
      autopilot(sim.state, sim.course, input);
      sim.step(input, SIM_DT);
      if (sim.state.events.finished) finished = true;
    }
    assert.ok(finished, `finished ${sim.course.name}: progress ${sim.state.progress.toFixed(2)} at ${sim.state.runTime.toFixed(0)} s, crashes ${sim.state.crashCount}`);
    assert.ok(sim.state.lastGate >= sim.course.gates.length - 1, `passed every gate (${sim.state.lastGate + 1}/${sim.course.gates.length})`);
  });
}

test("holding right steer turns the skis clockwise (negative yaw) and bleeds lateral speed", () => {
  const { sim } = run(4.5, (t, input) => { input.tuck = t < 3; input.steer = t > 3 ? 1 : 0; });
  const startYaw = world.courses[0].start.yaw;
  let delta = sim.state.yaw - startYaw;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  assert.ok(delta < -0.3, `yaw moved ${delta.toFixed(2)} rad`);
  // Travel direction follows the skis: the skid angle stays small.
  let skid = sim.state.travelYaw - sim.state.yaw;
  skid = Math.atan2(Math.sin(skid), Math.cos(skid));
  assert.ok(Math.abs(skid) < 0.6, `skid ${skid.toFixed(2)} rad`);
});

test("braking slows the rider compared with gliding", () => {
  const glide = run(8, (t, input) => { input.tuck = t < 1; }).sim.state;
  const brake = run(8, (t, input) => { input.tuck = t < 1; input.brake = t > 3; }).sim.state;
  assert.ok(Math.hypot(brake.vx, brake.vz) < Math.hypot(glide.vx, glide.vz) * 0.8);
});

test("a charged pop leaves the ground and lands again without crashing", () => {
  let popped = false, airborne = false, landed = false, crashed = false;
  const sim = createRiderSim(world, 0);
  sim.resetToStart();
  const input = createInputState();
  for (let i = 0; i < 12 * SIM_HZ; i++) {
    const t = i / SIM_HZ;
    input.jumpReleased = false; input.tuck = true;
    input.jumpHeld = t > 4 && t < 4.4;
    if (t >= 4.4 && !popped) { input.jumpReleased = true; popped = true; input.jumpHeld = false; }
    sim.step(input, SIM_DT);
    if (!sim.state.onGround) airborne = true;
    if (sim.state.events.landed) landed = true;
    if (sim.state.events.crashed) crashed = true;
  }
  assert.ok(airborne, "left the ground");
  assert.ok(landed, "landed");
  assert.equal(crashed, false, "clean landing");
});

test("30 Hz samples of a fast run stay inside the leaderboard validator's envelope", () => {
  const { trace } = run(45, (t, input) => { input.tuck = true; input.steer = Math.sin(t * 0.7) * 0.8; });
  // trace is at 30 Hz already (every 4th step).
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    if (a.crashed || b.crashed) continue; // the validator has a separate, looser envelope for crashed segments
    const dt = b.t - a.t;
    const accel = (b.speed - a.speed) / dt;
    assert.ok(accel < 60, `accel ${accel.toFixed(1)} m/s² at t=${b.t.toFixed(2)}`);
    assert.ok(accel > -80, `decel ${accel.toFixed(1)} m/s² at t=${b.t.toFixed(2)}`);
    assert.ok(b.speed < 60.9, `speed ${b.speed.toFixed(1)}`);
  }
});

test("reset returns the rider to the last checkpoint", () => {
  const sim = createRiderSim(world, 0);
  sim.resetToStart();
  const input = createInputState();
  for (let i = 0; i < 90 * SIM_HZ; i++) { autopilot(sim.state, sim.course, input); sim.step(input, SIM_DT); if (sim.state.lastGate >= 1) break; }
  assert.ok(sim.state.lastGate >= 1, "passed a gate");
  const cp = sim.state.checkpoint;
  for (let i = 0; i < 2 * SIM_HZ; i++) { autopilot(sim.state, sim.course, input); sim.step(input, SIM_DT); }
  input.resetPressed = true; input.tuck = false; input.steer = 0; input.brake = false;
  sim.step(input, SIM_DT);
  assert.ok(Math.hypot(sim.state.x - cp.x, sim.state.z - cp.z) < 0.5);
  assert.equal(sim.state.speed, 0);
});

test("the rider can board a lift at its base and gets off at the top facing downhill", () => {
  const lift = world.lifts.find((candidate) => candidate.rideable && candidate.top.y - candidate.base.y > 100)!;
  assert.ok(lift, "a rideable lift with real vertical");
  const sim = createRiderSim(world, 0);
  sim.resetToStart();
  // Teleport to the base station: same thing the checkpoint reset does, so use the sim's own placer.
  sim.state.checkpoint = { x: lift.base.x, y: lift.base.y, z: lift.base.z, yaw: 0, gate: -1, progressM: 0 };
  sim.resetToCheckpoint();
  assert.equal(sim.boardableLift()?.index, lift.index);
  const input = createInputState();
  input.liftPressed = true;
  sim.step(input, SIM_DT);
  input.liftPressed = false;
  assert.equal(sim.state.liftIndex, lift.index);
  assert.ok(sim.state.events.liftBoarded);
  let exited = false;
  // The cable is longer than the mapped 2-D line (vertical + sag), so allow a generous ceiling.
  const maxSteps = Math.ceil((lift.lift.lengthM * 1.5 / lift.speedMps + 30) * SIM_HZ);
  for (let i = 0; i < maxSteps && !exited; i++) {
    sim.step(input, SIM_DT);
    if (sim.state.events.liftExited) exited = true;
  }
  assert.ok(exited, "reached the top");
  assert.ok(Math.hypot(sim.state.x - lift.top.x, sim.state.z - lift.top.z) < 25, "stands near the top terminal");
  assert.ok(sim.state.y > lift.base.y + 100, "gained the lift's vertical");
  assert.equal(sim.state.liftIndex, -1);
});
