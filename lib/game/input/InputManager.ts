import type { InputFrame } from "../core/types";
import type { AnalogSource, ControlScheme, DigitalSource, InputAction } from "./types";

const DEAD_ZONE = 0.12;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export class InputManager {
  private analog = new Map<AnalogSource, { value: number; order: number }>();
  private digitalSteer = new Map<DigitalSource, number>();
  private held = new Map<InputAction, boolean>();
  private pending = new Set<InputAction>();
  private order = 0;

  constructor(private readonly onControlActivated?: (scheme: ControlScheme) => void) {}

  setAnalog(source: AnalogSource, rawValue: number): void {
    const raw = clamp(Number.isFinite(rawValue) ? rawValue : 0);
    const magnitude = Math.abs(raw);
    const value = magnitude <= DEAD_ZONE
      ? 0
      : Math.sign(raw) * ((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE));
    if (value !== 0) {
      this.analog.set(source, { value, order: ++this.order });
      this.onControlActivated?.(source);
    } else {
      const previous = this.analog.get(source);
      this.analog.set(source, { value: 0, order: previous?.order ?? 0 });
    }
  }

  setDigitalSteer(source: DigitalSource, value: number): void {
    const normalized = value < 0 ? -1 : value > 0 ? 1 : 0;
    this.digitalSteer.set(source, normalized);
    if (normalized) this.onControlActivated?.(source);
  }

  setAction(action: InputAction, pressed: boolean, scheme: ControlScheme = "keyboard"): void {
    const wasHeld = this.held.get(action) ?? false;
    this.held.set(action, pressed);
    if (pressed && !wasHeld) {
      this.pending.add(action);
      this.onControlActivated?.(scheme);
    }
  }

  nextFrame(): InputFrame {
    let steer = 0;
    for (const value of this.digitalSteer.values()) steer += value;
    if (steer === 0) {
      let newest = -1;
      for (const source of this.analog.values()) {
        if (source.value !== 0 && source.order > newest) {
          newest = source.order;
          steer = source.value;
        }
      }
    }
    const frame: InputFrame = {
      steer: clamp(steer),
      tuck: this.held.get("tuck") ? 1 : 0,
      brake: this.held.get("brake") ? 1 : 0,
      jumpHeld: this.held.get("jump") ?? false,
      jumpPressed: this.pending.has("jump"),
      restartPressed: this.pending.has("restart"),
      trailPressed: this.pending.has("trail"),
    };
    this.pending.delete("jump");
    this.pending.delete("restart");
    this.pending.delete("trail");
    return frame;
  }

  consumePausePressed(): boolean {
    const pressed = this.pending.delete("pause");
    return pressed;
  }

  clearHeld(): void {
    this.analog.clear();
    this.digitalSteer.clear();
    this.held.clear();
    this.pending.clear();
  }
}

