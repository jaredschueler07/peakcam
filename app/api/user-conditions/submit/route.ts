// ─────────────────────────────────────────────────────────────
// POST /api/user-conditions/submit
// Accepts a rich conditions report from an authenticated user.
// Runs profanity check and sets is_flagged accordingly.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { jsonError, parseJsonBody } from "@/lib/api/response";
import { containsProfanity } from "@/lib/profanity";
import { hasRecentReport } from "@/lib/user-conditions/rate-limit";
import type { UserSnowQuality, UserVisibility, UserWind, UserTrailConditions } from "@/lib/types";

const SNOW_QUALITY_VALUES: UserSnowQuality[] = ["powder", "packed", "crud", "ice", "spring"];
const VISIBILITY_VALUES: UserVisibility[] = ["clear", "foggy", "whiteout"];
const WIND_VALUES: UserWind[] = ["calm", "breezy", "gusty", "high"];
const TRAIL_CONDITIONS_VALUES: UserTrailConditions[] = ["groomed", "ungroomed", "moguls", "variable"];

export async function POST(request: NextRequest) {
  // 1. Parse body
  const parsed = await parseJsonBody<{
    resort_id: unknown;
    snow_quality: unknown;
    visibility: unknown;
    wind: unknown;
    trail_conditions: unknown;
    notes: unknown;
  }>(request);
  if (!parsed.ok) {
    return jsonError("Invalid JSON", 400);
  }

  const { resort_id, snow_quality, visibility, wind, trail_conditions, notes } = parsed.value ?? {};

  // 2. Validate required fields
  if (!resort_id || typeof resort_id !== "string") {
    return jsonError("resort_id is required", 400);
  }
  if (!SNOW_QUALITY_VALUES.includes(snow_quality as UserSnowQuality)) {
    return jsonError("Invalid snow_quality", 400);
  }
  if (!VISIBILITY_VALUES.includes(visibility as UserVisibility)) {
    return jsonError("Invalid visibility", 400);
  }
  if (!WIND_VALUES.includes(wind as UserWind)) {
    return jsonError("Invalid wind", 400);
  }
  if (!TRAIL_CONDITIONS_VALUES.includes(trail_conditions as UserTrailConditions)) {
    return jsonError("Invalid trail_conditions", 400);
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return jsonError("notes must be a string", 400);
  }

  const notesText = typeof notes === "string" ? notes.slice(0, 500) : null;

  // 3. Verify auth
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonError("Authentication required", 401);
  }

  // 4. Rate limit — max 1 report per resort per user per hour.
  // Read with the service-role key, not the user's client: RLS hides
  // is_flagged=true rows from the user, so an RLS-scoped check never sees a
  // profanity-flagged report and lets a flagged user submit without limit.
  // See lib/user-conditions/rate-limit.ts. The insert below stays RLS-scoped.
  // Env defaults to the service-role pair; see lib/api/service-env.ts.
  const rateLimited = await hasRecentReport({
    resortId: resort_id,
    userId: user.id,
  });

  if (rateLimited) {
    return jsonError("You already submitted a report here recently. Try again in an hour.", 429);
  }

  // 5. Profanity check
  const isFlagged = notesText ? containsProfanity(notesText) : false;

  // 6. Insert
  const { error: insertError } = await supabase
    .from("user_conditions")
    .insert({
      resort_id,
      user_id: user.id,
      snow_quality,
      visibility,
      wind,
      trail_conditions,
      notes: notesText ?? null,
      is_flagged: isFlagged,
    });

  if (insertError) {
    console.error("[PeakCam] user_conditions insert error:", insertError.message);
    return jsonError("Failed to save report", 500);
  }

  return NextResponse.json({ ok: true, flagged: isFlagged });
}
