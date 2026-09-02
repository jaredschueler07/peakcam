import { test } from "node:test";
import assert from "node:assert";
import { extractIp } from "./request-ip";
import { hashIp } from "./hash-ip";

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

test("the first x-forwarded-for hop wins and is trimmed", () => {
  assert.strictEqual(extractIp(req({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" })), "203.0.113.7");
  assert.strictEqual(extractIp(req({ "x-forwarded-for": "  203.0.113.7  " })), "203.0.113.7");
});

test("x-real-ip is the fallback, and no header means no IP", () => {
  assert.strictEqual(extractIp(req({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.strictEqual(extractIp(req({})), null);
});

test("x-forwarded-for takes precedence over x-real-ip", () => {
  assert.strictEqual(
    extractIp(req({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.4" })),
    "203.0.113.7"
  );
});

test("the hash is stable within a day and rotates across days", () => {
  const a = hashIp("203.0.113.7", { salt: "s", day: "2026-01-01" });
  const b = hashIp("203.0.113.7", { salt: "s", day: "2026-01-01" });
  const c = hashIp("203.0.113.7", { salt: "s", day: "2026-01-02" });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.match(a!, /^[0-9a-f]{64}$/);
});

test("the salt changes the digest, and a missing salt stores nothing", () => {
  assert.notStrictEqual(
    hashIp("203.0.113.7", { salt: "s1", day: "2026-01-01" }),
    hashIp("203.0.113.7", { salt: "s2", day: "2026-01-01" })
  );
  const saved = process.env.CAM_REPORT_SALT;
  delete process.env.CAM_REPORT_SALT;
  try {
    assert.strictEqual(hashIp("203.0.113.7"), null);
  } finally {
    if (saved !== undefined) process.env.CAM_REPORT_SALT = saved;
  }
});

test("a null IP hashes to null", () => {
  assert.strictEqual(hashIp(null, { salt: "s", day: "2026-01-01" }), null);
});
