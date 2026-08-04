import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  SNOW_NORMAL_SOURCE,
  SNOW_ROUGHNESS_SOURCE,
  bakeSurfaceTextures,
  type SurfaceTextureEncoder,
} from "./bake-surface-textures";

const KTX2_IDENTIFIER = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function syntheticPng(red: number): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = red;
    png.data[i + 1] = 128;
    png.data[i + 2] = 255;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

test("the surface bake reads Snow006 PNG maps, discards albedo, and emits KTX2", async (t) => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-snow-source-"));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-snow-output-"));
  t.after(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(sourceDir, SNOW_NORMAL_SOURCE), syntheticPng(64));
  fs.writeFileSync(path.join(sourceDir, SNOW_ROUGHNESS_SOURCE), syntheticPng(192));
  fs.writeFileSync(path.join(sourceDir, "Snow006_2K-PNG_Color.png"), syntheticPng(255));

  const encodedSources: string[] = [];
  const encoder: SurfaceTextureEncoder = async (sourcePath) => {
    const decoded = PNG.sync.read(fs.readFileSync(sourcePath));
    assert.equal(decoded.width, 2, "the encoder boundary receives the real PNG fixture");
    encodedSources.push(path.basename(sourcePath));
    return Buffer.concat([KTX2_IDENTIFIER, Buffer.from(path.basename(sourcePath))]);
  };

  const outputs = await bakeSurfaceTextures(sourceDir, outputDir, encoder);

  assert.deepEqual(encodedSources, [SNOW_NORMAL_SOURCE, SNOW_ROUGHNESS_SOURCE]);
  assert.deepEqual(outputs.map((output) => output.name), ["snow-normal.ktx2", "snow-roughness.ktx2"]);
  for (const output of outputs) {
    const bytes = fs.readFileSync(path.join(outputDir, output.name));
    assert.equal(bytes.subarray(0, KTX2_IDENTIFIER.length).equals(KTX2_IDENTIFIER), true);
  }
  assert.equal(fs.existsSync(path.join(outputDir, "snow-albedo.ktx2")), false);
});

test("the surface bake rejects encoder output without the KTX2 identifier", async (t) => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-snow-source-"));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-snow-output-"));
  t.after(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(sourceDir, SNOW_NORMAL_SOURCE), syntheticPng(64));
  fs.writeFileSync(path.join(sourceDir, SNOW_ROUGHNESS_SOURCE), syntheticPng(192));

  await assert.rejects(
    () => bakeSurfaceTextures(sourceDir, outputDir, async () => Buffer.from("not ktx2")),
    /invalid KTX2/i,
  );
});
