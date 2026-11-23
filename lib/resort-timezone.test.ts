import { test } from "node:test";
import assert from "node:assert/strict";
import { resortTimeZone } from "./resort-timezone";

const idaho = (lat: number | null, lng: number) => resortTimeZone({ state: "ID", country: "US", lat, lng });

test("Idaho: only the panhandle is on Pacific time", () => {
  // South-west Idaho lies west of the panhandle's longitude but keeps Mountain time.
  assert.equal(idaho(44.8236, -116.4189), "America/Denver"); // Brundage
  assert.equal(idaho(44.69, -115.7042), "America/Denver"); // Tamarack
  assert.equal(idaho(43.7636, -116.1011), "America/Denver"); // Bogus Basin
  assert.equal(idaho(43.6877, -114.351), "America/Denver"); // Sun Valley
  assert.equal(idaho(48.3683, -116.6203), "America/Los_Angeles"); // Schweitzer
  assert.equal(idaho(47.5405, -116.1327), "America/Los_Angeles"); // Silver Mountain
  assert.equal(idaho(47.4631, -115.7092), "America/Los_Angeles"); // Lookout Pass
});

test("Idaho without a latitude falls back to the longitude split", () => {
  assert.equal(idaho(null, -116.6203), "America/Los_Angeles");
  assert.equal(resortTimeZone({ state: "ID", country: "US", lng: -111.6303 }), "America/Denver");
});
