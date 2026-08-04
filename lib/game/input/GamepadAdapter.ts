import type { InputManager } from "./InputManager";
import type { InputAdapter } from "./types";

export class GamepadAdapter implements InputAdapter {
  private active = false;
  constructor(private readonly input: InputManager) {}
  poll(): void {
    if (!this.active || typeof navigator.getGamepads !== "function") return;
    const pad = Array.from(navigator.getGamepads()).find((candidate) => candidate?.mapping === "standard");
    if (!pad) return;
    const dpad = Number(pad.buttons[15]?.pressed) - Number(pad.buttons[14]?.pressed);
    this.input.setAnalog("gamepad", dpad || pad.axes[0] || 0);
    this.input.setAction("tuck", Boolean(pad.buttons[0]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.12), "gamepad");
    this.input.setAction("brake", Boolean(pad.buttons[1]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.12), "gamepad");
    this.input.setAction("jump", Boolean(pad.buttons[0]?.pressed), "gamepad");
    this.input.setAction("trail", Boolean(pad.buttons[4]?.pressed || pad.buttons[5]?.pressed), "gamepad");
    this.input.setAction("pause", Boolean(pad.buttons[9]?.pressed), "gamepad");
    this.input.setAction("restart", Boolean(pad.buttons[3]?.pressed), "gamepad");
  }
  setActive(active: boolean): void { this.active = active; if (!active) this.clear(); }
  clear(): void { this.input.setAnalog("gamepad", 0); }
  dispose(): void { this.setActive(false); }
}

