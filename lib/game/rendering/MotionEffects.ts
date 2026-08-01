export function chromaticAberrationOffset(speed01: number, reducedMotion: boolean): [number, number] {
  if (reducedMotion) return [0, 0];
  const amount = Math.max(0, Math.min(1, speed01)) * 0.0012;
  return [amount, amount * 0.45];
}
