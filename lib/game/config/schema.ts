import { z } from "zod";

const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const packedColorSchema = z.number().int().min(0).max(0xffffff);
const positiveFiniteSchema = z.number().finite().positive();
const nonNegativeFiniteSchema = z.number().finite().nonnegative();

export const dropInResortSlugSchema = z.enum([
  "ski-portillo",
  "breckenridge",
  "heavenly",
]);

export const resortTrailSchema = z.object({
  name: z.string().min(1),
  grade: z.string().min(1),
  hex: hexColorSchema,
  col: packedColorSchema,
  off: z.number().finite(),
  amp: nonNegativeFiniteSchema,
  freq: positiveFiniteSchema,
  phase: nonNegativeFiniteSchema,
  half: positiveFiniteSchema,
  ramp: nonNegativeFiniteSchema,
});

export const resortForestSchema = z.object({
  treeline: z.number().finite().min(0).max(1),
  rockBias: z.number().finite().min(0).max(1),
  rockKeep: z.number().finite().min(0).max(1),
  treeScale: positiveFiniteSchema,
  trunk: packedColorSchema,
  cone: z.tuple([packedColorSchema, packedColorSchema, packedColorSchema]),
  cap: packedColorSchema,
});

export const resortWeatherSchema = z.object({
  name: z.string().min(1),
  fog: positiveFiniteSchema,
  fogCol: packedColorSchema,
  top: packedColorSchema,
  hor: packedColorSchema,
  sun: nonNegativeFiniteSchema,
  hemi: nonNegativeFiniteSchema,
  amb: nonNegativeFiniteSchema,
  snow: nonNegativeFiniteSchema,
  wind: nonNegativeFiniteSchema,
  haze: z.number().finite().min(0).max(1),
  /**
   * Fraction of the height fog removed beyond `FAR_START_M` (`fogCurve.ts`), so distant terrain
   * keeps contrast instead of saturating to fog colour. Optional and defaulting to 0, which is the
   * pre-envelope behaviour — that is deliberate for the storm presets, where a horizon that
   * vanishes is the point.
   */
  farRetention: z.number().finite().min(0).max(1).optional(),
  exposure: positiveFiniteSchema,
});

const resortGameProfileInputSchema = z.object({
  slug: dropInResortSlugSchema,
  name: z.string().min(1),
  /** Exact poster copy consumed by the v1 engine. */
  tagline: z.string().min(1),
  /** Existing site-facing copy preserved by the lib/drop-in.ts facade. */
  siteTagline: z.string().min(1),
  summitFt: z.number().int().positive(),
  verticalFt: z.number().int().positive(),
  seed: z.number().int().nonnegative(),
  fall: positiveFiniteSchema,
  relief: positiveFiniteSchema,
  accent: hexColorSchema,
  accent2: hexColorSchema,
  logo: z.string().min(1),
  glow: z.string().min(1),
  trails: z.array(resortTrailSchema).length(6),
  forest: resortForestSchema,
  weather: z.array(resortWeatherSchema).min(1),
});

export const resortGameProfileSchema = resortGameProfileInputSchema.transform(
  (profile) => ({
    ...profile,
    summitElevationFt: profile.summitFt,
    verticalDropFt: profile.verticalFt,
    terrainSeed: profile.seed,
    trailNames: profile.trails.map((trail) => trail.name),
  }),
);

export const resortGameProfilesSchema = z.record(
  dropInResortSlugSchema,
  resortGameProfileSchema,
);

export type DropInResortSlug = z.infer<typeof dropInResortSlugSchema>;
export type ResortTrail = z.infer<typeof resortTrailSchema>;
export type ResortForest = z.infer<typeof resortForestSchema>;
export type ResortWeather = z.infer<typeof resortWeatherSchema>;
export type ResortGameProfile = z.infer<typeof resortGameProfileSchema>;
