/**
 * Structural view of the parts of the Descent runtime the shell touches.
 *
 * `DescentRuntime.input` is typed against `lib/descent/input/Input.ts`; the
 * shell only needs these members, so it codes against this narrower shape and
 * stays compilable while the engine is assembled.
 */

import type { DescentRuntime } from "@/lib/descent/types";

export type Hotkey = "camera" | "weather" | "trailHint" | "help" | "pause" | "fullscreen" | "mute" | "restart" | "trailMap" | "menu";
export type TouchButton = "tuck" | "brake" | "jump" | "grab" | "lift";

export interface ShellInput {
  onHotkey(listener: (key: Hotkey) => void): () => void;
  setTouchSteer(value: number): void;
  setTouchButton(button: TouchButton, down: boolean): void;
}

export function shellInput(runtime: DescentRuntime): ShellInput {
  return runtime.input as unknown as ShellInput;
}

export const DIFFICULTY: Record<string, { label: string; color: string; shape: "circle" | "square" | "diamond" | "double" }> = {
  easy: { label: "Green", color: "#3ad686", shape: "circle" },
  novice: { label: "Green", color: "#3ad686", shape: "circle" },
  intermediate: { label: "Blue", color: "#3ea0ff", shape: "square" },
  advanced: { label: "Black", color: "#e8edf2", shape: "diamond" },
  expert: { label: "Double Black", color: "#e8edf2", shape: "double" },
  extreme: { label: "Extreme", color: "#ff9f43", shape: "double" },
  freeride: { label: "Freeride", color: "#ff9f43", shape: "double" },
};

export function difficultyMeta(difficulty: string | null | undefined) {
  return (difficulty && DIFFICULTY[difficulty.toLowerCase()]) || { label: "Unrated", color: "#7f8b99", shape: "circle" as const };
}

export function formatRunTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

export const AUDIO_STORAGE_KEY = "descent-audio";
export const QUALITY_STORAGE_KEY = "descent-quality";
export const TOUCH_STORAGE_KEY = "descent-touch";
export const CAMERA_STORAGE_KEY = "descent-camera";

export function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Private mode: this visit still works. */ }
}
