import type { InputManager } from "./InputManager";
import type { InputAction, InputAdapter } from "./types";

export class TouchAdapter implements InputAdapter {
  private active = false;
  private pointerId: number | null = null;
  private originX = 0;

  constructor(private readonly element: HTMLElement, private readonly input: InputManager) {}
  private down = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (event.pointerType !== "touch" || this.pointerId !== null ||
        event.clientX > window.innerWidth * 0.55 ||
        target?.closest?.("button,a,input,select,textarea,[role=button],[contenteditable]:not([contenteditable=false])")) return;
    this.pointerId = event.pointerId; this.originX = event.clientX;
    this.element.setPointerCapture?.(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    if (this.pointerId === event.pointerId) this.input.setAnalog("touch", (event.clientX - this.originX) / 64);
  };
  private up = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) return;
    this.clear();
  };
  setAction(action: Exclude<InputAction, "pause">, held: boolean): void { this.input.setAction(action, held, "touch"); }
  setActive(active: boolean): void {
    if (active === this.active) return; this.active = active;
    const method = active ? "addEventListener" : "removeEventListener";
    this.element[method]("pointerdown", this.down as EventListener);
    this.element[method]("pointermove", this.move as EventListener);
    this.element[method]("pointerup", this.up as EventListener);
    this.element[method]("pointercancel", this.up as EventListener);
    this.element[method]("lostpointercapture", this.up as EventListener);
    if (!active) this.clear();
  }
  clear(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.input.setAnalog("touch", 0);
    if (pointerId !== null && this.element.hasPointerCapture?.(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
  }
  dispose(): void { this.setActive(false); }
}
