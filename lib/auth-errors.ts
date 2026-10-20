/** Keep authentication errors useful without exposing provider internals. */
export function authErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  switch (code) {
    case "invalid_credentials": return "The email or password is incorrect. Try again or reset your password.";
    case "email_not_confirmed": return "Confirm your email before signing in. You can resend the confirmation below.";
    case "otp_expired": return "That code or link expired or has already been used. Request a new one.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit": return "Too many attempts. Please wait a few minutes before trying again.";
    case "weak_password": return "Choose a stronger password with at least 8 characters. Avoid common or previously exposed passwords.";
    case "same_password": return "Choose a password you haven’t used for this account before.";
    case "reauthentication_needed": return "Please sign out and sign in again, then retry changing your password.";
    case "session_not_found":
    case "refresh_token_not_found": return "Your session has ended. Please sign in again.";
    // Google sign-in (P11). `provider_disabled` / `oauth_provider_not_supported`
    // are Supabase's own codes; `google_not_enabled` is what AuthForm raises
    // when the settings probe says the provider is off.
    case "google_not_enabled":
    case "provider_disabled":
    case "oauth_provider_not_supported": return "Google sign-in is not enabled yet. Use your email to sign in for now.";
    // The visitor closed or declined Google's account chooser (`error=access_denied`).
    case "access_denied": return "Google sign-in was cancelled. Try again, or sign in with your email.";
    // Supabase joins a Google identity to an existing account automatically when
    // Google reports the address verified; these codes mean it could not.
    case "email_exists":
    case "user_already_exists":
    case "identity_already_exists": return "An account with that email already exists. Sign in with your email and password instead.";
    case "provider_email_needs_verification": return "Confirm the email address Google reported — we’ve sent a message — then sign in again.";
    case "signup_disabled": return "New accounts are paused right now. Please try again later.";
    // PKCE state lost between leaving and returning: a different browser, an
    // expired flow, or a mangled callback.
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
    case "bad_oauth_state":
    case "bad_oauth_callback": return "That Google sign-in attempt expired or was opened in a different browser. Start again from this page.";
    default: return "We couldn’t complete that request. Please try again in a moment.";
  }
}
