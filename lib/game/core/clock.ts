export const FIXED_HZ = 120;
export const FIXED_DT = 1 / FIXED_HZ;
export const MAX_FRAME_DT = 0.1;
export const MAX_STEPS_PER_FRAME = 12;

export class FixedStepClock {
  accumulator = 0;

  reset(): void { this.accumulator = 0; }

  advance(frameDt: number, step: (dt: number) => void): number {
    let dt = frameDt;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, MAX_FRAME_DT);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      step(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    return steps;
  }
}
