// ─────────────────────────────────────────────────────────────
// The IANA time zone a resort's calendar day runs on.
//
// `resorts` carries no time-zone column, so the zone is derived from the
// state / province / country code the row does carry, with longitude as the
// tie-breaker inside the two split states in the catalogue (Idaho's
// panhandle is Pacific, the rest Mountain). Pure: lib/conditions-contract.ts
// uses it to decide what "today" means at the resort when it derives the
// operating status, and the tests pin the mapping.
// ─────────────────────────────────────────────────────────────

export interface TimeZoneResort {
  state: string;
  country: string;
  lng: number;
}

const BY_STATE: Record<string, string> = {
  // US Mountain
  CO: "America/Denver",
  UT: "America/Denver",
  WY: "America/Denver",
  MT: "America/Denver",
  NM: "America/Denver",
  // Arizona keeps standard time all year.
  AZ: "America/Phoenix",
  // US Pacific
  CA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  // US Central
  WI: "America/Chicago",
  MN: "America/Chicago",
  // US Eastern
  VT: "America/New_York",
  NH: "America/New_York",
  ME: "America/New_York",
  NY: "America/New_York",
  MA: "America/New_York",
  PA: "America/New_York",
  VA: "America/New_York",
  MD: "America/New_York",
  WV: "America/New_York",
  MI: "America/New_York",
  NC: "America/New_York",
  // Canada
  BC: "America/Vancouver",
  AB: "America/Edmonton",
  ON: "America/Toronto",
  QC: "America/Toronto",
  NB: "America/Halifax",
  NS: "America/Halifax",
  NL: "America/St_Johns",
  // The Andes rows store the country name in `state`.
  Chile: "America/Santiago",
  Argentina: "America/Argentina/Buenos_Aires",
};

const BY_COUNTRY: Record<string, string> = {
  CL: "America/Santiago",
  AR: "America/Argentina/Buenos_Aires",
};

/** Idaho west of this longitude (the panhandle: Schweitzer, Lookout Pass) is on Pacific time. */
const IDAHO_PACIFIC_WEST_OF_LNG = -115.5;

/** A longitude-only fallback for a code the table does not know. */
function byLongitude(lng: number): string {
  if (lng < -114) return "America/Los_Angeles";
  if (lng < -100) return "America/Denver";
  if (lng < -85) return "America/Chicago";
  return "America/New_York";
}

export function resortTimeZone(resort: TimeZoneResort): string {
  const state = (resort.state ?? "").trim();
  if (state === "ID") return resort.lng < IDAHO_PACIFIC_WEST_OF_LNG ? "America/Los_Angeles" : "America/Denver";
  if (BY_STATE[state]) return BY_STATE[state];
  if (BY_COUNTRY[resort.country]) return BY_COUNTRY[resort.country];
  return byLongitude(resort.lng);
}

const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** The YYYY-MM-DD calendar day of `instant` in `timeZone`. */
export function localDay(instant: Date, timeZone: string): string {
  let fmt = DAY_FORMATS.get(timeZone);
  if (!fmt) {
    // en-CA prints YYYY-MM-DD; the parts are reassembled by type anyway so the
    // output never depends on the locale's separator.
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    DAY_FORMATS.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPart["type"]) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The resort's calendar day for `instant`: what "today" means where the lifts are. */
export function resortLocalDay(resort: TimeZoneResort, instant: Date): string {
  return localDay(instant, resortTimeZone(resort));
}
