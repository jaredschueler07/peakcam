import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { STATION_INDEX } from "@/lib/stations";

// The catalogue CSVs are what the importer ships to production, so their
// shape is checked here rather than on the mini after the fact: every resort
// has coordinates a map can place, something to show (a cam row) or to
// measure with (an NRCS station), and every cross-file reference resolves.
// Pure filesystem, no database.

const ROOT = resolve(__dirname, "..");
const DATA = join(ROOT, "data");

type Row = Record<string, string>;
const readCsv = (name: string): Row[] =>
  parse(readFileSync(join(DATA, name), "utf-8"), { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Row[];

const resorts = readCsv("resorts.csv");
const cams = readCsv("cams.csv");
const profiles = readCsv("resort-profiles.csv");
const openings = readCsv("resort-openings.csv");

/**
 * Resorts that ship with neither a cam row nor a SNOTEL station. Each one
 * needs a reason here so the gap is a decision, never an accident: the Andes
 * rows have no public cam and no open station network (Open-Meteo covers the
 * snow report); any new entry should name the follow-up that removes it.
 */
const NO_CAM_NO_STATION_ALLOWED: Record<string, string> = {
  lagunillas: "Andes: no public cam, no station network; model snow report",
  "cerro-mirador": "Andes: no public cam, no station network; model snow report",
  "batea-mahuida": "Andes: no public cam, no station network; model snow report",
  "cerro-perito-moreno": "Andes: no public cam, no station network; model snow report",
};

const slugs = new Set(resorts.map((r) => r.slug));
const camsBySlug = new Map<string, Row[]>();
for (const cam of cams) camsBySlug.set(cam.resort_slug, [...(camsBySlug.get(cam.resort_slug) ?? []), cam]);

test("resorts.csv: slugs are unique and kebab-case", () => {
  const seen = new Set<string>();
  for (const r of resorts) {
    assert.match(r.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `bad slug "${r.slug}"`);
    assert.ok(!seen.has(r.slug), `duplicate slug ${r.slug}`);
    seen.add(r.slug);
    assert.ok(r.name, `${r.slug} has no name`);
    assert.ok(r.state && r.region, `${r.slug} needs state and region`);
    assert.ok(/^https?:\/\//.test(r.website_url), `${r.slug} website_url "${r.website_url}" is not a URL`);
  }
});

test("resorts.csv: every row has coordinates a map can place", () => {
  for (const r of resorts) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    assert.ok(Number.isFinite(lat) && Math.abs(lat) <= 90 && lat !== 0, `${r.slug} lat "${r.lat}"`);
    assert.ok(Number.isFinite(lng) && Math.abs(lng) <= 180 && lng !== 0, `${r.slug} lng "${r.lng}"`);
    // The catalogue is the Americas: west of the prime meridian, both hemispheres.
    assert.ok(lng < -30 && lng > -180, `${r.slug} lng ${lng} is outside the Americas`);
    if (r.elevation_base_ft || r.elevation_summit_ft) {
      const base = Number(r.elevation_base_ft);
      const summit = Number(r.elevation_summit_ft);
      assert.ok(Number.isInteger(base) && Number.isInteger(summit), `${r.slug} elevations must both be integers or both blank`);
      assert.ok(summit > base && base > 0 && summit < 20_000, `${r.slug} summit ${summit} must be above base ${base}`);
    }
  }
});

test("resorts.csv: every active resort has a cam row or a SNOTEL station (or a reason not to)", () => {
  for (const r of resorts) {
    if (r.is_active !== "true") continue;
    const hasCam = (camsBySlug.get(r.slug)?.length ?? 0) > 0;
    const hasStation = r.snotel_station_id !== "";
    if (hasCam || hasStation) continue;
    assert.ok(r.slug in NO_CAM_NO_STATION_ALLOWED, `${r.slug} has neither a cam row nor a station; add one or record why in NO_CAM_NO_STATION_ALLOWED`);
  }
  for (const slug of Object.keys(NO_CAM_NO_STATION_ALLOWED)) {
    assert.ok(slugs.has(slug), `NO_CAM_NO_STATION_ALLOWED names ${slug}, which is not in resorts.csv`);
  }
});

test("resorts.csv: every SNOTEL triplet is a known station", () => {
  for (const r of resorts) {
    if (!r.snotel_station_id) continue;
    assert.match(r.snotel_station_id, /^\d+:[A-Z]{2}:(?:SNTL|SCAN)$/, `${r.slug} station "${r.snotel_station_id}" is not an NRCS triplet`);
    const meta = STATION_INDEX[r.snotel_station_id];
    assert.ok(meta?.name, `${r.slug} station ${r.snotel_station_id} is missing from lib/public-api/stations.json`);
  }
});

test("cams.csv: every row names a resort, a supported embed and a unique embed per resort", () => {
  const seen = new Set<string>();
  for (const cam of cams) {
    assert.ok(slugs.has(cam.resort_slug), `cam "${cam.name}" references unknown resort ${cam.resort_slug}`);
    assert.ok(cam.name, `${cam.resort_slug} has a cam with no name`);
    assert.ok(["youtube", "iframe", "image", "link"].includes(cam.embed_type), `${cam.resort_slug}/${cam.name} embed_type "${cam.embed_type}"`);
    if (cam.embed_type === "youtube") {
      assert.match(cam.youtube_id, /^[A-Za-z0-9_-]{11}$/, `${cam.resort_slug}/${cam.name} youtube_id "${cam.youtube_id}"`);
    } else {
      assert.match(cam.embed_url, /^https?:\/\//, `${cam.resort_slug}/${cam.name} embed_url "${cam.embed_url}"`);
    }
    if (cam.kind) {
      assert.ok(["summit", "mid", "base", "snow-stake", "village", "approach"].includes(cam.kind), `${cam.resort_slug}/${cam.name} kind "${cam.kind}"`);
    }
    const key = `${cam.resort_slug}|${cam.embed_type === "youtube" ? cam.youtube_id : cam.embed_url}`;
    assert.ok(!seen.has(key), `duplicate cam embed for ${cam.resort_slug}: ${cam.embed_type === "youtube" ? cam.youtube_id : cam.embed_url}`);
    seen.add(key);
  }
});

test("resort-profiles.csv and resort-openings.csv reference resorts that exist", () => {
  const profileSlugs = new Set<string>();
  for (const p of profiles) {
    assert.ok(slugs.has(p.slug), `profile row for unknown resort ${p.slug}`);
    assert.ok(!profileSlugs.has(p.slug), `duplicate profile row ${p.slug}`);
    profileSlugs.add(p.slug);
  }
  for (const o of openings) {
    assert.ok(slugs.has(o.slug), `opening row for unknown resort ${o.slug}`);
    for (const col of ["projected_open", "confirmed_open", "closing_date"]) {
      if (o[col]) assert.match(o[col], /^\d{4}-\d{2}-\d{2}$/, `${o.slug} ${col} "${o[col]}"`);
    }
  }
});
