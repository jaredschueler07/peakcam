import type { SimulationState } from "./types";

export function bumpCombo(state: SimulationState): void {
  state.combo = Math.min(state.combo + 1, 12);
  state.comboTimer = 7;
  state.events.comboChanged = true;
}

export function addScore(state: SimulationState, points: number): number {
  const total = Math.round(points * state.combo);
  state.score += total;
  state.events.scoreDelta += total;
  return total;
}

export function tickCombo(state: SimulationState, dt: number): void {
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      state.combo = 1;
      state.events.comboChanged = true;
    }
  }
}
