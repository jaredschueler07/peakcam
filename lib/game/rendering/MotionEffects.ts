/** Module-scope result — callers must read both components before the next call. */
const chromaticScratch: [number, number] = [0, 0];

/**
 * Chromatic aberration UV offset for the current speed. Reuses a module-scope
 * tuple so the per-frame post path does not allocate.
 */
export function chromaticAberrationOffset(speed01: number, reducedMotion: boolean): [number, number] {
  if (reducedMotion) {
    chromaticScratch[0] = 0;
    chromaticScratch[1] = 0;
    return chromaticScratch;
  }
  const amount = Math.max(0, Math.min(1, speed01)) * 0.0012;
  chromaticScratch[0] = amount;
  chromaticScratch[1] = amount * 0.45;
  return chromaticScratch;
}
