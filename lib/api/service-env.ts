// ─────────────────────────────────────────────────────────────
// Service-role Supabase environment.
//
// Read lazily (inside the request, not at module scope) and validated rather
// than `!`-asserted: a missing var used to reach PostgREST as the literal
// string "undefined" in the URL, which fails as an opaque network/404 error.
// Here it fails immediately with the name of the var that is missing.
//
// Edge- and Node-runtime safe: no Node built-ins.
// ─────────────────────────────────────────────────────────────

export interface ServiceEnv {
  url: string;
  serviceKey: string;
}

export interface ServiceEnvSource {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // Present so `process.env` (ProcessEnv) is assignable to this type.
  [key: string]: string | undefined;
}

/** Best-effort read. Either field may be undefined; callers decide what that means. */
export function readServiceEnv(
  env: ServiceEnvSource = process.env
): { url: string | undefined; serviceKey: string | undefined } {
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/** Strict read. Throws naming every missing variable. */
export function requireServiceEnv(env: ServiceEnvSource = process.env): ServiceEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    const missing = [
      url ? null : "NEXT_PUBLIC_SUPABASE_URL",
      serviceKey ? null : "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    throw new Error(
      `Supabase service role env not configured: missing ${missing.join(", ")}`
    );
  }
  return { url, serviceKey };
}
