import { test } from "node:test";
import assert from "node:assert";
import { EVENTS } from "./analytics-events";

test("EVENTS has the required product event names", () => {
  assert.deepStrictEqual(EVENTS, {
    BROWSE_OPENED: "browse_opened",
    RESORT_VIEWED: "resort_viewed",
    ALERT_SIGNUP_SUBMITTED: "alert_signup_submitted",
    ALERT_CONFIRMED: "alert_confirmed",
    AUTH_SIGNUP_STARTED: "auth_signup_started",
    AUTH_SIGNUP_COMPLETED: "auth_signup_completed",
    FAVORITE_ADDED: "favorite_added",
    FAVORITE_REMOVED: "favorite_removed",
    CONDITION_VOTED: "condition_voted",
    DROP_IN_OPENED: "drop_in_opened",
    DROP_IN_STARTED: "drop_in_started",
    DROP_IN_FAILED: "drop_in_failed",
  });
});
