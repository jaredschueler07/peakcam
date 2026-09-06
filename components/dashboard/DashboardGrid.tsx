"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { type WidgetConfig, type ResolvedWidget } from "@/lib/types";
import { DashboardWidget } from "./DashboardWidget";

// Import styles (standard for react-grid-layout)
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);
// Stable identities: both feed the sync effect's dep array, and a fresh `[]` or
// `new Map()` per render would re-run it forever.
const EMPTY_LAYOUT: WidgetConfig[] = [];
const EMPTY_RESOLVED = new Map<string, ResolvedWidget>();

interface DashboardGridProps {
  initialLayout?: WidgetConfig[];
  resolved?: Map<string, ResolvedWidget>;
}

export function DashboardGrid({ initialLayout = EMPTY_LAYOUT, resolved = EMPTY_RESOLVED }: DashboardGridProps) {
  const [layout, setLayout] = useState<WidgetConfig[]>(initialLayout);
  const [compact, setCompact] = useState(false);
  const [listView, setListView] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const [isEditMode, setIsEditMode] = useState(false);
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompact(query.matches);
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const useList = compact || listView;
  const move = (id: string, step: number) => {
    const from = ordered.findIndex(widget => widget.id === id), to = from + step;
    if (to < 0 || to >= ordered.length) return;
    const next = [...ordered];
    [next[from], next[to]] = [next[to], next[from]];
    let y = 0;
    const placed = next.map(widget => { const result = { ...widget, x: 0, y }; y += widget.h; return result; });
    setLayout(placed); saveLayout(placed);
  };

  const appliedLayout = useRef(initialLayout);
  // refresh() replaces initialLayout; skip during edit so in-progress drags are not clobbered.
  useEffect(() => {
    if (isEditMode || appliedLayout.current === initialLayout) return;
    appliedLayout.current = initialLayout;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from parent, not an external store
    setLayout(initialLayout);
  }, [initialLayout, isEditMode]);

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

  const saveLayout = (updatedWidgets: WidgetConfig[]) => {
    // Serialize writes so fast reorder taps cannot save an older order last.
    saveQueue.current = saveQueue.current.then(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaveError("Sign in to save this layout."); return; }
      const { error } = await supabase.from("dashboard_layouts").upsert({
        user_id: user.id, config: { widgets: updatedWidgets }, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      setSaveError(error ? "Couldn’t save your layout. Please try another change." : null);
    }).catch(() => setSaveError("Couldn’t save your layout. Check your connection and try again."));
  };

  return (
    <div className="relative min-h-[600px] w-full">
      <div className="flex flex-wrap justify-end mb-4 gap-2">
        {!compact && <button className="min-h-11 rounded-full border border-ink px-4 text-sm font-bold" aria-pressed={listView} onClick={() => setListView(value => !value)}>{listView ? "Grid layout" : "List layout"}</button>}
        <button
          onClick={() => setIsEditMode(!isEditMode)}
          className={`px-4 py-2 min-h-11 rounded-full text-[13px] font-semibold border-[1.5px] transition-[transform,box-shadow] duration-100 ${
            isEditMode
              ? "bg-alpen-dk text-cream-50 border-ink shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
              : "bg-cream-50 text-ink border-ink shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]"
          }`}
        >
          {isEditMode ? "Finish editing" : "Customize layout"}
        </button>
      </div>

      {saveError && <p role="alert" className="mb-4 text-sm text-poor">{saveError}</p>}
      {useList ? <div className="space-y-4">{ordered.map((widget, index) => <section key={widget.id} className="overflow-hidden rounded-[18px] border border-ink bg-cream-50 shadow-stamp-sm">
        {isEditMode && <div className="flex items-center gap-2 border-b border-ink/20 p-3">
          <span className="mr-auto text-sm font-bold">Position {index + 1}</span>
          <button className="min-h-11 rounded-full border border-ink px-3 text-sm disabled:opacity-40" disabled={index === 0} onClick={() => move(widget.id, -1)}>Move up</button>
          <button className="min-h-11 rounded-full border border-ink px-3 text-sm disabled:opacity-40" disabled={index === ordered.length - 1} onClick={() => move(widget.id, 1)}>Move down</button>
        </div>}
        <div className="h-64" inert={isEditMode || undefined}><DashboardWidget widget={widget} resolved={resolved.get(widget.id)} /></div>
      </section>)}</div> : <ResponsiveGridLayout
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
            {/* Always visible in edit mode — hover-reveal left touch users with no way to drag */}
            {isEditMode && (
              <div className="drag-handle absolute top-2 left-2 z-30 p-1 pointer-coarse:p-2.5 bg-ink/80 text-cream-50 rounded cursor-move transition-opacity">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
              </div>
            )}

            {/* inert while editing: the body is a link, and a drag or a stray
                Tab+Enter must not navigate away mid-layout-change. */}
            <div className="w-full h-full" inert={isEditMode || undefined}>
              <DashboardWidget widget={widget} resolved={resolved.get(widget.id)} />
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>}

      {layout.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border-[1.5px] border-dashed border-bark rounded-[18px] bg-cream-50/50">
          <p className="font-display font-black text-ink text-2xl mb-2">Your dashboard is <em className="italic text-alpen">empty</em>.</p>
          <p className="text-bark text-sm max-w-xs text-center">
            Tap the heart on a resort or camera to add it here.
          </p>
        </div>
      )}
    </div>
  );
}
