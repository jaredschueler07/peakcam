"use client";

import { useEffect, useRef } from "react";
import type { World } from "@/lib/descent/types";

export interface TrailMapCanvasProps {
  world: World;
  /** Index into `world.courses` drawn in the accent colour. */
  selected: number;
  accent: string;
  /** Rider marker, when in a run. */
  rider?: { x: number; z: number; yaw: number } | null;
  /** Square edge in CSS pixels. */
  size?: number;
  /** Zoom around the rider (metres per half-width). Omit to fit the whole box. */
  followRadiusM?: number;
  className?: string;
}

/**
 * North-up 2D map of the mountain: every named run faint, the selected course
 * bright, lifts thin, and optionally the rider. Draws with a plain 2D canvas —
 * the data is a few thousand short segments, cheap enough to redraw on demand.
 */
export default function TrailMapCanvas({ world, selected, accent, rider = null, size = 240, followRadiusM, className = "" }: TrailMapCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(6,8,11,0.82)";
    ctx.fillRect(0, 0, size, size);

    const half = world.halfSizeM;
    let cx = 0, cz = 0, radius = half;
    if (followRadiusM && rider) { cx = rider.x; cz = rider.z; radius = followRadiusM; }
    const scale = size / (radius * 2);
    // Game z is south; screen y grows downward, so north-up means y = z directly.
    const px = (x: number) => (x - cx) * scale + size / 2;
    const py = (z: number) => (z - cz) * scale + size / 2;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Lifts.
    ctx.strokeStyle = "rgba(127,139,153,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const lift of world.lifts) {
      const pts = lift.lift.points;
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(px(pts[0].x), py(pts[0].z));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].z));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Every named run.
    ctx.strokeStyle = "rgba(232,237,242,0.28)";
    ctx.lineWidth = 1.2;
    for (const run of world.terrain.runs) {
      const pts = run.points;
      if (pts.length < 2 || !run.name) continue;
      ctx.beginPath();
      ctx.moveTo(px(pts[0].x), py(pts[0].z));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].z));
      ctx.stroke();
    }

    // Selected course.
    const course = world.courses[selected];
    if (course) {
      const pts = course.run.points;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(px(pts[0].x), py(pts[0].z));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].z));
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(px(course.start.x), py(course.start.z), 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e8edf2";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px(course.finish.x), py(course.finish.z), 3.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rider.
    if (rider) {
      const x = px(rider.x), y = py(rider.z);
      const dx = Math.sin(rider.yaw), dz = Math.cos(rider.yaw);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x + dx * 7, y + dz * 7);
      ctx.lineTo(x - dz * 4 - dx * 4, y + dx * 4 - dz * 4);
      ctx.lineTo(x + dz * 4 - dx * 4, y - dx * 4 - dz * 4);
      ctx.closePath();
      ctx.fill();
    }

    // North tick.
    ctx.fillStyle = "rgba(232,237,242,0.7)";
    ctx.font = "bold 9px ui-monospace, Menlo, monospace";
    ctx.fillText("N", 6, 12);
  }, [world, selected, accent, rider, size, followRadiusM]);

  return <canvas ref={ref} style={{ width: size, height: size }} className={`block border border-[#1b222b] ${className}`} aria-label="Trail map" role="img" />;
}
