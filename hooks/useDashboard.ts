"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { withResolvedCamNames } from "@/lib/cam-name";
import { subscribeFavoritesChanged } from "@/lib/favorites-events";
import {
  type WidgetConfig,
  type UserFavorite,
  type DashboardLayout,
  type ResolvedWidget,
  type Resort,
  type Cam,
  type SnowReport,
} from "@/lib/types";

type BrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

export function reconcileDashboardWidgets(
  existingWidgets: readonly WidgetConfig[],
  favorites: readonly UserFavorite[],
): WidgetConfig[] {
  const syncedWidgets: WidgetConfig[] = [];
  const matchedFavKeys = new Set<string>();

  // 1. Preserve the user's saved widget order (including List View Move Up / Move Down)
  // for every existing widget that is still in favorites.
  for (const existing of existingWidgets) {
    const match = favorites.find(
      (fav) => fav.item_id === existing.id && fav.item_type === existing.type,
    ) ?? favorites.find((fav) => fav.item_id === existing.id);
    if (match) {
      const key = `${match.item_type}:${match.item_id}`;
      if (!matchedFavKeys.has(key)) {
        matchedFavKeys.add(key);
        syncedWidgets.push(existing);
      }
    }
  }

  // 2. Append any newly favorited items not yet in the saved layout.
  for (const fav of favorites) {
    const key = `${fav.item_type}:${fav.item_id}`;
    if (matchedFavKeys.has(key)) continue;
    matchedFavKeys.add(key);
    const index = syncedWidgets.length;
    syncedWidgets.push({
      id: fav.item_id,
      type: fav.item_type,
      x: (index * 4) % 12,
      y: Math.floor(index / 3) * 3,
      w: 4,
      h: 3,
    });
  }

  return syncedWidgets;
}

/**
 * `auth.getUser()` reports "nobody is signed in" as an error
 * (`AuthSessionMissingError`), and a revoked or expired session as a 4xx from
 * the auth server. Both mean signed out, which shows the sign-in prompt; only
 * a transport failure or a 5xx is a real "could not verify" error.
 */
export function isSignedOutAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; status?: unknown };
  if (e.name === "AuthSessionMissingError") return true;
  return e.name === "AuthApiError" && (e.status === 400 || e.status === 401 || e.status === 403);
}

export interface DashboardSyncStore {
  getUser(): Promise<{ user: { id: string } | null; error?: unknown }>;
  fetchFavoritesAndLayout(userId: string): Promise<{
    favorites: UserFavorite[] | null;
    favoritesError: unknown;
    layout: DashboardLayout | null;
    layoutError: unknown;
  }>;
  upsertLayout(userId: string, widgets: WidgetConfig[]): Promise<{ error?: unknown }>;
  resolveWidgets(widgets: WidgetConfig[]): Promise<Map<string, ResolvedWidget>>;
}

export type DashboardSyncResult =
  | { status: "signed_out" }
  | { status: "error"; message: string }
  | { status: "ok"; userId: string; widgets: WidgetConfig[]; resolved: Map<string, ResolvedWidget>; persisted: boolean };

/**
 * Pure orchestration for `useDashboard` syncs. Aborts before reconciling or
 * upserting when either Supabase read fails so transient outages can never
 * overwrite a user's saved `dashboard_layouts` row with `[]`.
 */
export async function executeDashboardSync(store: DashboardSyncStore): Promise<DashboardSyncResult> {
  let user: { id: string } | null = null;
  try {
    const auth = await store.getUser();
    if (auth.error) {
      return { status: "error", message: "Could not verify your session right now." };
    }
    user = auth.user;
  } catch {
    return { status: "error", message: "Could not verify your session right now." };
  }

  if (!user) {
    return { status: "signed_out" };
  }

  const { favorites, favoritesError, layout, layoutError } = await store.fetchFavoritesAndLayout(user.id);
  if (favoritesError || layoutError || !Array.isArray(favorites)) {
    return {
      status: "error",
      message: "Couldn’t refresh your dashboard right now — your saved layout was left untouched.",
    };
  }

  const rawWidgets = layout?.config?.widgets;
  const existingWidgets = Array.isArray(rawWidgets) ? rawWidgets : [];
  const syncedWidgets = reconcileDashboardWidgets(existingWidgets, favorites);
  const resolved = await store.resolveWidgets(syncedWidgets);

  let persisted = false;
  if (JSON.stringify(syncedWidgets) !== JSON.stringify(existingWidgets)) {
    const { error } = await store.upsertLayout(user.id, syncedWidgets);
    persisted = !error;
  }

  return {
    status: "ok",
    userId: user.id,
    widgets: syncedWidgets,
    resolved,
    persisted,
  };
}

async function resolveWidgets(
  supabase: BrowserClient,
  widgets: WidgetConfig[],
): Promise<Map<string, ResolvedWidget>> {
  const resolved = new Map<string, ResolvedWidget>();
  const resortIds = new Set<string>();
  const camIds: string[] = [];

  for (const widget of widgets) {
    if (widget.type === "resort") resortIds.add(widget.id);
    else if (widget.type === "cam") camIds.push(widget.id);
  }

  const camById = new Map<string, Cam>();
  if (camIds.length) {
    const { data, error } = await supabase.from("cams").select("*").in("id", camIds);
    if (error) {
      console.warn("[PeakCam] Could not fetch dashboard cams:", error.message);
    } else {
      for (const cam of withResolvedCamNames((data ?? []) as Cam[])) {
        camById.set(cam.id, cam);
        resortIds.add(cam.resort_id);
      }
    }
  }

  const resortById = new Map<string, Resort>();
  const snowByResort = new Map<string, SnowReport>();
  const camsByResort = new Map<string, Cam[]>();

  const ids = [...resortIds];
  if (ids.length) {
    const [resortsResult, snowResult, camsResult] = await Promise.all([
      // is_active matches every other resort read (lib/supabase.ts); a deactivated
      // resort has no /resorts/[slug] page, so it must resolve as unavailable.
      supabase.from("resorts").select("*").in("id", ids).eq("is_active", true),
      supabase.from("latest_snow_reports").select("*").in("resort_id", ids),
      supabase.from("cams").select("*").in("resort_id", ids).eq("is_active", true),
    ]);

    if (resortsResult.error) {
      console.warn("[PeakCam] Could not fetch dashboard resorts:", resortsResult.error.message);
    } else {
      for (const resort of (resortsResult.data ?? []) as Resort[]) {
        resortById.set(resort.id, resort);
      }
    }

    if (snowResult.error) {
      console.warn("[PeakCam] Could not fetch dashboard snow reports:", snowResult.error.message);
    } else {
      for (const snow of (snowResult.data ?? []) as SnowReport[]) {
        snowByResort.set(snow.resort_id, snow);
      }
    }

    if (camsResult.error) {
      console.warn("[PeakCam] Could not fetch dashboard resort cams:", camsResult.error.message);
    } else {
      const grouped = new Map<string, Cam[]>();
      for (const cam of (camsResult.data ?? []) as Cam[]) {
        const list = grouped.get(cam.resort_id) ?? [];
        list.push(cam);
        grouped.set(cam.resort_id, list);
      }
      for (const [resortId, list] of grouped) {
        camsByResort.set(resortId, withResolvedCamNames(list));
      }
    }
  }

  for (const widget of widgets) {
    if (widget.type === "region") {
      resolved.set(widget.id, { kind: "missing", type: "region" });
      continue;
    }

    if (widget.type === "resort") {
      const resort = resortById.get(widget.id);
      resolved.set(
        widget.id,
        resort
          ? {
              kind: "resort",
              resort,
              snow: snowByResort.get(widget.id) ?? null,
              cams: camsByResort.get(widget.id) ?? [],
            }
          : { kind: "missing", type: "resort" },
      );
      continue;
    }

    const cam = camById.get(widget.id);
    resolved.set(
      widget.id,
      cam
        ? { kind: "cam", cam, resort: resortById.get(cam.resort_id) ?? null }
        : { kind: "missing", type: "cam" },
    );
  }

  return resolved;
}

export function useDashboard() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [resolved, setResolved] = useState<Map<string, ResolvedWidget>>(() => new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const supabase = createSupabaseBrowserClient();
  // The user the dashboard was last synced for (null = signed out, undefined =
  // never synced). Auth events for the same user are no-ops; see below.
  const syncedUserId = useRef<string | null | undefined>(undefined);
  const syncGenRef = useRef(0);

  const syncDashboard = useCallback(async () => {
    const gen = ++syncGenRef.current;
    // Only the first load shows the page-level spinner. Later syncs (favorites
    // changed, refresh, account change) update the grid in place, because the
    // spinner unmounts DashboardGrid and with it the edit mode, list/grid
    // choice, cam switcher positions and any unsaved drag.
    if (syncedUserId.current === undefined) setIsLoading(true);

    const result = await executeDashboardSync({
      async getUser() {
        const { data, error } = await supabase.auth.getUser();
        if (!data.user && isSignedOutAuthError(error)) return { user: null };
        return { user: data.user ? { id: data.user.id } : null, error };
      },
      async fetchFavoritesAndLayout(userId) {
        const [favsResult, layoutResult] = await Promise.all([
          supabase.from("user_favorites").select("*").eq("user_id", userId),
          supabase.from("dashboard_layouts").select("*").eq("user_id", userId).maybeSingle(),
        ]);
        return {
          favorites: (favsResult.data as UserFavorite[] | null) ?? null,
          favoritesError: favsResult.error,
          layout: (layoutResult.data as DashboardLayout | null) ?? null,
          layoutError: layoutResult.error,
        };
      },
      async upsertLayout(userId, nextWidgets) {
        const { error } = await supabase
          .from("dashboard_layouts")
          .upsert({
            user_id: userId,
            config: { widgets: nextWidgets },
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
        return { error };
      },
      resolveWidgets: (nextWidgets) => resolveWidgets(supabase, nextWidgets),
    });

    if (gen !== syncGenRef.current) return;

    if (result.status === "signed_out") {
      syncedUserId.current = null;
      setIsAuthenticated(false);
      setLoadError(null);
      setWidgets([]);
      setResolved(new Map());
      setIsLoading(false);
      return;
    }

    if (result.status === "error") {
      setLoadError(result.message);
      setIsLoading(false);
      return;
    }

    syncedUserId.current = result.userId;
    setIsAuthenticated(true);
    setLoadError(null);
    setWidgets(result.widgets);
    setResolved(result.resolved);
    setIsLoading(false);
  }, [supabase]);

  useEffect(() => {
    const runSync = async () => {
      await syncDashboard();
    };
    void runSync();
    // supabase-js emits INITIAL_SESSION on subscribe (the first sync above
    // already covers it), TOKEN_REFRESHED on every token rotation and
    // SIGNED_IN again on every tab refocus (_recoverAndRefresh). Only a change
    // of account, in or out, is a reason to rebuild the dashboard.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      const nextUserId = session?.user?.id ?? null;
      if (syncedUserId.current !== undefined && nextUserId === syncedUserId.current) return;
      void syncDashboard();
    });
    const unsubscribeFavs = subscribeFavoritesChanged(() => {
      void syncDashboard();
    });
    return () => {
      syncGenRef.current += 1;
      subscription.unsubscribe();
      unsubscribeFavs();
    };
  }, [supabase, syncDashboard]);

  return { widgets, resolved, isLoading, isAuthenticated, loadError, refresh: syncDashboard };
}
