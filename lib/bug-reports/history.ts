import { breadcrumbSchema, HISTORY_MS, MAX_BREADCRUMBS, type Breadcrumb, type BugAction } from "./schema";

/** Session-local bounded history. No timers, persistence, network, or per-frame hooks. */
export class BugHistory {
  private readonly slots: ({ at: number; crumb: Breadcrumb } | undefined)[] = new Array(MAX_BREADCRUMBS);
  private cursor = 0;
  private count = 0;
  private lastAt = -Infinity;
  private lastAction: BugAction | undefined;
  private lastPath = "";

  record(action: BugAction, path: string, now: number, detail: Partial<Breadcrumb> = {}): void {
    if (action === this.lastAction && path === this.lastPath && now - this.lastAt < 1000) return;
    const parsed = breadcrumbSchema.safeParse({ ...detail, ageMs: 0, action, path });
    if (!parsed.success) return;
    this.slots[this.cursor] = { at: now, crumb: parsed.data };
    this.cursor = (this.cursor + 1) % MAX_BREADCRUMBS;
    this.count = Math.min(this.count + 1, MAX_BREADCRUMBS);
    this.lastAt = now; this.lastAction = action; this.lastPath = path;
  }

  snapshot(now: number): Breadcrumb[] {
    const out: Breadcrumb[] = [];
    for (let i = 0; i < this.count; i++) {
      const entry = this.slots[(this.cursor - this.count + i + MAX_BREADCRUMBS) % MAX_BREADCRUMBS]!;
      const ageMs = Math.max(0, Math.round(now - entry.at));
      if (ageMs <= HISTORY_MS) out.push({ ...entry.crumb, ageMs });
    }
    return out;
  }
}
