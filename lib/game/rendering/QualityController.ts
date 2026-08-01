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

export class QualityController {
  pixelScale = 1;

  constructor(public rung: QualityRung) {}

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
