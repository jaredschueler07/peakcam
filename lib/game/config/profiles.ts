import { resortGameProfilesSchema } from "./schema";

/**
 * Complete Drop In resort configuration — the single source of truth for both
 * engines. `public/drop-in/engine.html` is a bundler-free static asset that
 * cannot import this file, so its embedded `RESORT_PROFILES` table is GENERATED
 * from here by `npm run drop-in:sync-profiles`. Edit this file, re-run that, and
 * never hand-edit the engine's copy; `scripts/drop-in-engine.test.ts` fails if
 * the two diverge.
 *
 * `siteTagline` and `farRetention` are v2/site-only and are filtered out of the
 * generated v1 table — see `scripts/drop-in-sync-profiles.ts` for the field list.
 */
export const DROP_IN_GAME_PROFILES = resortGameProfilesSchema.parse({
  "ski-portillo": {
    slug: "ski-portillo",
    name: "Portillo",
    tagline: "Andean Fall Line · Laguna del Inca",
    siteTagline: "Andean fall line above Laguna del Inca",
    summitFt: 10860,
    verticalFt: 2500,
    seed: 32836,
    /** Steep for its size — Roca Jack is a wall, not a cruiser. */
    fall: 0.46,
    /** Enormous naked Andean relief: big spines, deep couloirs. */
    relief: 1.28,
    accent: "#f5b32d",
    accent2: "#ffe08a",
    logo: "linear-gradient(175deg,#fffdf5 10%,#ffe08a 44%,#f5b32d 76%,#c9791a)",
    glow: "rgba(150,110,30,.55)",
    trails: [
      { name: "Roca Jack", grade: "DOUBLE BLACK", hex: "#f5b32d", col: 0xf5b32d, off: 0, amp: 58, freq: 0.00232, phase: 0, half: 26, ramp: 300 },
      { name: "Juncalillo", grade: "BLACK", hex: "#c9d6ea", col: 0x1b2230, off: 248, amp: 44, freq: 0.00298, phase: 1.94, half: 20, ramp: 455 },
      { name: "El Plateau", grade: "BLUE", hex: "#3ea0ff", col: 0x3ea0ff, off: -262, amp: 96, freq: 0.00128, phase: 3.02, half: 33, ramp: 610 },
      { name: "La Garganta", grade: "BLACK", hex: "#eb5577", col: 0xeb5577, off: 512, amp: 34, freq: 0.00358, phase: 0.72, half: 16, ramp: 250 },
      { name: "Kilómetro Lanzado", grade: "RED", hex: "#ff9f43", col: 0xff9f43, off: -486, amp: 22, freq: 0.00096, phase: 2.44, half: 21, ramp: 520 },
      { name: "Las Vizcachas", grade: "GREEN", hex: "#3ad686", col: 0x3ad686, off: 702, amp: 112, freq: 0.00118, phase: 4.31, half: 35, ramp: 660 },
    ],
    /** Above treeline in the Andes: rock and wind-scoured snow, near-zero trees. */
    forest: {
      treeline: 0.93,
      rockBias: 0.34,
      rockKeep: 0.8,
      treeScale: 0.78,
      trunk: 0x4a3a26,
      cone: [0x22351f, 0x2b4126, 0x35502e],
      cap: 0xe8eff7,
    },
    weather: [
      { name: "Bluebird", fog: 0.00135, fogCol: 0xd3e8fb, top: 0x1b56b8, hor: 0xd8ecff, sun: 2.7, hemi: 1.05, amb: 0.3, snow: 300, wind: 2.6, haze: 0.09, farRetention: 0.5, exposure: 1.08 },
      { name: "Viento Blanco", fog: 0.0046, fogCol: 0xcbd7e6, top: 0x7b90ac, hor: 0xd3dde9, sun: 0.9, hemi: 1.5, amb: 0.55, snow: 2500, wind: 9.5, haze: 0.52, farRetention: 0.2, exposure: 1 },
      { name: "Whiteout", fog: 0.009, fogCol: 0xe6ecf3, top: 0xb6c4d3, hor: 0xeef3f8, sun: 0.4, hemi: 1.85, amb: 0.82, snow: 3400, wind: 15, haze: 0.88, exposure: 0.98 },
    ],
  },
  breckenridge: {
    slug: "breckenridge",
    name: "Breckenridge",
    tagline: "Tenmile Range · Above-Treeline Bowls",
    siteTagline: "Above-treeline bowls off the Tenmile Range",
    summitFt: 12998,
    verticalFt: 3398,
    seed: 39481,
    /** Long, sustained, wide-open — less pitch than Portillo, far more of it. */
    fall: 0.4,
    relief: 1,
    accent: "#3d7fd6",
    accent2: "#ffd166",
    logo: "linear-gradient(175deg,#ffffff 10%,#bcdcff 44%,#3d7fd6 78%,#20488f)",
    glow: "rgba(45,110,205,.42)",
    trails: [
      { name: "Horseshoe Bowl", grade: "BLACK", hex: "#c9d6ea", col: 0x1b2230, off: 0, amp: 92, freq: 0.00142, phase: 0, half: 30, ramp: 300 },
      { name: "Imperial Bowl", grade: "DOUBLE BLACK", hex: "#eb5577", col: 0xeb5577, off: 286, amp: 66, freq: 0.00186, phase: 1.51, half: 23, ramp: 470 },
      { name: "Devil's Crotch", grade: "BLACK", hex: "#9aa8bd", col: 0x2a3242, off: 542, amp: 36, freq: 0.00324, phase: 0.91, half: 17, ramp: 245 },
      { name: "Four O'Clock", grade: "GREEN", hex: "#3ad686", col: 0x3ad686, off: -268, amp: 124, freq: 0.00104, phase: 3.24, half: 37, ramp: 640 },
      { name: "Whale's Tail", grade: "BLUE", hex: "#35b8d4", col: 0x35b8d4, off: -498, amp: 78, freq: 0.00198, phase: 4.22, half: 32, ramp: 385 },
      { name: "Psychopath", grade: "RED", hex: "#ff9f43", col: 0xff9f43, off: 724, amp: 48, freq: 0.00268, phase: 2.28, half: 19, ramp: 540 },
    ],
    /** Lodgepole and subalpine fir below the bowls, bare rock above. */
    forest: {
      treeline: 0.44,
      rockBias: 0.15,
      rockKeep: 0.55,
      treeScale: 1,
      trunk: 0x4a3628,
      cone: [0x1d3c28, 0x244a30, 0x2e5a3a],
      cap: 0xdfeaf5,
    },
    weather: [
      { name: "Bluebird", fog: 0.0017, fogCol: 0xd9edfd, top: 0x2560c4, hor: 0xdef0ff, sun: 2.6, hemi: 1.08, amb: 0.31, snow: 380, wind: 1.8, haze: 0.11, farRetention: 0.5, exposure: 1.07 },
      { name: "Champagne Powder", fog: 0.0039, fogCol: 0xd2dcea, top: 0x8298b4, hor: 0xd8e2ee, sun: 1, hemi: 1.48, amb: 0.54, snow: 2600, wind: 4.2, haze: 0.46, farRetention: 0.2, exposure: 1.01 },
      { name: "Ground Blizzard", fog: 0.0084, fogCol: 0xe4ebf3, top: 0xb4c2d2, hor: 0xecf2f8, sun: 0.42, hemi: 1.8, amb: 0.8, snow: 3300, wind: 13.5, haze: 0.86, exposure: 0.99 },
    ],
  },
  heavenly: {
    slug: "heavenly",
    name: "Heavenly",
    tagline: "Sierra Nevada · 3,500 Feet to the Lake",
    siteTagline: "Sierra pines and a 3,500-foot drop to the lake",
    summitFt: 10067,
    verticalFt: 3500,
    seed: 38935,
    fall: 0.43,
    /** Rounder, more forgiving Sierra ridgelines. */
    relief: 0.86,
    accent: "#6f5bd4",
    accent2: "#5ec8e8",
    logo: "linear-gradient(175deg,#ffffff 10%,#c3b8ff 44%,#6f5bd4 78%,#3d2f8f)",
    glow: "rgba(105,80,200,.45)",
    trails: [
      { name: "Gunbarrel", grade: "DOUBLE BLACK", hex: "#eb5577", col: 0xeb5577, off: 0, amp: 70, freq: 0.00178, phase: 0, half: 28, ramp: 300 },
      { name: "Ridge Run", grade: "GREEN", hex: "#3ad686", col: 0x3ad686, off: -282, amp: 132, freq: 0.00098, phase: 3.38, half: 36, ramp: 645 },
      { name: "Milky Way Bowl", grade: "BLUE", hex: "#6f5bd4", col: 0x6f5bd4, off: 264, amp: 104, freq: 0.00124, phase: 1.66, half: 34, ramp: 470 },
      { name: "Mott Canyon", grade: "BLACK", hex: "#c9d6ea", col: 0x1b2230, off: 548, amp: 40, freq: 0.00312, phase: 0.66, half: 18, ramp: 255 },
      { name: "Olympic Downhill", grade: "BLUE", hex: "#35b8d4", col: 0x35b8d4, off: -512, amp: 62, freq: 0.00208, phase: 4.44, half: 31, ramp: 395 },
      { name: "Killebrew Canyon", grade: "RED", hex: "#ff9f43", col: 0xff9f43, off: 712, amp: 86, freq: 0.00152, phase: 2.19, half: 22, ramp: 545 },
    ],
    /** Thick Jeffrey pine and red fir all the way to the summit ridge. */
    forest: {
      treeline: 0.33,
      rockBias: 0.09,
      rockKeep: 0.42,
      treeScale: 1.14,
      trunk: 0x53412c,
      cone: [0x24462a, 0x2d5633, 0x3a6a3f],
      cap: 0xe4eef8,
    },
    weather: [
      { name: "Bluebird", fog: 0.0021, fogCol: 0xdcecfb, top: 0x2f6fc6, hor: 0xe2f0ff, sun: 2.45, hemi: 1.14, amb: 0.34, snow: 440, wind: 1.3, haze: 0.16, farRetention: 0.5, exposure: 1.05 },
      { name: "Sierra Snowfall", fog: 0.0048, fogCol: 0xccd8e8, top: 0x7a8fac, hor: 0xd4dfec, sun: 0.88, hemi: 1.55, amb: 0.58, snow: 3000, wind: 6.2, haze: 0.56, farRetention: 0.2, exposure: 1 },
      { name: "Lake Whiteout", fog: 0.0088, fogCol: 0xe8edf4, top: 0xbcc8d6, hor: 0xf0f4f9, sun: 0.4, hemi: 1.82, amb: 0.83, snow: 3600, wind: 11, haze: 0.9, exposure: 0.98 },
    ],
  },
});
