/**
 * lib/game/rendering/GhostRenderer.ts
 * ──────────────────────────────────
 * Draws a decoded PCGH replay as a translucent poster-ink rider alongside the
 * live skier. Purely presentational: it reads {@link DecodedGhost} samples and
 * never feeds anything back into the simulation.
 *
 * Keyframes arrive at ~10 Hz, so every frame interpolates between the two
 * bracketing samples — linear in position, shortest-arc in yaw. Sample times
 * come from the recorded simulation tick at the fixed {@link FIXED_HZ} rate.
 */

import * as THREE from "three";
import { FIXED_HZ } from "../core/clock";
import type { TerrainSampler } from "../core/types";
import type { DecodedGhost, GhostSample } from "../replay/codec";

const CM_TO_M = 0.01;
const TWO_PI = Math.PI * 2;

/** Poster ink, the darkest token in the retro-poster palette. */
const GHOST_INK = 0x2a1f14;
const GHOST_OPACITY = 0.45;

/** One interpolated ghost pose in world units (metres, radians). */
export interface GhostPose {
  /** False before the first sample and after the last — the rider is hidden. */
  visible: boolean;
  x: number;
  z: number;
  /** Height above the sampled terrain, metres. */
  groundOffset: number;
  yaw: number;
  /** Metres per second. */
  speed: number;
  /** Bitfield of the `POSE_*` constants from the codec. */
  poseFlags: number;
}

/** A reusable `out` object for {@link sampleGhostAt}. */
export function createGhostPose(): GhostPose {
  return { visible: false, x: 0, z: 0, groundOffset: 0, yaw: 0, speed: 0, poseFlags: 0 };
}

function writePose(out: GhostPose, sample: GhostSample): GhostPose {
  out.visible = true;
  out.x = sample.xCm * CM_TO_M;
  out.z = sample.zCm * CM_TO_M;
  out.groundOffset = sample.groundOffsetCm * CM_TO_M;
  out.yaw = sample.yaw;
  out.speed = sample.speedCms * CM_TO_M;
  out.poseFlags = sample.poseFlags;
  return out;
}

/** Signed shortest angular distance from `a` to `b`, in `(-π, π]`. */
function shortArc(a: number, b: number): number {
  return ((((b - a) % TWO_PI) + TWO_PI + Math.PI) % TWO_PI) - Math.PI;
}

/**
 * Interpolate the ghost's pose at `simTime` seconds of run time, writing into
 * `out` and returning it. Pure and allocation-free: no three.js, no `new`.
 */
export function sampleGhostAt(
  samples: readonly GhostSample[],
  simTime: number,
  out: GhostPose,
): GhostPose {
  const count = samples.length;
  if (count === 0) {
    out.visible = false;
    return out;
  }

  const firstTime = samples[0].tick / FIXED_HZ;
  const lastTime = samples[count - 1].tick / FIXED_HZ;
  // `!(simTime >= firstTime)` also rejects NaN.
  if (!(simTime >= firstTime) || simTime > lastTime) {
    out.visible = false;
    return out;
  }
  if (simTime === lastTime) return writePose(out, samples[count - 1]);

  // Largest index whose sample time is <= simTime; `hi` is its successor.
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].tick / FIXED_HZ <= simTime) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = (b.tick - a.tick) / FIXED_HZ;
  const u = span > 0 ? (simTime - a.tick / FIXED_HZ) / span : 0;

  out.visible = true;
  out.x = (a.xCm + (b.xCm - a.xCm) * u) * CM_TO_M;
  out.z = (a.zCm + (b.zCm - a.zCm) * u) * CM_TO_M;
  out.groundOffset = (a.groundOffsetCm + (b.groundOffsetCm - a.groundOffsetCm) * u) * CM_TO_M;
  out.yaw = a.yaw + shortArc(a.yaw, b.yaw) * u;
  out.speed = (a.speedCms + (b.speedCms - a.speedCms) * u) * CM_TO_M;
  // Pose bits are discrete; the frame they were recorded on wins.
  out.poseFlags = u < 0.5 ? a.poseFlags : b.poseFlags;
  return out;
}

/** Scratch pose shared by every renderer instance — `update` is never re-entrant. */
const scratchPose = createGhostPose();

/**
 * A simplified stand-in for {@link SkierRenderer}: capsule torso, helmet and a
 * pair of skis, all in flat poster ink. No articulation, no spray, no shadows —
 * the ghost has to read as a silhouette without competing with the live rider.
 */
export class GhostRenderer {
  readonly root = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private ghost: DecodedGhost | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.MeshStandardMaterial({
      color: GHOST_INK, roughness: 0.85, metalness: 0,
      transparent: true, opacity: GHOST_OPACITY, depthWrite: false,
    });
    // Height fog would tint the flat ink; the skier rig opts out the same way.
    this.material.userData.heightFog = false;

    const torso = this.mesh(new THREE.CapsuleGeometry(0.30, 0.86, 4, 8));
    torso.position.y = 1.24;
    const head = this.mesh(new THREE.SphereGeometry(0.24, 10, 8));
    head.position.y = 1.86;
    const skiGeometry = new THREE.BoxGeometry(0.16, 0.055, 1.86);
    this.geometries.push(skiGeometry);
    for (const side of [-1, 1]) {
      const ski = new THREE.Mesh(skiGeometry, this.material);
      ski.castShadow = false; ski.receiveShadow = false;
      ski.position.set(side * 0.19, 0.045, 0.05);
      this.root.add(ski);
    }

    this.root.visible = false;
    this.root.renderOrder = 1; // drawn after the opaque world, like other blends
    scene.add(this.root);
  }

  private mesh(geometry: THREE.BufferGeometry): THREE.Mesh {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.root.add(mesh);
    return mesh;
  }

  /** Attach a decoded replay, or `null` to hide the rider and drop the samples. */
  setGhost(ghost: DecodedGhost | null): void {
    this.ghost = ghost;
    this.root.visible = false;
  }

  /**
   * Pose the rider for `simTime` seconds of run time. `terrain`, when supplied,
   * lifts the ghost onto the same ground the live skier rides.
   */
  update(simTime: number, terrain?: TerrainSampler): void {
    const ghost = this.ghost;
    if (!ghost) {
      this.root.visible = false;
      return;
    }
    const pose = sampleGhostAt(ghost.samples, simTime, scratchPose);
    this.root.visible = pose.visible;
    if (!pose.visible) return;
    const ground = terrain ? terrain.height(pose.x, pose.z) : 0;
    this.root.position.set(pose.x, ground + pose.groundOffset, pose.z);
    this.root.rotation.y = pose.yaw;
  }

  dispose(): void {
    this.ghost = null;
    this.scene.remove(this.root);
    this.root.clear();
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.material.dispose();
  }
}
