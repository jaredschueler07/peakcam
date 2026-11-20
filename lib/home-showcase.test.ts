import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SHOWCASE_FALLBACK_SLUGS, buildShowcaseCards, pickShowcaseResort, type ShowcaseResort } from "./home-showcase";

const NOVEMBER = new Date(2026, 10, 20, 12);
const JULY = new Date(2026, 6, 20, 12);

function resort(slug: string, over: Partial<ShowcaseResort> = {}): ShowcaseResort {
  return { id: slug, slug, name: slug, lat: 39, snotel_station_id: "1:CA:SNTL", ...over };
}

test("picks today's top-scored in-season resort that has a station", () => {
  const resorts = [
    resort("model-only", { snotel_station_id: null }),
    resort("second"),
    resort("first"),
    resort("andes", { lat: -33 }),
  ];
  const scores = { "model-only": { score: 99 }, second: { score: 70 }, first: { score: 80 }, andes: { score: 95 } };
  assert.equal(pickShowcaseResort(resorts, scores, NOVEMBER)?.slug, "first");
  // In July the northern resorts are out of season and the Andes one is in.
  assert.equal(pickShowcaseResort(resorts, scores, JULY)?.slug, "andes");
});

test("ties go to the name, so the pick does not move between renders", () => {
  const resorts = [resort("zeta"), resort("alpha")];
  assert.equal(pickShowcaseResort(resorts, { zeta: { score: 80 }, alpha: { score: 80 } }, NOVEMBER)?.slug, "alpha");
});

test("without scores it falls back to a known station resort, then to null", () => {
  const withFallback = [resort("somewhere"), resort(SHOWCASE_FALLBACK_SLUGS[1]), resort(SHOWCASE_FALLBACK_SLUGS[0])];
  assert.equal(pickShowcaseResort(withFallback, null, NOVEMBER)?.slug, SHOWCASE_FALLBACK_SLUGS[0]);
  assert.equal(pickShowcaseResort(withFallback, {}, NOVEMBER)?.slug, SHOWCASE_FALLBACK_SLUGS[0]);
  assert.equal(pickShowcaseResort([resort("somewhere")], null, NOVEMBER), null);
});

test("an unscored resort never outranks the fallback", () => {
  const resorts = [resort("unscored"), resort(SHOWCASE_FALLBACK_SLUGS[0])];
  assert.equal(pickShowcaseResort(resorts, { other: { score: 50 } }, NOVEMBER)?.slug, SHOWCASE_FALLBACK_SLUGS[0]);
});

/** `/resorts/x/history` → `app/resorts/[slug]/history/page.tsx`. */
function routeFile(href: string): string {
  const path = href.replace(/^\/resorts\/[^/]+/, "/resorts/[slug]");
  return join(process.cwd(), "app", path, "page.tsx");
}

test("every card links to a page that exists in app/", () => {
  for (const cards of [buildShowcaseCards({ slug: "alta", name: "Alta Ski Area" }), buildShowcaseCards(null)]) {
    assert.ok(cards.length >= 6 && cards.length <= 8, `${cards.length} cards`);
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, "card ids are unique");
    for (const card of cards) {
      assert.match(card.href, /^\/[a-z0-9\-/]+$/, `${card.id} href ${card.href}`);
      assert.ok(existsSync(routeFile(card.href)), `${card.id} links to ${card.href}, which has no page in app/`);
      assert.ok(card.title && card.body && card.cta && card.eyebrow, `${card.id} is missing copy`);
    }
  }
});

test("the per-resort cards name the resort; without one they link to an aggregate page", () => {
  const named = buildShowcaseCards({ slug: "palisades-tahoe", name: "Palisades Tahoe" });
  assert.equal(named.find((c) => c.id === "history")?.href, "/resorts/palisades-tahoe/history");
  assert.equal(named.find((c) => c.id === "forecast")?.href, "/resorts/palisades-tahoe/snow-forecast");
  assert.match(named.find((c) => c.id === "history")!.cta, /Palisades Tahoe/);
  const bare = buildShowcaseCards(null);
  assert.ok(!bare.some((c) => c.href.startsWith("/resorts/")));
});

test("powder alerts are left to the banner the homepage already has", () => {
  assert.ok(!buildShowcaseCards(null).some((c) => c.href === "/alerts"));
});
