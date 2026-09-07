/** Offline prototype audit; CPU timings describe this host, not a mobile device. */
import fs from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import * as THREE from "three";
import { AdaptiveTerrainMesh, AdaptiveTerrainStream } from "../lib/game/rendering/AdaptiveTerrainMesh";
import { createRealTerrain } from "../lib/game/terrain/real-heightfield";
import { pointAtArcLength } from "../lib/game/terrain/real-course";
import { DROP_IN_GAME_PROFILES } from "../lib/game/config/profiles";
import { residualSummary } from "./audit-terrain";
import { triangleHeight } from "./measure-terrain-resolution";

const bytes = brotliDecompressSync(fs.readFileSync("public/game/terrain/breckenridge.height.u16.br"));
const terrain = createRealTerrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
  JSON.parse(fs.readFileSync("public/game/terrain/breckenridge.meta.json", "utf8")),
  JSON.parse(fs.readFileSync("public/game/terrain/breckenridge.trails.json", "utf8")), { profile: DROP_IN_GAME_PROFILES.breckenridge });
const routes = [...terrain.realRuns!].sort((a, b) => b.lengthM - a.lengthM).slice(0, 5);
const results = [];
for (const mobile of [false, true]) {
  const mesh = new AdaptiveTerrainMesh(terrain, new THREE.MeshBasicMaterial(), mobile);
  const errors: number[] = [], baseline: number[] = [], buildTimes: number[] = [];
  let maxTriangles = 0, maxContactChangeAtRecenterM = 0;
  for (const run of routes) for (let i = 0; i <= 32; i++) {
    const p = pointAtArcLength(run.points, run.lengthM * i / 32);
    mesh.update(p.x, p.z); buildTimes.push(mesh.lastBuildMs);
    maxTriangles = Math.max(maxTriangles, mesh.triangles);
    for (const offset of [-5, 0, 5]) {
      const x = p.x + offset * Math.cos(p.heading), z = p.z - offset * Math.sin(p.heading);
      errors.push(mesh.sampleRenderedHeight(x, z) - terrain.height(x, z));
      baseline.push(triangleHeight(terrain.height, x, z, mobile ? 8 : 4) - terrain.height(x, z));
    }
    // Cross a recenter boundary by 2cm and compare the same contact point.
    const snap = mobile ? 16 : 32, crossingX = (Math.floor(p.x / snap) + 0.5) * snap;
    mesh.update(crossingX - 0.01, p.z);
    const before = mesh.sampleRenderedHeight(crossingX, p.z);
    mesh.update(crossingX + 0.01, p.z);
    maxContactChangeAtRecenterM = Math.max(maxContactChangeAtRecenterM, Math.abs(before - mesh.sampleRenderedHeight(crossingX, p.z)));
  }
  buildTimes.sort((a, b) => a - b);
  results.push({ mobile, baselineSpacingM: mobile ? 8 : 4, maxTriangles, drawCalls: 1, fixedBufferBytes: mesh.bufferBytes,
    baselineContact: residualSummary(baseline), adaptiveContact: residualSummary(errors), maxContactChangeAtRecenterM,
    cpuBuildMs: { p50: buildTimes[Math.floor(buildTimes.length * 0.5)], p95: buildTimes[Math.floor(buildTimes.length * 0.95)], max: buildTimes.at(-1) } });
  mesh.geometry.dispose(); mesh.mesh.material.dispose();
}
const streamResults = [];
for (const mobile of [false, true]) {
  const stream = new AdaptiveTerrainStream(terrain, new THREE.MeshBasicMaterial(), mobile);
  const frameWork: number[] = [], errors: number[] = [];
  const run = routes[0];
  for (let frame = 0; frame < 600; frame++) {
    // 30m/s at 30fps, one metre per frame. This exercises moving-window rebuilds.
    const p = pointAtArcLength(run.points, frame);
    stream.update(p.x, p.z);
    if (frame > 0) frameWork.push(stream.lastWorkMs);
    errors.push(stream.sampleRenderedHeight(p.x, p.z) - terrain.height(p.x, p.z));
  }
  frameWork.sort((a, b) => a - b);
  streamResults.push({ mobile, frames: 600, simulatedHz: 30, simulatedSpeedMps: 30, swaps: stream.swaps,
    fixedBufferBytes: stream.bufferBytes, contact: residualSummary(errors),
    cpuWorkMs: { p50: frameWork[Math.floor(frameWork.length * 0.5)], p95: frameWork[Math.floor(frameWork.length * 0.95)], max: frameWork.at(-1) } });
  stream.disposeInactiveGeometry(); stream.geometry.dispose(); stream.mesh.material.dispose();
}
const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, node: process.version,
  reference: "Existing course-v4 bicubic physics surface, not independent surveyed ground.",
  method: "Five longest named pieces, 33 positions each, centre and +/-5m laterally. Actual active adaptive mesh interpolation, Float32 uniform baseline. Same spatial sample points. CPU timings include warm/cold mesh rebuilds; no rendering or GPU measured.",
  limits: "Sampled errors are not exhaustive bounds. Whole-scene GPU budgets, temporal appearance and hardware frame/heap metrics require separate recorded playtests. Finest spacing adds no survey source information.",
  routes: routes.map(r => ({ id: r.id, name: r.name, lengthM: r.lengthM })), results, streamResults };
const output = process.argv[2];
if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
else console.log(JSON.stringify(report, null, 2));
