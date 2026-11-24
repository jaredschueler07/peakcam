import type { WidgetConfig } from "@/lib/types";

export type RglLayoutItem = { i: string; x: number; y: number; w: number; h: number };

export const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
export const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;

export function colsForViewportWidth(width: number): number {
  if (width >= BREAKPOINTS.lg) return COLS.lg;
  if (width >= BREAKPOINTS.md) return COLS.md;
  if (width >= BREAKPOINTS.sm) return COLS.sm;
  if (width >= BREAKPOINTS.xs) return COLS.xs;
  return COLS.xxs;
}

export function clampRglLayout(items: readonly RglLayoutItem[], maxCols: number): RglLayoutItem[] {
  return items.map((item) => {
    const w = Math.max(1, Math.min(item.w, maxCols));
    const x = Math.max(0, Math.min(item.x, Math.max(0, maxCols - w)));
    return { ...item, x, w };
  });
}

export function widgetLayoutsEqual(a: readonly WidgetConfig[], b: readonly WidgetConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((w, i) => {
    const o = b[i];
    return o && w.id === o.id && w.type === o.type && w.x === o.x && w.y === o.y && w.w === o.w && w.h === o.h;
  });
}

/**
 * Merge a `react-grid-layout` callback back into canonical desktop (`lg`)
 * widget configs without letting smaller breakpoints (`md`/`sm`) permanently
 * clamp away wider desktop `w` values.
 */
export function mergeBreakpointLayoutChange(
  current: readonly WidgetConfig[],
  rglItems: readonly RglLayoutItem[],
  activeCols: number,
): WidgetConfig[] {
  return current.map((widget) => {
    const match = rglItems.find((item) => item.i === widget.id);
    if (!match) return widget;

    // Below `lg` (12 cols), RGL clamps widths to fit `activeCols` (e.g. 6 or 10).
    // Preserve wider desktop widths unless the user intentionally resized to < activeCols.
    const preserveDesktopWidth =
      activeCols < COLS.lg && widget.w > activeCols && match.w >= activeCols;
    const nextW = preserveDesktopWidth ? widget.w : match.w;

    const preserveDesktopX = preserveDesktopWidth && widget.x + widget.w <= COLS.lg;
    const nextX = preserveDesktopX ? widget.x : match.x;

    return { ...widget, x: nextX, y: match.y, w: nextW, h: match.h };
  });
}

/**
 * When background sync updates `initialLayout` while the user was editing,
 * reconcile additions/removals on edit exit while keeping the local user's
 * just-edited positions/sizes for widgets still present.
 */
export function reconcileEditExitLayout(
  localLayout: readonly WidgetConfig[],
  incomingLayout: readonly WidgetConfig[],
  hadLocalEdits: boolean,
): WidgetConfig[] {
  if (!hadLocalEdits) return [...incomingLayout];
  const incomingByKey = new Map(incomingLayout.map((w) => [`${w.type}:${w.id}`, w]));
  const keptKeys = new Set<string>();
  const merged: WidgetConfig[] = [];
  for (const w of localLayout) {
    const key = `${w.type}:${w.id}`;
    if (incomingByKey.has(key)) {
      keptKeys.add(key);
      merged.push(w);
    }
  }
  for (const w of incomingLayout) {
    const key = `${w.type}:${w.id}`;
    if (!keptKeys.has(key)) merged.push(w);
  }
  return merged;
}
