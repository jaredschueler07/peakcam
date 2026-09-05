import type { ResortGameProfile } from "../config/schema";
import type { RealGate, RealLift, RealRamp, RealRun, RealRunPoint, SimulationState, TerrainSampler } from "../core/types";
import { mulberry32 } from "../core/rng";
import type { DrapedLift, DrapedRun } from "./real-heightfield";

const RUN_MAP: Record<string, readonly string[]> = {
  "ski-portillo": ["Roca Jack", "Bajada Del Tren", "Plateau", "Garganta", "Super C", "Las Lomas"],
  breckenridge: ["Horseshoe Bowl", "Imperial Bowl", "Devils Crotch", "4 O'Clock", "Whale's Tail", "Psychopath"],
  heavenly: ["Gunbarrel", "Ridge Run", "Milky Way Bowl", "Mott Canyon Trail", "Olympic Downhill", "Canyonland"],
};

export interface ArcPoint extends RealRunPoint { heading: number }
export interface RealCourse { runs: RealRun[]; lifts: RealLift[]; mainLift: RealLift | null }

export function polylineLength(points: readonly RealRunPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return length;
}

/**
 * Sample a draped polyline at arc length. Pass `out` from the render/physics
 * hot path so the frame loop does not allocate a fresh ArcPoint every call.
 */
export function pointAtArcLength(points: readonly RealRunPoint[], distanceM: number, out?: ArcPoint): ArcPoint {
  if (points.length < 2) throw new Error("a real polyline needs at least two points");
  const result = out ?? { x: 0, y: 0, z: 0, heading: 0 };
  let remaining = Math.max(0, distanceM);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= length || i === points.length - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0;
      result.x = a.x + (b.x - a.x) * t;
      result.y = a.y + (b.y - a.y) * t;
      result.z = a.z + (b.z - a.z) * t;
      result.heading = Math.atan2(b.x - a.x, b.z - a.z);
      return result;
    }
    remaining -= length;
  }
  const end = points.at(-1)!;
  result.x = end.x; result.y = end.y; result.z = end.z; result.heading = 0;
  return result;
}

function downhill(points: readonly RealRunPoint[]): RealRunPoint[] {
  const copy = points.map((point) => ({ ...point }));
  if (copy.length > 3 && Math.hypot(copy[0].x - copy.at(-1)!.x, copy[0].z - copy.at(-1)!.z) < 1) {
    copy.pop();
    let high = 0, low = 0;
    for (let i = 1; i < copy.length; i += 1) {
      if (copy[i].y > copy[high].y) high = i;
      if (copy[i].y < copy[low].y) low = i;
    }
    const forward: RealRunPoint[] = [];
    for (let i = high; ; i = (i + 1) % copy.length) {
      forward.push(copy[i]); if (i === low) break;
    }
    const backward: RealRunPoint[] = [];
    for (let i = high; ; i = (i - 1 + copy.length) % copy.length) {
      backward.push(copy[i]); if (i === low) break;
    }
    return polylineLength(forward) <= polylineLength(backward) ? forward : backward;
  }
  if (copy[0].y < copy.at(-1)!.y) copy.reverse();
  return copy;
}

const SUSTAINED_DOWNHILL_DISTANCE_M = 40;
const MIN_START_GRADE = 0.04;

function trimFlatStart(points: readonly RealRunPoint[]): RealRunPoint[] {
  for (let start = 0; start < points.length - 1; start += 1) {
    let distance = 0;
    let elevation = points[start].y;
    for (let i = start + 1; i < points.length && distance < SUSTAINED_DOWNHILL_DISTANCE_M; i += 1) {
      const a = points[i - 1], b = points[i];
      const segmentLength = Math.hypot(b.x - a.x, b.z - a.z);
      if (segmentLength <= 0) continue;
      const used = Math.min(segmentLength, SUSTAINED_DOWNHILL_DISTANCE_M - distance);
      elevation = a.y + (b.y - a.y) * (used / segmentLength);
      distance += used;
    }
    if (distance >= SUSTAINED_DOWNHILL_DISTANCE_M &&
        points[start].y - elevation >= distance * MIN_START_GRADE) {
      return points.slice(start).map((point) => ({ ...point }));
    }
  }
  return points.map((point) => ({ ...point }));
}

function selectRuns(profile: ResortGameProfile, inventory: readonly DrapedRun[]): DrapedRun[] {
  const wanted = RUN_MAP[profile.slug] ?? profile.trailNames;
  const used = new Set<number>();
  const selected: DrapedRun[] = [];
  for (const name of wanted) {
    let index = inventory.findIndex((run, candidate) => !used.has(candidate) && run.name === name);
    if (index < 0) {
      index = inventory.findIndex((run, candidate) => !used.has(candidate) && run.name !== null);
    }
    if (index < 0) break;
    used.add(index);
    selected.push(inventory[index]);
  }
  // Preserve familiar first choices; append every usable named source piece.
  for (let i = 0; i < inventory.length; i += 1) {
    const run = inventory[i];
    if (used.has(i) || !run.name || run.points.length < 2) continue;
    const points = trimFlatStart(downhill(run.points));
    if (polylineLength(points) < 100 || points[0].y - points.at(-1)!.y < 5) continue;
    selected.push(run);
  }
  return selected;
}

function makeRun(run: DrapedRun, sourceIndex: number, seed: number): RealRun {
  const points = trimFlatStart(downhill(run.points));
  const lengthM = polylineLength(points);
  const random = mulberry32(seed + sourceIndex * 1009);
  const gates: RealGate[] = [];
  const firstGate = 55 + random() * 25;
  for (let distanceM = firstGate, key = 0; distanceM < lengthM - 35; key += 1) {
    const point = pointAtArcLength(points, distanceM);
    gates.push({ key, distanceM, ...point, halfWidthM: run.halfWidthM * 0.52 });
    distanceM += 88 + random() * 24;
  }
  const ramps: RealRamp[] = [];
  for (let distanceM = 180 + random() * 80, key = 0; distanceM < lengthM - 45; key += 1) {
    const point = pointAtArcLength(points, distanceM);
    ramps.push({ key, distanceM, ...point });
    distanceM += 380 + random() * 100;
  }
  return {
    ...run,
    kind: "real", sourceIndex, name: run.name ?? `Run ${sourceIndex + 1}`,
    topElevationM: points[0].y, bottomElevationM: points.at(-1)!.y,
    difficulty: run.difficulty, halfWidthM: run.halfWidthM, points, lengthM,
    finishM: lengthM, gates, ramps,
  };
}

function makeLift(lift: DrapedLift): RealLift {
  const points = lift.points.map(point => ({ ...point }));
  const reversed = points[0].y > points.at(-1)!.y;
  if (reversed) points.reverse();
  const stations = lift.stations?.map(station => ({x:station.x,y:station.elevationM,z:-station.y,radiusM:station.radiusM}));
  if (reversed) stations?.reverse();
  return {
    kind: "real", id: lift.id, sourceId: lift.sourceId,
    name: lift.name ?? "Unnamed lift", type: lift.type,
    points, lengthM: polylineLength(points), speedMps: lift.speedMps,
    speedSource: lift.speedSource, occupancy: lift.occupancy,
    // DrapedLift's raw metadata retains the documented asset ENU frame.
    // Full runtime lifts expose game coordinates throughout.
    towers: lift.towers?.map(tower => {
      let elevation = points[0].y, distance = Infinity;
      for (let i=1;i<points.length;i++) {
        const a=points[i-1], b=points[i], dx=b.x-a.x, dz=b.z-a.z;
        const t=Math.max(0,Math.min(1,((tower.x-a.x)*dx+(-tower.y-a.z)*dz)/(dx*dx+dz*dz||1)));
        const d=Math.hypot(tower.x-a.x-dx*t,-tower.y-a.z-dz*t);
        if(d<distance){distance=d;elevation=a.y+(b.y-a.y)*t;}
      }
      return {x:tower.x,y:tower.elevationM ?? elevation,z:-tower.y};
    }),
    stations,
  };
}
function selectMainLift(profile: ResortGameProfile, lifts: readonly RealLift[]): RealLift | null {
  const eligible = lifts.filter((lift) => profile.slug === "ski-portillo"
    ? lift.type === "platter"
    : lift.type === "chair_lift" || lift.type === "gondola");
  let best: RealLift | null = null;
  for (const lift of eligible) if (!best || lift.lengthM > best.lengthM) best = lift;
  return best;
}

export function buildRealCourse(
  profile: ResortGameProfile, runs: readonly DrapedRun[], lifts: readonly DrapedLift[], seed: number,
): RealCourse {
  const selected = selectRuns(profile, runs);
  const realLifts = lifts.filter(lift => lift.points.length >= 2).map(makeLift);
  return {
    runs: selected.map((run, index) => makeRun(run, runs.indexOf(run), seed + index * 7919)),
    lifts: realLifts,
    mainLift: selectMainLift(profile, realLifts),
  };
}

export function nearestPointOnRun(
  run: RealRun, x: number, z: number,
): { distance: number; progressM: number; x: number; z: number } {
  let bestDistance = Infinity, bestProgress = 0, bestX = 0, bestZ = 0, progress = 0;
  for (let i = 1; i < run.points.length; i += 1) {
    const a = run.points[i - 1], b = run.points[i];
    const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq)) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    const segmentLength = Math.sqrt(lengthSq);
    if (distance < bestDistance) {
      bestDistance = distance; bestProgress = progress + segmentLength * t; bestX = px; bestZ = pz;
    }
    progress += segmentLength;
  }
  return { distance: bestDistance, progressM: bestProgress, x: bestX, z: bestZ };
}

/**
 * Place a freshly reset simulation onto a course at a given arc length, facing
 * downhill, at the same 15 m/s the normal spawn uses.
 *
 * Only the automated play→submit→board check calls this, via `?e2espawn`. It
 * exists because a hands-off descent cannot reach the finish gate — the skier
 * leaves the run corridor and `courseProgress` stops advancing — so the only
 * way to exercise everything *after* the finish line was to start nearer to it.
 * The run then finishes naturally through `checkGates` with real physics and
 * real recorder samples; nothing about the finish itself is faked.
 *
 * Prod-harmless by construction rather than by obscurity: a ghost recorded from
 * a near-finish spawn is refused by the server validator, which checks the run
 * began in the start zone and covered at least `MIN_COURSE_DISTANCE`. Typing
 * the parameter yields a run that cannot be submitted.
 *
 * This is initial state, not per-step logic: it runs once after reset and never
 * touches the deterministic step path or the parity fixtures.
 *
 * @returns the arc length actually used, clamped to `[0, finishM - 10]`.
 */
export function spawnOnRunAtArcLength(
  state: SimulationState,
  run: RealRun,
  arcM: number,
  terrain: TerrainSampler,
): number {
  // A negative value counts back from the finish, so a caller can ask for "40 m
  // out" without knowing the course length — which keeps the e2e spec free of
  // hardcoded geometry that would rot the next time a run is re-baked.
  const requested = arcM < 0 ? run.finishM + arcM : arcM;
  const clamped = Math.max(0, Math.min(requested, run.finishM - 10));
  const at = pointAtArcLength(run.points, clamped);
  const y = terrain.height(at.x, at.z);

  state.pos.x = at.x; state.pos.y = y; state.pos.z = at.z;
  state.vel.x = Math.sin(at.heading) * 15; state.vel.y = 0; state.vel.z = Math.cos(at.heading) * 15;
  state.yaw = at.heading;
  state.startY = y;
  // Seed both progress fields so the gate sweep does not treat the spawn as a
  // single enormous forward step and award every gate behind us.
  state.courseProgress = clamped; state.prevCourseProgress = clamped;
  state.prevX = at.x; state.prevZ = at.z;
  state.onGround = true; state.airTime = 0;
  return clamped;
}
