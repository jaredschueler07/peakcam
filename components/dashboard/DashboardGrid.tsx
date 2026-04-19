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
          className={`px-4 py-2 rounded-full text-[13px] font-semibold border-[1.5px] transition-[transform,box-shadow] duration-100 ${
            isEditMode
              ? "bg-alpen text-cream-50 border-ink shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
              : "bg-cream-50 text-ink border-ink shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]"
          }`}
        >
          {isEditMode ? "Finish editing" : "Customize layout"}
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
            className="bg-cream-50 border-[1.5px] border-ink rounded-[18px] overflow-hidden group shadow-stamp"
          >
            {isEditMode && (
              <div className="drag-handle absolute top-2 left-2 z-30 p-1 bg-ink/80 text-cream-50 rounded cursor-move opacity-0 group-hover:opacity-100 transition-opacity">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
              </div>
            )}

            <div className="w-full h-full flex flex-col items-center justify-center p-4">
              <span className="pc-eyebrow" style={{ color: "var(--pc-bark)" }}>{widget.type}</span>
              <span className="font-display font-black text-ink mt-1">{widget.id.slice(0, 8)}</span>
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>

      {layout.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border-[1.5px] border-dashed border-bark rounded-[18px] bg-cream-50/50">
          <p className="font-display font-black text-ink text-2xl mb-2">Your dashboard is <em className="italic text-alpen">empty</em>.</p>
          <p className="text-bark text-sm max-w-xs text-center">
            Star your favorite resorts and cams to build your personal mission control.
          </p>
        </div>
      )}
    </div>
  );
}
