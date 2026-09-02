// ─────────────────────────────────────────────────────────────
// Service-role supabase-js client for route handlers.
// RLS is bypassed here, so only use it where the route's own auth model has
// already decided the caller is allowed to do the write.
// ─────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireServiceEnv, type ServiceEnvSource } from "./service-env";

export function getServiceClient(env?: ServiceEnvSource): SupabaseClient {
  const { url, serviceKey } = requireServiceEnv(env ?? process.env);
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
