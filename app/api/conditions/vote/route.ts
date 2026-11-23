import { NextRequest, NextResponse } from "next/server";
import { submitConditionVote } from "@/lib/supabase";
import type { SnowQuality, ComfortLevel } from "@/lib/types";

const VALID_SNOW: SnowQuality[] = ["powder", "packed", "crud", "ice", "spring"];
const VALID_COMFORT: ComfortLevel[] = ["warm", "perfect", "cold", "freezing"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Missing required fields: resort_id, session_id" },
      { status: 400 }
    );
  }

  const { resort_id, session_id, snow_quality, comfort, comment } = body as Record<string, unknown>;

  if (typeof resort_id !== "string" || !UUID_RE.test(resort_id)) {
    return NextResponse.json({ error: "resort_id must be a valid UUID" }, { status: 400 });
  }
  if (typeof session_id !== "string" || session_id.trim().length === 0 || session_id.length > 128) {
    return NextResponse.json({ error: "session_id must be a non-empty string up to 128 characters" }, { status: 400 });
  }

  // Validate enum values (reject non-null empty strings / non-strings too).
  if (snow_quality != null && (typeof snow_quality !== "string" || !VALID_SNOW.includes(snow_quality as SnowQuality))) {
    return NextResponse.json({ error: "Invalid snow_quality value" }, { status: 400 });
  }
  if (comfort != null && (typeof comfort !== "string" || !VALID_COMFORT.includes(comfort as ComfortLevel))) {
    return NextResponse.json({ error: "Invalid comfort value" }, { status: 400 });
  }
  if (snow_quality == null && comfort == null) {
    return NextResponse.json({ error: "At least one of snow_quality or comfort is required" }, { status: 400 });
  }
  // submitConditionVote slices the comment; a number here used to throw → 500.
  if (comment != null && typeof comment !== "string") {
    return NextResponse.json({ error: "comment must be a string" }, { status: 400 });
  }

  const result = await submitConditionVote(
    resort_id,
    session_id,
    (snow_quality as SnowQuality | null | undefined) ?? null,
    (comfort as ComfortLevel | null | undefined) ?? null,
    (comment as string | null | undefined) ?? undefined
  );

  if (!result.ok) {
    const status = result.code === "rate_limited" ? 429 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
