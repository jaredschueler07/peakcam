/**
 * Offline ambientCG Snow006 surface bake.
 *
 * Usage:
 *   npx tsx scripts/bake-surface-textures.ts /path/to/Snow006_2K-PNG
 *
 * Only normal and roughness are accepted. Snow albedo carries almost no signal,
 * and a photographic albedo fights PeakCam's poster palette, so it is discarded.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emitKtx2Texture, type BakedFile } from "./bake-resort";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "public", "game", "textures");

export const SNOW_NORMAL_SOURCE = "Snow006_2K-PNG_NormalGL.png";
export const SNOW_ROUGHNESS_SOURCE = "Snow006_2K-PNG_Roughness.png";

type SurfaceMapKind = "normal" | "roughness";
export type SurfaceTextureEncoder = (sourcePath: string, kind: SurfaceMapKind) => Promise<Buffer>;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const detail = stderr.trim() || error.message;
      reject(new Error(`${command} failed: ${detail}`));
    });
  });
}

async function encodeWithToktx(sourcePath: string, kind: SurfaceMapKind): Promise<Buffer> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-toktx-"));
  const outputPath = path.join(tempDir, `${kind}.ktx2`);
  // ETC1S/BasisLZ at 1024x1024: UASTC at the native 2K source is ~5.6 MB per map, far past the
  // 512 KB per-asset KTX2 budget (docs/drop-in-v2/BUDGETS.md). The triplanar path samples this
  // detail tiled at world-unit scales of 3 and 0.35 (SnowNodeMaterial.ts), so the softer,
  // supercompressed ETC1S result at half resolution is imperceptible at those scales.
  const args = [
    "--t2", "--encode", "etc1s", "--clevel", "4", "--qlevel", "200",
    "--resize", "1024x1024", "--genmipmap",
  ];
  // Both maps are assigned linear: roughness is a scalar signal, and the normal map is kept as a
  // plain RGB-encoded unit vector (not toktx's `--normal_mode`, which repacks to 2-component X+Y
  // storage — `snowNormalNode` in SnowNodeMaterial.ts samples `.xyz` directly as a 3-vector, so a
  // repacked map would silently read a zeroed third channel through the same triplanar path).
  args.push("--assign_oetf", "linear", "--assign_primaries", "none");
  args.push(outputPath, sourcePath);
  try {
    await run(process.env.TOKTX_BIN || "toktx", args);
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Bake the pinned maps and pass every encoder result through the shared KTX2 boundary. */
export async function bakeSurfaceTextures(
  sourceDir: string,
  outputDir = DEFAULT_OUTPUT_DIR,
  encoder: SurfaceTextureEncoder = encodeWithToktx,
): Promise<BakedFile[]> {
  const inputs: Array<{ source: string; output: string; kind: SurfaceMapKind }> = [
    { source: SNOW_NORMAL_SOURCE, output: "snow-normal.png", kind: "normal" },
    { source: SNOW_ROUGHNESS_SOURCE, output: "snow-roughness.png", kind: "roughness" },
  ];
  const outputs: BakedFile[] = [];
  for (const input of inputs) {
    const sourcePath = path.join(sourceDir, input.source);
    if (!fs.existsSync(sourcePath)) throw new Error(`Missing source texture: ${sourcePath}`);
    const encoded = await encoder(sourcePath, input.kind);
    outputs.push(emitKtx2Texture(input.output, encoded));
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const output of outputs) fs.writeFileSync(path.join(outputDir, output.name), output.data);
  return outputs;
}

async function main(): Promise<void> {
  const sourceDir = process.argv[2];
  const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT_DIR;
  if (!sourceDir) {
    console.error("Usage: npx tsx scripts/bake-surface-textures.ts <Snow006_2K-PNG-directory> [output-directory]");
    process.exitCode = 1;
    return;
  }
  const outputs = await bakeSurfaceTextures(path.resolve(sourceDir), outputDir);
  for (const output of outputs) console.log(`${output.name}: ${output.data.byteLength} bytes`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
