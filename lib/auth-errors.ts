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
    default: return "We couldn’t complete that request. Please try again in a moment.";
  }
}
