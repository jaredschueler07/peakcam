// ─────────────────────────────────────────────────────────────
// Station layer — approach (road) cams from state and provincial DOT feeds.
//
// Open feeds, no key:
// - Caltrans CCTV: https://cwwp2.dot.ca.gov/data/d{N}/cctv/cctvStatusD{NN}.json
//   per district (D3 Tahoe/I-80/US-50, D9 Mammoth/US-395, D10 Hwy 4/88/108,
//   D2 Mt Shasta). Terms: https://dot.ca.gov/conditions-of-use.
// - DriveBC: https://www.drivebc.ca/api/webcams/ (the current site API; the
//   images are https://www.drivebc.ca/images/{id}.jpg). The metadata and image
//   links are the BC Data Catalogue "BC Highway Cams" record under the Open
//   Government Licence – BC; DriveBC's own "about" page still reserves
//   rebroadcast rights over the images, so rows are hot-linked, never archived,
//   and docs/stations.md records the conflict for the user to settle.
// Keyed feeds (client implemented, skipped when the env var is unset):
// - UDOT:  https://www.udottraffic.utah.gov/api/v2/get/cameras?key=…&format=json  (UDOT_API_KEY)
// - WSDOT: https://wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=…  (WSDOT_ACCESS_CODE)
// - COtrip: https://data.cotrip.org/api/v1/cameras?apiKey=…  (COTRIP_API_KEY)
//
// Every parser returns the same RoadCam; `matchApproachCams` turns them into
// `cams` rows (embed_type image, kind approach, credit = agency, the agency's
// terms URL) for resorts within 25 km, preferring cams on a known access
// route, capped at four per resort. Pure: the fetchers are thin wrappers.
// ─────────────────────────────────────────────────────────────

import { haversineKm, num, type GeoPointLike } from "./types";

export type RoadCamAgency = "caltrans" | "drivebc" | "udot" | "wsdot" | "cotrip";

export interface RoadCam {
  agency: RoadCamAgency;
  sourceId: string;
  name: string;
  lat: number;
  lng: number;
  /** Route as the agency labels it: `I-80`, `US-50`, `SR-210`, `99`, `5`. */
  route: string | null;
  /** Direct still image URL. */
  imageUrl: string;
  /** The agency page or feed entry a viewer can be sent to. */
  pageUrl: string | null;
  elevationFt: number | null;
  /** False when the feed marks the cam out of service. */
  inService: boolean;
}

export interface RoadCamAgencyInfo {
  credit: string;
  termsUrl: string;
  /** Whether the agency's published terms allow PeakCam to store frames (migration 024 `archive_allowed`). */
  archiveAllowed: boolean;
}

export const ROAD_CAM_AGENCIES: Record<RoadCamAgency, RoadCamAgencyInfo> = {
  caltrans: { credit: "Caltrans", termsUrl: "https://dot.ca.gov/conditions-of-use", archiveAllowed: true },
  drivebc: {
    credit: "DriveBC (BC Ministry of Transportation and Transit)",
    termsUrl: "https://catalogue.data.gov.bc.ca/dataset/bc-highway-cams",
    archiveAllowed: false,
  },
  udot: { credit: "UDOT Traffic", termsUrl: "https://www.udottraffic.utah.gov/developers/doc", archiveAllowed: false },
  wsdot: { credit: "WSDOT", termsUrl: "https://wsdot.wa.gov/traffic/api/", archiveAllowed: false },
  cotrip: { credit: "COtrip (CDOT)", termsUrl: "https://www.cotrip.org/about-cotrip/", archiveAllowed: false },
};

export const CALTRANS_DISTRICTS = [2, 3, 9, 10] as const;
export function caltransDistrictUrl(district: number): string {
  return `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, "0")}.json`;
}
export const DRIVEBC_WEBCAMS_URL = "https://www.drivebc.ca/api/webcams/";
export const DRIVEBC_IMAGE_BASE = "https://www.drivebc.ca";
export const UDOT_CAMERAS_URL = "https://www.udottraffic.utah.gov/api/v2/get/cameras";
export const WSDOT_CAMERAS_URL = "https://wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson";
export const COTRIP_CAMERAS_URL = "https://data.cotrip.org/api/v1/cameras";

/** Env var names the keyed feeds read; the user adds the values to .env.local. */
export const ROAD_CAM_ENV = {
  udot: "UDOT_API_KEY",
  wsdot: "WSDOT_ACCESS_CODE",
  cotrip: "COTRIP_API_KEY",
} as const;

// ── Parsers ──────────────────────────────────────────────────

interface CaltransRecord {
  cctv?: {
    index?: string;
    location?: {
      district?: string;
      locationName?: string;
      nearbyPlace?: string;
      longitude?: string;
      latitude?: string;
      elevation?: string;
      route?: string;
      county?: string;
    };
    inService?: string;
    imageData?: {
      streamingVideoURL?: string;
      static?: { currentImageURL?: string };
    };
  };
}

export function parseCaltrans(json: { data?: CaltransRecord[] }): RoadCam[] {
  const out: RoadCam[] = [];
  for (const row of json.data ?? []) {
    const c = row.cctv;
    const loc = c?.location;
    const lat = num(loc?.latitude);
    const lng = num(loc?.longitude);
    const imageUrl = c?.imageData?.static?.currentImageURL;
    if (!c || !loc || lat == null || lng == null || !imageUrl) continue;
    const district = loc.district ?? "";
    out.push({
      agency: "caltrans",
      sourceId: `d${district}-${c.index ?? imageUrl}`,
      name: loc.locationName?.trim() || imageUrl,
      lat,
      lng,
      route: loc.route?.trim() || null,
      imageUrl,
      pageUrl: `https://cwwp2.dot.ca.gov/vm/loc/d${district}/${imageUrl.split("/").slice(-2, -1)[0] ?? ""}.htm`,
      elevationFt: num(loc.elevation),
      inService: c.inService !== "false",
    });
  }
  return out;
}

interface DriveBcRecord {
  id: number;
  name?: string;
  caption?: string;
  highway?: string | null;
  highway_description?: string;
  elevation?: number | null;
  location?: { coordinates?: number[] };
  links?: { imageDisplay?: string };
  is_on?: boolean;
  should_appear?: boolean;
  marked_stale?: boolean;
  credit?: string;
}

export function parseDriveBc(json: DriveBcRecord[]): RoadCam[] {
  const out: RoadCam[] = [];
  for (const r of Array.isArray(json) ? json : []) {
    const coords = r.location?.coordinates;
    if (!coords || coords.length < 2 || r.should_appear === false) continue;
    const [lng, lat] = coords;
    const elevM = num(r.elevation);
    out.push({
      agency: "drivebc",
      sourceId: String(r.id),
      name: r.name?.trim() || `DriveBC ${r.id}`,
      lat,
      lng,
      route: r.highway?.trim() || null,
      imageUrl: `${DRIVEBC_IMAGE_BASE}/images/${r.id}.jpg`,
      pageUrl: `https://www.drivebc.ca/cameras/${r.id}`,
      elevationFt: elevM == null ? null : Math.round(elevM * 3.28084),
      inService: r.is_on !== false && r.marked_stale !== true,
    });
  }
  return out;
}

/** UDOT shares the 511 vendor schema: Id, Roadway, Latitude, Longitude, Location, Views[{Url, Status}]. */
interface UdotRecord {
  Id?: number | string;
  Roadway?: string;
  Direction?: string;
  Latitude?: number;
  Longitude?: number;
  Location?: string;
  Views?: Array<{ Id?: number | string; Url?: string; Status?: string; Description?: string }>;
}

export function parseUdot(json: UdotRecord[]): RoadCam[] {
  const out: RoadCam[] = [];
  for (const r of Array.isArray(json) ? json : []) {
    const lat = num(r.Latitude);
    const lng = num(r.Longitude);
    const view = (r.Views ?? []).find((v) => v.Url) ?? null;
    if (lat == null || lng == null || !view?.Url) continue;
    out.push({
      agency: "udot",
      sourceId: String(r.Id ?? view.Id ?? view.Url),
      name: r.Location?.trim() || `UDOT ${r.Id}`,
      lat,
      lng,
      route: r.Roadway?.trim() || null,
      imageUrl: view.Url,
      pageUrl: `https://www.udottraffic.utah.gov/map/#camera-${r.Id ?? ""}`,
      elevationFt: null,
      inService: (view.Status ?? "Enabled").toLowerCase() !== "disabled",
    });
  }
  return out;
}

/** WSDOT Traveler Information `Camera` class. */
interface WsdotRecord {
  CameraID?: number;
  Title?: string;
  Description?: string;
  ImageURL?: string;
  IsActive?: boolean;
  CameraLocation?: { Latitude?: number; Longitude?: number; RoadName?: string; MilePost?: number; Description?: string };
  OwnerURL?: string;
  CameraOwner?: string;
}

export function parseWsdot(json: WsdotRecord[]): RoadCam[] {
  const out: RoadCam[] = [];
  for (const r of Array.isArray(json) ? json : []) {
    const lat = num(r.CameraLocation?.Latitude);
    const lng = num(r.CameraLocation?.Longitude);
    if (lat == null || lng == null || !r.ImageURL || r.CameraID == null) continue;
    out.push({
      agency: "wsdot",
      sourceId: String(r.CameraID),
      name: r.Title?.trim() || r.CameraLocation?.Description?.trim() || `WSDOT ${r.CameraID}`,
      lat,
      lng,
      route: r.CameraLocation?.RoadName?.trim() || null,
      imageUrl: r.ImageURL,
      pageUrl: r.OwnerURL?.trim() || null,
      elevationFt: null,
      inService: r.IsActive !== false,
    });
  }
  return out;
}

/** COtrip GeoJSON (`features[].properties.views[].url`); tolerant of `imageUrl` variants until a key verifies the shape. */
interface CotripFeature {
  geometry?: { coordinates?: number[] } | null;
  properties?: {
    id?: string | number;
    name?: string;
    status?: string;
    routeName?: string;
    route?: string;
    imageUrl?: string;
    views?: Array<{ url?: string; imageUrl?: string; category?: string; status?: string }>;
  };
}

export function parseCotrip(json: { features?: CotripFeature[] }): RoadCam[] {
  const out: RoadCam[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const view = (p.views ?? []).find((v) => (v.url ?? v.imageUrl) && (!v.category || /image|still/i.test(v.category)));
    const imageUrl = view?.url ?? view?.imageUrl ?? p.imageUrl;
    if (!imageUrl) continue;
    out.push({
      agency: "cotrip",
      sourceId: String(p.id ?? imageUrl),
      name: p.name?.trim() || `COtrip ${p.id}`,
      lat: coords[1],
      lng: coords[0],
      route: p.routeName?.trim() || p.route?.trim() || null,
      imageUrl,
      pageUrl: "https://www.cotrip.org/",
      elevationFt: null,
      inService: !p.status || !/disabled|inactive|closed/i.test(p.status),
    });
  }
  return out;
}

// ── Matching ─────────────────────────────────────────────────

/**
 * The highway that reaches each resort, by slug, as the feeds spell it. Used
 * only to rank: a cam on the access road beats a nearer cam on another road.
 * Resorts not listed rank by distance alone. Editorial; extend freely.
 */
export const ACCESS_ROUTES: Record<string, string[]> = {
  alta: ["SR-210", "210"],
  snowbird: ["SR-210", "210"],
  brighton: ["SR-190", "190"],
  solitude: ["SR-190", "190"],
  "park-city": ["SR-224", "224", "I-80"],
  "deer-valley": ["SR-224", "224", "SR-248"],
  snowbasin: ["SR-226", "226", "SR-39"],
  "powder-mountain": ["SR-158", "158"],
  "sundance": ["SR-92", "92"],
  "palisades-tahoe": ["SR-89", "89", "I-80"],
  "sugar-bowl": ["I-80", "80"],
  "boreal": ["I-80", "80"],
  northstar: ["SR-267", "267"],
  heavenly: ["US-50", "50"],
  kirkwood: ["SR-88", "88"],
  "sierra-at-tahoe": ["US-50", "50"],
  "mammoth-mountain": ["SR-203", "203", "US-395"],
  "june-mountain": ["SR-158", "158", "US-395"],
  "mt-rose": ["SR-431", "431"],
  "bear-valley": ["SR-4", "4"],
  "dodge-ridge": ["SR-108", "108"],
  "mt-shasta-ski-park": ["SR-89", "89"],
  "whistler-blackcomb": ["99"],
  "sun-peaks": ["5"],
  "big-white": ["33"],
  "silver-star": ["97"],
  revelstoke: ["1"],
  "kicking-horse": ["1", "95"],
  fernie: ["3"],
  "red-mountain": ["3B", "22"],
  "whitewater": ["6"],
  "apex": ["97", "3A"],
  "mt-washington": ["19"],
  "cypress-mountain": ["1", "99"],
  "grouse-mountain": ["1"],
  "crystal-mountain": ["SR 410", "410"],
  "stevens-pass": ["US 2", "2"],
  "mt-baker": ["SR 542", "542"],
  "snoqualmie": ["I-90", "90"],
  "white-pass": ["US 12", "12"],
  "mission-ridge": ["US 2", "2", "SR 285"],
  "49-degrees-north": ["US 395", "395"],
  "vail": ["I-70", "I 70", "70"],
  "beaver-creek": ["I-70", "I 70", "70"],
  "copper-mountain": ["I-70", "I 70", "CO-91", "91"],
  "breckenridge": ["CO-9", "CO 9", "9", "I-70"],
  "keystone": ["US-6", "US 6", "6"],
  "arapahoe-basin": ["US-6", "US 6", "6"],
  "loveland": ["US-6", "US 6", "6", "I-70"],
  "winter-park": ["US-40", "US 40", "40"],
  "steamboat": ["US-40", "US 40", "40"],
  "aspen-snowmass": ["CO-82", "CO 82", "82"],
  "crested-butte": ["CO-135", "CO 135", "135"],
  "telluride": ["CO-145", "CO 145", "145"],
  "purgatory": ["US-550", "US 550", "550"],
  "wolf-creek": ["US-160", "US 160", "160"],
  "monarch": ["US-50", "US 50", "50"],
  "eldora": ["CO-119", "CO 119", "119"],
};

export interface ApproachCamRow {
  resort_id: string;
  name: string;
  elevation: string | null;
  embed_type: "image";
  embed_url: string;
  youtube_id: null;
  is_active: boolean;
  kind: "approach";
  credit: string;
  source_terms_url: string;
  archive_allowed: boolean;
  card_preview: boolean;
}

export interface ApproachMatch {
  cam: RoadCam;
  distanceKm: number;
  onAccessRoute: boolean;
  row: ApproachCamRow;
}

export interface ResortForMatching extends GeoPointLike {
  id: string;
  slug: string;
  name: string;
}

export interface MatchOptions {
  maxKm?: number;
  perResort?: number;
  accessRoutes?: Record<string, string[]>;
}

/** `"SR-210"`, `"sr 210"`, `"210"` → `"210"`; `"I-80"` → `"i80"`; `"US 50"` → `"us50"`. */
export function normalizeRoute(route: string): string {
  const r = route.toLowerCase().replace(/[^a-z0-9]/g, "");
  return r.replace(/^(sr|ca|co|ut|wa|hwy|highway|bc)/, "");
}

export function routeMatches(camRoute: string | null, routes: readonly string[] | undefined): boolean {
  if (!camRoute || !routes?.length) return false;
  const cam = normalizeRoute(camRoute);
  return routes.some((r) => normalizeRoute(r) === cam);
}

/**
 * Cams within `maxKm` of each resort, access-road cams first then nearest,
 * capped at `perResort`. Returns the ready-to-insert `cams` rows; the cam name
 * carries the agency so a visitor can tell "Hwy 50 at Meyers (Caltrans)" from
 * the resort's own base cam.
 */
export function matchApproachCams(resorts: readonly ResortForMatching[], cams: readonly RoadCam[], { maxKm = 25, perResort = 4, accessRoutes = ACCESS_ROUTES }: MatchOptions = {}): Map<string, ApproachMatch[]> {
  const out = new Map<string, ApproachMatch[]>();
  for (const resort of resorts) {
    const routes = accessRoutes[resort.slug];
    const hits: ApproachMatch[] = [];
    for (const cam of cams) {
      if (!cam.inService) continue;
      const distanceKm = haversineKm(resort, cam);
      if (!Number.isFinite(distanceKm) || distanceKm > maxKm) continue;
      const info = ROAD_CAM_AGENCIES[cam.agency];
      hits.push({
        cam,
        distanceKm,
        onAccessRoute: routeMatches(cam.route, routes),
        row: {
          resort_id: resort.id,
          name: `${cam.name} (${info.credit.split(" (")[0]})`,
          elevation: cam.elevationFt != null ? `${Math.round(cam.elevationFt).toLocaleString("en-US")} ft` : null,
          embed_type: "image",
          embed_url: cam.imageUrl,
          youtube_id: null,
          is_active: true,
          kind: "approach",
          credit: info.credit,
          source_terms_url: info.termsUrl,
          archive_allowed: info.archiveAllowed,
          card_preview: false,
        },
      });
    }
    hits.sort((a, b) => Number(b.onAccessRoute) - Number(a.onAccessRoute) || a.distanceKm - b.distanceKm || a.cam.name.localeCompare(b.cam.name, "en"));
    if (hits.length) out.set(resort.slug, hits.slice(0, perResort));
  }
  return out;
}

// ── Network ──────────────────────────────────────────────────

export interface RoadCamFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

async function getJson<T>(url: string, options: RoadCamFetchOptions): Promise<T> {
  const f = options.fetchImpl ?? fetch;
  const res = await f(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
  if (!res.ok) throw new Error(`${res.status} for ${url.split("?")[0]}`);
  return (await res.json()) as T;
}

export async function fetchCaltransCams(options: RoadCamFetchOptions = {}, districts: readonly number[] = CALTRANS_DISTRICTS): Promise<RoadCam[]> {
  const out: RoadCam[] = [];
  for (const d of districts) out.push(...parseCaltrans(await getJson(caltransDistrictUrl(d), options)));
  return out;
}

export async function fetchDriveBcCams(options: RoadCamFetchOptions = {}): Promise<RoadCam[]> {
  return parseDriveBc(await getJson(DRIVEBC_WEBCAMS_URL, options));
}

/** Keyed feeds: an empty array, not an error, when the key is absent — the sync logs the env var name. */
export async function fetchUdotCams(options: RoadCamFetchOptions = {}): Promise<RoadCam[]> {
  const key = (options.env ?? process.env)[ROAD_CAM_ENV.udot];
  if (!key) return [];
  return parseUdot(await getJson(`${UDOT_CAMERAS_URL}?${new URLSearchParams({ key, format: "json" })}`, options));
}

export async function fetchWsdotCams(options: RoadCamFetchOptions = {}): Promise<RoadCam[]> {
  const code = (options.env ?? process.env)[ROAD_CAM_ENV.wsdot];
  if (!code) return [];
  return parseWsdot(await getJson(`${WSDOT_CAMERAS_URL}?${new URLSearchParams({ AccessCode: code })}`, options));
}

export async function fetchCotripCams(options: RoadCamFetchOptions = {}): Promise<RoadCam[]> {
  const key = (options.env ?? process.env)[ROAD_CAM_ENV.cotrip];
  if (!key) return [];
  return parseCotrip(await getJson(`${COTRIP_CAMERAS_URL}?${new URLSearchParams({ apiKey: key })}`, options));
}

/** Which keyed agencies are configured in an env; the sync prints the missing names. */
export function keyedAgenciesStatus(env: Record<string, string | undefined> = process.env): Record<keyof typeof ROAD_CAM_ENV, boolean> {
  return { udot: Boolean(env[ROAD_CAM_ENV.udot]), wsdot: Boolean(env[ROAD_CAM_ENV.wsdot]), cotrip: Boolean(env[ROAD_CAM_ENV.cotrip]) };
}
