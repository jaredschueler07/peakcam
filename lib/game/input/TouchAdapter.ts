import type { InputManager } from "./InputManager";
import type { InputAction, InputAdapter } from "./types";

export class TouchAdapter implements InputAdapter {
  private active = false;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private dragEnabled = true;
  private steeringListeners = new Set<(point: { x: number; y: number; offset: number } | null) => void>();

  subscribeSteering(listener: (point: { x: number; y: number; offset: number } | null) => void): () => void {
    this.steeringListeners.add(listener);
    return () => { this.steeringListeners.delete(listener); };
  }
  private notifySteering(offset: number | null): void {
    for (const listener of this.steeringListeners) listener(offset === null ? null : { x: this.originX, y: this.originY, offset });
  }
  setDragEnabled(enabled: boolean): void { this.clear(); this.dragEnabled = enabled; }
  setSteer(value: number): void { if (this.active) this.input.setAnalog("touch", value); }

  constructor(private readonly element: HTMLElement, private readonly input: InputManager) {}
  private down = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (!this.dragEnabled || event.pointerType !== "touch" || this.pointerId !== null ||
        target?.closest?.("button,a,input,select,textarea,[role=button],[role=dialog],dialog,[contenteditable]:not([contenteditable=false])")) return;
    this.pointerId = event.pointerId; this.originX = event.clientX; this.originY = event.clientY;
    this.element.setPointerCapture?.(event.pointerId);
    this.notifySteering(0);
  };
  private move = (event: PointerEvent) => {
    if (this.pointerId === event.pointerId) {
      const offset = event.clientX - this.originX;
      this.input.setAnalog("touch", offset / 64);
      this.notifySteering(Math.max(-64, Math.min(64, offset)));
    }
  };
  private up = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) return;
    this.clear();
  };
  setAction(action: Exclude<InputAction, "pause">, held: boolean): void { if (this.active) this.input.setAction(action, held, "touch"); }
  setActive(active: boolean): void {
    if (active === this.active) return; this.active = active;
    const method = active ? "addEventListener" : "removeEventListener";
    this.element[method]("pointerdown", this.down as EventListener);
    this.element[method]("pointermove", this.move as EventListener);
    this.element[method]("pointerup", this.up as EventListener);
    this.element[method]("pointercancel", this.up as EventListener);
    this.element[method]("lostpointercapture", this.up as EventListener);
    if (!active) {
      this.clear();
      for (const action of ["tuck", "brake", "jump"] as const) this.input.setAction(action, false, "touch");
    }
  }
  clear(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.input.setAnalog("touch", 0);
    this.notifySteering(null);
    if (pointerId !== null && this.element.hasPointerCapture?.(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
  }
  dispose(): void { this.setActive(false); }
}
