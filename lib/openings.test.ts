import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CURRENT_SEASON,
  daysUntil,
  formatOpeningDate,
  isIsoDay,
  isOpeningToday,
  openingStatus,
  openingSummary,
  sortForTable,
  toIsoDay,
  toPacificDay,
  type OpeningResort,
  type ResortOpening,
} from "./openings";

const TODAY = "2026-09-27";

function opening(overrides: Partial<ResortOpening> & { resort_id: string }): ResortOpening {
  return {
    id: `o-${overrides.resort_id}`,
    season: CURRENT_SEASON,
    projected_open: null,
    confirmed_open: null,
    closing_date: null,
    source_url: null,
    notes: null,
    updated_at: "2026-09-27T00:00:00Z",
    ...overrides,
  };
}

function resort(id: string, name: string, lat = 39.5, state = "CO"): OpeningResort {
  return { id, name, slug: id, state, lat };
}

// ── Dates ────────────────────────────────────────────────────

test("isIsoDay accepts real YYYY-MM-DD days and nothing else", () => {
  assert.equal(isIsoDay("2026-11-13"), true);
  assert.equal(isIsoDay("2026-02-30"), false, "February 30 is not a day");
  assert.equal(isIsoDay("2026-11-13T00:00:00Z"), false, "timestamps are not days");
  assert.equal(isIsoDay("11/13/2026"), false);
  assert.equal(isIsoDay(""), false);
  assert.equal(isIsoDay(null), false);
  assert.equal(isIsoDay(20261113), false);
});

test("toIsoDay reads the UTC calendar day of a Date and passes a valid string through", () => {
  // 23:30 UTC on Sep 27 is Sep 28 in Europe; the cron uses UTC (the page uses toPacificDay).
  assert.equal(toIsoDay(new Date("2026-09-27T23:30:00Z")), "2026-09-27");
  assert.equal(toIsoDay("2026-09-27"), "2026-09-27");
  assert.throws(() => toIsoDay("garbage"), RangeError);
  assert.throws(() => toIsoDay(new Date("nope")), RangeError);
});

test("toPacificDay reads the US Pacific calendar day, so the evening before opening day is still the day before", () => {
  // 2026-11-13T00:00Z is 4 pm PST on Nov 12 at Mammoth (US DST ended Nov 1).
  assert.equal(toPacificDay(new Date("2026-11-13T00:00:00Z")), "2026-11-12");
  assert.equal(toPacificDay(new Date("2026-11-13T00:30:00Z")), "2026-11-12");
  assert.equal(toPacificDay(new Date("2026-11-13T07:59:59Z")), "2026-11-12", "23:59:59 PST");
  assert.equal(toPacificDay(new Date("2026-11-13T08:00:00Z")), "2026-11-13", "midnight PST");
  // Daylight time in October is UTC-7.
  assert.equal(toPacificDay(new Date("2026-10-09T06:59:00Z")), "2026-10-08");
  assert.equal(toPacificDay(new Date("2026-10-09T07:00:00Z")), "2026-10-09");
  // At the trigger cron's 13:00 UTC the Pacific day and the UTC day are the same
  // date, so the email and the page agree on who opens today.
  const cronRun = new Date("2026-11-13T13:00:00Z");
  assert.equal(toPacificDay(cronRun), toIsoDay(cronRun));
  assert.throws(() => toPacificDay(new Date("nope")), RangeError);
});

test("daysUntil counts whole days in either direction", () => {
  assert.equal(daysUntil("2026-11-13", TODAY), 47);
  assert.equal(daysUntil(TODAY, TODAY), 0);
  assert.equal(daysUntil("2026-09-20", TODAY), -7);
  assert.equal(daysUntil("2026-11-13", new Date("2026-09-27T23:59:59Z")), 47);
});

test("formatOpeningDate is a pure function of the ISO string", () => {
  assert.equal(formatOpeningDate("2026-11-13"), "Nov 13");
  assert.equal(formatOpeningDate("2026-11-13", "weekday"), "Fri, Nov 13");
  assert.equal(formatOpeningDate("2026-11-13", "long"), "Friday, November 13, 2026");
  assert.equal(formatOpeningDate("2026-10-09", "weekday"), "Fri, Oct 9", "no zero padding");
  assert.equal(formatOpeningDate("2027-01-03", "weekday"), "Sun, Jan 3");
  assert.equal(formatOpeningDate(null), "");
  assert.equal(formatOpeningDate(undefined), "");
  assert.equal(formatOpeningDate("2026-11-13T12:00:00Z"), "", "timestamps are rejected, not mangled by a timezone");
  assert.equal(formatOpeningDate("Invalid"), "");
});

// ── Status ───────────────────────────────────────────────────

test("openingStatus: confirmed beats projected, and flips to open on the day", () => {
  const row = opening({ resort_id: "mammoth", projected_open: "2026-11-20", confirmed_open: "2026-11-13" });
  assert.equal(openingStatus(row, TODAY), "confirmed");
  assert.equal(openingStatus(row, "2026-11-12"), "confirmed");
  assert.equal(openingStatus(row, "2026-11-13"), "open", "opening day itself counts as open");
  assert.equal(openingStatus(row, "2027-02-01"), "open");
  assert.equal(openingStatus(row, new Date("2026-11-13T05:00:00Z")), "open");
});

test("openingStatus under the page's Pacific day: 00:30Z on opening day is still the evening before", () => {
  const mammoth = opening({ resort_id: "mammoth", confirmed_open: "2026-11-13" });
  // Nov 12, 4:30 pm PST — the ISR render that used to flip Mammoth to "Open now".
  assert.equal(openingStatus(mammoth, toPacificDay(new Date("2026-11-13T00:30:00Z"))), "confirmed");
  assert.equal(openingStatus(mammoth, toPacificDay(new Date("2026-11-13T08:00:00Z"))), "open", "midnight PST on Nov 13");
  assert.equal(openingStatus(mammoth, toPacificDay(new Date("2026-11-13T13:00:00Z"))), "open", "the cron's hour");

  // An Andes closing date flips the morning after it, not at 9 pm Chile time
  // on the closing day: 00:30Z Oct 12 is Oct 11 in Pacific; 07:30Z is 00:30 PDT
  // Oct 12, which is already 04:30 in Chile.
  const portillo = opening({ resort_id: "portillo", closing_date: "2026-10-11", season: "2026" });
  assert.equal(openingStatus(portillo, toPacificDay(new Date("2026-10-12T00:30:00Z"))), "open");
  assert.equal(openingStatus(portillo, toPacificDay(new Date("2026-10-12T07:30:00Z"))), "closed");
});

test("openingStatus: a projection never becomes open on its own", () => {
  const row = opening({ resort_id: "abasin", projected_open: "2026-10-09" });
  assert.equal(openingStatus(row, TODAY), "projected");
  assert.equal(openingStatus(row, "2026-10-09"), "projected");
  assert.equal(openingStatus(row, "2026-10-20"), "projected", "past the projection with no announcement is still only a projection");
});

test("openingStatus: closing dates describe a season that is running out", () => {
  const portillo = opening({ resort_id: "portillo", closing_date: "2026-10-11", season: "2026" });
  assert.equal(openingStatus(portillo, TODAY), "open");
  assert.equal(openingStatus(portillo, "2026-10-11"), "open", "still open on the closing day");
  assert.equal(openingStatus(portillo, "2026-10-12"), "closed");
});

test("openingStatus: a confirmed opening with a later closing date runs open → closed; an earlier closing date is last season's and is ignored", () => {
  const full = opening({ resort_id: "x", confirmed_open: "2026-11-13", closing_date: "2027-04-19" });
  assert.equal(openingStatus(full, "2026-11-01"), "confirmed");
  assert.equal(openingStatus(full, "2027-01-15"), "open");
  assert.equal(openingStatus(full, "2027-04-20"), "closed");

  const stale = opening({ resort_id: "y", confirmed_open: "2026-11-13", closing_date: "2026-04-19" });
  assert.equal(openingStatus(stale, "2026-09-27"), "confirmed");
  assert.equal(openingStatus(stale, "2026-12-01"), "open");
});

test("openingStatus: no row and no dates are both TBA", () => {
  assert.equal(openingStatus(null, TODAY), "tba");
  assert.equal(openingStatus(undefined, TODAY), "tba");
  assert.equal(openingStatus(opening({ resort_id: "z" }), TODAY), "tba");
});

test("isOpeningToday matches only the confirmed date, only on that day", () => {
  const row = opening({ resort_id: "m", projected_open: "2026-09-27", confirmed_open: "2026-11-13" });
  assert.equal(isOpeningToday(row, "2026-11-13"), true);
  assert.equal(isOpeningToday(row, new Date("2026-11-13T23:00:00Z")), true);
  assert.equal(isOpeningToday(row, "2026-11-12"), false);
  assert.equal(isOpeningToday(row, "2026-09-27"), false, "a projection for today is not an opening");
  assert.equal(isOpeningToday(opening({ resort_id: "n" }), TODAY), false);
});

// ── Table order ──────────────────────────────────────────────

const RESORTS: OpeningResort[] = [
  resort("vail", "Vail Mountain"),
  resort("abasin", "Arapahoe Basin"),
  resort("mammoth", "Mammoth Mountain", 37.6, "CA"),
  resort("killington", "Killington", 43.6, "VT"),
  resort("keystone", "Keystone Resort"),
  resort("aspen", "Aspen Snowmass"),
  resort("beaver", "Beaver Creek Resort"),
  resort("timberline", "Timberline Lodge", 45.3, "OR"),
  resort("portillo", "Ski Portillo", -32.8, "Chile"),
  resort("valle", "Valle Nevado", -33.4, "Chile"),
  resort("catedral", "Cerro Catedral", -41.2, "Argentina"),
];

const ROWS: ResortOpening[] = [
  opening({ resort_id: "vail", projected_open: "2026-11-13" }),
  opening({ resort_id: "abasin", projected_open: "2026-10-09" }),
  opening({ resort_id: "mammoth", confirmed_open: "2026-11-13" }),
  opening({ resort_id: "killington", confirmed_open: "2026-11-11" }),
  opening({ resort_id: "keystone", projected_open: "2026-10-31" }),
  opening({ resort_id: "timberline", confirmed_open: "2026-09-20" }),
  opening({ resort_id: "portillo", closing_date: "2026-10-11", season: "2026" }),
  opening({ resort_id: "valle", closing_date: "2026-10-18", season: "2026" }),
];

test("sortForTable buckets every resort and orders each bucket as the page expects", () => {
  const groups = sortForTable(ROWS, RESORTS, TODAY);
  const ids = (rows: { resort: OpeningResort }[]) => rows.map((r) => r.resort.id);

  assert.deepEqual(ids(groups.open), ["timberline"]);
  assert.deepEqual(ids(groups.confirmed), ["killington", "mammoth"], "soonest confirmed first");
  assert.deepEqual(ids(groups.projected), ["abasin", "keystone", "vail"], "soonest projection first");
  assert.deepEqual(ids(groups.tba), ["aspen", "beaver"], "alphabetical, and a resort with no row is still listed");
  assert.deepEqual(ids(groups.closing), ["portillo", "valle", "catedral"], "Andes by closing date, undated last");

  // Every resort appears exactly once.
  const all = [...groups.open, ...groups.confirmed, ...groups.projected, ...groups.tba, ...groups.closing];
  assert.equal(all.length, RESORTS.length);
  assert.equal(new Set(all.map((r) => r.resort.id)).size, RESORTS.length);

  // Statuses travel with the rows.
  assert.equal(groups.closing[0].status, "open");
  assert.equal(groups.closing[2].status, "tba");
  assert.equal(groups.tba[0].opening, null);
});

test("sortForTable breaks date ties alphabetically and accepts a Date for today", () => {
  const rows = [
    opening({ resort_id: "vail", projected_open: "2026-11-20" }),
    opening({ resort_id: "abasin", projected_open: "2026-11-20" }),
    opening({ resort_id: "keystone", projected_open: "2026-11-20" }),
  ];
  const groups = sortForTable(rows, RESORTS.slice(0, 2).concat(RESORTS[4]), new Date("2026-09-27T12:00:00Z"));
  assert.deepEqual(groups.projected.map((r) => r.resort.name), ["Arapahoe Basin", "Keystone Resort", "Vail Mountain"]);
});

test("sortForTable moves a resort from confirmed to open as the calendar passes its date", () => {
  const before = sortForTable(ROWS, RESORTS, "2026-11-12");
  const after = sortForTable(ROWS, RESORTS, "2026-11-13");
  assert.deepEqual(before.confirmed.map((r) => r.resort.id), ["mammoth"]);
  assert.deepEqual(before.open.map((r) => r.resort.id), ["timberline", "killington"]);
  assert.deepEqual(after.confirmed, []);
  assert.deepEqual(after.open.map((r) => r.resort.id), ["timberline", "killington", "mammoth"]);
  // The Andes rows have closed by then.
  assert.deepEqual(after.closing.map((r) => r.status), ["closed", "closed", "tba"]);
});

test("openingSummary counts confirmed dates (open or not) and names the next opening", () => {
  const summary = openingSummary(sortForTable(ROWS, RESORTS, TODAY), TODAY);
  assert.equal(summary.confirmed, 3, "timberline (open) + killington + mammoth");
  assert.equal(summary.open, 1);
  assert.equal(summary.projected, 3);
  assert.equal(summary.tba, 2);
  assert.equal(summary.nextToOpen?.resort.id, "killington");

  // With nothing confirmed, the soonest projection stands in.
  const projectedOnly = openingSummary(sortForTable(ROWS.filter((r) => !r.confirmed_open), RESORTS, TODAY), TODAY);
  assert.equal(projectedOnly.confirmed, 0);
  assert.equal(projectedOnly.nextToOpen?.resort.id, "abasin");

  // And with no dates at all, there is no "next".
  assert.equal(openingSummary(sortForTable([], RESORTS, TODAY), TODAY).nextToOpen, null);
});

test("openingSummary never headlines a projection that has already passed", () => {
  const unconfirmed = ROWS.filter((r) => !r.confirmed_open);
  const summaryOn = (day: string) => openingSummary(sortForTable(unconfirmed, RESORTS, day), day);

  // On Oct 20 A-Basin's Oct 9 projection is stale (no announcement, so it is
  // still only "projected" and still listed) — Keystone (Oct 31) is next up.
  const stale = summaryOn("2026-10-20");
  assert.equal(stale.projected, 3, "the stale projection stays in the table");
  assert.equal(stale.nextToOpen?.resort.id, "keystone");

  // A projection for today itself still counts as upcoming.
  assert.equal(summaryOn("2026-10-09").nextToOpen?.resort.id, "abasin");

  // Once every projection has passed there is no "next" rather than a past date.
  assert.equal(summaryOn("2026-12-01").nextToOpen, null);

  // A confirmed date still wins, even over a sooner projection, and takes a Date.
  const withConfirmed = openingSummary(sortForTable(ROWS, RESORTS, "2026-10-20"), new Date("2026-10-20T12:00:00Z"));
  assert.equal(withConfirmed.nextToOpen?.resort.id, "killington");
});

// ── The seed CSV ─────────────────────────────────────────────
// data/resort-openings.csv is the only source of the dates the page shows
// and the emails quote. Keep it honest: every slug must exist in
// data/resorts.csv, every date must be a real day, and a row must carry at
// least one date (unsourced resorts stay out — the page shows TBA).

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.trim());
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? "").trim()]));
  });
}

test("data/resort-openings.csv only names real resorts and well-formed, sourced dates", () => {
  const resorts = readCsv("../data/resorts.csv");
  const openings = readCsv("../data/resort-openings.csv");
  const bySlug = new Map(resorts.map((r) => [r.slug, r]));

  assert.deepEqual(
    Object.keys(openings[0]),
    ["slug", "season", "projected_open", "confirmed_open", "closing_date", "source_url", "notes"],
    "column order matters to scripts/seed-resort-openings.mjs"
  );
  assert.ok(openings.length > 0);

  const seen = new Set<string>();
  for (const row of openings) {
    assert.ok(bySlug.has(row.slug), `${row.slug} is not in data/resorts.csv`);
    assert.equal(seen.has(row.slug), false, `${row.slug} appears twice`);
    seen.add(row.slug);

    for (const column of ["projected_open", "confirmed_open", "closing_date"] as const) {
      if (row[column] !== "") assert.ok(isIsoDay(row[column]), `${row.slug}.${column} = "${row[column]}"`);
    }
    assert.ok(
      row.projected_open || row.confirmed_open || row.closing_date,
      `${row.slug} has no date — unsourced resorts belong out of the CSV`
    );
    assert.match(row.source_url, /^https:\/\//, `${row.slug} has no source URL — quote a date in public only with its source`);
    assert.match(row.season, /^\d{4}(-\d{2})?$/, `${row.slug}.season = "${row.season}"`);

    // Hemisphere sanity: an Andes row is a closing date for its own calendar
    // year; a Northern row is an opening for the 2026–27 season.
    const lat = Number(bySlug.get(row.slug)!.lat);
    if (lat < 0) {
      assert.ok(row.closing_date && !row.projected_open && !row.confirmed_open, `${row.slug}: Southern rows carry closing_date only`);
      assert.equal(row.season, "2026");
    } else {
      assert.equal(row.closing_date, "", `${row.slug}: Northern rows have no closing date this early`);
      assert.equal(row.season, CURRENT_SEASON);
      assert.ok(!(row.projected_open && row.confirmed_open), `${row.slug}: once confirmed, drop the projection`);
    }
  }
});
