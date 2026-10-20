// ─────────────────────────────────────────────────────────────
// Account-page view of a Supabase user: display name, avatar and the sign-in
// providers. Google fills `user_metadata` with `full_name`, `name`,
// `avatar_url` and `picture`; email accounts carry none of these. Pure so the
// account page stays a thin Server Component and the rules are unit-tested.
// ─────────────────────────────────────────────────────────────

export type AccountProfile = {
  displayName: string | null;
  avatarUrl: string | null;
  providers: string[];
};

type UserLike = {
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

/**
 * Hosts the avatar may be served from. Must stay in step with
 * `images.remotePatterns` in next.config.ts: next/image throws at render time
 * for a host it does not know, which would take the whole account page down,
 * so an avatar on any other host is dropped rather than rendered.
 */
export const AVATAR_HOST_PATTERN = /^[a-z0-9-]+\.googleusercontent\.com$/i;

export function isAllowedAvatarUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && AVATAR_HOST_PATTERN.test(url.hostname);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

export function accountProfile(user: UserLike): AccountProfile {
  const meta = user.user_metadata ?? {};
  const app = user.app_metadata ?? {};
  const providersRaw = Array.isArray(app.providers) ? app.providers : typeof app.provider === "string" ? [app.provider] : [];
  const providers = providersRaw.filter((p): p is string => typeof p === "string");
  const avatar = isAllowedAvatarUrl(meta.avatar_url) ? meta.avatar_url : isAllowedAvatarUrl(meta.picture) ? meta.picture : null;
  return {
    displayName: text(meta.full_name) ?? text(meta.name) ?? null,
    avatarUrl: avatar,
    providers,
  };
}

export function signedInWithGoogle(profile: AccountProfile): boolean {
  return profile.providers.includes("google");
}
