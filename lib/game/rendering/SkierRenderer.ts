import * as THREE from "three";
import type { SimulationState, TerrainSampler, Vec3 } from "../core/types";

const UP = new THREE.Vector3(0, 1, 0);
/** Stable tumble axis — previously `new THREE.Vector3(0.6,0.4,0.7).normalize()` every crash frame. */
const TUMBLE_AXIS = new THREE.Vector3(0.6, 0.4, 0.7).normalize();
const normal: Vec3 = { x: 0, y: 1, z: 0 };
const normalVec = new THREE.Vector3();
const upScratch = new THREE.Vector3();

const material = (color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0, emissive: THREE.ColorRepresentation = 0) => {
  const result = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: emissive ? 0.35 : 0 });
  result.userData.heightFog = false;
  return result;
};

function limb(length: number, radius: number, mat: THREE.Material) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), mat);
  mesh.position.y = -length * 0.5 - radius * 0.5; mesh.castShadow = true; group.add(mesh);
  return group;
}

export class SkierRenderer {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL: THREE.Group; private readonly armR: THREE.Group;
  private readonly legL: THREE.Group; private readonly legR: THREE.Group;
  private readonly skiL: THREE.Group; private readonly skiR: THREE.Group;
  private readonly poleL: THREE.Group; private readonly poleR: THREE.Group;
  private readonly qGround = new THREE.Quaternion(); private readonly qYaw = new THREE.Quaternion();
  private tumble = 0;

  constructor(scene: THREE.Scene) {
    const suit = material(0x1b6fe0, 0.55), suit2 = material(0xf4f7fb, 0.6);
    const dark = material(0x1d2330, 0.65), skin = material(0xe8b58a, 0.75);
    const ski = material(0xff8b2e, 0.35, 0.3, 0xff6a00), pole = material(0xb9c4d2, 0.4, 0.7);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.30, 0.62, 4, 10), suit);
    torso.position.y = 1.16; torso.castShadow = true;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.42), suit2);
    chest.position.y = 1.30; chest.castShadow = true;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), material(0xe8ecf3, 0.35, 0.15));
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.30), material(0x101820, 0.15, 0.9, 0x3aa0ff));
    goggles.position.set(0, 0.03, 0.13);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skin); chin.position.set(0, -0.14, 0.06);
    this.head.add(helmet, goggles, chin); this.head.position.y = 1.72;
    this.armL = limb(0.52, 0.10, suit); this.armR = limb(0.52, 0.10, suit);
    this.armL.position.set(-0.36, 1.40, 0.02); this.armR.position.set(0.36, 1.40, 0.02);
    this.legL = limb(0.62, 0.13, dark); this.legR = limb(0.62, 0.13, dark);
    this.legL.position.set(-0.17, 0.86, 0); this.legR.position.set(0.17, 0.86, 0);
    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.24, 0.36), material(0x2b3444, 0.5));
    const bootR = bootL.clone(); bootL.position.set(-0.17, 0.16, 0.02); bootR.position.set(0.17, 0.16, 0.02);
    const skiGeometry = new THREE.BoxGeometry(0.16, 0.055, 1.86), tipGeometry = new THREE.ConeGeometry(0.09, 0.30, 6);
    const makeSki = () => {
      const group = new THREE.Group(), plank = new THREE.Mesh(skiGeometry, ski), tip = new THREE.Mesh(tipGeometry, ski), tail = tip.clone();
      tip.rotation.x = Math.PI / 2; tip.position.set(0, 0.05, 1.02); tail.rotation.x = -Math.PI / 2; tail.position.set(0, 0.03, -1);
      const binding = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.09, 0.34), dark); binding.position.y = 0.06;
      group.add(plank, tip, tail, binding); return group;
    };
    this.skiL = makeSki(); this.skiR = makeSki();
    const makePole = () => {
      const group = new THREE.Group(), shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 1.24, 5), pole);
      shaft.position.y = -0.62; const basket = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 5, 8), dark);
      basket.rotation.x = Math.PI / 2; basket.position.y = -1.12; group.add(shaft, basket); return group;
    };
    this.poleL = makePole(); this.poleR = makePole();
    this.poleL.position.set(-0.42, 1.16, 0.06); this.poleR.position.set(0.42, 1.16, 0.06);
    this.body.add(torso, chest, this.head, this.armL, this.armR, this.legL, this.legR, bootL, bootR, this.skiL, this.skiR, this.poleL, this.poleR);
    this.root.add(this.body); scene.add(this.root);
  }

  update(state: SimulationState, terrain: TerrainSampler, dt: number): void {
    this.root.position.set(state.pos.x, state.pos.y, state.pos.z);
    terrain.normal(state.pos.x, state.pos.z, normal);
    normalVec.set(normal.x, normal.y, normal.z);
    if (state.crash > 0) {
      this.tumble += dt * 9;
      this.qGround.setFromUnitVectors(UP, normalVec);
      this.qYaw.setFromAxisAngle(TUMBLE_AXIS, this.tumble);
      this.root.quaternion.copy(this.qGround).multiply(this.qYaw);
      this.body.position.y = 0;
      this.body.rotation.set(Math.sin(this.tumble * 1.7) * 0.8, 0, Math.cos(this.tumble * 1.3) * 0.7);
      this.armL.rotation.z = Math.sin(this.tumble * 2.1) * 1.4; this.armR.rotation.z = -Math.cos(this.tumble * 1.8) * 1.4;
      this.legL.rotation.x = Math.cos(this.tumble * 2.4); this.legR.rotation.x = -Math.sin(this.tumble * 2.2);
    } else {
      this.tumble = 0;
      upScratch.copy(UP).lerp(normalVec, state.onGround ? 1 : 0.25).normalize();
      this.qGround.setFromUnitVectors(UP, upScratch); this.qYaw.setFromAxisAngle(UP, state.yaw);
      this.root.quaternion.slerp(this.qGround.multiply(this.qYaw), 1 - Math.exp(-16 * dt));
      this.body.position.y = -state.crouch * 0.46;
      this.body.rotation.set(state.crouch * 0.72 + Math.min(1, Math.hypot(state.vel.x, state.vel.z) / 70) * 0.18 - (state.onGround ? 0 : 0.15), state.lean * 0.2, -state.lean * 0.46);
      const swing = Math.sin(state.time * 5.2) * 0.16 * (1 - state.crouch);
      this.armL.rotation.set(-0.35 - state.crouch * 0.9 + swing, 0, 0.45 + state.lean * 0.3);
      this.armR.rotation.set(-0.35 - state.crouch * 0.9 - swing, 0, -0.45 + state.lean * 0.3);
      this.poleL.rotation.set(0.9 + state.crouch * 0.6, 0, 0.5); this.poleR.rotation.set(0.9 + state.crouch * 0.6, 0, -0.5);
      this.poleL.position.set(-0.42 - state.lean * 0.05, 1.16 - state.crouch * 0.3, 0.06);
      this.poleR.position.set(0.42 - state.lean * 0.05, 1.16 - state.crouch * 0.3, 0.06);
      this.legL.rotation.set(state.crouch * 0.55, 0, 0.06 + state.lean * 0.12); this.legR.rotation.set(state.crouch * 0.55, 0, -0.06 + state.lean * 0.12);
      const spread = 0.19 + Math.abs(state.lean) * 0.06;
      this.skiL.position.set(-spread, 0.045, 0.05); this.skiR.position.set(spread, 0.045, 0.05);
      this.skiL.rotation.set(state.onGround ? 0 : 0.16, -state.lean * 0.1, state.lean * 0.42);
      this.skiR.rotation.copy(this.skiL.rotation); this.head.rotation.y = state.lean * 0.35;
    }
    if (state.liftIndex >= 0) {
      const lift = terrain.realLifts?.[state.liftIndex];
      const seated = lift && !/platter|drag_lift|t-bar|j-bar|rope_tow|magic_carpet/.test(lift.type);
      this.root.quaternion.setFromAxisAngle(UP, state.yaw);
      this.body.position.y = 0;
      this.body.rotation.set(0, 0, 0);
      if (seated) {
        this.legL.rotation.x = this.legR.rotation.x = -1.15;
        this.skiL.rotation.x = this.skiR.rotation.x = 0.35;
        this.armL.rotation.x = this.armR.rotation.x = -0.9;
      }
    }
    // Spawn/recovery immunity belongs to collision handling. Hiding the whole
    // skier made the first750ms capture and active turns randomly disappear.
    this.root.visible = true;
  }
}
