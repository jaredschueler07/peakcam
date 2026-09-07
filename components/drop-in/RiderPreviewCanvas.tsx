"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { RiderMode, SnowboardStance } from "@/lib/game/config/rider-style";
import type { RiderStyle } from "@/lib/game/config/rider-style";
import { SkierRenderer } from "@/lib/game/rendering/SkierRenderer";
import { disposeObjectTree } from "@/lib/game/rendering/resources";
import { createSkierState } from "@/lib/game/physics/skier";
import type { TerrainSampler } from "@/lib/game/core/types";

interface Props { style: RiderStyle; riderMode: RiderMode; stance: SnowboardStance }
interface PreviewApi { setStyle(style: RiderStyle, mode: RiderMode, stance: SnowboardStance): void; rotate(angle: number): void }
// The preview uses only a flat normal; it never calls or changes the game's height sampler.
const previewTerrain = { height() { return 0; }, normal(_x: number, _z: number, out: { x: number; y: number; z: number }) { out.x = 0; out.y = 1; out.z = 0; return out; } } satisfies Pick<TerrainSampler, "normal" | "height" | "realLifts">;

/** Loaded on opening the locker. Renders on change/resize, with no permanent animation loop. */
export default function RiderPreviewCanvas({ style, riderMode, stance }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const api = useRef<PreviewApi | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [angle, setAngle] = useState(-.45);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true, alpha: true }); }
    catch {
      // GPU availability is only known after mounting the canvas.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnavailable(true); return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 20);
    camera.position.set(0, 1.5, 4.3); camera.lookAt(0, .94, 0);
    scene.add(new THREE.HemisphereLight(0xfff8e9, 0x668782, 2.4));
    const key = new THREE.DirectionalLight(0xffe6b8, 2.7); key.position.set(-3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9d9d6, 1.4); fill.position.set(3, 2, -2); scene.add(fill);
    const state = createSkierState(); state.crouch = .06; state.yaw = -.45;
    let rig: SkierRenderer | null = null;
    const draw = () => {
      rig?.update(state, previewTerrain, 1); renderer.render(scene, camera);
      if (rig) element.dataset.previewReady = "true";
    };
    api.current = {
      setStyle(next, mode, nextStance) {
        if (rig) { scene.remove(rig.root); disposeObjectTree(rig.root); }
        rig = new SkierRenderer(scene, { riderMode: mode, stance: nextStance }, next);
        draw();
      },
      rotate(next) { state.yaw = next; draw(); },
    };
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); draw();
    });
    resize.observe(element);
    return () => {
      resize.disconnect(); api.current = null; disposeObjectTree(scene); renderer.dispose();
      delete element.dataset.previewReady;
      // Strict Mode replays setup on the same connected canvas. Lose the context only
      // after a real unmount, otherwise the replacement renderer receives a dead context.
      queueMicrotask(() => { if (!element.isConnected) renderer.forceContextLoss(); });
    };
  }, []);
  useEffect(() => { api.current?.setStyle(style, riderMode, stance); }, [style, riderMode, stance]);
  return <div className="flex h-full min-h-64 flex-col">
    <div className="relative min-h-56 flex-1">
      <canvas hidden={unavailable} ref={canvas} className="absolute inset-0 h-full w-full" role="img" aria-label={`${style.character === "yeti" ? "Yeti" : "Human"} wearing ${style.outfit}, riding ${riderMode === "skier" ? style.skis + " skis" : style.board + " snowboard"}`} />
      {unavailable && <p role="status" className="absolute inset-0 flex items-center justify-center p-5 text-sm text-bark-dk">3D preview unavailable. You can still choose your outfit and gear.</p>}
    </div>
    <label className="flex items-center gap-3 px-5 pb-4 text-xs text-bark-dk">Rotate
      <input aria-label="Rotate rider preview" type="range" disabled={unavailable} min={-Math.PI} max={Math.PI} step="0.05" value={angle} onChange={event => { const next = Number(event.target.value); setAngle(next); api.current?.rotate(next); }} className="min-h-6 min-w-0 flex-1 accent-forest" />
    </label>
  </div>;
}
