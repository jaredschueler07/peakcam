import { NextRequest, NextResponse } from "next/server";
import { sendWelcomeEmail, sendManageLinkEmail } from "@/lib/email";
import { handleSubscribe, type SubscribeDeps } from "@/lib/alerts/subscribe-core";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sbFetch(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

const deps: SubscribeDeps = {
  async findSubscriberByEmail(email) {
    const resp = await sbFetch(
      `/alert_subscribers?email=eq.${encodeURIComponent(email)}&select=id,email,manage_token&limit=1`
    );
    if (!resp.ok) return null;
    const [row] = await resp.json();
    return row ?? null;
  },

  async createSubscriber(email) {
    // Plain insert, not an upsert: an existing row must never be merged into.
    // A unique-violation on `email` (a concurrent signup for the same address)
    // surfaces here as !ok, and the caller re-reads to resolve the race.
    const resp = await sbFetch("/alert_subscribers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ email }),
    });
    if (!resp.ok) {
      console.error("[alerts/subscribe] subscriber insert failed:", await resp.text());
      return null;
    }
    const [row] = await resp.json();
    return row ?? null;
  },

  async findActiveResorts(resortIds) {
    // Values are URL-encoded and quoted rather than interpolated raw: these are
    // caller-supplied strings going into a PostgREST filter on a service-role
    // request, where an unencoded `)` or `&` would let the caller append their
    // own query parameters.
    const list = resortIds
      .map((id) => encodeURIComponent(`"${id.replace(/["\\]/g, "")}"`))
      .join(",");
    const resp = await sbFetch(
      `/resorts?id=in.(${list})&select=id,name&is_active=eq.true`
    );
    return resp.ok ? await resp.json() : [];
  },

  async insertPreferences(prefs) {
    const resp = await sbFetch("/alert_preferences", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(prefs),
    });
    if (!resp.ok) {
      console.error("[alerts/subscribe] prefs insert failed:", await resp.text());
      return false;
    }
    return true;
  },

  sendWelcomeEmail,
  sendManageLinkEmail,

  logError(message, detail) {
    console.error(message, detail);
  },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { status, body: json } = await handleSubscribe(body, deps);
  return NextResponse.json(json, { status });
}
