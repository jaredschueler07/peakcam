"use client";

import { useState, useMemo } from "react";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { type WidgetConfig } from "@/lib/types";

// Import styles (standard for react-grid-layout)
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardGridProps {
  initialLayout?: WidgetConfig[];
}

export function DashboardGrid({ initialLayout = [] }: DashboardGridProps) {
  const [layout, setLayout] = useState<WidgetConfig[]>(initialLayout);
  const [isEditMode, setIsEditMode] = useState(false);
  const supabase = createSupabaseBrowserClient();

  // Map our WidgetConfig to RGL Layout format
  const rglLayout = useMemo(() => {
    return layout.map(w => ({
      i: w.id,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
    }));
  }, [layout]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onLayoutChange = (currentLayout: any) => {
    // Only update if we're in edit mode to prevent accidental shifts during load
    if (!isEditMode) return;

    const updatedWidgets = layout.map(w => {
      const match = (currentLayout as Array<{ i: string; x: number; y: number; w: number; h: number }>)
        .find(l => l.i === w.id);
      if (match) {
        return { ...w, x: match.x, y: match.y, w: match.w, h: match.h };
      }
      return w;
    });

    setLayout(updatedWidgets);
    saveLayout(updatedWidgets);
  };

  const saveLayout = async (updatedWidgets: WidgetConfig[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("dashboard_layouts")
        .upsert({
          user_id: user.id,
          config: { widgets: updatedWidgets },
          updated_at: new Date().toISOString(),
        });
    }
  };

  return (
    <div className="relative min-h-[600px] w-full">
      <div className="flex justify-end mb-4 gap-2">
        <button
          onClick={() => setIsEditMode(!isEditMode)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            isEditMode
              ? "bg-cyan text-surface border border-cyan"
              : "bg-surface2 text-text-subtle border border-border hover:border-cyan/50"
          }`}
        >
          {isEditMode ? "Finish Editing" : "Customize Layout"}
        </button>
      </div>

      <ResponsiveGridLayout
        className="layout"
        layouts={{ lg: rglLayout }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={100}
        isDraggable={isEditMode}
        isResizable={isEditMode}
        onLayoutChange={onLayoutChange}
        draggableHandle=".drag-handle"
      >
        {layout.map((widget) => (
          <div
            key={widget.id}
            className="bg-surface2 border border-border rounded-xl overflow-hidden group shadow-lg"
          >
            {isEditMode && (
              <div className="drag-handle absolute top-2 left-2 z-30 p-1 bg-surface/80 rounded cursor-move opacity-0 group-hover:opacity-100 transition-opacity">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
              </div>
            )}
            
            <div className="w-full h-full flex flex-col items-center justify-center p-4">
              <span className="text-text-muted text-xs uppercase tracking-widest">{widget.type}</span>
              <span className="text-text-base font-semibold">{widget.id.slice(0, 8)}</span>
              {/* Actual widget content will be rendered here based on type */}
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>

      {layout.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-2xl">
          <p className="text-text-muted mb-4 text-lg">Your dashboard is empty</p>
          <p className="text-text-dim text-sm max-w-xs text-center">
            Star your favorite resorts and cams to build your personal mission control.
          </p>
        </div>
      )}
    </div>
  );
}
