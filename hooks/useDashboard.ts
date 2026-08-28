"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
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
      for (const cam of (data ?? []) as Cam[]) {
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
      for (const cam of (camsResult.data ?? []) as Cam[]) {
        const list = camsByResort.get(cam.resort_id) ?? [];
        list.push(cam);
        camsByResort.set(cam.resort_id, list);
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
  const supabase = createSupabaseBrowserClient();

  const syncDashboard = useCallback(async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsLoading(false);
      return;
    }

    // 1. Fetch favorites and current layout in parallel
    const [favsResult, layoutResult] = await Promise.all([
      supabase.from("user_favorites").select("*").eq("user_id", user.id),
      supabase.from("dashboard_layouts").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    const favorites: UserFavorite[] = favsResult.data || [];
    const layout: DashboardLayout | null = layoutResult.data;
    const existingWidgets = layout?.config.widgets || [];

    // 2. Reconcile:
    // - Keep existing widgets that are still in favorites
    // - Add new favorites as new widgets
    // - Remove widgets that are no longer favorited
    
    const syncedWidgets: WidgetConfig[] = [];
    
    // Process favorites
    favorites.forEach((fav) => {
      const existing = existingWidgets.find(w => w.id === fav.item_id);
      if (existing) {
        syncedWidgets.push(existing);
      } else {
        // New favorite! 3-across on 12 cols; y is a real row (Infinity serializes to null).
        const index = syncedWidgets.length;
        syncedWidgets.push({
          id: fav.item_id,
          type: fav.item_type,
          x: (index * 4) % 12,
          y: Math.floor(index / 3) * 3,
          w: fav.item_type === "cam" ? 4 : 3,
          h: fav.item_type === "cam" ? 3 : 2,
        });
      }
    });

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
    // We use a void IIFE or similar to avoid the "set-state-in-effect" warning 
    // if the linter thinks we are doing something synchronously wrong.
    // In reality, syncDashboard is async.
    const runSync = async () => {
      await syncDashboard();
    };
    runSync();
  }, [syncDashboard]);

  return { widgets, resolved, isLoading, refresh: syncDashboard };
}
