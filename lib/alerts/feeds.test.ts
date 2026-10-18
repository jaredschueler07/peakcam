import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  buildAtomFeed,
  buildIcsCalendar,
  FEED_POWDER_INCHES,
  foldIcsLine,
  icsEscape,
  powderEntries,
  publicFeedHeaders,
  stormWindowEvent,
  xmlEscape,
} from "./feeds";

const ALTA = { slug: "alta", name: "Alta Ski Area" };

test("powderEntries: one entry per day at or above the feed threshold, with that day's peak, newest first", () => {
  assert.equal(FEED_POWDER_INCHES, 6);
  const reports = [
    { new_snow_24h: 2, updated_at: "2026-12-01T06:00:00.000Z" },
    { new_snow_24h: 7, updated_at: "2026-12-02T06:00:00.000Z" },
    { new_snow_24h: 9, updated_at: "2026-12-02T12:00:00.000Z" },
    { new_snow_24h: 8, updated_at: "2026-12-02T18:00:00.000Z" },
    { new_snow_24h: null, updated_at: "2026-12-03T06:00:00.000Z" },
    { new_snow_24h: 6, updated_at: "2026-12-04T06:00:00.000Z" },
    { new_snow_24h: 5.9, updated_at: "2026-12-05T06:00:00.000Z" },
  ];
  const entries = powderEntries(ALTA, reports);
  assert.deepEqual(entries.map((e) => e.id), [
    "tag:peakcam.io,2026:powder:alta:2026-12-04",
    "tag:peakcam.io,2026:powder:alta:2026-12-02",
  ]);
  assert.equal(entries[1].inches, 9);
  assert.equal(entries[1].updated, "2026-12-02T12:00:00.000Z", "updated comes from the peak report, not render time");
  assert.equal(entries[1].title, '9" of new snow at Alta Ski Area');
  assert.equal(entries[1].link, "https://www.peakcam.io/resorts/alta");
  assert.equal(entries[0].kind, "measured");
});

test("powderEntries: a subscriber threshold replaces the feed default", () => {
  const reports = [{ new_snow_24h: 7, updated_at: "2026-12-02T06:00:00.000Z" }];
  assert.equal(powderEntries(ALTA, reports, [], 8).length, 0);
  assert.equal(powderEntries(ALTA, reports, [], 3).length, 1);
});

test("powderEntries: forecast log rows collapse to one entry per storm start, keyed apart from measured days", () => {
  const logs = [
    { new_snow_inches: 10, alert_date: "2026-12-01", storm_start_date: "2026-12-03", sent_at: "2026-12-01T13:00:05.000Z" },
    { new_snow_inches: 13, alert_date: "2026-12-02", storm_start_date: "2026-12-03", sent_at: "2026-12-02T13:00:05.000Z" },
    { new_snow_inches: 6, alert_date: "2026-12-10", storm_start_date: null },
  ];
  const entries = powderEntries(ALTA, [{ new_snow_24h: 8, updated_at: "2026-12-03T06:00:00.000Z" }], logs);
  assert.deepEqual(entries.map((e) => e.id), [
    "tag:peakcam.io,2026:powder:alta:forecast:2026-12-10",
    "tag:peakcam.io,2026:powder:alta:2026-12-03",
    "tag:peakcam.io,2026:powder:alta:forecast:2026-12-03",
  ]);
  const storm = entries[2];
  assert.equal(storm.inches, 13, "the storm's highest total wins");
  assert.equal(storm.updated, "2026-12-02T13:00:05.000Z");
  assert.equal(entries[0].updated, "2026-12-10T13:00:00.000Z", "a row without sent_at is stamped at the cron hour of its alert_date");
});

test("buildAtomFeed: well-formed Atom with self/alternate links, data-derived updated, escaped text", () => {
  const entries = powderEntries(
    { slug: "a-b", name: "Snow & <Ice> \"Resort\"" },
    [{ new_snow_24h: 12, updated_at: "2026-12-02T12:00:00.000Z" }],
  );
  const xml = buildAtomFeed({
    id: "tag:peakcam.io,2026:powder:a-b",
    title: "Powder at Snow & <Ice>",
    selfUrl: "https://www.peakcam.io/resorts/a-b/powder.xml?x=1&y=2",
    alternateUrl: "https://www.peakcam.io/resorts/a-b",
    updated: entries[0].updated,
    entries,
  });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">'));
  assert.match(xml, /<title>Powder at Snow &amp; &lt;Ice&gt;<\/title>/);
  assert.match(xml, /<updated>2026-12-02T12:00:00.000Z<\/updated>/);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/www.peakcam.io\/resorts\/a-b\/powder.xml\?x=1&amp;y=2"\/>/);
  assert.match(xml, /<entry>\s*<id>tag:peakcam.io,2026:powder:a-b:2026-12-02<\/id>/);
  assert.match(xml, /<title>12&quot; of new snow at Snow &amp; &lt;Ice&gt; &quot;Resort&quot;<\/title>/);
  assert.match(xml, /<category term="measured"\/>/);
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(xml), "every ampersand is an entity");
  // Every open tag the builder emits is closed.
  for (const tag of ["feed", "entry", "title", "id", "updated", "summary", "author", "name"]) {
    assert.equal((xml.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length, (xml.match(new RegExp(`</${tag}>`, "g")) ?? []).length, tag);
  }
});

test("xmlEscape / icsEscape / foldIcsLine", () => {
  assert.equal(xmlEscape(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  assert.equal(icsEscape("a;b,c\\d\ne"), "a\\;b\\,c\\\\d\\ne");
  const short = "SUMMARY:short";
  assert.equal(foldIcsLine(short), short);
  const long = "DESCRIPTION:" + "x".repeat(200);
  const folded = foldIcsLine(long);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => Buffer.byteLength(l, "utf8") <= 75), "every physical line is at most 75 octets");
  assert.ok(lines.slice(1).every((l) => l.startsWith(" ")), "continuations start with a space");
  assert.equal(folded.replace(/\r\n /g, ""), long, "unfolding restores the line");
  // Multi-byte characters are never split.
  const snowy = "SUMMARY:" + "❄".repeat(60);
  assert.ok(foldIcsLine(snowy).split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75));
  assert.equal(foldIcsLine(snowy).replace(/\r\n /g, ""), snowy);
});

test("buildIcsCalendar: all-day VEVENT per storm window, UID stable per (resort, start), CRLF, escaped", () => {
  const stamp = "2026-12-01T13:00:00.000Z";
  const a = stormWindowEvent(ALTA, { stormStartDate: "2026-12-03", forecastDays: 3, snowInches: 13 }, stamp);
  const again = stormWindowEvent(ALTA, { stormStartDate: "2026-12-03", forecastDays: 2, snowInches: 20 }, "2026-12-02T13:00:00.000Z");
  assert.equal(a.uid, "powder-alta-2026-12-03@peakcam.io");
  assert.equal(a.uid, again.uid, "same resort + start → same UID however the forecast moved");
  const b = stormWindowEvent({ slug: "vail", name: "Vail; Colorado, USA" }, { stormStartDate: "2026-12-01", forecastDays: 1, snowInches: 8.5 }, stamp);

  const ics = buildIcsCalendar({ name: "PeakCam powder: ski@example.com", events: [a, b] });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PeakCam//Powder Alerts//EN\r\n"));
  assert.ok(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.ok(ics.indexOf("UID:powder-vail-2026-12-01@peakcam.io") < ics.indexOf("UID:powder-alta-2026-12-03@peakcam.io"), "events sorted by start");
  assert.match(ics, /DTSTART;VALUE=DATE:20261203\r\nDTEND;VALUE=DATE:20261206\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261202\r\n/);
  assert.match(ics, /DTSTAMP:20261201T130000Z/);
  assert.match(ics, /SUMMARY:8.5" forecast: Vail\\; Colorado\\, USA/);
  assert.match(ics, /URL:https:\/\/www.peakcam.io\/resorts\/alta/);
  assert.ok(!/\n(?!\r)|[^\r]\n/.test(ics.replace(/\r\n/g, "")), "only CRLF line endings");
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75));
});

test("addDays and feed headers", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-02-28", 3), "2026-03-03");
  assert.deepEqual(publicFeedHeaders("application/atom+xml; charset=utf-8"), {
    "Content-Type": "application/atom+xml; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
    "X-Attribution": "PeakCam (https://www.peakcam.io)",
  });
});
