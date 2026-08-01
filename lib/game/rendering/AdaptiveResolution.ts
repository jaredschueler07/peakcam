export class AdaptiveResolution {
  scale = 1;

  observe(fps: number): number {
    if (fps < 45) this.scale = Math.max(0.55, this.scale - 0.12);
    else if (fps > 58) this.scale = Math.min(1, this.scale + 0.08);
    return this.scale;
  }
}
