import { test } from "node:test";
import assert from "node:assert/strict";
import { fanOutWebhooks } from "./fanout";
import { deliveryOutcomePatch, type WebhookDestination } from "./destinations";
import { buildPowderAlertEvent, WEBHOOK_DISABLE_AFTER_FAILURES, type PowderAlertEvent } from "./webhooks";

const NOW = new Date("2026-12-01T13:00:10.000Z");

function destination(id: string, subscriber: string, failures = 0): WebhookDestination {
  return {
    id, subscriber_id: subscriber, kind: "webhook", target: `https://hooks.example.com/${id}`, secret: `whsec_${id}`,
    created_at: "2026-11-01T00:00:00.000Z", last_delivered_at: null, failures, disabled_at: null,
  };
}

function event(slug: string): PowderAlertEvent {
  return buildPowderAlertEvent({
    resort: { slug, name: slug, url: `https://www.peakcam.io/resorts/${slug}` },
    inches: 9, kind: "measured", measuredAt: "2026-12-01T12:00:00.000Z", url: `https://www.peakcam.io/resorts/${slug}`,
  });
}

test("deliveryOutcomePatch: success resets, failure counts, the tenth disables", () => {
  assert.deepEqual(deliveryOutcomePatch({ failures: 4 }, true, NOW), { failures: 0, last_delivered_at: NOW.toISOString() });
  assert.deepEqual(deliveryOutcomePatch({ failures: 4 }, false, NOW), { failures: 5 });
  assert.deepEqual(deliveryOutcomePatch({ failures: WEBHOOK_DISABLE_AFTER_FAILURES - 1 }, false, NOW), {
    failures: WEBHOOK_DISABLE_AFTER_FAILURES,
    disabled_at: NOW.toISOString(),
  });
});

test("fanOutWebhooks: one signed event per (destination, alert); counts, errors and the disable rule", async () => {
  const sent: Array<{ url: string; secret: string; body: PowderAlertEvent; deadline: number }> = [];
  const patches: Array<[string, unknown]> = [];
  const events = new Map<string, PowderAlertEvent[]>([
    ["s1", [event("alta"), event("snowbird")]],
    ["s2", [event("vail")]],
  ]);
  const summary = await fanOutWebhooks(
    [destination("d1", "s1"), destination("d2", "s1", 2), destination("d3", "s2", WEBHOOK_DISABLE_AFTER_FAILURES - 1), destination("d4", "s3")],
    events,
    123_456,
    {
      deliver: async ({ url, secret, body, deadline }) => {
        sent.push({ url, secret, body: JSON.parse(body), deadline });
        if (url.endsWith("/d2") && JSON.parse(body).resort.slug === "snowbird") return { ok: false, id: "m", attempts: 3, status: 502, error: "http_502" };
        if (url.endsWith("/d3")) return { ok: false, id: "m", attempts: 3, status: null, error: "TimeoutError" };
        return { ok: true, id: "m", attempts: 1, status: 200 };
      },
      record: async (id, patch) => { patches.push([id, patch]); },
      now: () => NOW,
    },
  );

  // d4's subscriber has no alerts this run: not counted, not touched.
  assert.deepEqual(summary, { destinations: 3, attempted: 5, delivered: 3, failed: 2, disabled: 1, errors: ["http_502", "TimeoutError"] });
  assert.ok(sent.every((s) => s.deadline === 123_456));
  assert.ok(sent.every((s) => s.body.type === "powder.alert"));
  assert.deepEqual(sent.filter((s) => s.url.endsWith("/d1")).map((s) => s.body.resort.slug).sort(), ["alta", "snowbird"]);
  assert.deepEqual(sent.filter((s) => s.url.endsWith("/d1")).map((s) => s.secret), ["whsec_d1", "whsec_d1"]);

  const byId = Object.fromEntries(patches);
  assert.deepEqual(byId.d1, { failures: 0, last_delivered_at: NOW.toISOString() });
  assert.deepEqual(byId.d2, { failures: 3 }, "one failed event in the run counts as one failed run");
  assert.deepEqual(byId.d3, { failures: WEBHOOK_DISABLE_AFTER_FAILURES, disabled_at: NOW.toISOString() });
  assert.equal("d4" in byId, false);
});

test("fanOutWebhooks: nothing to do is an empty summary without errors", async () => {
  const summary = await fanOutWebhooks([], new Map(), 0, { deliver: async () => { throw new Error("must not be called"); } });
  assert.deepEqual(summary, { destinations: 0, attempted: 0, delivered: 0, failed: 0, disabled: 0 });
});
