import { z } from "zod";
import type { SampleManifest } from "./SampleLayers";

/**
 * Typed loader for `public/game/audio/manifest.json` (Phase 7.2).
 *
 * The committed JSON is a *superset* of the engine's `SampleManifest`: each
 * layer also carries a `fallbackUrl` pointing at an `.m4a` twin of the `.ogg`.
 * `SampleLayers` has no opinion about codecs — it fetches whatever `url` says —
 * so choosing between the two is this module's job, and `toSampleManifest`
 * hands the engine exactly the shape it already accepts. Nothing in
 * `SampleLayers`/`AudioEngine` changes to support this.
 *
 * Like the rest of the audio stack, loading is best-effort: `loadSampleManifest`
 * resolves to `null` on a bad fetch or a malformed file rather than throwing,
 * so a broken manifest costs the sample enrichment and nothing else.
 */

/** Where the runtime fetches the manifest from. */
export const SAMPLE_MANIFEST_URL = "/game/audio/manifest.json";

const sampleBusSchema = z.enum(["music", "sfx"]);

/** A relative, app-absolute asset path — never an off-origin URL. */
const assetUrlSchema = z
  .string()
  .regex(/^\/game\/audio\/[\w-]+\.(ogg|m4a)$/, "must be a /game/audio/*.{ogg,m4a} path");

export const sampleLayerEntrySchema = z.object({
  /** Stable id used by `SampleLayers.play()`/`stop()`. */
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "must be kebab-case"),
  /** Preferred encoding: Ogg Vorbis. */
  url: assetUrlSchema.refine((u) => u.endsWith(".ogg"), "must be the .ogg encoding"),
  /** AAC twin, used where Ogg Vorbis will not decode (Safari). */
  fallbackUrl: assetUrlSchema.refine((u) => u.endsWith(".m4a"), "must be the .m4a encoding"),
  gain: z.number().finite().min(0).max(2),
  loop: z.boolean(),
  bus: sampleBusSchema,
});

export const sampleManifestFileSchema = z
  .object({
    version: z.number().int().positive(),
    layers: z.array(sampleLayerEntrySchema).nonempty(),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const layer of file.layers) {
      if (seen.has(layer.name)) {
        ctx.addIssue({ code: "custom", message: `duplicate layer name: ${layer.name}` });
      }
      seen.add(layer.name);
    }
  });

export type SampleLayerEntry = z.infer<typeof sampleLayerEntrySchema>;
export type SampleManifestFile = z.infer<typeof sampleManifestFileSchema>;

/** Throws a `ZodError` describing every problem with `value`. */
export function parseSampleManifest(value: unknown): SampleManifestFile {
  return sampleManifestFileSchema.parse(value);
}

export function safeParseSampleManifest(value: unknown) {
  return sampleManifestFileSchema.safeParse(value);
}

/**
 * True when the environment can decode Ogg Vorbis. Safari answers `""` here and
 * takes the `.m4a` twin. Outside a browser (SSR, tests) this returns `true`, so
 * a server-side render never encodes a Safari-shaped choice into markup.
 */
export function canPlayOggVorbis(): boolean {
  if (typeof document === "undefined") return true;
  const probe = document.createElement("audio");
  return probe.canPlayType('audio/ogg; codecs="vorbis"') !== "";
}

/**
 * Narrow the committed file to the manifest the engine consumes, picking one
 * URL per layer. Pass `preferOgg: false` to force the AAC set (the tests do).
 */
export function toSampleManifest(
  file: SampleManifestFile,
  options: { preferOgg?: boolean } = {},
): SampleManifest {
  const preferOgg = options.preferOgg ?? canPlayOggVorbis();
  return {
    version: file.version,
    layers: file.layers.map(({ name, url, fallbackUrl, gain, loop, bus }) => ({
      name,
      url: preferOgg ? url : fallbackUrl,
      gain,
      loop,
      bus,
    })),
  };
}

/**
 * Fetch and validate the manifest. Resolves to `null` — never rejects — when
 * the network, the JSON or the schema disagrees, matching the rule that audio
 * assets are an enhancement and must not surface an error to the player.
 */
export async function loadSampleManifest(
  url: string = SAMPLE_MANIFEST_URL,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SampleManifestFile | null> {
  try {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) return null;
    const parsed = sampleManifestFileSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
