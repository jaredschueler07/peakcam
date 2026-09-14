/**
 * lib/descent/input/Input.ts
 * ──────────────────────────
 * Keyboard, gamepad and touch, blended into one `InputState` for the rider sim.
 *
 * The sim never sees a device. Keyboard steering is ramped in `poll()` so a
 * held key reads like a stick pushed over ~120 ms rather than a switch; gamepad
 * and touch axes are summed with the ramp and clamped. Hotkeys (camera,
 * weather, pause…) are not sim input: they are dispatched to subscribers.
 *
 * Key handling is a pure `handleKey(code, down, target?)` method so tests drive
 * it directly without a DOM.
 */

import { createInputState, type GrabKind, type InputState } from "../types";

export type HotKey = "camera" | "weather" | "trailHint" | "help" | "pause" | "fullscreen" | "mute" | "restart" | "trailMap" | "menu";
export type ControlScheme = "keyboard" | "gamepad" | "touch";
export type TouchButton = "tuck" | "brake" | "jump" | "grab" | "lift";

export interface InputController {
  /** Level state read by the runtime every sim step. */
  readonly state: InputState;
  /** Last device that produced input. */
  readonly scheme: ControlScheme;
  attach(target: HTMLElement): void;
  detach(): void;
  /** Once per rendered frame, before stepping. Polls gamepads and ramps keys. */
  poll(): void;
  /** After each sim step: clears one-shot flags. */
  endStep(): void;
  setTouchSteer(value: number): void;
  setTouchButton(name: TouchButton, down: boolean): void;
  onHotkey(handler: (key: HotKey) => void): () => void;
  /** True while any steer/tuck/brake/jump input is active. */
  readonly active: boolean;
  /** Pure key handler; returns true when the key was consumed. */
  handleKey(code: string, down: boolean, target?: EventTarget | null): boolean;
}

/** Seconds for a held key to reach full steer, and to fall back to zero. */
export const KEY_RAMP_UP_S = 0.12;
export const KEY_RAMP_DOWN_S = 0.08;
const STICK_DEADZONE = 0.15;

const GAME_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space",
  "KeyA", "KeyD", "KeyW", "KeyS", "KeyJ", "KeyK", "KeyL", "KeyI", "KeyR", "KeyE",
]);

const HOTKEYS: Readonly<Record<string, HotKey>> = {
  KeyC: "camera", KeyN: "weather", KeyV: "trailHint", KeyH: "help", Escape: "pause",
  KeyF: "fullscreen", KeyM: "mute", KeyT: "trailMap", Backspace: "menu",
};

const GRAB_KEYS: Readonly<Record<string, GrabKind>> = { KeyJ: "mute", KeyK: "eagle", KeyL: "daffy", KeyI: "twister" };

function isTextTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

class Input implements InputController {
  readonly state = createInputState();
  scheme: ControlScheme = "keyboard";

  private keys = new Set<string>();
  private grabStack: GrabKind[] = [];
  private keySteer = 0;
  private lastPoll: number | null = null;
  private padSteer = 0;
  private padTuck = false;
  private padBrake = false;
  private padJump = false;
  private padGrab: GrabKind | null = null;
  private padButtons: boolean[] = [];
  private touchSteer = 0;
  private touch = { tuck: false, brake: false, jump: false, grab: false, lift: false };
  private jumpWasHeld = false;
  private handlers = new Set<(key: HotKey) => void>();
  private listening = false;
  private readonly now: () => number;

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) { if (GAME_KEYS.has(event.code)) event.preventDefault(); return; }
    if (this.handleKey(event.code, true, event.target)) event.preventDefault();
  };
  private onKeyUp = (event: KeyboardEvent) => {
    if (this.handleKey(event.code, false, event.target)) event.preventDefault();
  };
  private onBlur = () => { this.releaseAll(); };

  constructor(now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now())) {
    this.now = now;
  }

  get active(): boolean {
    const s = this.state;
    return Math.abs(s.steer) > 0.05 || s.tuck || s.brake || s.jumpHeld;
  }

  attach(_target: HTMLElement): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.releaseAll();
  }

  handleKey(code: string, down: boolean, target?: EventTarget | null): boolean {
    if (isTextTarget(target)) return false;
    const hot = HOTKEYS[code];
    if (hot) {
      if (down) this.dispatch(hot);
      return true;
    }
    if (!GAME_KEYS.has(code)) return false;
    if (down) this.keys.add(code); else this.keys.delete(code);
    const grab = GRAB_KEYS[code];
    if (grab) {
      this.grabStack = this.grabStack.filter((g) => g !== grab);
      if (down) this.grabStack.push(grab);
    }
    if (down) {
      if (code === "KeyR") this.state.resetPressed = true;
      if (code === "KeyE") this.state.liftPressed = true;
    }
    if (down) this.scheme = "keyboard";
    this.compose();
    return true;
  }

  poll(): void {
    const now = this.now();
    const dt = this.lastPoll === null ? 0 : Math.min(0.1, (now - this.lastPoll) / 1000);
    this.lastPoll = now;

    // Keyboard steer ramp.
    const left = this.keys.has("ArrowLeft") || this.keys.has("KeyA");
    const right = this.keys.has("ArrowRight") || this.keys.has("KeyD");
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (target !== 0) {
      const step = dt / KEY_RAMP_UP_S;
      if (Math.sign(this.keySteer) !== Math.sign(target) && this.keySteer !== 0) this.keySteer = 0;
      this.keySteer = clamp(this.keySteer + target * step, -1, 1);
    } else if (this.keySteer !== 0) {
      const step = dt / KEY_RAMP_DOWN_S;
      this.keySteer = Math.abs(this.keySteer) <= step ? 0 : this.keySteer - Math.sign(this.keySteer) * step;
    }

    this.pollGamepad();
    this.compose();
  }

  private pollGamepad(): void {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    let pad: Gamepad | null = null;
    for (const candidate of navigator.getGamepads()) {
      if (candidate && candidate.connected && candidate.mapping === "standard") { pad = candidate; break; }
    }
    if (!pad) { this.padSteer = 0; this.padTuck = this.padBrake = this.padJump = false; this.padGrab = null; return; }
    const x = pad.axes[0] ?? 0;
    this.padSteer = Math.abs(x) < STICK_DEADZONE ? 0 : Math.sign(x) * (Math.abs(x) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    const b = (i: number) => !!pad!.buttons[i]?.pressed;
    const prev = this.padButtons;
    this.padJump = b(0);
    this.padTuck = b(7) || b(1);
    this.padBrake = b(6) || b(2);
    this.padGrab = b(5) ? "mute" : b(4) ? "eagle" : null;
    if (b(9) && !prev[9]) this.dispatch("pause");
    if (b(3) && !prev[3]) this.dispatch("camera");
    if (b(8) && !prev[8]) this.state.resetPressed = true;
    this.padButtons = pad.buttons.map((button) => button.pressed);
    if (this.padSteer !== 0 || this.padJump || this.padTuck || this.padBrake || this.padGrab) this.scheme = "gamepad";
  }

  private compose(): void {
    const s = this.state;
    s.steer = clamp(this.keySteer + this.padSteer + this.touchSteer, -1, 1);
    s.tuck = this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.padTuck || this.touch.tuck;
    s.brake = this.keys.has("KeyS") || this.keys.has("ArrowDown") || this.padBrake || this.touch.brake;
    const jump = this.keys.has("Space") || this.padJump || this.touch.jump;
    if (this.jumpWasHeld && !jump) s.jumpReleased = true;
    this.jumpWasHeld = jump;
    s.jumpHeld = jump;
    const keyGrab = this.grabStack.length ? this.grabStack[this.grabStack.length - 1] : null;
    s.grab = keyGrab ?? this.padGrab ?? (this.touch.grab ? "mute" : null);
  }

  endStep(): void {
    this.state.jumpReleased = false;
    this.state.resetPressed = false;
    this.state.liftPressed = false;
  }

  setTouchSteer(value: number): void {
    this.touchSteer = clamp(Number.isFinite(value) ? value : 0, -1, 1);
    if (this.touchSteer !== 0) this.scheme = "touch";
    this.compose();
  }

  setTouchButton(name: TouchButton, down: boolean): void {
    if (name === "lift") { if (down) this.state.liftPressed = true; }
    else this.touch[name] = down;
    if (down) this.scheme = "touch";
    this.compose();
  }

  onHotkey(handler: (key: HotKey) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private dispatch(key: HotKey): void {
    for (const handler of this.handlers) handler(key);
  }

  private releaseAll(): void {
    this.keys.clear();
    this.grabStack = [];
    this.keySteer = 0;
    this.touchSteer = 0;
    this.touch = { tuck: false, brake: false, jump: false, grab: false, lift: false };
    this.padSteer = 0; this.padTuck = this.padBrake = this.padJump = false; this.padGrab = null;
    this.compose();
  }
}

export function createInput(now?: () => number): InputController {
  return new Input(now);
}
