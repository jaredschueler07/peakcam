import type { InputManager } from "./InputManager";
import type { InputAdapter } from "./types";

export interface PointerLockResult {
  status: "acquired" | "denied" | "unsupported" | "lost";
  errorName?: string;
}

interface PointerLockOptions {
  document?: Document;
  onResult?: (result: PointerLockResult) => void;
}

export class PointerLockAdapter implements InputAdapter {
  private active = false;
  private acquired = false;
  private readonly doc: Document;
  private readonly report: (result: PointerLockResult) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: InputManager,
    options: PointerLockOptions = {},
  ) {
    this.doc = options.document ?? document;
    this.report = options.onResult ?? (() => undefined);
  }

  async request(): Promise<void> {
    const request = this.canvas.requestPointerLock?.bind(this.canvas);
    if (!request) { this.report({ status: "unsupported" }); return; }
    let lastError: unknown;
    try {
      await request({ unadjustedMovement: true });
      return;
    } catch (error) { lastError = error; }
    try {
      await request();
    } catch (error) {
      lastError = error;
      this.report({ status: "denied", errorName: error instanceof DOMException ? error.name : "Error" });
    }
    void lastError;
  }

  private move = (event: MouseEvent) => {
    if (this.doc.pointerLockElement === this.canvas) this.input.setAnalog("pointer", event.movementX / 22);
  };
  private change = () => {
    const locked = this.doc.pointerLockElement === this.canvas;
    if (locked) { this.acquired = true; this.report({ status: "acquired" }); }
    else if (this.acquired) { this.acquired = false; this.input.setAnalog("pointer", 0); this.report({ status: "lost" }); }
  };
  private error = () => this.report({ status: "denied", errorName: "PointerLockError" });

  setActive(active: boolean): void {
    if (active === this.active) return; this.active = active;
    const method = active ? "addEventListener" : "removeEventListener";
    this.doc[method]("mousemove", this.move as EventListener);
    this.doc[method]("pointerlockchange", this.change);
    this.doc[method]("pointerlockerror", this.error);
    if (!active) this.clear();
  }
  clear(): void { this.input.setAnalog("pointer", 0); }
  dispose(): void { this.setActive(false); }
}

