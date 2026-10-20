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
 * Companion to WELCOME_PARAM: how the fresh account was created. Absent for
 * the email flows (the historical rows carry no method); "google" when the
 * callback exchanged a Google OAuth code. Read by SignupWelcomeTracker and
 * stripped from the URL with the marker.
 */
export const WELCOME_METHOD_PARAM = "welcome_method";
export const WELCOME_METHOD_GOOGLE = "google";

/**
 * Keyed on the *confirmation* timestamp, not account creation. Supabase stamps
 * `email_confirmed_at` during the /auth/v1/verify hop immediately before it
 * redirects to /auth/callback, so on a first confirmation it is seconds old no
 * matter how long the user took to open the email — whereas `created_at` is
 * stamped at form submit and would exclude everyone who read their inbox more
 * than a few minutes later. For a returning magic-link or password-reset user
 * the confirmation is days old, so those flows stay excluded. A brand-new
 * Google account is confirmed at creation, seconds before the same redirect,
 * so it falls inside the window too; an existing email account that just
 * linked Google keeps its old confirmation and stays out.
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
