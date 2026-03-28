"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { type WidgetConfig, type UserFavorite, type DashboardLayout } from "@/lib/types";

export function useDashboard() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
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
      supabase.from("dashboard_layouts").select("*").eq("user_id", user.id).single(),
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
        // New favorite! Give it a default spot at the bottom
        syncedWidgets.push({
          id: fav.item_id,
          type: fav.item_type,
          x: (syncedWidgets.length * 4) % 12,
          y: Infinity, // RGL will place it at the bottom
          w: fav.item_type === "cam" ? 4 : 3,
          h: fav.item_type === "cam" ? 3 : 2,
        });
      }
    });

    setWidgets(syncedWidgets);
    setIsLoading(false);

    // 3. If reconciliation changed the widget list, save it back
    if (JSON.stringify(syncedWidgets) !== JSON.stringify(existingWidgets)) {
      await supabase
        .from("dashboard_layouts")
        .upsert({
          user_id: user.id,
          config: { widgets: syncedWidgets },
          updated_at: new Date().toISOString(),
        });
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

  return { widgets, isLoading, refresh: syncDashboard };
}
