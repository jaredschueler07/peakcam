import test from "node:test";
import assert from "node:assert/strict";
import { matchesResortSearch } from "./resort-search";
import { brownriceCamera, playerScript, streamURL, checkBrownrice } from "./cam-status/brownrice";
import { authorizeReviewer, ReviewAccessError } from "./bug-reports/review-access";
import { inboxQuery, triageSchema } from "./bug-reports/review-schema";

const vail = { name: "Vail Mountain", state: "CO", country: "US", region: "Colorado Rockies" };
test("snow search matches normalized names, state aliases, regions and combined terms", () => {
  for (const query of [" VAIL ", "Colorado", "Rockies", "vail co", "United States", ""]) assert.equal(matchesResortSearch(vail, query), true, query);
  assert.equal(matchesResortSearch(vail, "Utah"), false);
  assert.equal(matchesResortSearch({ name: "Las Leñas", state: "Argentina", country: "AR", region: "Andes" }, "las lenas"), true);
  assert.equal(matchesResortSearch({ ...vail, name: "Whistler", state: "BC", country: "CA" }, "Canada"), true);
});

const embed = "https://player.brownrice.com/embed/vailch21";
const html = `<script src="https://live5.brownrice.com/?sn=vailch21&amp;em=1"></script>`;
const config = `camera['name']='vailch21'; camera['streamurl']='https://live9.brownrice.com:444'; camera['typeid']='6';`;
const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchunklist.m3u8\n";
const media = "#EXTM3U\n#EXTINF:3,\nsegment.ts\n";
function fetchFixture(responses: (string | number)[]) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(String(url)); assert.equal(init?.redirect, "error");
    const response = responses.shift(); if (response === undefined) throw new Error("Unexpected fetch");
    return new Response(typeof response === "string" ? response : "", { status: typeof response === "number" ? response : 200 });
  };
  return { calls, fetcher };
}
test("provider parser rejects arbitrary hosts, credentials, camera mismatch and unsupported URLs", () => {
  assert.equal(brownriceCamera(embed), "vailch21");
  for (const url of ["http://player.brownrice.com/embed/vailch21", "https://player.brownrice.com.evil.test/embed/vailch21", "https://x@player.brownrice.com/embed/vailch21", "https://127.0.0.1/embed/vailch21"]) assert.equal(brownriceCamera(url), null);
  assert.equal(playerScript(`<script src="https://localhost/?sn=vailch21"></script>`, "vailch21"), null);
  assert.equal(playerScript(html, "another-camera"), null);
  assert.equal(streamURL(config.replace("live9.brownrice.com", "127.0.0.1"), "vailch21"), null);
  assert.equal(streamURL(config, "another-camera"), null);
});
test("provider check follows same-directory HLS variant, distinguishes a dead stream from unknown", async () => {
  const live = fetchFixture([html, config, master, media]);
  assert.equal(await checkBrownrice(embed, live.fetcher), "available"); assert.equal(live.calls.length, 4);
  assert.equal(await checkBrownrice(embed, fetchFixture([html, config, 404]).fetcher), "unavailable");
  assert.equal(await checkBrownrice(embed, fetchFixture([html, config, master, 503]).fetcher), "unavailable");
  assert.equal(await checkBrownrice(embed, fetchFixture([html, config, 403]).fetcher), "unknown");
  assert.equal(await checkBrownrice(embed, fetchFixture([html, config, "<html>Error</html>"]).fetcher), "unknown");
  assert.equal(await checkBrownrice(embed, fetchFixture(["changed player markup"]).fetcher), "unknown");
});
test("provider checker never follows injected external/parent playlist URLs or oversized metadata", async () => {
  for (const variant of ["https://127.0.0.1/private.m3u8", "https://live9.brownrice.com:444/other/private.m3u8", "../private.m3u8", "https://user@live9.brownrice.com:444/vailch21/vailch21.stream/x.m3u8"]) {
    const fixture = fetchFixture([html, config, master.replace("chunklist.m3u8", variant)]);
    assert.equal(await checkBrownrice(embed, fixture.fetcher), "unknown"); assert.equal(fixture.calls.length, 3);
  }
  const large = fetchFixture(["x".repeat(200001)]); assert.equal(await checkBrownrice(embed, large.fetcher), "unknown"); assert.equal(large.calls.length, 1);
});
test("reviewer authorization rejects anonymous and ordinary users before any report access", async () => {
  let lookups = 0;
  await assert.rejects(authorizeReviewer({ verifiedUserId: async () => null, isReviewer: async () => { lookups++; return true; } }), (error: unknown) => error instanceof ReviewAccessError && error.status === 401);
  assert.equal(lookups, 0);
  await assert.rejects(authorizeReviewer({ verifiedUserId: async () => "ordinary-user", isReviewer: async () => false }), (error: unknown) => error instanceof ReviewAccessError && error.status === 403);
  assert.equal(await authorizeReviewer({ verifiedUserId: async () => "verified-reviewer", isReviewer: async id => id === "verified-reviewer" }), "verified-reviewer");
  await assert.rejects(authorizeReviewer({ verifiedUserId: async () => "verified-reviewer", isReviewer: async () => { throw new Error("offline"); } }));
});
test("inbox filters and review updates reject injected filters and malformed duplicate IDs", () => {
  assert.equal(inboxQuery.safeParse({ group: "a,or(status.eq.open)" }).success, false);
  assert.equal(inboxQuery.safeParse({ page: "-1" }).success, false);
  assert.equal(triageSchema.safeParse({ revision: 0, status: "resolved", note: "", duplicateOf: "bad" }).success, false);
  const parsed = triageSchema.parse({ revision: 0, status: "triaged", note: " Investigating ", duplicateOf: null, actor: "forged-admin" });
  assert.equal(parsed.note, "Investigating"); assert.ok(!("actor" in parsed));
});
