// ─────────────────────────────────────────────────────────────
// Pure input validation shared by the alert endpoints. No I/O — every
// function here is exercised directly by lib/alerts/validate.test.ts.
// ─────────────────────────────────────────────────────────────

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export const MAX_RESORTS_PER_REQUEST = 200;

export const DEFAULT_THRESHOLD_INCHES = 6;
const MIN_THRESHOLD_INCHES = 1;
const MAX_THRESHOLD_INCHES = 48;

/**
 * Whole inches in 1–48. Anything that is not a finite number falls back to
 * the default — callers that want to reject bad values instead of defaulting
 * them (PUT /api/alerts/manage) check the type before calling this.
 */
export function clampThreshold(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_THRESHOLD_INCHES;
  return Math.max(MIN_THRESHOLD_INCHES, Math.min(MAX_THRESHOLD_INCHES, Math.round(n)));
}

export type OptionalBooleanParse =
  | { ok: true; value: boolean | undefined }
  | { ok: false; error: string };

/**
 * The `opening_alerts` flag both alert endpoints accept: absent (or null) is
 * "not specified" and a caller that sends anything but a real boolean is
 * rejected rather than coerced — `"false"` would otherwise opt a subscriber
 * in to opening-day mail they never asked for.
 */
export function parseOptionalBoolean(value: unknown, field: string): OptionalBooleanParse {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "boolean") return { ok: false, error: `${field} must be a boolean` };
  return { ok: true, value };
}

export interface ManageUpdate {
  token: string;
  /** De-duplicated, lower-cased, UUID-shaped, in request order. Empty means "follow nothing". */
  resortIds: string[];
  /** A clamped threshold for every id in `resortIds` (defaulted when absent). */
  thresholds: Record<string, number>;
  /**
   * Opening-day emails for every resort in `resortIds`. `undefined` when the
   * body did not mention it — the caller then leaves each row's stored value
   * alone instead of resetting it.
   */
  openingAlerts: boolean | undefined;
}

export type ManageUpdateParse =
  | { ok: true; update: ManageUpdate }
  | { ok: false; error: string };

/**
 * Validates the body of PUT /api/alerts/manage before anything touches the
 * database. The old handler deleted every preference row first and validated
 * nothing, so a malformed id or a `"abc"` threshold left the subscriber with
 * zero alerts and a 500. Shape errors are rejected outright; whether an id
 * refers to a live resort is a database question answered by the caller.
 */
export function parseManageUpdate(body: unknown): ManageUpdateParse {
  const input = (body && typeof body === "object" ? body : {}) as {
    token?: unknown;
    resort_ids?: unknown;
    thresholds?: unknown;
    opening_alerts?: unknown;
  };

  if (typeof input.token !== "string" || input.token.length === 0) {
    return { ok: false, error: "token is required" };
  }
  const openingAlerts = parseOptionalBoolean(input.opening_alerts, "opening_alerts");
  if (!openingAlerts.ok) return openingAlerts;
  if (!Array.isArray(input.resort_ids)) {
    return { ok: false, error: "resort_ids must be an array" };
  }
  if (input.resort_ids.length > MAX_RESORTS_PER_REQUEST) {
    return {
      ok: false,
      error: `resort_ids may list at most ${MAX_RESORTS_PER_REQUEST} resorts`,
    };
  }
  if (!input.resort_ids.every(isUuid)) {
    return { ok: false, error: "resort_ids must be an array of resort UUIDs" };
  }

  const rawThresholds = input.thresholds;
  if (
    rawThresholds !== undefined &&
    rawThresholds !== null &&
    (typeof rawThresholds !== "object" || Array.isArray(rawThresholds))
  ) {
    return { ok: false, error: "thresholds must be an object keyed by resort_id" };
  }
  const source = (rawThresholds ?? {}) as Record<string, unknown>;

  // PostgREST returns uuids lower-case and lib/alerts/manage.ts keys every
  // lookup by those. An upper-case id passes isUuid, survives the Set as a
  // second spelling of the same resort, and would then miss its own threshold
  // — saved at the default with a 200. Normalise once, ids and keys alike.
  const resortIds = [...new Set((input.resort_ids as string[]).map((id) => id.toLowerCase()))];
  const thresholdsById = new Map(Object.entries(source).map(([id, raw]) => [id.toLowerCase(), raw]));
  const thresholds: Record<string, number> = {};
  for (const id of resortIds) {
    const raw = thresholdsById.get(id);
    if (raw !== undefined && raw !== null && (typeof raw !== "number" || !Number.isFinite(raw))) {
      return { ok: false, error: "thresholds must be finite numbers of inches" };
    }
    thresholds[id] = clampThreshold(raw);
  }

  return { ok: true, update: { token: input.token, resortIds, thresholds, openingAlerts: openingAlerts.value } };
}
