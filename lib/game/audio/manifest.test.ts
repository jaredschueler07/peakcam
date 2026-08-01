import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  canPlayOggVorbis,
  loadSampleManifest,
  parseSampleManifest,
  safeParseSampleManifest,
  SAMPLE_MANIFEST_URL,
  toSampleManifest,
  type SampleManifestFile,
} from "./manifest";

const AUDIO_DIR = path.join(process.cwd(), "public", "game", "audio");

/** Budgets from PLAN.md Phase 7.2. Bytes, not KB — the test compares raw sizes. */
const TOTAL_BUDGET = 2.5 * 1024 * 1024;
const ONE_SHOT_BUDGET = 150 * 1024;
const LOOP_BUDGET = 400 * 1024;

/** The ten layers Phase 7.2 committed to shipping. */
const EXPECTED_LAYERS = [
  "wind-bed",
  "wind-gust",
  "carve-packed",
  "carve-powder",
  "lift-hum",
  "jump-whoosh",
  "land-soft",
  "crash-impact",
  "ui-tick",
  "trick-chime",
];

const committed: SampleManifestFile = parseSampleManifest(
  JSON.parse(readFileSync(path.join(AUDIO_DIR, "manifest.json"), "utf8")),
);

/** `/game/audio/x.ogg` -> the file on disk that Next will serve for it. */
function onDisk(url: string): string {
  return path.join(AUDIO_DIR, path.basename(url));
}

test("the committed manifest satisfies the schema", () => {
  assert.equal(committed.version, 1);
  assert.deepEqual(
    committed.layers.map((l) => l.name),
    EXPECTED_LAYERS,
  );
});

test("every referenced file exists on disk and is non-empty", () => {
  for (const layer of committed.layers) {
    for (const url of [layer.url, layer.fallbackUrl]) {
      const file = onDisk(url);
      assert.ok(statSync(file).isFile(), `${url} is not a file`);
      assert.ok(statSync(file).size > 0, `${url} is empty`);
    }
  }
});

test("each file is within its per-asset budget", () => {
  for (const layer of committed.layers) {
    const budget = layer.loop ? LOOP_BUDGET : ONE_SHOT_BUDGET;
    for (const url of [layer.url, layer.fallbackUrl]) {
      const size = statSync(onDisk(url)).size;
      assert.ok(
        size <= budget,
        `${url} is ${size} bytes, over the ${layer.loop ? "loop" : "one-shot"} budget of ${budget}`,
      );
    }
  }
});

test("the whole audio payload fits the 2.5 MB budget", () => {
  const total = committed.layers.reduce(
    (sum, layer) => sum + statSync(onDisk(layer.url)).size + statSync(onDisk(layer.fallbackUrl)).size,
    0,
  );
  assert.ok(total <= TOTAL_BUDGET, `audio payload is ${total} bytes, over ${TOTAL_BUDGET}`);
});

test("loops and one-shots are tagged the way the engine expects", () => {
  const byName = new Map(committed.layers.map((l) => [l.name, l]));
  for (const name of ["wind-bed", "wind-gust", "carve-packed", "carve-powder", "lift-hum"]) {
    assert.equal(byName.get(name)?.loop, true, `${name} should loop`);
  }
  for (const name of ["jump-whoosh", "land-soft", "crash-impact", "ui-tick", "trick-chime"]) {
    assert.equal(byName.get(name)?.loop, false, `${name} should be a one-shot`);
  }
});

test("toSampleManifest picks one url per layer and drops fallbackUrl", () => {
  const ogg = toSampleManifest(committed, { preferOgg: true });
  assert.deepEqual(
    ogg.layers.map((l) => l.url),
    committed.layers.map((l) => l.url),
  );
  assert.ok(ogg.layers.every((l) => !("fallbackUrl" in l)));

  const aac = toSampleManifest(committed, { preferOgg: false });
  assert.deepEqual(
    aac.layers.map((l) => l.url),
    committed.layers.map((l) => l.fallbackUrl),
  );
  assert.equal(aac.version, committed.version);
});

test("canPlayOggVorbis assumes support when there is no document", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(canPlayOggVorbis(), true);
});

test("the schema rejects malformed layers", () => {
  const base = committed.layers[0];
  const cases: Array<[string, unknown]> = [
    ["gain above 2", { ...base, gain: 2.5 }],
    ["negative gain", { ...base, gain: -1 }],
    ["an off-origin url", { ...base, url: "https://cdn.example.com/wind.ogg" }],
    ["an m4a in the ogg slot", { ...base, url: base.fallbackUrl }],
    ["a path outside /game/audio", { ...base, url: "/other/wind-bed.ogg" }],
    ["a non-kebab name", { ...base, name: "Wind Bed" }],
    ["a missing fallback", { ...base, fallbackUrl: undefined }],
  ];
  for (const [label, layer] of cases) {
    const result = safeParseSampleManifest({ version: 1, layers: [layer] });
    assert.equal(result.success, false, `should have rejected ${label}`);
  }
});

test("the schema rejects duplicate layer names and empty manifests", () => {
  const layer = committed.layers[0];
  assert.equal(safeParseSampleManifest({ version: 1, layers: [layer, layer] }).success, false);
  assert.equal(safeParseSampleManifest({ version: 1, layers: [] }).success, false);
  assert.equal(safeParseSampleManifest({ version: 0, layers: [layer] }).success, false);
});

test("loadSampleManifest returns the parsed file over a working fetch", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    return { ok: true, json: async () => committed };
  }) as unknown as typeof fetch;

  const loaded = await loadSampleManifest(SAMPLE_MANIFEST_URL, fetchImpl);
  assert.deepEqual(loaded, committed);
  assert.deepEqual(seen, [SAMPLE_MANIFEST_URL]);
});

test("loadSampleManifest returns null rather than throwing on any failure", async () => {
  const failures: Array<[string, typeof fetch]> = [
    ["a 404", (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch],
    ["a network error", (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch],
    ["unparseable json", (async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } })) as unknown as typeof fetch],
    ["a schema violation", (async () => ({ ok: true, json: async () => ({ version: 1, layers: [{ name: "x" }] }) })) as unknown as typeof fetch],
  ];
  for (const [label, fetchImpl] of failures) {
    assert.equal(await loadSampleManifest(SAMPLE_MANIFEST_URL, fetchImpl), null, `should be null for ${label}`);
  }
});
