import { createClient } from "@supabase/supabase-js";
import type { Resort, Cam, SnowReport, ResortWithData } from "./types";

// ─────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
    "Copy .env.local.example → .env.local and fill in your project values."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

/** Fetch all active resorts with their latest snow report. */
export async function getAllResorts(): Promise<ResortWithData[]> {
  const { data: resorts, error: resortError } = await supabase
    .from("resorts")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (resortError) throw resortError;
  if (!resorts?.length) return [];

  const resortIds = resorts.map((r) => r.id);

  // Fetch latest snow report per resort
  const { data: snowReports, error: snowError } = await supabase
    .from("snow_reports")
    .select("*")
    .in("resort_id", resortIds)
    .order("updated_at", { ascending: false });

  if (snowError) throw snowError;

  // Fetch cam counts (active only)
  const { data: cams, error: camError } = await supabase
    .from("cams")
    .select("*")
    .in("resort_id", resortIds)
    .eq("is_active", true);

  if (camError) throw camError;

  // Join — latest snow report per resort
  const snowByResort = new Map<string, SnowReport>();
  for (const s of snowReports ?? []) {
    if (!snowByResort.has(s.resort_id)) snowByResort.set(s.resort_id, s);
  }

  const camsByResort = new Map<string, Cam[]>();
  for (const c of cams ?? []) {
    const existing = camsByResort.get(c.resort_id) ?? [];
    camsByResort.set(c.resort_id, [...existing, c]);
  }

  return resorts.map((r) => ({
    ...r,
    snow_report: snowByResort.get(r.id) ?? null,
    cams: camsByResort.get(r.id) ?? [],
  }));
}

/** Fetch a single resort by slug with full cam list and latest snow report. */
export async function getResortBySlug(slug: string): Promise<ResortWithData | null> {
  const { data: resort, error: resortError } = await supabase
    .from("resorts")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (resortError || !resort) return null;

  const { data: snowReports } = await supabase
    .from("snow_reports")
    .select("*")
    .eq("resort_id", resort.id)
    .order("updated_at", { ascending: false })
    .limit(1);

  const { data: cams } = await supabase
    .from("cams")
    .select("*")
    .eq("resort_id", resort.id)
    .order("name");

  return {
    ...resort,
    snow_report: snowReports?.[0] ?? null,
    cams: cams ?? [],
  };
}

/** Fetch all resort slugs — used for generateStaticParams. */
export async function getAllResortSlugs(): Promise<string[]> {
  const { data, error } = await supabase
    .from("resorts")
    .select("slug")
    .eq("is_active", true);

  if (error) throw error;
  return data?.map((r) => r.slug) ?? [];
}
