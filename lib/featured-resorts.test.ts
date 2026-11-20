import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURED_LIMIT, MIN_FEATURED_CAMS, featuredCamCount, isFeaturedCandidate, pickFeatured } from "./featured-resorts";
import type { Cam, ResortWithData } from "./types";

const NOVEMBER = new Date(2026, 10, 20, 12);
const JULY = new Date(2026, 6, 20, 12);

const cam = (over: Partial<Cam> = {}): Cam => ({ id: "c", is_active: true, kind: null, ...over }) as Cam;

function resort(id: string, over: Record<string, unknown> = {}, cams: Cam[] = [cam(), cam()]): ResortWithData {
  return {
    id,
    slug: id,
    name: id,
    lat: 37.2,
    cond_rating: "good",
    snow_report: { new_snow_24h: 0 },
    cams,
    ...over,
  } as unknown as ResortWithData;
}

test("the gate is two cams and the strip holds four", () => {
  assert.equal(MIN_FEATURED_CAMS, 2);
  assert.equal(FEATURED_LIMIT, 4);
});

test("featuredCamCount counts active resort cams and leaves out road cams", () => {
  assert.equal(featuredCamCount(resort("a", {}, [cam(), cam({ is_active: false }), cam({ kind: "approach" }), cam({ kind: "base" })])), 2);
  assert.equal(featuredCamCount(resort("a", {}, [])), 0);
  assert.equal(featuredCamCount({ cams: undefined as unknown as Cam[] }), 0);
});

test("a resort with fewer than two active cams is not a candidate (China Peak with one stream left)", () => {
  assert.equal(isFeaturedCandidate(resort("one", {}, [cam()]), NOVEMBER), false);
  assert.equal(isFeaturedCandidate(resort("none", {}, []), NOVEMBER), false);
  assert.equal(isFeaturedCandidate(resort("road", {}, [cam(), cam({ kind: "approach" })]), NOVEMBER), false);
  assert.equal(isFeaturedCandidate(resort("two"), NOVEMBER), true);
});

test("the existing rules still hold: a report, a rating and the hemisphere's season", () => {
  assert.equal(isFeaturedCandidate(resort("a", { snow_report: null }), NOVEMBER), false);
  assert.equal(isFeaturedCandidate(resort("a", { cond_rating: null }), NOVEMBER), false);
  assert.equal(isFeaturedCandidate(resort("north"), JULY), false);
  assert.equal(isFeaturedCandidate(resort("south", { lat: -32.8 }), NOVEMBER), false);
  assert.equal(isFeaturedCandidate(resort("south", { lat: -32.8 }), JULY), true);
});

test("by score: the top score with one cam is passed over for the next resorts", () => {
  const resorts = [
    resort("dark", {}, [cam()]),
    resort("b"),
    resort("c"),
    resort("d"),
    resort("e"),
    resort("f"),
  ];
  const scores = {
    dark: { score: 95, rating: "great" },
    b: { score: 80, rating: "great" },
    c: { score: 70, rating: "good" },
    d: { score: 60, rating: "good" },
    e: { score: 50, rating: "fair" },
    f: { score: 40, rating: "fair" },
  };
  assert.deepEqual(pickFeatured(resorts, scores, NOVEMBER).map((r) => r.id), ["b", "c", "d", "e"]);
});

test("by score: ties break on new snow, an unscored resort sorts last, an all-poor strip is empty", () => {
  const resorts = [resort("dry"), resort("deep", { snow_report: { new_snow_24h: 12 } }), resort("unscored")];
  const scores = { dry: { score: 60, rating: "good" }, deep: { score: 60, rating: "good" } };
  assert.deepEqual(pickFeatured(resorts, scores, NOVEMBER).map((r) => r.id), ["deep", "dry", "unscored"]);
  assert.deepEqual(pickFeatured(resorts, { dry: { score: 10, rating: "poor" }, deep: { score: 9, rating: "poor" } }, NOVEMBER), []);
});

test("without scores: rating first, then new snow, and nothing unless one pick is good or better", () => {
  const resorts = [
    resort("fair", { cond_rating: "fair", snow_report: { new_snow_24h: 20 } }),
    resort("great", { cond_rating: "great" }),
    resort("good-deep", { cond_rating: "good", snow_report: { new_snow_24h: 9 } }),
    resort("good", { cond_rating: "good" }),
    resort("great-one-cam", { cond_rating: "great" }, [cam()]),
  ];
  assert.deepEqual(pickFeatured(resorts, null, NOVEMBER).map((r) => r.id), ["great", "good-deep", "good", "fair"]);
  assert.deepEqual(pickFeatured(resorts, {}, NOVEMBER).map((r) => r.id), ["great", "good-deep", "good", "fair"]);
  assert.deepEqual(pickFeatured([resort("fair", { cond_rating: "fair" }), resort("poor", { cond_rating: "poor" })], null, NOVEMBER), []);
});

test("the input array is not reordered and the limit is honoured", () => {
  const resorts = [resort("a", { cond_rating: "fair" }), resort("b", { cond_rating: "great" }), resort("c", { cond_rating: "good" })];
  const before = resorts.map((r) => r.id);
  assert.deepEqual(pickFeatured(resorts, null, NOVEMBER, 2).map((r) => r.id), ["b", "c"]);
  assert.deepEqual(resorts.map((r) => r.id), before);
});
