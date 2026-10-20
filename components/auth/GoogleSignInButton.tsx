// Presentational "Continue with Google" button plus the "or" divider that
// separates it from the email form. No hooks, so it renders statically in
// tests (tests/google-sign-in-button.test.ts) and AuthForm owns the click.
//
// Google's sign-in branding rules: the official four-colour "G" mark at its
// own colours (never recoloured or restyled), the mark on a light tile, and
// the "Continue with Google" wording. The poster styling around it (ink
// border, cream fill, pill shape) matches the rest of the form.

/** The official Google "G" mark; colours are Google's and must not change. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export const GOOGLE_BUTTON_LABEL = "Continue with Google";

export function GoogleSignInButton({ onClick, disabled = false, busy = false }: { onClick?: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        data-testid="google-sign-in"
        className="flex min-h-11 w-full items-center justify-center gap-3 rounded-full border border-ink bg-cream-50 px-4 py-3 text-sm font-bold text-ink transition hover:bg-cream disabled:opacity-50"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white"><GoogleMark /></span>
        {busy ? "Opening Google…" : GOOGLE_BUTTON_LABEL}
      </button>
      <p className="mt-4 flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-bark">
        <span aria-hidden className="h-px flex-1 bg-bark/40" />
        or
        <span aria-hidden className="h-px flex-1 bg-bark/40" />
      </p>
    </div>
  );
}
