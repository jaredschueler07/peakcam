// ─────────────────────────────────────────────────────────────
// Salted, daily-rotating IP hash for abuse triage.
//
// The date is part of the digest so a stored hash stops being linkable to the
// address after 24h, and no salt configured means no hash is stored at all.
//
// node:crypto — Node runtime only. Routes importing this must not run on edge.
// ─────────────────────────────────────────────────────────────

import crypto from "node:crypto";

export interface HashIpOptions {
  /** Defaults to process.env.CAM_REPORT_SALT. */
  salt?: string;
  /** "YYYY-MM-DD"; defaults to today in UTC. */
  day?: string;
}

export function hashIp(ip: string | null, options: HashIpOptions = {}): string | null {
  if (!ip) return null;
  const salt = options.salt ?? process.env.CAM_REPORT_SALT;
  if (!salt) return null;
  const day = options.day ?? new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(`${ip}${salt}${day}`).digest("hex");
}
