// ─────────────────────────────────────────────────────────────
// Service-role read behind the manage link, shared by the /alerts/manage page
// (server component) and GET /api/alerts/manage (the route the page's client
// code still uses for its PUT/DELETE round trips).
//
// Server-only: the alerts tables are deny-all under RLS, so this reaches them
// with the service-role key and must never be imported into a Client
// Component. (The `server-only` package would enforce that at build time, but
// it is not a dependency of this project.)
// ─────────────────────────────────────────────────────────────

export interface ManageResort {
  id: string;
  name: string;
  state: string;
  region: string;
  slug: string;
}

export interface ManagePreference {
  resort_id: string;
  threshold_inches: number;
}

export interface ManageData {
  email: string;
  created_at: string;
  preferences: ManagePreference[];
  resorts: ManageResort[];
}

function sbFetch(path: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured");
  }
  return fetch(`${url}/rest/v1${path}`, {
    cache: "no-store",
    // Bounded so a hung database fails the page instead of holding the
    // request open until the platform kills it.
    signal: AbortSignal.timeout(8_000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
}

/** Returns null for an unknown token — callers turn that into a 404. */
export async function loadManageData(token: string): Promise<ManageData | null> {
  try {
    const subResp = await sbFetch(
      `/alert_subscribers?manage_token=eq.${encodeURIComponent(token)}&select=id,email,created_at&limit=1`
    );
    const subscribers = subResp.ok ? await subResp.json() : [];
    if (!subscribers.length) return null;
    const subscriber = subscribers[0];

    const [prefsResp, resortsResp] = await Promise.all([
      sbFetch(
        `/alert_preferences?subscriber_id=eq.${subscriber.id}&select=resort_id,threshold_inches`
      ),
      sbFetch(`/resorts?is_active=eq.true&select=id,name,state,region,slug&order=name`),
    ]);

    return {
      email: subscriber.email,
      created_at: subscriber.created_at,
      preferences: prefsResp.ok ? await prefsResp.json() : [],
      resorts: resortsResp.ok ? await resortsResp.json() : [],
    };
  } catch (err) {
    console.error("[alerts/manage] load failed:", err);
    return null;
  }
}
