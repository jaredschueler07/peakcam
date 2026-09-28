import { test } from "node:test";
import assert from "node:assert/strict";
import { planOpeningDayEmails, type OpeningPreference, type OpeningTodayResort } from "./opening-day";

const MAMMOTH: OpeningTodayResort = { resort_id: "r-mammoth", name: "Mammoth Mountain", slug: "mammoth", camCount: 3 };
const VAIL: OpeningTodayResort = { resort_id: "r-vail", name: "Vail Mountain", slug: "vail", camCount: 0 };

const ANN = { id: "s-ann", email: "ann@example.com", manage_token: "tok-ann" };
const BOB = { id: "s-bob", email: "bob@example.com", manage_token: "tok-bob" };

function pref(subscriber: typeof ANN | null, resortId: string, subscriberId = subscriber?.id ?? "s-ghost"): OpeningPreference {
  return { subscriber_id: subscriberId, resort_id: resortId, alert_subscribers: subscriber };
}

test("one email per subscriber listing every resort of theirs that opens today, alphabetically", () => {
  const plans = planOpeningDayEmails(
    [VAIL, MAMMOTH],
    [pref(ANN, "r-vail"), pref(BOB, "r-mammoth"), pref(ANN, "r-mammoth")],
    []
  );
  assert.equal(plans.length, 2);
  const ann = plans.find((p) => p.subscriber.id === "s-ann")!;
  assert.deepEqual(ann.resorts.map((r) => r.resortName), ["Mammoth Mountain", "Vail Mountain"]);
  assert.deepEqual(ann.resortIds, ["r-mammoth", "r-vail"], "ids stay aligned with the sorted rows");
  assert.deepEqual(ann.resorts[0], { resortName: "Mammoth Mountain", slug: "mammoth", camCount: 3 });
  const bob = plans.find((p) => p.subscriber.id === "s-bob")!;
  assert.deepEqual(bob.resortIds, ["r-mammoth"]);
  assert.equal(bob.subscriber.email, "bob@example.com");
});

test("a preference for a resort that is not opening today is ignored", () => {
  const plans = planOpeningDayEmails([MAMMOTH], [pref(ANN, "r-vail"), pref(BOB, "r-mammoth")], []);
  assert.deepEqual(plans.map((p) => p.subscriber.id), ["s-bob"]);
});

test("a resort already logged for that subscriber today is not mailed again; other resorts still are", () => {
  const plans = planOpeningDayEmails(
    [VAIL, MAMMOTH],
    [pref(ANN, "r-vail"), pref(ANN, "r-mammoth"), pref(BOB, "r-mammoth")],
    [{ subscriber_id: "s-ann", resort_id: "r-mammoth" }, { subscriber_id: "s-bob", resort_id: "r-mammoth" }]
  );
  assert.equal(plans.length, 1, "Bob has nothing left to hear about");
  assert.equal(plans[0].subscriber.id, "s-ann");
  assert.deepEqual(plans[0].resortIds, ["r-vail"]);
});

test("a second run on the same day (everything logged) plans no emails", () => {
  const plans = planOpeningDayEmails(
    [MAMMOTH],
    [pref(ANN, "r-mammoth")],
    [{ subscriber_id: "s-ann", resort_id: "r-mammoth" }]
  );
  assert.deepEqual(plans, []);
});

test("a preference whose subscriber failed to embed, or that repeats a pair, cannot produce an email", () => {
  const plans = planOpeningDayEmails(
    [MAMMOTH],
    [pref(null, "r-mammoth", "s-orphan"), pref(ANN, "r-mammoth"), pref(ANN, "r-mammoth")],
    []
  );
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].resortIds, ["r-mammoth"], "the duplicate pair is listed once");
});

test("no openings or no opted-in preferences means nothing to send", () => {
  assert.deepEqual(planOpeningDayEmails([], [pref(ANN, "r-mammoth")], []), []);
  assert.deepEqual(planOpeningDayEmails([MAMMOTH], [], []), []);
});
