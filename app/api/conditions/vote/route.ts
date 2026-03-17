import { NextRequest, NextResponse } from "next/server";
import { submitConditionVote } from "@/lib/supabase";
import type { SnowQuality, ComfortLevel } from "@/lib/types";

const VALID_SNOW: SnowQuality[] = ["powder", "packed", "crud", "ice", "spring"];
const VALID_COMFORT: ComfortLevel[] = ["warm", "perfect", "cold", "freezing"];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || !body.resort_id || !body.session_id) {
    return NextResponse.json(
      { error: "Missing required fields: resort_id, session_id" },
      { status: 400 }
    );
  }

  const { resort_id, session_id, snow_quality, comfort, comment } = body;

  // Validate enum values
  if (snow_quality && !VALID_SNOW.includes(snow_quality)) {
    return NextResponse.json({ error: "Invalid snow_quality value" }, { status: 400 });
  }
  if (comfort && !VALID_COMFORT.includes(comfort)) {
    return NextResponse.json({ error: "Invalid comfort value" }, { status: 400 });
  }
  if (!snow_quality && !comfort) {
    return NextResponse.json({ error: "At least one of snow_quality or comfort is required" }, { status: 400 });
  }

  const result = await submitConditionVote(
    resort_id,
    session_id,
    snow_quality ?? null,
    comfort ?? null,
    comment
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 429 });
  }

  return NextResponse.json({ ok: true });
}
