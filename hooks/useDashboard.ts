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
  const supabase = createSupabaseBrowserClient();
  // The user the dashboard was last synced for (null = signed out, undefined =
  // never synced). Auth events for the same user are no-ops; see below.
  const syncedUserId = useRef<string | null | undefined>(undefined);

  const syncDashboard = useCallback(async () => {
    // Only the first load shows the page-level spinner. Later syncs (favorites
    // changed, refresh, account change) update the grid in place, because the
    // spinner unmounts DashboardGrid and with it the edit mode, list/grid
    // choice, cam switcher positions and any unsaved drag.
    if (syncedUserId.current === undefined) setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    syncedUserId.current = user?.id ?? null;
    if (!user) {
      setIsAuthenticated(false);
      setWidgets([]);
      setResolved(new Map());
      setIsLoading(false);
      return;
    }
    setIsAuthenticated(true);

    // 1. Fetch favorites and current layout in parallel
    const [favsResult, layoutResult] = await Promise.all([
      supabase.from("user_favorites").select("*").eq("user_id", user.id),
      supabase.from("dashboard_layouts").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    const favorites: UserFavorite[] = favsResult.data || [];
    const layout: DashboardLayout | null = layoutResult.data;
    const existingWidgets = layout?.config.widgets || [];

    // 2. Reconcile while preserving the user's saved widget order
    const syncedWidgets = reconcileDashboardWidgets(existingWidgets, favorites);

    const resolvedMap = await resolveWidgets(supabase, syncedWidgets);
    setWidgets(syncedWidgets);
    setResolved(resolvedMap);
    setIsLoading(false);

    // 3. If reconciliation changed the widget list, save it back
    if (JSON.stringify(syncedWidgets) !== JSON.stringify(existingWidgets)) {
      await supabase
        .from("dashboard_layouts")
        .upsert({
          user_id: user.id,
          config: { widgets: syncedWidgets },
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
    }
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
      subscription.unsubscribe();
      unsubscribeFavs();
    };
  }, [supabase, syncDashboard]);

  return { widgets, resolved, isLoading, isAuthenticated, refresh: syncDashboard };
}
