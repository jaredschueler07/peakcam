import type { SimulationEnvironment, SurfaceKind } from "../core/config";

export interface RankedConditions {
  surface: SurfaceKind;
  environment: SimulationEnvironment;
  conditionsDate: string;
}

export const FIXED_TRIAL_ENVIRONMENT: SimulationEnvironment = Object.freeze({
  powderDepthCm: 0, windSpeedMps: 0, morningIce: false, visibilityM: 20000, northSign: -1,
});

export function fixedTrialConditions(): RankedConditions {
  return { surface: "packed", environment: FIXED_TRIAL_ENVIRONMENT, conditionsDate: "fixed-v2" };
}

const ZONES: Record<string, string> = {
  breckenridge: "America/Denver", heavenly: "America/Los_Angeles", "ski-portillo": "America/Santiago",
};

export function resortMorning(now: number, slug: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONES[slug], year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

export interface MorningStore {
  read(slug: string, date: string): Promise<RankedConditions | null>;
  /** Atomic insert-if-absent, never UPDATE. Competing captures must keep the first writer. */
  insertOnce(slug: string, date: string, snapshot: RankedConditions): Promise<void>;
}

export async function lockMorningConditions(
  slug: string, now: number, store: MorningStore, capture: () => Promise<RankedConditions>,
): Promise<RankedConditions> {
  const { date, hour } = resortMorning(now, slug);
  const existing = await store.read(slug, date);
  if (existing) return existing;
  if (hour !== 7) throw new Error("Today's morning conditions have not been captured");
  const snapshot = await capture();
  if (snapshot.conditionsDate !== date) throw new Error("Morning date does not match resort date");
  await store.insertOnce(slug, date, snapshot);
  const locked = await store.read(slug, date);
  if (!locked) throw new Error("Morning snapshot was not persisted");
  return locked;
}
