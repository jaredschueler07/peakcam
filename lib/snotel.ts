// ─────────────────────────────────────────────────────────────
// NRCS SNOTEL API helpers
// Free — no API key required.
// Data from the Natural Resources Conservation Service (USDA).
// Stations provide snowpack, temperature, and precip readings
// from automated sensors across western US mountain ranges.
// ─────────────────────────────────────────────────────────────

const REPORT_BASE = "https://wcc.sc.egov.usda.gov/reportGenerator/view_csv";

/** SNOTEL data elements we care about. */
type SnotelElement =
  | "SNWD::value"   // Snow depth (inches)
  | "WTEQ::value"   // Snow water equivalent (inches)
  | "PREC::value"   // Precipitation accumulation (inches)
  | "TOBS::value"   // Observed air temperature (°F)
  | "TMAX::value"   // Max temperature (°F)
  | "TMIN::value";  // Min temperature (°F)

/** Parsed SNOTEL reading for a single station. */
export interface SnotelReading {
  stationId: string;
  date: string;              // YYYY-MM-DD
  snowDepthIn: number | null;
  sweIn: number | null;      // snow water equivalent
  precipIn: number | null;
  tempF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
}

/** Multi-day SNOTEL snapshot used by the Snow Report page. */
export interface SnotelSnapshot {
  stationId: string;
  stationName: string;
  current: SnotelReading | null;
  newSnow24h: number | null; // computed: today depth - yesterday depth
  newSnow48h: number | null;
  seasonTotal: number | null;
  readings: SnotelReading[]; // up to 7 days of history
}

// ── CSV Fetcher ──────────────────────────────────────────────

/**
 * Build a reportGenerator URL for a single SNOTEL station.
 * Returns daily data for the last `days` days.
 *
 * @see https://www.nrcs.usda.gov/wps/portal/wcc/home/dataAccessHelp/webService/
 */
function buildReportUrl(
  stationId: string,
  days: number = 7,
  elements: SnotelElement[] = [
    "SNWD::value",
    "WTEQ::value",
    "PREC::value",
    "TOBS::value",
    "TMAX::value",
    "TMIN::value",
  ]
): string {
  const params = new URLSearchParams({
    stationTriplets: `${stationId}:US:SNTL`,
    report:          "custom",
    timeseries:      "Daily",
    format:          "csv",
    sitenum:         "1",
    interval:        "DAILY",
    duration:        days.toString(),
    elements:        elements.join(","),
  });
  return `${REPORT_BASE}?${params}`;
}

/**
 * Parse SNOTEL CSV response into typed readings.
 * SNOTEL CSV format: comment lines start with #, then header row, then data.
 */
function parseSnotelCsv(csv: string, stationId: string): SnotelReading[] {
  const lines = csv.split("\n").filter((l) => !l.startsWith("#") && l.trim());
  if (lines.length < 2) return []; // header + at least 1 data row

  const readings: SnotelReading[] = [];

  // First non-comment line is the header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < 2) continue;

    const date = cols[0]; // YYYY-MM-DD
    const parse = (idx: number): number | null => {
      const raw = cols[idx];
      if (!raw || raw === "" || raw === "-") return null;
      const n = parseFloat(raw);
      return isNaN(n) ? null : n;
    };

    readings.push({
      stationId,
      date,
      snowDepthIn: parse(1),
      sweIn:       parse(2),
      precipIn:    parse(3),
      tempF:       parse(4),
      tempMaxF:    parse(5),
      tempMinF:    parse(6),
    });
  }

  return readings;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Fetch recent SNOTEL readings for a station.
 * Returns null if the service is unreachable — always handle gracefully.
 *
 * @param stationId  SNOTEL triplet ID (e.g. "669" for Stevens Pass)
 * @param days       Number of days of history (default 7)
 */
export async function getSnotelReadings(
  stationId: string,
  days: number = 7
): Promise<SnotelReading[] | null> {
  try {
    const url = buildReportUrl(stationId, days);
    const res = await fetch(url, {
      next: { revalidate: 1800 }, // cache 30 min
    });
    if (!res.ok) return null;

    const csv = await res.text();
    const readings = parseSnotelCsv(csv, stationId);
    return readings.length > 0 ? readings : null;
  } catch {
    // SNOTEL can be slow/flaky — never crash the page
    return null;
  }
}

/**
 * Build a full SNOTEL snapshot with computed new-snow deltas.
 * Used by the Snow Report page and the resort detail page.
 */
export async function getSnotelSnapshot(
  stationId: string,
  stationName: string = ""
): Promise<SnotelSnapshot | null> {
  const readings = await getSnotelReadings(stationId, 7);
  if (!readings || readings.length === 0) return null;

  // Most recent reading
  const current = readings[readings.length - 1];

  // Compute new snow (depth delta)
  let newSnow24h: number | null = null;
  let newSnow48h: number | null = null;

  if (readings.length >= 2 && current.snowDepthIn != null) {
    const prev1 = readings[readings.length - 2];
    if (prev1.snowDepthIn != null) {
      const delta = current.snowDepthIn - prev1.snowDepthIn;
      newSnow24h = delta > 0 ? delta : 0;
    }
  }

  if (readings.length >= 3 && current.snowDepthIn != null) {
    const prev2 = readings[readings.length - 3];
    if (prev2.snowDepthIn != null) {
      const delta = current.snowDepthIn - prev2.snowDepthIn;
      newSnow48h = delta > 0 ? delta : 0;
    }
  }

  // Season total: precip accumulation of most recent reading
  const seasonTotal = current.precipIn;

  return {
    stationId,
    stationName,
    current,
    newSnow24h,
    newSnow48h,
    seasonTotal,
    readings,
  };
}
