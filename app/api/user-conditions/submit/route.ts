// ─────────────────────────────────────────────────────────────
// POST /api/user-conditions/submit
// Accepts a rich conditions report from an authenticated user.
// Runs profanity check and sets is_flagged accordingly.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { containsProfanity } from "@/lib/profanity";
import type { UserSnowQuality, UserVisibility, UserWind, UserTrailConditions } from "@/lib/types";

const SNOW_QUALITY_VALUES: UserSnowQuality[] = ["powder", "packed", "crud", "ice", "spring"];
const VISIBILITY_VALUES: UserVisibility[] = ["clear", "foggy", "whiteout"];
const WIND_VALUES: UserWind[] = ["calm", "breezy", "gusty", "high"];
const TRAIL_CONDITIONS_VALUES: UserTrailConditions[] = ["groomed", "ungroomed", "moguls", "variable"];

export async function POST(request: NextRequest) {
  // 1. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { resort_id, snow_quality, visibility, wind, trail_conditions, notes } = body as {
    resort_id: unknown;
    snow_quality: unknown;
    visibility: unknown;
    wind: unknown;
    trail_conditions: unknown;
    notes: unknown;
  };

  // 2. Validate required fields
  if (!resort_id || typeof resort_id !== "string") {
    return NextResponse.json({ error: "resort_id is required" }, { status: 400 });
  }
  if (!SNOW_QUALITY_VALUES.includes(snow_quality as UserSnowQuality)) {
    return NextResponse.json({ error: "Invalid snow_quality" }, { status: 400 });
  }
  if (!VISIBILITY_VALUES.includes(visibility as UserVisibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }
  if (!WIND_VALUES.includes(wind as UserWind)) {
    return NextResponse.json({ error: "Invalid wind" }, { status: 400 });
  }
  if (!TRAIL_CONDITIONS_VALUES.includes(trail_conditions as UserTrailConditions)) {
    return NextResponse.json({ error: "Invalid trail_conditions" }, { status: 400 });
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
  }

  const notesText = typeof notes === "string" ? notes.slice(0, 500) : null;

  // 3. Verify auth
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // 4. Rate limit — max 1 report per resort per user per hour
  const { data: recent } = await supabase
    .from("user_conditions")
    .select("id")
    .eq("resort_id", resort_id)
    .eq("user_id", user.id)
    .gte("submitted_at", new Date(Date.now() - 3600_000).toISOString())
    .limit(1);

  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: "You already submitted a report here recently. Try again in an hour." },
      { status: 429 }
    );
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
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, flagged: isFlagged });
}
