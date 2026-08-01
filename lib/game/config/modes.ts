import type { DropInResortSlug } from "./schema";

export type CompetitiveRunMode = "time_trial" | "score_attack";

/** Finite, deterministic contract for a leaderboard-eligible run. */
export interface RunDefinition {
  mode: CompetitiveRunMode;
  resortSlug: DropInResortSlug;
  trailId: string;
  seed: number;
  startZ: number;
  finishZ: number;
  durationLimitMs?: number;
  physicsVersion: number;
  courseVersion: number;
}
