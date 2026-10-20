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
 * Resorts that ship with neither a cam row nor a SNOTEL/SCAN triplet. Each one
 * needs a reason here so the gap is a decision, never an accident: the Andes
 * rows have no public cam and no open station network (Open-Meteo covers the
 * snow report); the Eastern and Midwest rows name the P3 station that measures
 * for them and why no cam is stored; any new entry should name the follow-up
 * that removes it.
 */
const NO_CAM_NO_STATION_ALLOWED: Record<string, string> = {
  lagunillas: "Andes: no public cam, no station network; model snow report",
  "cerro-mirador": "Andes: no public cam, no station network; model snow report",
  "batea-mahuida": "Andes: no public cam, no station network; model snow report",
  "cerro-perito-moreno": "Andes: no public cam, no station network; model snow report",
  // P1 batch 2 (2026-10-20): east of the Rockies the AWDB rule rarely matches, so the P3
  // station layer (GHCN-Daily snow stations, NWS observations) is the measured source.
  // The nearest ones within 25 km are recorded here from the import-day check.
  "afton-alps": "P3: GHCN US1MNWG0047 5 km, NWS K21D 17 km; no public cam on the operator site",
  "alpine-valley": "P3: GHCN US1WIWW0037 10 km, NWS K57C 8 km; no public cam on the operator site",
  "berkshire-east": "P3: GHCN USC00192175 5 km; no public cam on the operator site",
  "big-boulder": "P3: GHCN US1PACB0033 4 km, NWS KMPO 21 km; no public cam on the operator site",
  "big-powderhorn": "P3: GHCN US1MIGG0008 4 km, NWS KIWD 4 km; Twitch players need a host-bound parent parameter",
  "black-mountain-nh": "P3: GHCN US1NHCR0015 6 km; no public cam on the operator site",
  "black-mountain-of-maine": "P3: GHCN USC00171901 18 km; no public cam on the operator site",
  "boston-mills": "P3: GHCN US1OHSM0044 7 km; no public cam on the operator site",
  "devils-head": "P3: GHCN US1WISK0026 6 km, NWS KDLL 17 km; no public cam on the operator site",
  "elk-mountain": "P3: GHCN USC00367029 9 km; no public cam on the operator site",
  "jack-frost": "P3: GHCN US1PACB0033 4 km, NWS KMPO 23 km; no public cam on the operator site",
  "labrador-mountain": "P3: GHCN US1NYOG0087 9 km, NWS KN03 22 km; no public cam on the operator site",
  "laurel-mountain": "P3: GHCN USC00364839 2 km, NWS KLBE 24 km; no public cam on the operator site",
  "lost-valley": "P3: GHCN US1MEAN0041 3 km, NWS KLEW 9 km; no public cam on the operator site",
  "mad-river-mountain": "P3: GHCN US1OHLG0015 9 km, NWS KEDJ 13 km; no public cam on the operator site",
  "montage-mountain": "P3: GHCN USW00014777 5 km, NWS KAVP 6 km; no public cam on the operator site",
  "mount-bohemia": "P3: GHCN US1MIKW0001 9 km, NWS KP59 14 km; no public cam on the operator site",
  "mountain-creek": "P3: GHCN US1NJSS0066 3 km, NWS KFWN 10 km; no public cam on the operator site",
  "mt-abram": "P3: GHCN US1MEOX0014 8 km; no public cam on the operator site",
  "mt-brighton": "P3: GHCN US1MILV0024 6 km, NWS KOZW 18 km; no public cam on the operator site",
  "otsego-resort": "P3: GHCN USW00004854 3 km, NWS KGLR 3 km; no public cam on the operator site",
  "paoli-peaks": "P3: GHCN US1INOR0034 6 km; no public cam on the operator site",
  "pine-mountain": "P3: GHCN US1MIDC0006 1 km, NWS KIMT 3 km; no public cam on the operator site",
  "plattekill": "P3: GHCN US1NYDL0025 9 km; no public cam on the operator site",
  "pleasant-mountain": "P3: GHCN USC00176484 18 km, NWS KIZG 13 km; cams held on Boyne framing terms",
  "quechee": "P3: GHCN US1VTWR0032 2 km, NWS KLEB 12 km; no public cam on the operator site",
  "ski-brule": "P3: GHCN USC00207812 7 km; no public cam on the operator site",
  "snowriver": "P3: GHCN US1MIGG0011 10 km, NWS KIWD 13 km; no public cam on the operator site",
  "song-mountain": "P3: GHCN US1NYOG0087 5 km, NWS KN03 21 km; no public cam on the operator site",
  "swain": "P3: GHCN US1NYLV0001 10 km, NWS KDSV 15 km; no public cam on the operator site",
  "the-highlands": "P3: GHCN US1MIEM0005 5 km, NWS KMGN 5 km; cams held on Boyne framing terms",
  "trollhaugen": "P3: GHCN US1WIPK0054 6 km, NWS KOEO 7 km; no public cam on the operator site",
  "welch-village": "P3: GHCN US1MNGH0021 3 km, NWS KRGK 20 km; no public cam on the operator site",
  "wild-mountain": "P3: GHCN US1MNCG0043 4 km, NWS KOEO 20 km; cams held on framing terms",
  "wilmot-mountain": "P3: GHCN US1WIKN0037 5 km, NWS KBUU 23 km; no public cam on the operator site",
  // P1 batch 3 (2026-10-20): Canada has no NRCS stations at all, so every Canadian row relies on the P3
  // layer (GHCN-Daily, BC ASWS, ECCC SWOB); the nearest within 25 km on import day are recorded here.
  "baldy-mountain": "P3: GHCN CAN01125852 20 km, ECCC BC_TRAN_33093 17 km; both operator cams unembeddable (ipcamlive free tier), re-check at opening",
  "cypress-mountain": "P3: GHCN CAN01108824 5 km, BC ASWS 3A09P 14 km, ECCC 1108824 5 km; four cams held on Boyne framing terms",
  "manning-park": "P3: BC ASWS 2G03P 11 km, ECCC BC_TRAN_15392 7 km; both operator cams offline until opening",
  "powder-king": "P3: BC ASWS 4A02P 2 km; the operator's YouTube stream ended 2025-04, re-check at opening",
  "sommet-morin-heights": "P3: GHCN CA1QC000022 11 km; the Sommets group publishes no cam for this hill",
  "sommet-olympia": "P3: GHCN CA1QC000061 6 km; the Sommets group publishes no cam for this hill",
  "crabbe-mountain": "P3: GHCN CA1NB000081 20 km; the only cam (nbcams.ca relay) is stale off-season, re-check at opening",
  "marble-mountain": "P3: GHCN CA1NL000095 3 km, ECCC 8401298 6 km; the Brownrice stream is scheduled offline until opening",
  "bigrock-mountain": "P3: GHCN US1MEAR0028 17 km, NWS KPQI 25 km; no public cam on the operator site",
  penitentes: "Andes: no public cam, no station network; model snow report",
  antuco: "Andes: no public cam, no station network; model snow report",
  "las-araucarias": "Andes: no public cam, no station network; model snow report",
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
