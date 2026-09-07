import { BugHistory } from "./history";
import { errorLocation, errorNameSchema, gameReportSchema, type Breadcrumb, type BugAction, type GameReport } from "./schema";

const history = new BugHistory();
let gameProvider: (() => GameReport) | undefined;

export function recordBugAction(action: BugAction, detail?: Partial<Breadcrumb>): void {
  if (typeof window !== "undefined") history.record(action, window.location.pathname, performance.now(), detail);
}
export function bugHistory(): Breadcrumb[] { return history.snapshot(performance.now()); }

/** Evaluated only when the report opens, never in a physics tick or render frame. */
export function registerGameReport(provider: () => GameReport): () => void {
  gameProvider = provider;
  return () => { if (gameProvider === provider) gameProvider = undefined; };
}
export function gameReport(): GameReport | undefined {
  try { const parsed = gameReportSchema.safeParse(gameProvider?.()); return parsed.success ? parsed.data : undefined; }
  catch { return undefined; }
}

export function installBugHistory(): () => void {
  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest("a,button,[role=button]") : null;
    if (!target || target.closest("[data-bug-report-form]")) return;
    if (target instanceof HTMLAnchorElement) {
      let url: URL;
      try { url = new URL(target.href, window.location.origin); } catch { return; }
      // External destinations and query strings never enter the buffer.
      if (url.origin === window.location.origin) recordBugAction("navigate", { target: url.pathname });
    } else recordBugAction("button");
  };
  const change = (event: Event) => {
    if (event.target instanceof HTMLSelectElement && !event.target.closest("[data-bug-report-form]")) recordBugAction("selection-changed");
  };
  const error = (event: Event) => {
    if (!(event instanceof ErrorEvent)) { recordBugAction("resource-error"); return; }
    const name = errorNameSchema.safeParse(event.error instanceof Error ? event.error.name : "Error");
    recordBugAction("javascript-error", { errorName: name.success ? name.data : "UnknownError",
      source: errorLocation(event.filename, window.location.origin), line: event.lineno, column: event.colno });
  };
  const rejection = (event: PromiseRejectionEvent) => {
    const name = errorNameSchema.safeParse(event.reason instanceof Error ? event.reason.name : "UnknownError");
    recordBugAction("unhandled-rejection", { errorName: name.success ? name.data : "UnknownError" });
  };
  const offline = () => recordBugAction("offline");
  const online = () => recordBugAction("online");
  document.addEventListener("click", click, true);
  document.addEventListener("change", change, true);
  window.addEventListener("error", error, true);
  window.addEventListener("unhandledrejection", rejection);
  window.addEventListener("offline", offline); window.addEventListener("online", online);
  return () => {
    document.removeEventListener("click", click, true); document.removeEventListener("change", change, true);
    window.removeEventListener("error", error, true); window.removeEventListener("unhandledrejection", rejection);
    window.removeEventListener("offline", offline); window.removeEventListener("online", online);
  };
}
