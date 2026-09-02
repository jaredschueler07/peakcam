/**
 * scripts/lib/env.mjs
 * ───────────────────
 * Shared .env loading + Supabase env guard for every ops script.
 *
 * Written as `.mjs` (not `.ts`) on purpose: several scripts run under plain
 * `node` (cam-health-check.mjs, powder-alert-check.mjs,
 * import-resorts-standalone.mjs, alert-e2e-test.mjs, pipeline-inspect.mjs)
 * and cannot import TypeScript. The `.ts` scripts run under `tsx`, which
 * imports `.mjs` fine, and `tsconfig.json` has `allowJs: true`, so the JSDoc
 * annotations below give `npx tsc --noEmit` real types at every call site.
 *
 * Behavior matches the ~12-line `loadEnv()` that used to be pasted into each
 * script: `.env.local` first, then `.env`, never overwriting a variable that
 * is already present in `process.env`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file's location (scripts/lib → ../..). */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * Parse one dotenv-style file into `process.env`.
 * Missing files are ignored. Existing variables are never overwritten.
 *
 * @param {string} filePath absolute path to a `.env`-style file
 * @returns {void}
 */
export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

/**
 * Load `.env.local` then `.env` from the repo root.
 *
 * @param {string} [rootDir] override the directory searched (defaults to REPO_ROOT)
 * @returns {void}
 */
export function loadEnv(rootDir = REPO_ROOT) {
  loadEnvFile(path.join(rootDir, ".env.local"));
  loadEnvFile(path.join(rootDir, ".env"));
}

/**
 * Read the service-role Supabase credentials, exiting the process with the
 * shared error message when either is missing. Scripts previously each had
 * their own copy of this guard with slightly different wording.
 *
 * @returns {{ url: string, key: string }}
 */
export function requireSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }
  return { url, key };
}

/**
 * Non-exiting variant, for callers that want to handle the failure themselves
 * (tests, or a script that only needs Supabase on some code paths).
 *
 * @returns {{ url: string, key: string } | null}
 */
export function readSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
