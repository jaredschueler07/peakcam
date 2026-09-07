import * as THREE from "three";
import { GEAR, OUTFITS, type GearId, type OutfitPalette } from "../config/rider-style";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Construction-only helpers. Clothing details share one draw per articulated part. */
export function ellipsoid(x: number, y: number, z: number, px = 0, py = 0, pz = 0): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 10, 6).scale(x, y, z).translate(px, py, pz);
}

export function coloredParts(parts: readonly [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const color = new THREE.Color();
  for (const [geometry, hex] of parts) {
    color.setHex(hex);
    const count = geometry.getAttribute("position").count;
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(values, i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
  }
  const merged = mergeGeometries(parts.map(([geometry]) => geometry), false)!;
  for (const [geometry] of parts) geometry.dispose();
  return merged;
}

/** Tailored jacket: curved hem, waist, chest and shoulder profiles, flattened front/back. */
export function jacketGeometry(outfit: OutfitPalette = OUTFITS.alpenglow): THREE.BufferGeometry {
  const profile = [[0, -.035], [.18, -.03], [.215, .015], [.22, .09], [.195, .23], [.245, .41], [.25, .46], [.21, .51], [.115, .56], [0, .56]];
  const shell = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 16).scale(1, 1, .72);
  const parts: [THREE.BufferGeometry, number][] = [[shell, outfit.jacket],
    [ellipsoid(.12, .075, .10, 0, .555, 0), outfit.trim],
    [ellipsoid(.012, outfit.cut === "anorak" ? .08 : .215, .012, 0, outfit.cut === "anorak" ? .43 : .285, .157), outfit.trim],
  ];
  if (outfit.cut === "vest") {
    // Raised quilt channels wrap the vest, visible from the chase camera too.
    for (let i = 0; i < 4; i++) parts.push([ellipsoid(.218, .038, .153, 0, .08 + i * .105, 0), outfit.jacket]);
    parts.push([ellipsoid(.026, .035, .012, -.13, .37, .15), outfit.accent]);
  } else {
    parts.push([ellipsoid(.16, .11, .105, 0, .49, -.13), outfit.trim]);
    const stripe = new THREE.CylinderGeometry(.244, .224, .075, 16, 1, true).scale(1, 1, .74).translate(0, .375, 0);
    parts.push([stripe, outfit.accent]);
    if (outfit.cut === "anorak") parts.push([ellipsoid(.145, .063, .025, 0, .15, .139), outfit.trim]);
    else {
      parts.push([ellipsoid(.07, .014, .008, -.09, .13, .143), outfit.trim]);
      parts.push([ellipsoid(.07, .014, .008, .09, .13, .143), outfit.trim]);
    }
  }
  return coloredParts(parts);
}

/** Rounded, tapered sleeve/trouser segment, aligned along +Y with joints at 0 and 1. */
export function sleeveGeometry(radius: number, length: number): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry([
    new THREE.Vector2(0, -radius * .65), new THREE.Vector2(radius * .65, -radius * .48),
    new THREE.Vector2(radius * .92, -radius * .15),
    new THREE.Vector2(radius, .04), new THREE.Vector2(radius * .98, length * .3),
    new THREE.Vector2(radius * .84, length * .74), new THREE.Vector2(radius * .72, length),
    new THREE.Vector2(radius * .55, length + radius * .32),
    new THREE.Vector2(0, length + radius * .5),
  ], 10);
  return geometry.scale(1, 1 / length, .9);
}

/** Rounded sidecut outline with a raised nose/tail, no rectangular plank or cone tips. */
export function deckGeometry(width: number, length: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2;
    const z = Math.cos(a) * length / 2;
    const x = Math.sin(a) * width / 2 * (1 + .7 * Math.abs(Math.cos(a)));
    if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .025, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.rotateX(Math.PI / 2);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const end = Math.max(0, (Math.abs(positions.getZ(i)) / (length / 2) - .68) / .32);
    positions.setY(i, positions.getY(i) + .025 + end * end * .095);
  }
  geometry.computeVertexNormals();
  return geometry;
}


const FUR = 0xf1e7cf;
/** Chunky clumps give fur a silhouette without alpha cards, textures, or hair simulation. */
function tuft(x: number, y: number, z: number, radius: number, length: number, tilt = 0): THREE.BufferGeometry {
  return new THREE.ConeGeometry(radius, length, 5).rotateZ(tilt).translate(x, y, z);
}
export function yetiHeadGeometry(): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, number][] = [
    [ellipsoid(.225, .225, .19, 0, .01, -.005), FUR],
    [ellipsoid(.083, .105, .07, -.217, .015, -.015), 0xe3d5b2],
    [ellipsoid(.083, .105, .07, .217, .015, -.015), 0xe3d5b2],
    [ellipsoid(.147, .108, .064, 0, -.077, .159), 0x8eaaa5],
    [ellipsoid(.062, .035, .042, 0, -.035, .211), 0x30505a],
    [ellipsoid(.082, .019, .025, .014, -.112, .217), 0x30505a],
    [tuft(-.048, -.118, .233, .016, .042, Math.PI), 0xfaf4e6],
    [tuft(.064, -.118, .233, .016, .035, Math.PI), 0xfaf4e6],
    [ellipsoid(.228, .039, .193, 0, .06, -.01), 0x30505a],
    [ellipsoid(.192, .078, .043, 0, .046, .168), 0x2a1f14],
  ];
  for (let i = -2; i <= 2; i++) {
    parts.push([tuft(i * .065, .20 - Math.abs(i) * .018, -.005, .065, .15, -i * .19), FUR]);
    parts.push([tuft(i * .07, -.19 + Math.abs(i) * .012, .04, .06, .13, Math.PI + i * .20), FUR]);
  }
  for (const side of [-1, 1]) {
    parts.push([tuft(side * .20, -.08, .03, .075, .19, side * .7 + Math.PI), FUR]);
    parts.push([tuft(side * .19, .13, -.07, .072, .15, -side * .8), FUR]);
  }
  return coloredParts(parts);
}
export function yetiPawGeometry(): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, number][] = [
    [ellipsoid(.09, .105, .085, 0, .045, .01), FUR],
    [ellipsoid(.043, .07, .048, -.07, .045, .042), FUR],
    [ellipsoid(.072, .075, .018, 0, .058, .085), 0x668782],
  ];
  for (let i = -1; i <= 1; i++) parts.push([tuft(i * .055, -.045, 0, .044, .09), FUR]);
  return coloredParts(parts);
}

/** Print is baked into deck vertex colors, so gear swaps add no textures or draw calls. */
export function styledDeckGeometry(width: number, length: number, style: GearId): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const palette = GEAR[style], color = new THREE.Color();
  const halfWidth = (t: number) => width / 2 * Math.sqrt(Math.max(0, 1 - t * t)) * (1 + .7 * Math.abs(t));
  const top = (t: number) => .025 + Math.pow(Math.max(0, (Math.abs(t) - .68) / .32), 2) * .095;
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, printed: boolean) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const x = (ax + bx + cx) / (3 * width), z = (az + bz + cz) / (3 * length);
    let hex = printed ? palette.base : palette.ink;
    if (printed && style === "sunrise") hex = z > .22 ? palette.accent : z < -.30 ? palette.ink : palette.base;
    if (printed && style === "ridgeline") hex = z > .13 + Math.abs(x) * .32 ? palette.accent : z < -.32 ? palette.ink : palette.base;
    if (printed && style === "nightfall") hex = z + x * .35 > .17 ? palette.accent : z + x * .35 < -.21 ? palette.ink : palette.base;
    color.setHex(hex);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < 24; i++) {
    const a = i / 12 - 1, b = (i + 1) / 12 - 1;
    const wa = halfWidth(a), wb = halfWidth(b), ya = top(a), yb = top(b), za = a * length / 2, zb = b * length / 2;
    for (let column = 0; column < 4; column++) {
      const l = column / 2 - 1, r = (column + 1) / 2 - 1;
      tri(l * wa, ya, za, l * wb, yb, zb, r * wa, ya, za, true);
      tri(r * wa, ya, za, l * wb, yb, zb, r * wb, yb, zb, true);
    }
    tri(-wa, ya - .025, za, wa, ya - .025, za, -wb, yb - .025, zb, false);
    tri(wa, ya - .025, za, wb, yb - .025, zb, -wb, yb - .025, zb, false);
    tri(-wa, ya, za, -wa, ya - .025, za, -wb, yb, zb, false);
    tri(-wa, ya - .025, za, -wb, yb - .025, zb, -wb, yb, zb, false);
    tri(wa, ya, za, wb, yb, zb, wa, ya - .025, za, false);
    tri(wa, ya - .025, za, wb, yb, zb, wb, yb - .025, zb, false);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
