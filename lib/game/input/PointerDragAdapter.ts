import type { InputManager } from "./InputManager";
import type { InputAdapter } from "./types";

export class PointerDragAdapter implements InputAdapter {
  private active = false;
  private pointerId: number | null = null;
  private lastX = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly input: InputManager) {}

  private down = (event: PointerEvent) => {
    if (event.pointerType === "touch" || document.pointerLockElement === this.canvas) return;
    this.pointerId = event.pointerId; this.lastX = event.clientX;
    this.canvas.setPointerCapture?.(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId || document.pointerLockElement === this.canvas) return;
    const delta = event.clientX - this.lastX; this.lastX = event.clientX;
    this.input.setAnalog("pointer", delta / 35);
  };
  private up = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) return;
    if (this.canvas.hasPointerCapture?.(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.pointerId = null; this.input.setAnalog("pointer", 0);
  };

  setActive(active: boolean): void {
    if (active === this.active) return; this.active = active;
    const method = active ? "addEventListener" : "removeEventListener";
    this.canvas[method]("pointerdown", this.down as EventListener);
    this.canvas[method]("pointermove", this.move as EventListener);
    this.canvas[method]("pointerup", this.up as EventListener);
    this.canvas[method]("pointercancel", this.up as EventListener);
    if (!active) this.clear();
  }
  clear(): void { this.pointerId = null; this.input.setAnalog("pointer", 0); }
  dispose(): void { this.setActive(false); }
}
