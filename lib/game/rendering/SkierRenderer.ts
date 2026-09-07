import * as THREE from "three";
import type { RiderPresentation } from "../config/rider-style";
const DUCK_FRONT_RAD = 15 * Math.PI / 180, DUCK_REAR_RAD = -6 * Math.PI / 180;
import type { SimulationState, TerrainSampler, Vec3 } from "../core/types";
import { DEFAULT_RIDER_STYLE, OUTFITS, type RiderStyle } from "../config/rider-style";
import { coloredParts, styledDeckGeometry, ellipsoid, jacketGeometry, sleeveGeometry, yetiHeadGeometry, yetiPawGeometry } from "./rider-geometry";

export interface RenderedGroundSampler { sampleRenderedHeight(x: number, z: number): number }
type RiderPose = SimulationState & { boardRoll?: number; grabTime?: number; stumble?: boolean };
const contactScratch = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const TUMBLE_AXIS = new THREE.Vector3(.6, .4, .7).normalize();
const normal: Vec3 = { x: 0, y: 1, z: 0 };
const normalVec = new THREE.Vector3(), upScratch = new THREE.Vector3();
const origin = new THREE.Vector3(), target = new THREE.Vector3(), bend = new THREE.Vector3();
const direction = new THREE.Vector3(), perpendicular = new THREE.Vector3(), joint = new THREE.Vector3();

function material(color: number, roughness = .7, metalness = 0, vertexColors = false) {
  const result = new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors });
  result.userData.heightFog = false;
  return result;
}
function mesh(name: string, geometry: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const result = new THREE.Mesh(geometry, mat);
  result.name = name; result.castShadow = true;
  return result;
}
function segment(part: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  direction.subVectors(b, a);
  const length = direction.length();
  part.position.copy(a);
  part.quaternion.setFromUnitVectors(UP, direction.multiplyScalar(1 / Math.max(.0001, length)));
  part.scale.y = length;
}

/** Two-bone IK keeps boots planted and sleeves connected, including during deep crouches. */
class Limb {
  readonly upper: THREE.Mesh;
  readonly lower: THREE.Mesh;
  constructor(parent: THREE.Group, name: string, mat: THREE.Material, private readonly a: number, private readonly b: number, radius: number) {
    this.upper = mesh(`${name}-upper`, sleeveGeometry(radius, a), mat);
    this.lower = mesh(`${name}-lower`, sleeveGeometry(radius * .88, b), mat);
    parent.add(this.upper, this.lower);
  }
  pose(start: THREE.Vector3, end: THREE.Vector3, pole: THREE.Vector3): void {
    direction.subVectors(end, start);
    const distance = Math.max(.0001, direction.length());
    direction.multiplyScalar(1 / distance);
    const reach = Math.min(this.a + this.b - .001, Math.max(Math.abs(this.a - this.b) + .001, distance));
    const along = (this.a * this.a - this.b * this.b + reach * reach) / (2 * reach);
    perpendicular.copy(pole).addScaledVector(direction, -pole.dot(direction));
    if (perpendicular.lengthSq() < .000001) perpendicular.set(1, 0, 0).addScaledVector(direction, -direction.x);
    perpendicular.normalize();
    joint.copy(start).addScaledVector(direction, along).addScaledVector(perpendicular, Math.sqrt(Math.max(0, this.a * this.a - along * along)));
    segment(this.upper, start, joint);
    segment(this.lower, joint, end);
  }
}

export class SkierRenderer {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly equipment = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL: Limb; private readonly armR: Limb;
  private readonly legL: Limb; private readonly legR: Limb;
  private readonly gloveL: THREE.Mesh; private readonly gloveR: THREE.Mesh;
  private readonly footL = new THREE.Group(); private readonly footR = new THREE.Group();
  private readonly board: THREE.Mesh | null;
  private readonly poleL: THREE.Mesh | null; private readonly poleR: THREE.Mesh | null;
  private readonly qGround = new THREE.Quaternion(); private readonly qYaw = new THREE.Quaternion();
  private readonly snowboard: boolean;
  private readonly side: number;
  private readonly shoulderWidth: number;
  private tumble = 0;
  private crouch = 0;
  private lean = 0;
  private grabBlend = 0;

  constructor(scene: THREE.Scene, config?: RiderPresentation, style: RiderStyle = DEFAULT_RIDER_STYLE) {
    this.snowboard = config?.riderMode === "snowboarder";
    this.side = config?.stance === "goofy" ? -1 : 1;
    const yeti = style.character === "yeti", outfit = OUTFITS[style.outfit];
    this.shoulderWidth = yeti ? .305 : .245;
    const suit = material(outfit.sleeves, .9), dark = material(outfit.pants, .9);
    const clothing = material(0xffffff, .8, 0, true), goggles = material(outfit.lens, .24, .4);
    const equipment = material(0xffffff, .5, .1, true);
    this.root.userData.riderStyle = style;
    this.root.name = "rider"; this.body.name = "rider-torso"; this.head.name = "rider-head";
    const jacket = jacketGeometry(outfit);
    if (yeti) jacket.scale(1.25, 1, 1.17);
    this.body.add(mesh("jacket", jacket, clothing));
    this.body.add(mesh("trouser-seat", ellipsoid(yeti ? .245 : .21, .13, .14, 0, -.035, 0), dark));
    const helmet = yeti ? yetiHeadGeometry() : coloredParts([
      [ellipsoid(.145, .15, .17, 0, .035, -.015), 0xecf0eb],
      [ellipsoid(.137, .105, .137, 0, -.035, .015), 0xdba881],
      [ellipsoid(.144, .062, .13, 0, -.105, .0), 0x233044],
      [ellipsoid(.15, .035, .171, 0, .014, -.015), 0x28364a],
      [ellipsoid(.132, .071, .047, 0, .003, .133), 0x162233],
    ]);
    this.head.add(mesh(yeti ? "yeti-fur-and-face" : "helmet-and-gaiter", helmet, clothing));
    this.head.add(mesh("curved-goggle-lens", ellipsoid(yeti ? .179 : .12, .056, .045, 0, yeti ? .047 : .006, yeti ? .19 : .151), goggles));
    this.head.position.set(0, yeti ? .765 : .715, .015); this.body.add(this.head);
    this.armL = new Limb(this.root, "left-arm", suit, .285, .265, yeti ? .113 : .09);
    this.armR = new Limb(this.root, "right-arm", suit, .285, .265, yeti ? .113 : .09);
    this.legL = new Limb(this.root, "left-leg", dark, .40, .38, yeti ? .14 : .125);
    this.legR = new Limb(this.root, "right-leg", dark, .40, .38, yeti ? .14 : .125);
    const glove = yeti ? yetiPawGeometry() : coloredParts([
      [ellipsoid(.061, .09, .065, 0, .035, .015), 0x172231],
      [ellipsoid(.03, .052, .032, -.045, .015, .045), 0x172231],
      [ellipsoid(.069, .032, .065, 0, -.025, 0), 0x33485b],
    ]);
    this.gloveL = mesh("left-glove", glove, clothing); this.gloveR = mesh("right-glove", glove, clothing);
    this.root.add(this.body, this.gloveL, this.gloveR, this.equipment);
    this.equipment.name = "rider-equipment";
    this.equipment.add(this.footL, this.footR);
    this.footL.name = "left-foot"; this.footR.name = "right-foot";
    const boot = coloredParts([
      [ellipsoid(.085, .07, .18, 0, .10, .065), 0x162233],
      [ellipsoid(.082, .14, .10, 0, .19, -.015), 0x344457],
      [ellipsoid(.083, .022, .107, 0, .22, -.006), 0xb8c5cc],
      [ellipsoid(.084, .02, .107, 0, .15, .025), 0x111c2b],
      [ellipsoid(.10, .025, .185, 0, .06, .055), 0x172231],
    ]);
    if (yeti) boot.scale(1.13, 1, 1.08);
    this.footL.add(mesh("left-boot", boot, clothing)); this.footR.add(mesh("right-boot", boot, clothing));
    if (this.snowboard) {
      this.board = mesh("snowboard", styledDeckGeometry(.40, 1.60, style.board), equipment);
      this.board.position.y = .035; this.equipment.add(this.board);
      this.poleL = this.poleR = null;
    } else {
      this.board = null;
      const ski = styledDeckGeometry(.14, 1.85, style.skis);
      this.footL.add(mesh("left-ski", ski, equipment)); this.footR.add(mesh("right-ski", ski, equipment));
      const pole = coloredParts([
        [new THREE.CylinderGeometry(.012, .009, 1.05, 6).translate(0, -.525, 0), 0xa7b6c5],
        [ellipsoid(.055, .012, .055, 0, -.97, 0), 0x172231],
        [ellipsoid(.022, .07, .023, 0, -.035, 0), 0x172231],
      ]);
      this.poleL = mesh("left-pole", pole, clothing); this.poleR = mesh("right-pole", pole, clothing);
      this.root.add(this.poleL, this.poleR);
    }
    scene.add(this.root);
  }

  update(state: RiderPose, terrain: Pick<TerrainSampler, "normal" | "height" | "realLifts">, dt: number, renderedGround?: RenderedGroundSampler): void {
    this.root.position.set(state.pos.x, state.pos.y, state.pos.z);
    terrain.normal(state.pos.x, state.pos.z, normal);
    normalVec.set(normal.x, normal.y, normal.z);
    const crashing = state.crash > 0 && !state.stumble;
    const blend = 1 - Math.exp(-14 * dt);
    const grab = this.snowboard && !state.onGround && (state.grabTime ?? 0) > 0;
    this.grabBlend += ((grab ? 1 : 0) - this.grabBlend) * blend;
    const charge = this.snowboard ? Math.min(1, state.jumpCharge / .4) : 0;
    this.crouch += (Math.max(state.crouch, charge, grab ? .85 : 0) - this.crouch) * blend;
    this.lean += (state.lean - this.lean) * blend;
    if (crashing) {
      this.tumble += dt * 9;
      this.qGround.setFromUnitVectors(UP, normalVec);
      this.qYaw.setFromAxisAngle(TUMBLE_AXIS, this.tumble);
      this.root.quaternion.copy(this.qGround).multiply(this.qYaw);
    } else {
      this.tumble = 0;
      upScratch.copy(UP).lerp(normalVec, state.onGround ? 1 : .25).normalize();
      this.qGround.setFromUnitVectors(UP, upScratch); this.qYaw.setFromAxisAngle(UP, state.yaw);
      this.root.quaternion.slerp(this.qGround.multiply(this.qYaw), 1 - Math.exp(-16 * dt));
    }
    const c = this.crouch, lean = this.lean;
    const facing = this.snowboard ? this.side * Math.PI / 2 : 0;
    const breath = Math.sin(state.time * 2.2) * .006 * (1 - c);
    this.body.position.set(-lean * .13, .91 - c * .28 - this.grabBlend * .16 + breath, this.snowboard ? -.035 : -.07 - c * .15);
    this.body.rotation.set(.10 + c * .45 + this.grabBlend * .32, facing + lean * .10, -lean * .23, "YXZ");
    if (state.stumble) this.body.rotation.x += Math.sin(state.crash * 24) * .18;
    if (state.liftIndex >= 0) {
      this.root.quaternion.setFromAxisAngle(UP, state.yaw);
      const lift = terrain.realLifts?.[state.liftIndex];
      if (lift && !/platter|drag_lift|t-bar|j-bar|rope_tow|magic_carpet/.test(lift.type)) {
        this.body.position.y = .64;
        this.body.rotation.set(.08, facing, 0, "YXZ");
      }
    }
    this.body.updateMatrix();
    this.head.rotation.set(-c * .20, this.snowboard ? -this.side * 1.15 : -lean * .20, lean * .08);
    const spread = .18 + Math.abs(lean) * .025;
    this.footL.position.set(this.snowboard ? 0 : -spread, .035, this.snowboard ? this.side * .29 : .025);
    this.footR.position.set(this.snowboard ? 0 : spread, .035, this.snowboard ? -this.side * .29 : .025);
    this.footL.rotation.set(0, facing + (this.snowboard ? -this.side * (this.side > 0 ? DUCK_FRONT_RAD : DUCK_REAR_RAD) : -lean * .06), 0);
    this.footR.rotation.set(0, facing + (this.snowboard ? -this.side * (this.side > 0 ? DUCK_REAR_RAD : DUCK_FRONT_RAD) : -lean * .06), 0);
    this.equipment.rotation.z = this.snowboard ? -(state.boardRoll ?? state.lean * .6) * .12 : lean * .08;
    // Lift by the width of the edged deck so its lower edge stays above the snow.
    this.equipment.position.y = Math.abs(Math.sin(this.equipment.rotation.z)) * (this.snowboard ? .20 : spread + .07);
    this.equipment.position.y += this.grabBlend * .18;
    this.equipment.updateMatrix();
    this.poseLeg(this.legL, this.footL, -.14, facing);
    this.poseLeg(this.legR, this.footR, .14, facing);
    this.poseArm(this.armL, this.gloveL, this.poleL, -1, c, lean, facing, crashing, grab);
    this.poseArm(this.armR, this.gloveR, this.poleR, 1, c, lean, facing, crashing, false);
    if (renderedGround && state.onGround && state.liftIndex < 0 && state.crash <= 0) {
      const supportOffset = state.pos.y - terrain.height(state.pos.x, state.pos.z);
      this.root.position.y = renderedGround.sampleRenderedHeight(state.pos.x, state.pos.z) + supportOffset;
      const clearance = this.snowboard
        ? this.deckClearance(null, renderedGround, supportOffset, .20, .8)
        : Math.max(this.deckClearance(this.footL, renderedGround, supportOffset, .08, .93), this.deckClearance(this.footR, renderedGround, supportOffset, .08, .93));
      this.root.position.y += Math.max(0, clearance);
    }
    // Preserve main's visibility fix: immunity must not blink the rider out of the scene.
    this.root.visible = true;
  }

  private deckClearance(foot: THREE.Group | null, ground: RenderedGroundSampler, support: number, halfWidth: number, halfLength: number): number {
    foot?.updateMatrix();
    let clearance = 0;
    for (let i = -1; i <= 1; i++) for (let side = -1; side <= 1; side += 2) {
      contactScratch.set(side * halfWidth, 0, i * halfLength);
      if (foot) contactScratch.applyMatrix4(foot.matrix);
      else contactScratch.y += .035;
      contactScratch.applyMatrix4(this.equipment.matrix).applyQuaternion(this.root.quaternion).add(this.root.position);
      clearance = Math.max(clearance, ground.sampleRenderedHeight(contactScratch.x, contactScratch.z) + support + .01 - contactScratch.y);
    }
    return clearance;
  }

  private poseLeg(limb: Limb, foot: THREE.Group, x: number, facing: number): void {
    origin.set(x, -.025, 0).applyMatrix4(this.body.matrix);
    target.set(0, .23, 0); foot.updateMatrix();
    target.applyMatrix4(foot.matrix).applyMatrix4(this.equipment.matrix);
    bend.set(Math.sin(facing), .05, Math.cos(facing));
    limb.pose(origin, target, bend);
  }

  private poseArm(limb: Limb, glove: THREE.Mesh, pole: THREE.Mesh | null, side: number, crouch: number, lean: number, facing: number, crashing: boolean, grab: boolean): void {
    origin.set(side * this.shoulderWidth, .465, 0).applyMatrix4(this.body.matrix);
    // Relaxed bent elbows; outside hand opens in a turn while the inside hand stays lower.
    target.set(side * (this.shoulderWidth + .095 + Math.abs(lean) * .08), .10 - crouch * .02 + side * lean * .10, .22 + crouch * .19);
    if (crashing) target.set(side * .55, .25 + Math.sin(this.tumble + side) * .3, .05);
    target.applyMatrix4(this.body.matrix);
    if (grab) {
      target.x += (this.side * .18 - target.x) * this.grabBlend;
      target.y += (this.equipment.position.y + .17 - target.y) * this.grabBlend;
      target.z += (this.side * .18 - target.z) * this.grabBlend;
    }
    direction.subVectors(target, origin).clampLength(0, .549);
    target.copy(origin).add(direction);
    bend.set(side * .65 * Math.cos(facing) - .3 * Math.sin(facing), -.3, -side * .65 * Math.sin(facing) - .3 * Math.cos(facing));
    limb.pose(origin, target, bend);
    glove.position.copy(target); glove.quaternion.copy(limb.lower.quaternion);
    if (pole) { pole.position.copy(target); pole.rotation.set(.45 + crouch * .6, 0, side * .13); }
  }
}
