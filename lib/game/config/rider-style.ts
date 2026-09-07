export type RiderMode = "skier" | "snowboarder";
export type SnowboardStance = "regular" | "goofy";
/** Visual equipment/stance; independent of the signed simulation configuration. */
export interface RiderPresentation { readonly riderMode?: RiderMode; readonly stance?: SnowboardStance }
/** Cosmetic choices only: never part of SimulationConfig, a run ticket, or a ghost header. */
export type RiderCharacter = "yeti" | "human";
export type OutfitId = "alpenglow" | "timberline" | "glacier";
export type GearId = "sunrise" | "ridgeline" | "nightfall";
export interface RiderStyle {
  readonly character: RiderCharacter;
  readonly outfit: OutfitId;
  readonly board: GearId;
  readonly skis: GearId;
}
export interface OutfitPalette {
  readonly name: string;
  readonly description: string;
  readonly cut: "anorak" | "vest" | "shell";
  readonly jacket: number;
  readonly trim: number;
  readonly accent: number;
  readonly pants: number;
  readonly sleeves: number;
  readonly lens: number;
}
export const OUTFITS: Readonly<Record<OutfitId, OutfitPalette>> = {
  alpenglow: { name: "Alpenglow", description: "Retro anorak", cut: "anorak", jacket: 0xd9552f, trim: 0x973e28, accent: 0xf1e7cf, pants: 0x293f37, sleeves: 0xd9552f, lens: 0xe2a740 },
  timberline: { name: "Timberline", description: "Quilted vest", cut: "vest", jacket: 0x3c5a3a, trim: 0x1f3322, accent: 0xe2a740, pants: 0x4a3620, sleeves: 0xe3d5b2, lens: 0xd9a954 },
  glacier: { name: "Glacier", description: "Alpine shell", cut: "shell", jacket: 0x527e87, trim: 0x30505a, accent: 0xfaf4e6, pants: 0x243d48, sleeves: 0x527e87, lens: 0xda7855 },
};
export const GEAR: Readonly<Record<GearId, { name: string; base: number; accent: number; ink: number }>> = {
  sunrise: { name: "Sunrise", base: 0xe2a740, accent: 0xd9552f, ink: 0x2a1f14 },
  ridgeline: { name: "Ridgeline", base: 0x3c5a3a, accent: 0xf1e7cf, ink: 0x1f3322 },
  nightfall: { name: "Nightfall", base: 0x293e50, accent: 0xc9d9d6, ink: 0xd9552f },
};
export const DEFAULT_RIDER_STYLE: RiderStyle = { character: "yeti", outfit: "alpenglow", board: "sunrise", skis: "sunrise" };
export const RIDER_STYLE_STORAGE_KEY = "drop-in-rider-style-v1";

/** Reject unknown saved identifiers independently so a future/old save cannot break rendering. */
export function normalizeRiderStyle(value: unknown): RiderStyle {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    character: source.character === "human" ? "human" : "yeti",
    outfit: typeof source.outfit === "string" && Object.hasOwn(OUTFITS, source.outfit) ? source.outfit as OutfitId : DEFAULT_RIDER_STYLE.outfit,
    board: typeof source.board === "string" && Object.hasOwn(GEAR, source.board) ? source.board as GearId : DEFAULT_RIDER_STYLE.board,
    skis: typeof source.skis === "string" && Object.hasOwn(GEAR, source.skis) ? source.skis as GearId : DEFAULT_RIDER_STYLE.skis,
  };
}
export function readRiderStyle(storage: Pick<Storage, "getItem">): RiderStyle {
  try { return normalizeRiderStyle(JSON.parse(storage.getItem(RIDER_STYLE_STORAGE_KEY) ?? "null")); }
  catch { return DEFAULT_RIDER_STYLE; }
}
export function saveRiderStyle(storage: Pick<Storage, "setItem">, style: RiderStyle): void {
  try { storage.setItem(RIDER_STYLE_STORAGE_KEY, JSON.stringify(normalizeRiderStyle(style))); }
  catch { /* Private browsing or a full store still permits customization for this visit. */ }
}
