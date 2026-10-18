// The intent vocabulary, on its own so lib/public-api/schema.ts (zod enum)
// and lib/ask/router.ts (rules) share one tuple without importing each other.
export const ASK_INTENTS = [
  "conditions",
  "openings",
  "forecast",
  "cams",
  "cam_timeline",
  "history",
  "compare",
  "powder",
  "percent_of_normal",
  "profile",
  "regions",
  "alerts",
  "unknown",
] as const;

export type AskIntent = (typeof ASK_INTENTS)[number];
