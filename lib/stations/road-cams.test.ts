import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESS_ROUTES,
  ROAD_CAM_AGENCIES,
  caltransDistrictUrl,
  fetchCotripCams,
  fetchUdotCams,
  fetchWsdotCams,
  keyedAgenciesStatus,
  matchApproachCams,
  normalizeRoute,
  parseCaltrans,
  parseCotrip,
  parseDriveBc,
  parseUdot,
  parseWsdot,
  routeMatches,
} from "./road-cams";

const FIX = join(__dirname, "fixtures");
const json = <T>(name: string) => JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;

const HEAVENLY = { id: "r-heavenly", slug: "heavenly", name: "Heavenly", lat: 38.9353, lng: -119.9399 };
const PALISADES = { id: "r-pal", slug: "palisades-tahoe", name: "Palisades Tahoe", lat: 39.1969, lng: -120.2357 };
const SUGAR_BOWL = { id: "r-sb", slug: "sugar-bowl", name: "Sugar Bowl", lat: 39.3044, lng: -120.3339 };
const WHISTLER = { id: "r-wb", slug: "whistler-blackcomb", name: "Whistler Blackcomb", lat: 50.1158, lng: -122.9542 };

test("caltrans: district JSON → road cams with route and still URL", () => {
  const cams = parseCaltrans(json("caltrans-d3.json"));
  assert.equal(cams.length, 7);
  const meyers = cams.find((c) => c.name === "Hwy 50 at Meyers")!;
  assert.equal(meyers.agency, "caltrans");
  assert.equal(meyers.route, "US-50");
  assert.match(meyers.imageUrl, /^https:\/\/cwwp2\.dot\.ca\.gov\/data\/d3\/cctv\/image\/.*\.jpg$/);
  assert.equal(meyers.inService, true);
  assert.ok(meyers.elevationFt! > 6000);
  assert.equal(caltransDistrictUrl(9), "https://cwwp2.dot.ca.gov/data/d9/cctv/cctvStatusD09.json");
});

test("drivebc: webcam list → road cams hot-linked to the DriveBC image", () => {
  const cams = parseDriveBc(json("drivebc-webcams.json"));
  assert.equal(cams.length, 6);
  const gate = cams.find((c) => c.sourceId === "522")!;
  assert.equal(gate.name, "Whistler Village Gate - S");
  assert.equal(gate.route, "99");
  assert.equal(gate.imageUrl, "https://www.drivebc.ca/images/522.jpg");
  assert.equal(gate.elevationFt, 2211);
  assert.equal(ROAD_CAM_AGENCIES.drivebc.archiveAllowed, false, "rebroadcast rights are contested; never archive");
});

test("keyed feeds: parsers accept the documented shapes", () => {
  const udot = parseUdot([
    { Id: 1, Roadway: "SR-210", Latitude: 40.57, Longitude: -111.65, Location: "SR-210 Little Cottonwood", Views: [{ Id: 11, Url: "https://udottraffic.utah.gov/1_devices/aux1.jpeg", Status: "Enabled" }] },
    { Id: 2, Roadway: "I-15", Latitude: 40.7, Longitude: -111.9, Location: "No view" },
  ]);
  assert.equal(udot.length, 1);
  assert.equal(udot[0].route, "SR-210");
  const wsdot = parseWsdot([
    { CameraID: 9030, Title: "SR 410 at MP 57: Crystal Mtn Blvd", ImageURL: "https://images.wsdot.wa.gov/sc/410VC05760.jpg", IsActive: true, CameraLocation: { Latitude: 46.9, Longitude: -121.5, RoadName: "SR 410", MilePost: 57.6 } },
  ]);
  assert.equal(wsdot[0].route, "SR 410");
  const cotrip = parseCotrip({
    features: [{ geometry: { coordinates: [-105.9, 39.68] }, properties: { id: "c1", name: "I-70 Loveland Pass", routeName: "I-70", views: [{ url: "https://i.cotrip.org/dimages/camera/1.jpg", category: "image" }] } }],
  });
  assert.equal(cotrip[0].imageUrl, "https://i.cotrip.org/dimages/camera/1.jpg");
  assert.equal(cotrip[0].route, "I-70");
});

test("keyed feeds: skipped cleanly when the env var is absent, called when present", async () => {
  const env = {};
  assert.deepEqual(await fetchUdotCams({ env }), []);
  assert.deepEqual(await fetchWsdotCams({ env }), []);
  assert.deepEqual(await fetchCotripCams({ env }), []);
  assert.deepEqual(keyedAgenciesStatus(env), { udot: false, wsdot: false, cotrip: false });
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  await fetchUdotCams({ env: { UDOT_API_KEY: "k" }, fetchImpl });
  assert.match(calls[0], /udottraffic\.utah\.gov\/api\/v2\/get\/cameras\?key=k&format=json/);
});

test("matching: within 25 km, access road first, four per resort, cams rows ready to insert", () => {
  const cams = parseCaltrans(json("caltrans-d3.json"));
  const matches = matchApproachCams([HEAVENLY, PALISADES, SUGAR_BOWL], cams);
  const heavenly = matches.get("heavenly")!;
  assert.ok(heavenly.length >= 1);
  assert.equal(heavenly[0].cam.name, "Hwy 50 at Meyers", "US-50 is Heavenly's access road");
  assert.equal(heavenly[0].onAccessRoute, true);
  for (const m of heavenly) assert.ok(m.distanceKm <= 25);
  const row = heavenly[0].row;
  assert.equal(row.resort_id, "r-heavenly");
  assert.equal(row.embed_type, "image");
  assert.equal(row.kind, "approach");
  assert.equal(row.credit, "Caltrans");
  assert.equal(row.source_terms_url, "https://dot.ca.gov/conditions-of-use");
  assert.equal(row.archive_allowed, true);
  assert.equal(row.card_preview, false);
  assert.equal(row.name, "Hwy 50 at Meyers (Caltrans)");
  assert.match(row.elevation!, /ft$/);

  const sugar = matches.get("sugar-bowl")!;
  assert.ok(sugar.length <= 4);
  assert.ok(sugar.some((m) => /Donner Summit|Soda Springs|Kingvale/.test(m.cam.name)));
  assert.equal(sugar[0].onAccessRoute, true, "I-80 cams first");
  // Sacramento's I-5 cam is 150 km from every Tahoe resort.
  for (const list of matches.values()) assert.ok(list.every((m) => m.cam.name !== "Hwy 5 at Pocket"));
});

test("matching: DriveBC cams match Whistler by route 99", () => {
  const cams = parseDriveBc(json("drivebc-webcams.json"));
  const matches = matchApproachCams([WHISTLER], cams);
  const w = matches.get("whistler-blackcomb")!;
  assert.equal(w.length, 3, "three Village Gate views within 25 km; the Coquihalla cams are 200 km east");
  assert.ok(w.every((m) => m.onAccessRoute));
  assert.equal(w[0].row.credit, ROAD_CAM_AGENCIES.drivebc.credit);
  assert.equal(w[0].row.archive_allowed, false);
});

test("routes: normalisation treats SR-210 / 210 / sr 210 alike, I-80 stays distinct from 80 in CA labels", () => {
  assert.equal(normalizeRoute("SR-210"), "210");
  assert.equal(normalizeRoute("sr 210"), "210");
  assert.equal(normalizeRoute("I-80"), "i80");
  assert.equal(normalizeRoute("US 50"), "us50");
  assert.equal(routeMatches("SR-210", ACCESS_ROUTES.alta), true);
  assert.equal(routeMatches("I-80", ACCESS_ROUTES["sugar-bowl"]), true);
  assert.equal(routeMatches("SR-89", ACCESS_ROUTES.alta), false);
  assert.equal(routeMatches(null, ACCESS_ROUTES.alta), false);
});
