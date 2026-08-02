export type QualityRung = 0 | 1 | 2 | 3 | 4;

export interface DeviceQualitySignals {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  coarsePointer: boolean;
  dpr: number;
}

export interface QualityState {
  rung: QualityRung;
  pixelScale: number;
  changed: boolean;
}

export function seedQualityRung(signals: DeviceQualitySignals): QualityRung {
  const cores = signals.hardwareConcurrency ?? 4;
  const memory = signals.deviceMemory ?? 4;
  if (cores <= 2 || memory <= 2) return 0;
  if (signals.coarsePointer && (cores <= 4 || memory <= 4 || signals.dpr > 2)) return 1;
  if (cores < 8 || memory < 8) return 2;
  if (signals.dpr > 1.5) return 3;
  return 4;
}

/** Seconds of continuous over-budget frames before the governor gives up a rung. */
const STEP_DOWN_DWELL_S = 5;
/** Seconds of continuous headroom before the governor takes a rung back. */
const STEP_UP_DWELL_S = 20;
/** Minimum spacing between governor steps in either direction. */
const MIN_STEP_INTERVAL_S = 5;
/** Frame time must sit below this fraction of budget to count as headroom. */
const RECOVERY_BUDGET_FRACTION = 0.7;

export class QualityController {
  pixelScale = 1;

  private overSince: number | null = null;
  private underSince: number | null = null;
  private lastStepAt: number | null = null;

  constructor(public rung: QualityRung) {}

  /**
   * Thermal governor for the slow adapt tick: fed the rolling p75 frame time and the
   * device frame budget, it trades quality for headroom only on sustained pressure and
   * takes it back only after a much longer stretch of comfort, so a thermally throttled
   * device settles instead of oscillating.
   */
  observeFrameTimes(p75Ms: number, budgetMs: number, nowSeconds: number): QualityState {
    const previousRung = this.rung;
    const previousScale = this.pixelScale;

    if (p75Ms > budgetMs) {
      this.underSince = null;
      if (this.overSince === null) this.overSince = nowSeconds;
      if (this.canStep(nowSeconds, this.overSince, STEP_DOWN_DWELL_S)) {
        if (this.rung > 0) this.rung = (this.rung - 1) as QualityRung;
        else this.pixelScale = Math.max(0.7, Number((this.pixelScale - 0.1).toFixed(2)));
        this.overSince = nowSeconds;
        this.lastStepAt = nowSeconds;
      }
    } else if (p75Ms < budgetMs * RECOVERY_BUDGET_FRACTION) {
      this.overSince = null;
      if (this.underSince === null) this.underSince = nowSeconds;
      if (this.canStep(nowSeconds, this.underSince, STEP_UP_DWELL_S)) {
        if (this.pixelScale < 1) this.pixelScale = Math.min(1, Number((this.pixelScale + 0.1).toFixed(2)));
        else if (this.rung < 4) this.rung = (this.rung + 1) as QualityRung;
        this.underSince = nowSeconds;
        this.lastStepAt = nowSeconds;
      }
    } else {
      this.overSince = null;
      this.underSince = null;
    }

    return { rung: this.rung, pixelScale: this.pixelScale, changed: previousRung !== this.rung || previousScale !== this.pixelScale };
  }

  private canStep(nowSeconds: number, since: number, dwellSeconds: number): boolean {
    if (nowSeconds - since < dwellSeconds) return false;
    return this.lastStepAt === null || nowSeconds - this.lastStepAt >= MIN_STEP_INTERVAL_S;
  }

  observe(fps: number): QualityState {
    const previousRung = this.rung;
    const previousScale = this.pixelScale;
    if (fps < 45) {
      if (this.rung > 0) this.rung = (this.rung - 1) as QualityRung;
      else this.pixelScale = Math.max(0.7, Number((this.pixelScale - 0.1).toFixed(2)));
    } else if (fps > 58) {
      if (this.pixelScale < 1) this.pixelScale = Math.min(1, Number((this.pixelScale + 0.1).toFixed(2)));
      else if (this.rung < 4) this.rung = (this.rung + 1) as QualityRung;
    }
    return { rung: this.rung, pixelScale: this.pixelScale, changed: previousRung !== this.rung || previousScale !== this.pixelScale };
  }
}
