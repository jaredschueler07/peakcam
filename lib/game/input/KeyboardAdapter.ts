import type { InputManager } from "./InputManager";
import type { InputAdapter } from "./types";

const ignoredTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, button, [role='dialog'], [contenteditable='true']"));
};

export class KeyboardAdapter implements InputAdapter {
  private active = false;
  private left = false;
  private right = false;

  constructor(
    private readonly input: InputManager,
    private readonly target: Window = window,
  ) {}

  private onKeyDown = (event: KeyboardEvent) => {
    if (ignoredTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(key)) event.preventDefault();
    if (key === "a" || key === "arrowleft") this.left = true;
    if (key === "d" || key === "arrowright") this.right = true;
    if (key === "w" || key === "arrowup") this.input.setAction("tuck", true);
    if (key === "s" || key === "arrowdown") this.input.setAction("brake", true);
    if (key === " " || key === "j") this.input.setAction("jump", true);
    if (key === "r") this.input.setAction("restart", true);
    if (key === "t") this.input.setAction("trail", true);
    if (key === "g") this.input.setAction("lift", true);
    if (key === "l") this.input.setAction("weatherCycle", true);
    if (key === "1" || key === "2" || key === "3") this.input.setAction(`weather${key}` as "weather1" | "weather2" | "weather3", true);
    if (key === "escape" || key === "p") this.input.setAction("pause", true);
    this.input.setDigitalSteer("keyboard", Number(this.right) - Number(this.left));
  };

  private onKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === "a" || key === "arrowleft") this.left = false;
    if (key === "d" || key === "arrowright") this.right = false;
    if (key === "w" || key === "arrowup") this.input.setAction("tuck", false);
    if (key === "s" || key === "arrowdown") this.input.setAction("brake", false);
    if (key === " " || key === "j") this.input.setAction("jump", false);
    if (key === "r") this.input.setAction("restart", false);
    if (key === "t") this.input.setAction("trail", false);
    if (key === "g") this.input.setAction("lift", false);
    if (key === "l") this.input.setAction("weatherCycle", false);
    if (key === "1" || key === "2" || key === "3") this.input.setAction(`weather${key}` as "weather1" | "weather2" | "weather3", false);
    if (key === "escape" || key === "p") this.input.setAction("pause", false);
    this.input.setDigitalSteer("keyboard", Number(this.right) - Number(this.left));
  };

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    const method = active ? "addEventListener" : "removeEventListener";
    this.target[method]("keydown", this.onKeyDown as EventListener);
    this.target[method]("keyup", this.onKeyUp as EventListener);
    if (!active) this.clear();
  }

  clear(): void { this.left = false; this.right = false; this.input.clearHeld(); }
  dispose(): void { this.setActive(false); }
}
