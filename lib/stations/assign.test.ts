import { test } from "node:test";
import assert from "node:assert/strict";
import { assignStations, roleForElevation, type Candidate } from "./assign";
import type { StationObservation, StationSource } from "./types";

function obs(source: StationSource, sourceId: string, elevationFt: number | null, over: Partial<StationObservation> = {}): StationObservation {
  return {
    source,
    sourceId,
    name: sourceId,
    lat: 40.5,
    lng: -111.6,
    elevationFt,
    kind: source === "nws" ? "nws_obs" : source === "snotel" ? "snotel" : "ghcn",
    observedAt: "2026-12-20T12:00:00.000Z",
    snowDepthIn: null,
    sweIn: null,
    newSnowIn: null,
    tempF: null,
    windMph: null,
    payload: {},
    ...over,
  };
}

const ALTA = { baseFt: 8530, summitFt: 11068 };

test("roleForElevation: thirds of the vertical, null without elevations", () => {
  assert.equal(roleForElevation(8750, ALTA), "base");
  assert.equal(roleForElevation(9800, ALTA), "mid");
  assert.equal(roleForElevation(11066, ALTA), "summit");
  assert.equal(roleForElevation(null, ALTA), null);
  assert.equal(roleForElevation(9000, { baseFt: null, summitFt: null }), null);
  assert.equal(roleForElevation(9000, { baseFt: 9000, summitFt: 9000 }), null);
});

test("assignStations: Alta gets SNOTEL at the base, Mt Baldy at the summit, Collins mid; farther sensors lose", () => {
  const candidates: Candidate[] = [
    { observation: obs("nws", "AMB", 11066), distanceKm: 2.3 },
    { observation: obs("nws", "CLN", 9662), distanceKm: 1.3 },
    { observation: obs("nws", "ATB", 8560), distanceKm: 0.2 },
    { observation: obs("snotel", "1308:UT:SNTL", 8750, { snowDepthIn: 12 }), distanceKm: 0.3 },
    { observation: obs("ghcn", "USC00420072", 8730), distanceKm: 0.3 },
    { observation: obs("nws", "HDP", 11000), distanceKm: 3.1 },
    { observation: obs("nws", "KSLC", 4226), distanceKm: 40 },
  ];
  const picked = assignStations(candidates, ALTA);
  assert.deepEqual(
    picked.map((p) => [p.role, p.observation.sourceId, p.rank]),
    [
      ["summit", "AMB", 1],
      ["mid", "CLN", 2],
      ["base", "1308:UT:SNTL", 3],
    ],
  );
  assert.ok(picked.every((p) => p.distanceKm <= 25), "KSLC at 40 km never enters");
});

test("assignStations: SNOTEL is never displaced from the base band; GHCN beats NWS in the same band", () => {
  const picked = assignStations(
    [
      { observation: obs("nws", "ATB", 8560), distanceKm: 0.1 },
      { observation: obs("ghcn", "USC1", 8600), distanceKm: 0.2 },
      { observation: obs("snotel", "S1", 8700), distanceKm: 5 },
    ],
    ALTA,
  );
  assert.equal(picked[0].role, "base");
  assert.equal(picked[0].observation.sourceId, "S1");
  assert.equal(picked[1].observation.sourceId, "USC1");
  assert.equal(picked[2].observation.sourceId, "ATB");
});

test("assignStations: without resort elevations the highest is summit and the lowest base", () => {
  const picked = assignStations(
    [
      { observation: obs("nws", "LOW", 5000), distanceKm: 1 },
      { observation: obs("nws", "HIGH", 9000), distanceKm: 2 },
      { observation: obs("nws", "MIDDLE", 7000), distanceKm: 3 },
      { observation: obs("nws", "FOURTH", 6000), distanceKm: 4 },
    ],
    { baseFt: null, summitFt: null },
  );
  assert.equal(picked.length, 3);
  assert.deepEqual(
    picked.map((p) => [p.role, p.observation.sourceId]),
    [
      ["summit", "HIGH"],
      ["mid", "MIDDLE"],
      ["base", "LOW"],
    ],
  );
});

test("assignStations: duplicates by (source, sourceId) collapse; empty input is empty", () => {
  const c = { observation: obs("nws", "X", 9000), distanceKm: 1 };
  assert.equal(assignStations([c, { ...c, distanceKm: 2 }], ALTA).length, 1);
  assert.deepEqual(assignStations([], ALTA), []);
});
