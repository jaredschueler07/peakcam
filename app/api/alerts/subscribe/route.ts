import { NextRequest, NextResponse } from "next/server";
import { sendWelcomeEmail, sendManageLinkEmail } from "@/lib/email";
import { handleSubscribe, type SubscribeDeps } from "@/lib/alerts/subscribe-core";
import { inList, isTimeoutError, SERVICE_TIMEOUT, serviceFetch } from "@/lib/alerts/service-fetch";

const deps: SubscribeDeps = {
  async findSubscriberByEmail(email) {
    const resp = await serviceFetch(
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
    const resp = await serviceFetch("/alert_subscribers", {
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
    // Caller-supplied strings going into a service-role PostgREST filter —
    // inList quotes and encodes them so none can escape the `in.(…)` operand.
    const resp = await serviceFetch(
      `/resorts?id=in.(${inList(resortIds)})&select=id,name&is_active=eq.true`
    );
    return resp.ok ? await resp.json() : [];
  },

  async insertPreferences(prefs) {
    const insert = (body: unknown) =>
      serviceFetch("/alert_preferences", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(body),
      });

    let resp = await insert(prefs);
    if (!resp.ok && resp.status === 400) {
      // A database that has not run migration 020 rejects the opening_day
      // column. The subscription itself must still go through — retry with
      // the flag stripped and log it, rather than failing every new signup
      // for the length of the deploy window.
      console.error("[alerts/subscribe] opening_day column missing — apply migration 020; saving preferences without the flag");
      resp = await insert(prefs.map(({ opening_day: _openingDay, ...pref }) => pref));
    }
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
  try {
    const { status, body: json } = await handleSubscribe(body, deps);
    return NextResponse.json(json, { status });
  } catch (err) {
    // A serviceFetch timeout propagates out of the deps above; report it as
    // such instead of letting the caller's spinner run to the function limit.
    if (isTimeoutError(err)) {
      return NextResponse.json(SERVICE_TIMEOUT.body, { status: SERVICE_TIMEOUT.status });
    }
    throw err;
  }
}
