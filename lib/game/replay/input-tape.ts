import type { InputFrame } from "../core/types";
/** Four bytes per 120 Hz tick: signed steer, tuck, brake, jump-held bit. */
export const INPUT_BYTES_PER_TICK = 4;
export const MAX_INPUT_TICKS = 120 * 30 * 60;
export const MAX_INPUT_BYTES = MAX_INPUT_TICKS * INPUT_BYTES_PER_TICK;

export function readInputTick(bytes: Uint8Array, tick: number, out: InputFrame): void {
  const at = tick * 4;
  const steer = bytes[at] > 127 ? bytes[at] - 256 : bytes[at];
  out.steer = steer / 127; out.tuck = bytes[at + 1] / 255; out.brake = bytes[at + 2] / 255;
  out.jumpHeld = (bytes[at + 3] & 1) !== 0;
  out.jumpPressed = false; out.restartPressed = false; out.trailPressed = false;
}

/** Quantize before simulation, so the browser skis exactly the submitted input. */
export class InputTapeRecorder {
  private readonly bytes = new Uint8Array(MAX_INPUT_BYTES);
  private ticks = 0;
  private overflow = false;
  reset(): void { this.ticks = 0; this.overflow = false; }
  record(input: InputFrame): void {
    if (this.ticks >= MAX_INPUT_TICKS) { this.overflow = true; return; }
    const at = this.ticks * 4;
    this.bytes[at] = Math.round(Math.max(-1, Math.min(1, input.steer)) * 127) & 255;
    this.bytes[at + 1] = Math.round(Math.max(0, Math.min(1, input.tuck)) * 255);
    this.bytes[at + 2] = Math.round(Math.max(0, Math.min(1, input.brake)) * 255);
    this.bytes[at + 3] = input.jumpHeld ? 1 : 0;
    readInputTick(this.bytes, this.ticks++, input);
  }
  finish(): Uint8Array | undefined {
    return this.overflow ? undefined : this.bytes.slice(0, this.ticks * 4);
  }
}
