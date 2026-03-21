#!/usr/bin/env node
/**
 * PeakCam Image Generation Script
 *
 * Uses xAI's Grok image generation API to create site hero, marketing,
 * and regional background images. Saves output to public/images/generated/.
 *
 * Usage:
 *   node scripts/generate-images.mjs                  # Generate all images
 *   node scripts/generate-images.mjs --name hero-powder-day  # Generate one
 *
 * Env: XAI_API_KEY must be set (via .env.local or environment)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Load .env.local manually
const envPath = path.join(ROOT, ".env.local");
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

const API_KEY = process.env.XAI_API_KEY;
if (!API_KEY) {
  console.error("Error: XAI_API_KEY is not set. Add it to .env.local");
  process.exit(1);
}

const OUTPUT_DIR = path.join(ROOT, "public/images/generated");
const LOG_FILE = path.join(ROOT, "public/images/generation-log.md");
const API_URL = "https://api.x.ai/v1/images/generations";
const MODEL = "grok-imagine-image";

// Image definitions
// Each entry: { name, prompt, analysis, version }
const IMAGES = [
  {
    name: "hero-powder-day",
    prompt:
      "Action photography — skier deep in bottomless powder, face shot of white snow exploding around them, dark evergreen forest backdrop. Warm morning golden light filtering through trees. Shot on 35mm film, motion blur on skis, sharp on face. West coast ski film aesthetic, not commercial stock.",
    analysis:
      "Hero image for powder day alerts and social sharing. Action-forward, emotion-first. Deep pow face shot is the universal ski stoke moment.",
  },
  {
    name: "hero-alpine-vista",
    prompt:
      "Wide alpine panorama — jagged granite peaks above treeline, vast snowfield in foreground, dramatic cloudscape at golden hour. No people. Shot from ridgeline looking across at neighboring peaks. Warm amber light on snow, deep blue shadows. National Geographic survey photography feel. 4x5 film, maximum detail.",
    analysis:
      "Landscape hero for homepage banners and marketing materials. Scale and grandeur communicate the range of mountains PeakCam covers.",
  },
  {
    name: "marketing-social-share",
    prompt:
      "Clean ski resort social media card — dark midnight navy background, white mountain ridgeline silhouette spanning full width, 'PEAKCAM' in bold condensed sans-serif centered, warm cyan glow behind mountains. Minimal, cinematic, premium outdoor brand feel. Warren Miller meets modern app design.",
    analysis:
      "Generic social share card for non-resort-specific posts. Clean and brand-forward.",
  },
  {
    name: "region-pnw",
    prompt:
      "Dark abstract texture background — Pacific Northwest feel. Wet dark basalt rock with deep forest green lichen patches, rain droplets beading on stone surface. Cool grey-green tones, very dark, suitable for text overlay. Oregon/Washington Cascades mountain wilderness.",
    analysis:
      "Regional card texture for Washington and Oregon resorts. PNW basalt + lichen differentiates from CO barn wood and UT sandstone.",
  },
  {
    name: "region-rockies",
    prompt:
      "Dark abstract texture background — Rocky Mountain feel. Dark slate with thin quartz veins, frost crystals forming in cracks, high-altitude tundra texture. Blue-grey tones with silver mineral sparkle. Very dark, suitable for text overlay. Wyoming/Montana alpine wilderness.",
    analysis:
      "Regional card texture for Montana, Wyoming, and Idaho resorts. Slate/quartz differentiates from CO/UT/CA existing textures.",
  },
  {
    name: "marketing-powder-alert",
    prompt:
      "Dramatic ski resort powder morning — fresh 2 feet of snow overnight, ski patrol first tracks down an ungroomed bowl, sparse pine trees dusted with snow, first light of dawn turning the snow pale blue-pink. Top-down aerial perspective, no people visible, abstract snow art. Dreamy, aspirational, early morning silence.",
    analysis:
      "Hero image for powder alert banner and email campaigns. Aerial perspective creates a different visual from ground-level hero shots.",
  },
];

// Parse CLI args
const args = process.argv.slice(2);
const nameFilter = args.includes("--name")
  ? args[args.indexOf("--name") + 1]
  : null;

const toGenerate = nameFilter
  ? IMAGES.filter((img) => img.name === nameFilter)
  : IMAGES;

if (toGenerate.length === 0) {
  console.error(`No images matched --name "${nameFilter}". Available: ${IMAGES.map((i) => i.name).join(", ")}`);
  process.exit(1);
}

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Call xAI image generation API
 * @param {string} prompt
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateImage(prompt) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      n: 1,
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`xAI API error ${response.status}: ${err}`);
  }

  const json = await response.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in API response");
  return Buffer.from(b64, "base64");
}

/**
 * Append an entry to the generation log
 */
function appendLog(name, prompt, analysis, version) {
  const date = new Date().toISOString().split("T")[0];
  const entry = `
## ${date} — ${name} v${version}

**Prompt:** ${prompt}
**Model:** ${MODEL}
**Analysis:** ${analysis}
**Next iteration:** Review output and iterate on prompt as needed.

---
`;
  fs.appendFileSync(LOG_FILE, entry, "utf8");
}

/**
 * Get the next version number for an image name
 */
function getNextVersion(name) {
  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.startsWith(name));
  if (files.length === 0) return 0;
  const versions = files
    .map((f) => {
      const m = f.match(new RegExp(`${name}-v(\\d+)\\.`));
      return m ? parseInt(m[1], 10) : -1;
    })
    .filter((v) => v >= 0);
  return versions.length > 0 ? Math.max(...versions) + 1 : 0;
}

// Main
console.log(`Generating ${toGenerate.length} image(s) with ${MODEL}...\n`);

for (const img of toGenerate) {
  const version = getNextVersion(img.name);
  const filename = `${img.name}-v${version}.jpg`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  console.log(`[${img.name}] Generating v${version}...`);
  console.log(`  Prompt: ${img.prompt.slice(0, 80)}...`);

  try {
    const buffer = await generateImage(img.prompt);
    fs.writeFileSync(outputPath, buffer);
    console.log(`  Saved: public/images/generated/${filename} (${Math.round(buffer.length / 1024)} KB)`);

    // Also save as canonical name (no version suffix) for easy reference
    const canonicalPath = path.join(OUTPUT_DIR, `${img.name}.jpg`);
    fs.writeFileSync(canonicalPath, buffer);

    appendLog(img.name, img.prompt, img.analysis, version);
    console.log(`  Logged to generation-log.md\n`);
  } catch (err) {
    console.error(`  ERROR: ${err.message}\n`);
  }
}

console.log("Done. Images saved to public/images/generated/");
