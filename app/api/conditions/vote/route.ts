import { NextRequest, NextResponse } from "next/server";
import { submitConditionVote } from "@/lib/supabase";
import { jsonError, parseJsonBodyOrNull } from "@/lib/api/response";
import type { SnowQuality, ComfortLevel } from "@/lib/types";

const VALID_SNOW: SnowQuality[] = ["powder", "packed", "crud", "ice", "spring"];
const VALID_COMFORT: ComfortLevel[] = ["warm", "perfect", "cold", "freezing"];

export async function POST(request: NextRequest) {
  // The declared shape is what a well-formed client sends; every field is
  // still checked at runtime below before it reaches the DB.
  const body = await parseJsonBodyOrNull<{
    resort_id?: string;
    session_id?: string;
    snow_quality?: SnowQuality;
    comfort?: ComfortLevel;
    comment?: string;
  }>(request);

  if (!body || !body.resort_id || !body.session_id) {
    return jsonError("Missing required fields: resort_id, session_id", 400);
  }

  const { resort_id, session_id, snow_quality, comfort, comment } = body;

  // Validate enum values
  if (snow_quality && !VALID_SNOW.includes(snow_quality)) {
    return jsonError("Invalid snow_quality value", 400);
  }
  if (comfort && !VALID_COMFORT.includes(comfort)) {
    return jsonError("Invalid comfort value", 400);
  }
  if (!snow_quality && !comfort) {
    return jsonError("At least one of snow_quality or comfort is required", 400);
  }

  const result = await submitConditionVote(
    resort_id,
    session_id,
    snow_quality ?? null,
    comfort ?? null,
    comment
  );

  if (!result.ok) {
    return jsonError(result.error, 429);
  }

  return NextResponse.json({ ok: true });
}
