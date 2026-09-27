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
 * A user whose account was created this recently is completing a sign-up
 * (email confirmation), not signing back in via magic link or password reset.
 * The window is generous enough to cover slow mail delivery on the first
 * confirmation click; a later re-click of the same link is a plain sign-in.
 */
export const SIGNUP_WINDOW_MS = 5 * 60 * 1000;

export function isFreshSignup(createdAt: string | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  const age = now - created;
  return age >= 0 && age <= SIGNUP_WINDOW_MS;
}
