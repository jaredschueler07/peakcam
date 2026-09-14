"use client";

/**
 * components/descent/RiderGallery.tsx
 * ───────────────────────────────────
 * Dev gallery: renders the real Drop In rider rig (`lib/descent/render/RiderMesh.ts`)
 * in every variant and pose, from several angles, using the game's own lights.
 * One WebGL context renders tile after tile into 2-D canvases; the page also
 * exposes `window.__riderGallery` (tile labels + PNG data URLs) so a script can
 * collect the images.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GEAR, OUTFITS, type GearId, type OutfitId, type RiderCharacter, type RiderStyle } from "@/lib/game/config/rider-style";
import type { RiderMode, SnowboardStance } from "@/lib/game/core/config";
import { createRiderState } from "@/lib/descent/sim/rider";
import type { RiderState, World } from "@/lib/descent/types";
import type { RenderFrame } from "@/lib/descent/render/frame";
import { RiderMesh } from "@/lib/descent/render/RiderMesh";

export interface GalleryTile { group: string; label: string; dataUrl: string }

const TILE = 360;
const VIEWS: { name: string; azimuth: number; elevation: number; distance: number }[] = [
  { name: "front ¾", azimuth: Math.PI * 0.8, elevation: 0.32, distance: 4.2 },
  { name: "side", azimuth: Math.PI * 0.5, elevation: 0.18, distance: 4.2 },
  { name: "back ¾", azimuth: Math.PI * 0.22, elevation: 0.36, distance: 4.2 },
  { name: "overhead", azimuth: Math.PI * 0.65, elevation: 1.05, distance: 4.6 },
];

interface Pose { name: string; apply(s: RiderState): void }
const POSES: Pose[] = [
  { name: "at the gate (held)", apply: (s) => { s.held = true; } },
  { name: "gliding 40 km/h", apply: (s) => { s.speed = 11; s.vz = 11; } },
  { name: "full tuck", apply: (s) => { s.speed = 30; s.vz = 30; s.crouch = 1; s.tucking = true; } },
  { name: "carving right", apply: (s) => { s.speed = 18; s.vz = 18; s.edge = 0.85; s.crouch = 0.35; } },
  { name: "carving left", apply: (s) => { s.speed = 18; s.vz = 18; s.edge = -0.85; s.crouch = 0.35; } },
  { name: "braking / smear", apply: (s) => { s.speed = 9; s.vz = 9; s.braking = true; s.travelYaw = 0.7; s.edge = 0.5; } },
  { name: "skating a flat", apply: (s) => { s.speed = 3; s.vz = 3; s.stride = 1.2; s.tucking = true; } },
  { name: "air · mute / indy", apply: (s) => { s.onGround = false; s.airTime = 0.6; s.y = 2; s.grab = "mute"; s.grabTime = 0.3; s.vz = 14; s.speed = 14; } },
  { name: "air · spread eagle / method", apply: (s) => { s.onGround = false; s.airTime = 0.6; s.y = 2; s.grab = "eagle"; s.grabTime = 0.3; s.vz = 14; s.speed = 14; } },
  { name: "air · daffy / tail", apply: (s) => { s.onGround = false; s.airTime = 0.6; s.y = 2; s.grab = "daffy"; s.grabTime = 0.3; s.vz = 14; s.speed = 14; } },
  { name: "air · twister / nose", apply: (s) => { s.onGround = false; s.airTime = 0.6; s.y = 2; s.grab = "twister"; s.grabTime = 0.3; s.vz = 14; s.speed = 14; } },
  { name: "air · mid-spin", apply: (s) => { s.onGround = false; s.airTime = 0.5; s.y = 2; s.spin = 1.3; s.vz = 14; s.speed = 14; } },
  { name: "crash tumble", apply: (s) => { s.crash = 0.9; s.crashReason = "tree"; s.speed = 4; s.vz = 4; s.stride = 2; s.y = 0.35; } },
  { name: "riding the lift", apply: (s) => { s.liftIndex = 0; s.y = 2.4; s.liftSeat = { x: 0, y: 4.5, z: 0, heading: 0 }; } },
];

function stubWorld(): World {
  const normal = (_x: number, _z: number, out: { x: number; y: number; z: number }) => { out.x = 0; out.y = 1; out.z = 0; return out; };
  return { terrain: { height: () => 0, normal }, profile: { slug: "breckenridge" } } as unknown as World;
}

export default function RiderGallery() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Rendering…");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const world = stubWorld();
    const glCanvas = document.createElement("canvas");
    glCanvas.width = TILE; glCanvas.height = TILE;
    const gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    gl.setPixelRatio(1);
    gl.setSize(TILE, TILE, false);
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.82;
    gl.shadowMap.enabled = true;
    gl.setClearColor(0xdde8f5, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd6e2f0);
    const sun = new THREE.DirectionalLight(0xfff1d8, 2.3);
    sun.position.set(0.62, 0.55, 0.5).multiplyScalar(40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cam = sun.shadow.camera; cam.left = -6; cam.right = 6; cam.top = 6; cam.bottom = -6; cam.near = 1; cam.far = 120;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x5c6470, 0.9));
    scene.add(new THREE.AmbientLight(0xdfe8ff, 0.12));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const tiles: GalleryTile[] = [];
    (window as unknown as { __riderGallery?: { tiles: GalleryTile[]; done: boolean } }).__riderGallery = { tiles, done: false };

    const frameFor = (state: RiderState, dt: number, time: number): RenderFrame => ({
      state, world, time, dt, camera, cameraPreset: "chase", weather: { name: "Bluebird" } as RenderFrame["weather"],
      weatherIndex: 0, phase: "riding", courseIndex: 0, trailHint: false, quality: 0,
    });

    function renderTile(group: string, label: string, style: RiderStyle, riderMode: RiderMode, stance: SnowboardStance, pose: Pose, view: typeof VIEWS[number]) {
      const rig = new RiderMesh(scene, world, style, { riderMode, stance });
      const state = createRiderState(riderMode, stance);
      pose.apply(state);
      // Let the damped pose settle, then frame the rider.
      for (let i = 0; i < 40; i++) rig.update(frameFor(state, 0.05, i * 0.05));
      const focusY = state.liftIndex >= 0 ? state.y + 0.9 : state.onGround ? state.y + 0.95 : state.y + 0.6;
      camera.position.set(Math.sin(view.azimuth) * Math.cos(view.elevation) * view.distance, focusY + Math.sin(view.elevation) * view.distance, Math.cos(view.azimuth) * Math.cos(view.elevation) * view.distance);
      camera.lookAt(0, focusY, 0);
      gl.render(scene, camera);
      const canvas = document.createElement("canvas");
      canvas.width = TILE; canvas.height = TILE;
      canvas.getContext("2d")!.drawImage(glCanvas, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      tiles.push({ group, label, dataUrl });
      const figure = document.createElement("figure");
      figure.className = "m-0 flex flex-col items-center gap-1";
      canvas.className = "w-[180px] h-[180px] rounded border border-[#1b222b]";
      const caption = document.createElement("figcaption");
      caption.className = "text-[10px] uppercase tracking-wider text-[#7f8b99] text-center max-w-[180px]";
      caption.textContent = `${label} · ${view.name}`;
      figure.append(canvas, caption);
      const root = host as HTMLDivElement;
      let section = root.querySelector<HTMLElement>(`[data-group="${CSS.escape(group)}"]`);
      if (!section) {
        section = document.createElement("section");
        section.dataset.group = group;
        section.innerHTML = `<h2 class="mt-8 mb-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-[#e8edf2]">${group}</h2><div class="flex flex-wrap gap-3"></div>`;
        root.append(section);
      }
      section.querySelector("div")!.append(figure);
      rig.dispose();
    }

    const outfits = Object.keys(OUTFITS) as OutfitId[];
    const gears = Object.keys(GEAR) as GearId[];
    const jobs: Array<() => void> = [];
    for (const character of ["human", "yeti"] as RiderCharacter[]) {
      for (const riderMode of ["skier", "snowboarder"] as RiderMode[]) {
        // The yeti wears its own fur, so outfit only matters for the human.
        const outfitList = character === "human" ? outfits : (["alpenglow"] as OutfitId[]);
        for (const outfit of outfitList) for (const gear of gears) {
          const style: RiderStyle = { character, outfit, board: gear, skis: gear };
          const group = `${character} · ${riderMode}`;
          const label = character === "human"
            ? `${OUTFITS[outfit].name} outfit · ${GEAR[gear].name} ${riderMode === "skier" ? "skis" : "board"}`
            : `Yeti · ${GEAR[gear].name} ${riderMode === "skier" ? "skis" : "board"}`;
          for (const view of VIEWS.slice(0, 3)) jobs.push(() => renderTile(group, label, style, riderMode, "regular", POSES[1], view));
        }
      }
    }
    for (const riderMode of ["skier", "snowboarder"] as RiderMode[]) {
      const style: RiderStyle = { character: "human", outfit: riderMode === "skier" ? "alpenglow" : "glacier", board: "sunrise", skis: "sunrise" };
      for (const pose of POSES) {
        jobs.push(() => renderTile(`poses · ${riderMode}`, pose.name, style, riderMode, "regular", pose, VIEWS[0]));
        jobs.push(() => renderTile(`poses · ${riderMode}`, pose.name, style, riderMode, "regular", pose, VIEWS[3]));
      }
    }
    jobs.push(() => renderTile("stance", "snowboard · regular", { character: "human", outfit: "timberline", board: "nightfall", skis: "nightfall" }, "snowboarder", "regular", POSES[1], VIEWS[0]));
    jobs.push(() => renderTile("stance", "snowboard · goofy", { character: "human", outfit: "timberline", board: "nightfall", skis: "nightfall" }, "snowboarder", "goofy", POSES[1], VIEWS[0]));

    let index = 0;
    const step = () => {
      if (cancelled) return;
      const end = Math.min(jobs.length, index + 4);
      for (; index < end; index++) jobs[index]();
      setStatus(`Rendered ${index} / ${jobs.length}`);
      if (index < jobs.length) requestAnimationFrame(step);
      else { (window as unknown as { __riderGallery: { done: boolean } }).__riderGallery.done = true; setStatus(`Done · ${jobs.length} tiles`); }
    };
    requestAnimationFrame(step);
    return () => { cancelled = true; gl.dispose(); };
  }, []);

  return (
    <div className="min-h-screen bg-[#06080b] px-6 py-8 font-mono text-[#e8edf2]">
      <h1 className="text-xl font-bold uppercase tracking-[0.2em]">Drop In rider gallery</h1>
      <p className="mt-1 text-xs text-[#7f8b99]">Every variant of the procedural rig, rendered live by the game engine. {status}</p>
      <div ref={hostRef} data-rider-gallery />
    </div>
  );
}
