/**
 * lib/descent/render/RiderMesh.ts
 * ───────────────────────────────
 * The rider: a blocky, flat-shaded skier built from primitives and posed
 * procedurally from `RiderState` every frame. There is no animation data —
 * every pose (tuck, carve lean, wedge, skate stride, grabs, tumble, chair
 * sit) is a target set of joint angles that the rig damps toward, so
 * transitions never snap.
 *
 * Rig (all rotations local):
 *   root (world pose: position, yaw+spin, flip, bank, slope tilt)
 *   └ hips
 *     ├ torso ─ head
 *     │       ├ upperArm[L/R] ─ forearm ─ pole
 *     └ thigh[L/R] ─ shin ─ boot ─ ski
 *
 * The ghost variant is the same rig, translucent, driven by `setGhostPose`.
 */

import * as THREE from "three";
import { GEAR, OUTFITS } from "@/lib/game/config/rider-style";
import type { RiderState, RiderStyle, World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const DEG = Math.PI / 180;

interface Limb {
  pivot: THREE.Group;
  target: THREE.Euler;
  extra?: THREE.Group;
}

export interface GhostPose {
  x: number; y: number; z: number; yaw: number;
  airborne: boolean; tucked: boolean; crashed: boolean; visible: boolean;
}

function damp(a: number, b: number, lambda: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

function dampEuler(e: THREE.Euler, target: THREE.Euler, lambda: number, dt: number): void {
  e.x = damp(e.x, target.x, lambda, dt);
  e.y = damp(e.y, target.y, lambda, dt);
  e.z = damp(e.z, target.z, lambda, dt);
}

export class RiderMesh implements RenderModule {
  readonly root: THREE.Group;
  private readonly ghost: boolean;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly scene: THREE.Scene;
  private readonly world: World;

  private readonly hips: THREE.Group;
  private readonly torso: Limb;
  private readonly head: Limb;
  private readonly upperArm: [Limb, Limb];
  private readonly forearm: [Limb, Limb];
  private readonly pole: [Limb, Limb];
  private readonly thigh: [Limb, Limb];
  private readonly shin: [Limb, Limb];
  private readonly ski: [Limb, Limb];

  private blob: THREE.Mesh | null = null;
  private blobMaterial: THREE.MeshBasicMaterial | null = null;

  // Smoothed pose scalars.
  private hipsY = 0.9;
  private hipsYTarget = 0.9;
  private bank = 0;
  private flip = 0;
  private yawSpin = 0;
  private tumble = 0;
  private tumbleRoll = 0;
  private lie = 0;
  private readonly slopeQuat = new THREE.Quaternion();
  private readonly slopeQuatTarget = new THREE.Quaternion();
  private readonly yawQuat = new THREE.Quaternion();
  private readonly bodyQuat = new THREE.Quaternion();
  private readonly scratchV = new THREE.Vector3();
  private readonly scratchUp = new THREE.Vector3(0, 1, 0);
  private readonly scratchN = { x: 0, y: 1, z: 0 };
  private readonly scratchE = new THREE.Euler();
  private readonly poleWorld = new THREE.Vector3();
  private readonly poleParentQuat = new THREE.Quaternion();
  private readonly poleWorldQuat = new THREE.Quaternion();
  private readonly poleLocalQuat = new THREE.Quaternion();
  private readonly POLE_LENGTH = 1.0;
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly xAxis = new THREE.Vector3(1, 0, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene, world: World, style: RiderStyle, options: { ghost?: boolean } = {}) {
    this.scene = scene;
    this.world = world;
    this.ghost = options.ghost === true;
    this.root = new THREE.Group();
    this.root.name = this.ghost ? "rider-ghost" : "rider";

    const outfit = OUTFITS[style.outfit];
    const gear = GEAR[style.skis];
    const yeti = style.character === "yeti";

    const mat = (color: number): THREE.MeshLambertMaterial => {
      const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
      if (this.ghost) {
        material.color.set(0x9fd0ff);
        material.transparent = true;
        material.opacity = 0.35;
        material.depthWrite = false;
        material.emissive.set(0x3f6fa8);
      }
      this.materials.push(material);
      return material;
    };
    const geo = <G extends THREE.BufferGeometry>(g: G): G => { this.geometries.push(g); return g; };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
      const m3 = new THREE.Mesh(g, m);
      m3.castShadow = !this.ghost;
      m3.receiveShadow = false;
      return m3;
    };

    const jacket = mat(yeti ? 0xf2f1ea : outfit.jacket);
    const sleeves = mat(yeti ? 0xe4e2d8 : outfit.sleeves);
    const trim = mat(yeti ? 0xd8d5c8 : outfit.trim);
    const pants = mat(yeti ? 0xe9e7de : outfit.pants);
    const skin = mat(yeti ? 0x3a3330 : 0xd9a67a);
    const lens = mat(outfit.lens);
    const bootMat = mat(yeti ? 0x2a2420 : 0x1e1a18);
    const skiMat = mat(gear.base);
    const skiAccent = mat(gear.accent);
    const poleMat = mat(gear.ink);

    // ── Hips / torso / head ──
    this.hips = new THREE.Group();
    this.hips.position.y = 0.9;
    this.root.add(this.hips);

    const torsoPivot = new THREE.Group();
    this.hips.add(torsoPivot);
    const torsoMesh = mesh(geo(new THREE.BoxGeometry(0.42, 0.56, 0.26)), jacket);
    torsoMesh.position.y = 0.3;
    torsoPivot.add(torsoMesh);
    const collar = mesh(geo(new THREE.BoxGeometry(0.44, 0.08, 0.28)), trim);
    collar.position.y = 0.6;
    torsoPivot.add(collar);
    const belt = mesh(geo(new THREE.BoxGeometry(0.44, 0.06, 0.28)), trim);
    belt.position.y = 0.02;
    torsoPivot.add(belt);
    this.torso = { pivot: torsoPivot, target: new THREE.Euler() };

    const headPivot = new THREE.Group();
    headPivot.position.y = 0.64;
    torsoPivot.add(headPivot);
    const headMesh = mesh(geo(new THREE.BoxGeometry(0.24, 0.26, 0.24)), yeti ? jacket : skin);
    headMesh.position.y = 0.14;
    headPivot.add(headMesh);
    const helmet = mesh(geo(new THREE.BoxGeometry(0.27, 0.14, 0.27)), yeti ? trim : lens);
    helmet.position.y = 0.24;
    headPivot.add(helmet);
    const goggles = mesh(geo(new THREE.BoxGeometry(0.26, 0.08, 0.06)), lens);
    goggles.position.set(0, 0.16, 0.14);
    headPivot.add(goggles);
    const band = mesh(geo(new THREE.BoxGeometry(0.27, 0.04, 0.27)), trim);
    band.position.y = 0.16;
    headPivot.add(band);
    this.head = { pivot: headPivot, target: new THREE.Euler() };

    // ── Arms ──
    const buildArm = (side: -1 | 1): [Limb, Limb, Limb] => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.27, 0.54, 0);
      torsoPivot.add(upper);
      const upperMesh = mesh(geo(new THREE.BoxGeometry(0.12, 0.3, 0.12)), sleeves);
      upperMesh.position.y = -0.15;
      upper.add(upperMesh);

      const fore = new THREE.Group();
      fore.position.y = -0.3;
      upper.add(fore);
      const foreMesh = mesh(geo(new THREE.BoxGeometry(0.11, 0.28, 0.11)), sleeves);
      foreMesh.position.y = -0.14;
      fore.add(foreMesh);
      const glove = mesh(geo(new THREE.BoxGeometry(0.12, 0.1, 0.12)), trim);
      glove.position.y = -0.31;
      fore.add(glove);

      const pole = new THREE.Group();
      pole.position.y = -0.31;
      fore.add(pole);
      const shaft = mesh(geo(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 5)), poleMat);
      shaft.position.y = -0.45;
      pole.add(shaft);
      const basket = mesh(geo(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 6)), skiAccent);
      basket.position.y = -0.95;
      pole.add(basket);

      return [
        { pivot: upper, target: new THREE.Euler() },
        { pivot: fore, target: new THREE.Euler() },
        { pivot: pole, target: new THREE.Euler() },
      ];
    };
    const [luA, lfA, lpA] = buildArm(-1);
    const [ruA, rfA, rpA] = buildArm(1);
    this.upperArm = [luA, ruA];
    this.forearm = [lfA, rfA];
    this.pole = [lpA, rpA];

    // ── Legs / skis ──
    const buildLeg = (side: -1 | 1): [Limb, Limb, Limb] => {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.11, 0, 0);
      this.hips.add(thigh);
      const thighMesh = mesh(geo(new THREE.BoxGeometry(0.16, 0.42, 0.18)), pants);
      thighMesh.position.y = -0.21;
      thigh.add(thighMesh);

      const shin = new THREE.Group();
      shin.position.y = -0.42;
      thigh.add(shin);
      const shinMesh = mesh(geo(new THREE.BoxGeometry(0.14, 0.36, 0.16)), pants);
      shinMesh.position.y = -0.18;
      shin.add(shinMesh);
      const boot = mesh(geo(new THREE.BoxGeometry(0.15, 0.16, 0.3)), bootMat);
      boot.position.set(0, -0.4, 0.04);
      shin.add(boot);

      const ski = new THREE.Group();
      ski.position.set(0, -0.48, 0.04);
      shin.add(ski);
      const skiBody = mesh(geo(new THREE.BoxGeometry(0.1, 0.03, 1.5)), skiMat);
      ski.add(skiBody);
      const tip = mesh(geo(new THREE.BoxGeometry(0.1, 0.03, 0.24)), skiAccent);
      tip.position.set(0, 0.03, 0.85);
      tip.rotation.x = -0.28;
      ski.add(tip);
      const tail = mesh(geo(new THREE.BoxGeometry(0.1, 0.03, 0.12)), skiAccent);
      tail.position.set(0, 0.01, -0.8);
      tail.rotation.x = 0.12;
      ski.add(tail);
      const binding = mesh(geo(new THREE.BoxGeometry(0.11, 0.05, 0.3)), poleMat);
      binding.position.y = 0.03;
      ski.add(binding);

      return [
        { pivot: thigh, target: new THREE.Euler() },
        { pivot: shin, target: new THREE.Euler() },
        { pivot: ski, target: new THREE.Euler() },
      ];
    };
    const [ltA, lsA, lkA] = buildLeg(-1);
    const [rtA, rsA, rkA] = buildLeg(1);
    this.thigh = [ltA, rtA];
    this.shin = [lsA, rsA];
    this.ski = [lkA, rkA];

    // ── Blob shadow ──
    if (!this.ghost && typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
        grad.addColorStop(0, "rgba(20,30,50,0.55)");
        grad.addColorStop(0.6, "rgba(20,30,50,0.22)");
        grad.addColorStop(1, "rgba(20,30,50,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        const texture = new THREE.CanvasTexture(canvas);
        this.blobMaterial = new THREE.MeshBasicMaterial({
          map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        this.materials.push(this.blobMaterial);
        const blobGeo = geo(new THREE.PlaneGeometry(2.2, 2.2));
        blobGeo.rotateX(-Math.PI / 2);
        this.blob = new THREE.Mesh(blobGeo, this.blobMaterial);
        this.blob.renderOrder = 1;
        scene.add(this.blob);
      }
    }

    this.setNeutralTargets();
    this.applyTargetsImmediately();
    if (this.ghost) this.root.visible = false;
    scene.add(this.root);
  }

  // ─── Pose targets ──────────────────────────────────────────

  private setNeutralTargets(): void {
    this.torso.target.set(0.12, 0, 0);
    this.head.target.set(-0.08, 0, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.upperArm[i].target.set(0.35, 0, side * 0.18);
      this.forearm[i].target.set(-0.55, 0, 0);
      this.pole[i].target.set(0.55, 0, 0);
      this.thigh[i].target.set(-0.32, 0, 0);
      this.shin[i].target.set(0.55, 0, 0);
      this.ski[i].target.set(-0.23, 0, 0);
    }
    this.hipsYTarget = 0.86;
  }

  private applyTargetsImmediately(): void {
    const limbs: Limb[] = [this.torso, this.head, ...this.upperArm, ...this.forearm, ...this.pole, ...this.thigh, ...this.shin, ...this.ski];
    for (const limb of limbs) limb.pivot.rotation.copy(limb.target);
    this.hipsY = this.hipsYTarget;
    this.hips.position.y = this.hipsY;
  }

  /** Standing / tucking / carving / braking / skating on snow. */
  private groundTargets(s: RiderState): void {
    this.setNeutralTargets();
    const crouch = s.crouch;
    const speed = Math.hypot(s.vx, s.vz);
    // Knees bend and hips drop with crouch; torso folds forward.
    const knee = 0.55 + crouch * 1.35;
    const thighPitch = -0.32 - crouch * 0.95;
    this.hipsYTarget = 0.86 - crouch * 0.34;
    this.torso.target.x = 0.12 + crouch * 1.15;
    this.head.target.x = -0.08 - crouch * 0.75;

    // Skis follow the direction of travel a little when skidding.
    let skid = s.travelYaw - s.yaw;
    while (skid > Math.PI) skid -= Math.PI * 2;
    while (skid < -Math.PI) skid += Math.PI * 2;
    const braking = s.braking && !s.held;
    const hockey = braking && speed >= 3;
    const skiYaw = speed > 1.5 ? skid * (hockey ? 1 : 0.35) : 0;
    const wedge = braking && speed < 3 ? 0.42 : 0;

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.thigh[i].target.x = thighPitch;
      this.shin[i].target.x = knee;
      // Wedge: tips together (left ski yaws right, right ski yaws left).
      this.ski[i].target.set(-(thighPitch + knee), skiYaw - side * wedge, 0);
      // Arms: tucked back under the shoulders in a deep tuck, poles trailing.
      this.upperArm[i].target.set(0.35 - crouch * 1.4, 0, side * (0.18 - crouch * 0.1));
      this.forearm[i].target.set(-0.55 - crouch * 0.6, 0, 0);
      this.pole[i].target.set(0.55 + crouch * 1.5, 0, 0);
    }

    if (hockey) {
      // Hockey stop: body stays facing travel, leans away from it (uphill), poles drag behind.
      const lean = Math.sign(skid) * Math.min(1, Math.abs(skid) / 1.2);
      this.hipsYTarget -= 0.12;
      this.torso.target.set(0.45, -skid * 0.6, lean * 0.35);
      this.head.target.set(-0.2, skid * 0.4, -lean * 0.15);
      for (let i = 0; i < 2; i++) {
        this.thigh[i].target.x -= 0.35;
        this.thigh[i].target.z = lean * 0.3;
        this.shin[i].target.x += 0.5;
        this.upperArm[i].target.set(0.9, 0, (i === 0 ? -1 : 1) * 0.6);
        this.forearm[i].target.set(-0.3, 0, 0);
        this.pole[i].target.set(1.9, 0, 0);
      }
    }

    if (s.held) {
      // Ready at the gate: upright, poles planted ahead, weight forward.
      this.hipsYTarget = 0.88;
      this.torso.target.set(0.22, 0, 0);
      this.head.target.set(-0.15, 0, 0);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        this.thigh[i].target.set(-0.25, 0, 0);
        this.shin[i].target.set(0.45, 0, 0);
        this.ski[i].target.set(-0.2, 0, 0);
        this.upperArm[i].target.set(-0.95, 0, side * 0.25);
        this.forearm[i].target.set(-0.45, 0, 0);
        this.pole[i].target.set(0.95, 0, side * 0.08);
      }
      return;
    }

    // Skating stride below walking pace: alternate leg push and pole plant.
    if (speed < 6.5 && speed > 0.2 && crouch < 0.5) {
      const phase = Math.sin(s.stride * 2.4);
      const amp = 0.35 * (1 - speed / 6.5);
      this.thigh[0].target.x += phase * amp;
      this.thigh[1].target.x -= phase * amp;
      this.thigh[0].target.z = -0.12 * amp * 2;
      this.thigh[1].target.z = 0.12 * amp * 2;
      this.ski[0].target.y += 0.22 * amp * 2;
      this.ski[1].target.y -= 0.22 * amp * 2;
      this.upperArm[0].target.x -= phase * amp * 1.2;
      this.upperArm[1].target.x += phase * amp * 1.2;
    }

    // Edge: outside leg straighter, inside knee driven in.
    const edge = s.edge;
    const inside = edge > 0 ? 1 : 0;
    const outside = 1 - inside;
    const e = Math.abs(edge);
    this.thigh[inside].target.z = -edge * 0.35;
    this.thigh[outside].target.z = -edge * 0.15;
    this.shin[inside].target.x += e * 0.25;
    this.torso.target.z = -edge * 0.18;
    this.head.target.z = edge * 0.12;
  }

  private airTargets(s: RiderState): void {
    this.setNeutralTargets();
    this.hipsYTarget = 0.86;
    const tuck = 0.35 + s.crouch * 0.4;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.thigh[i].target.set(-0.4 - tuck * 0.9, 0, 0);
      this.shin[i].target.set(0.6 + tuck * 0.8, 0, 0);
      this.ski[i].target.set(-0.2, 0, 0);
      this.upperArm[i].target.set(-0.4, 0, side * 0.9);
      this.forearm[i].target.set(-0.3, 0, 0);
      this.pole[i].target.set(0.6, 0, 0);
    }
    this.torso.target.set(0.2, 0, 0);
    switch (s.grab) {
      case "mute": {
        // Right hand reaches across to the left ski between the boots.
        this.torso.target.set(0.55, 0, 0.2);
        this.upperArm[1].target.set(1.3, 0, -0.9);
        this.forearm[1].target.set(-0.2, 0, 0);
        this.pole[1].target.set(-0.2, 0, 0);
        this.upperArm[0].target.set(-0.9, 0, -1.2);
        for (let i = 0; i < 2; i++) { this.thigh[i].target.x = -1.5; this.shin[i].target.x = 1.6; }
        break;
      }
      case "eagle": {
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? -1 : 1;
          this.thigh[i].target.set(-0.2, 0, -side * 1.0);
          this.shin[i].target.set(0.15, 0, 0);
          this.ski[i].target.set(0, 0, 0);
          this.upperArm[i].target.set(0, 0, -side * 1.9);
          this.forearm[i].target.set(0, 0, 0);
          this.pole[i].target.set(0.3, 0, 0);
        }
        this.torso.target.set(-0.15, 0, 0);
        this.head.target.set(-0.2, 0, 0);
        break;
      }
      case "daffy": {
        this.thigh[0].target.set(-1.4, 0, 0);
        this.shin[0].target.set(0.2, 0, 0);
        this.thigh[1].target.set(0.9, 0, 0);
        this.shin[1].target.set(0.9, 0, 0);
        this.ski[0].target.set(0.1, 0, 0);
        this.ski[1].target.set(-0.4, 0, 0);
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? -1 : 1;
          this.upperArm[i].target.set(-2.6, 0, side * 0.5);
          this.forearm[i].target.set(-0.2, 0, 0);
          this.pole[i].target.set(0.2, 0, 0);
        }
        break;
      }
      case "twister": {
        this.torso.target.set(0.2, 60 * DEG, 0);
        this.head.target.set(0, -25 * DEG, 0);
        for (let i = 0; i < 2; i++) {
          this.thigh[i].target.set(-0.9, 0, 0);
          this.shin[i].target.set(1.1, 0, 0);
          this.ski[i].target.set(-0.2, -20 * DEG, 0);
        }
        this.upperArm[0].target.set(-0.4, 0, -1.6);
        this.upperArm[1].target.set(-0.4, 0, 1.6);
        break;
      }
      default:
        break;
    }
  }

  private crashTargets(s: RiderState): void {
    this.setNeutralTargets();
    const p = s.stride * 3 + s.crash * 5;
    this.hipsYTarget = 0.35;
    this.torso.target.set(0.6 + Math.sin(p) * 0.3, Math.cos(p * 0.7) * 0.4, Math.sin(p * 1.3) * 0.3);
    this.head.target.set(Math.sin(p * 1.1) * 0.4, 0, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.thigh[i].target.set(-0.6 + Math.sin(p + i) * 0.6, 0, side * 0.5);
      this.shin[i].target.set(0.8 + Math.cos(p * 1.2 + i) * 0.5, 0, 0);
      this.ski[i].target.set(-0.3, side * 0.5, side * 0.6);
      this.upperArm[i].target.set(-1.2 + Math.sin(p * 0.9 + i * 2) * 0.8, 0, side * 1.6);
      this.forearm[i].target.set(-0.4, 0, 0);
      this.pole[i].target.set(1.2, side * 0.6, 0);
    }
  }

  private liftTargets(): void {
    this.setNeutralTargets();
    this.hipsYTarget = 0.62;
    this.torso.target.set(-0.05, 0, 0);
    this.head.target.set(0, 0, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.thigh[i].target.set(-1.5, 0, side * 0.05);
      this.shin[i].target.set(1.35, 0, 0);
      this.ski[i].target.set(0.2, 0, 0);
      this.upperArm[i].target.set(-0.5, 0, side * 0.15);
      this.forearm[i].target.set(-1.3, 0, 0);
      this.pole[i].target.set(1.5, side * 1.4, 0);
    }
  }

  // ─── Frame update ──────────────────────────────────────────

  update(frame: RenderFrame): void {
    if (this.ghost) return;
    const s = frame.state;
    const dt = Math.min(frame.dt, 0.1);
    const onLift = s.liftIndex >= 0;
    const crashed = s.crash > 0;

    if (onLift) this.liftTargets();
    else if (crashed) this.crashTargets(s);
    else if (!s.onGround) this.airTargets(s);
    else this.groundTargets(s);

    const rate = crashed ? 14 : s.grab ? 9 : 12;
    const limbs: Limb[] = [this.torso, this.head, ...this.upperArm, ...this.forearm, ...this.pole, ...this.thigh, ...this.shin, ...this.ski];
    for (const limb of limbs) dampEuler(limb.pivot.rotation, limb.target, rate, dt);
    this.hipsY = damp(this.hipsY, this.hipsYTarget, 10, dt);
    this.hips.position.y = this.hipsY;

    // Root position.
    this.root.position.set(s.x, s.y, s.z);
    if (onLift) this.root.position.y = s.y;

    // Root orientation: slope tilt × yaw(+spin) × flip × bank × tumble.
    const yaw = onLift ? s.liftSeat.heading : s.yaw + (s.onGround ? 0 : s.spin);
    const bankTarget = s.onGround && !crashed && !onLift ? -s.edge * 35 * DEG : 0;
    this.bank = damp(this.bank, bankTarget, 10, dt);
    const flipTarget = s.onGround || crashed || onLift ? 0 : s.flip;
    this.flip = damp(this.flip, flipTarget, s.onGround ? 14 : 30, dt);
    const lieTarget = crashed ? 1 : 0;
    this.lie = damp(this.lie, lieTarget, 8, dt);
    if (crashed) this.tumbleRoll += (s.speed * 1.4 + 2) * dt;
    this.tumble = damp(this.tumble, crashed ? this.tumbleRoll : Math.round(this.tumbleRoll / (Math.PI * 2)) * Math.PI * 2, crashed ? 30 : 6, dt);
    if (!crashed && Math.abs(this.tumble - this.tumbleRoll) < 0.01) this.tumbleRoll = this.tumble;

    if (s.onGround && !onLift) {
      this.scratchV.set(s.nx, s.ny, s.nz).normalize();
      this.slopeQuatTarget.setFromUnitVectors(this.scratchUp, this.scratchV);
    } else {
      this.slopeQuatTarget.identity();
    }
    this.slopeQuat.slerp(this.slopeQuatTarget, 1 - Math.exp(-10 * dt));

    this.yawQuat.setFromAxisAngle(this.yAxis, yaw);
    this.bodyQuat.setFromAxisAngle(this.xAxis, this.flip);
    this.yawQuat.multiply(this.bodyQuat);
    this.bodyQuat.setFromAxisAngle(this.zAxis, this.bank);
    this.yawQuat.multiply(this.bodyQuat);
    if (this.lie > 0.001) {
      // Tumble: roll about the direction of travel and lie down.
      this.bodyQuat.setFromAxisAngle(this.zAxis, this.tumble * this.lie);
      this.yawQuat.multiply(this.bodyQuat);
      this.bodyQuat.setFromAxisAngle(this.xAxis, -1.2 * this.lie);
      this.yawQuat.multiply(this.bodyQuat);
    }
    this.root.quaternion.copy(this.slopeQuat).multiply(this.yawQuat);

    // Plant the pole tips on the snow while gliding upright (or parked at the gate):
    // aim each pole from the hand down to the surface instead of trusting the damped
    // limb chain, which leaves the tips floating a few centimetres.
    if (s.onGround && !crashed && !onLift && (s.held || (s.crouch < 0.45 && !s.braking))) {
      this.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {
        const pole = this.pole[i].pivot;
        pole.getWorldPosition(this.poleWorld);
        const groundY = this.world.terrain.height(this.poleWorld.x, this.poleWorld.z) + 0.02;
        const drop = this.poleWorld.y - groundY;
        if (drop <= 0.2 || drop >= this.POLE_LENGTH + 0.05) continue;
        // World pitch that puts the tip on the ground; poles trail behind (or reach ahead at the gate).
        const pitch = Math.acos(Math.min(1, drop / this.POLE_LENGTH));
        const side = i === 0 ? -1 : 1;
        this.scratchE.set(s.held ? -pitch : pitch, yaw, side * 0.12, "YXZ");
        this.poleWorldQuat.setFromEuler(this.scratchE);
        if (pole.parent) pole.parent.getWorldQuaternion(this.poleParentQuat); else this.poleParentQuat.identity();
        this.poleLocalQuat.copy(this.poleParentQuat).invert().multiply(this.poleWorldQuat);
        pole.quaternion.slerp(this.poleLocalQuat, 1 - Math.exp(-14 * dt));
      }
    }

    // Blob shadow.
    if (this.blob && this.blobMaterial) {
      const gy = this.world.terrain.height(s.x, s.z);
      const n = this.world.terrain.normal(s.x, s.z, this.scratchN);
      const height = Math.max(0, s.y - gy);
      this.blob.position.set(s.x, gy + 0.03, s.z);
      this.scratchV.set(n.x, n.y, n.z).normalize();
      this.blob.quaternion.setFromUnitVectors(this.scratchUp, this.scratchV);
      const scale = 1 + Math.min(height, 12) * 0.12;
      this.blob.scale.set(scale, 1, scale);
      this.blobMaterial.opacity = Math.max(0, 1 - height / 14) * (onLift ? 0.3 : 1);
      this.blob.visible = this.blobMaterial.opacity > 0.02;
    }
  }

  setGhostPose(pose: GhostPose): void {
    this.root.visible = pose.visible;
    if (!pose.visible) return;
    this.root.position.set(pose.x, pose.y, pose.z);
    this.scratchE.set(0, pose.yaw, 0);
    this.root.quaternion.setFromEuler(this.scratchE);
    const crouch = pose.tucked ? 1 : 0;
    const knee = 0.55 + crouch * 1.35;
    const thighPitch = -0.32 - crouch * 0.95;
    this.hips.position.y = 0.86 - crouch * 0.34;
    this.torso.pivot.rotation.set(0.12 + crouch * 1.15 + (pose.crashed ? 0.8 : 0), 0, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      if (pose.airborne) {
        this.thigh[i].pivot.rotation.set(-0.9, 0, 0);
        this.shin[i].pivot.rotation.set(1.1, 0, 0);
        this.upperArm[i].pivot.rotation.set(-0.4, 0, side * 0.9);
      } else {
        this.thigh[i].pivot.rotation.set(thighPitch, 0, 0);
        this.shin[i].pivot.rotation.set(knee, 0, 0);
        this.upperArm[i].pivot.rotation.set(0.35 - crouch * 1.4, 0, side * 0.18);
      }
      this.ski[i].pivot.rotation.set(-(this.thigh[i].pivot.rotation.x + this.shin[i].pivot.rotation.x), 0, 0);
      this.forearm[i].pivot.rotation.set(-0.55, 0, 0);
      this.pole[i].pivot.rotation.set(0.55 + crouch * 1.5, 0, 0);
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    if (this.blob) this.scene.remove(this.blob);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) {
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map) map.dispose();
      m.dispose();
    }
  }
}
