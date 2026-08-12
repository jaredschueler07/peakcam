import { test } from "node:test";
import assert from "node:assert";
import {
  MAX_COMPARE_RESORTS,
  buildCompareHref,
  parseCompareSlugs,
} from "./compare-params";

test("a missing param yields no slugs", () => {
  assert.deepStrictEqual(parseCompareSlugs(undefined), []);
  assert.deepStrictEqual(parseCompareSlugs(null), []);
  assert.deepStrictEqual(parseCompareSlugs(""), []);
});

test("a single slug is passed through", () => {
  assert.deepStrictEqual(parseCompareSlugs("white-pass"), ["white-pass"]);
});

test("a comma list is split", () => {
  assert.deepStrictEqual(parseCompareSlugs("vail,bear-mountain"), [
    "vail",
    "bear-mountain",
  ]);
});

test("a repeated query param (array) does not throw and is flattened", () => {
  // ?resorts=vail&resorts=bear-mountain — the shape that used to 500 the route.
  assert.deepStrictEqual(parseCompareSlugs(["vail", "bear-mountain"]), [
    "vail",
    "bear-mountain",
  ]);
});

test("an array of comma lists is flattened in order", () => {
  assert.deepStrictEqual(
    parseCompareSlugs(["vail,alta", "bear-mountain"]),
    ["vail", "alta", "bear-mountain"],
  );
});

test("empty segments and whitespace are dropped", () => {
  assert.deepStrictEqual(parseCompareSlugs(",, vail , ,bear-mountain ,"), [
    "vail",
    "bear-mountain",
  ]);
  assert.deepStrictEqual(parseCompareSlugs(["", "  ", "alta"]), ["alta"]);
});

test("duplicates are removed, keeping first occurrence order", () => {
  assert.deepStrictEqual(parseCompareSlugs("vail,vail,alta,VAIL"), [
    "vail",
    "alta",
  ]);
  assert.deepStrictEqual(parseCompareSlugs(["alta", "alta"]), ["alta"]);
});

test("slugs are lower-cased so shared URLs survive case mangling", () => {
  assert.deepStrictEqual(parseCompareSlugs("Vail,Bear-Mountain"), [
    "vail",
    "bear-mountain",
  ]);
});

test("the list is capped at the comparison maximum", () => {
  assert.strictEqual(MAX_COMPARE_RESORTS, 4);
  assert.deepStrictEqual(parseCompareSlugs("a,b,c,d,e,f"), ["a", "b", "c", "d"]);
  assert.deepStrictEqual(parseCompareSlugs(["a", "b,c", "d", "e"]), [
    "a",
    "b",
    "c",
    "d",
  ]);
  assert.deepStrictEqual(parseCompareSlugs("a,b,c", 2), ["a", "b"]);
  assert.deepStrictEqual(parseCompareSlugs("a,b,c", 0), []);
});

test("unknown slugs survive parsing — resolution is the caller's job", () => {
  assert.deepStrictEqual(parseCompareSlugs("not-a-real-resort,vail"), [
    "not-a-real-resort",
    "vail",
  ]);
});

test("non-string array members are ignored", () => {
  const messy = ["vail", undefined, 7, null, "alta"] as unknown as string[];
  assert.deepStrictEqual(parseCompareSlugs(messy), ["vail", "alta"]);
});

test("buildCompareHref round-trips a normalised, encoded URL", () => {
  assert.strictEqual(buildCompareHref([]), "/compare");
  assert.strictEqual(buildCompareHref(["  "]), "/compare");
  assert.strictEqual(
    buildCompareHref(["vail", "bear-mountain"]),
    "/compare?resorts=vail,bear-mountain",
  );
  assert.strictEqual(
    buildCompareHref(["vail", "vail", "alta", "brighton", "solitude", "snowbird"]),
    "/compare?resorts=vail,alta,brighton,solitude",
  );
  assert.deepStrictEqual(
    parseCompareSlugs("vail,alta"),
    parseCompareSlugs(["vail", "alta"]),
  );
});
