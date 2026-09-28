// ─────────────────────────────────────────────────────────────
// Sign-up completion marker, shared by the server-side auth callback (which
// sets it) and the client-side SignupWelcomeTracker (which consumes it and
// fires AUTH_SIGNUP_COMPLETED). Plain module on purpose: the route handler
// cannot import from a "use client" file, and route files may only export
// HTTP handlers.
// ─────────────────────────────────────────────────────────────

export const WELCOME_PARAM = "welcome";
export const WELCOME_SIGNUP = "signup";

/**
 * Keyed on the *confirmation* timestamp, not account creation. Supabase stamps
 * `email_confirmed_at` during the /auth/v1/verify hop immediately before it
 * redirects to /auth/callback, so on a first confirmation it is seconds old no
 * matter how long the user took to open the email — whereas `created_at` is
 * stamped at form submit and would exclude everyone who read their inbox more
 * than a few minutes later. For a returning magic-link or password-reset user
 * the confirmation is days old, so those flows stay excluded.
 *
 * The window only has to absorb the verify → callback redirect plus clock
 * skew between Supabase and Vercel; two minutes is generous for that.
 */
export const SIGNUP_WINDOW_MS = 2 * 60 * 1000;

export function isFreshSignup(confirmedAt: string | null | undefined, now = Date.now()): boolean {
  if (!confirmedAt) return false;
  const confirmed = Date.parse(confirmedAt);
  if (Number.isNaN(confirmed)) return false;
  const age = now - confirmed;
  return age >= 0 && age <= SIGNUP_WINDOW_MS;
}
