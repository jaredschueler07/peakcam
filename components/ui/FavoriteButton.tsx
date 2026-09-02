"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, Heart, Loader2 } from "lucide-react";
import { Button } from "./Button";
import { type FavoriteType } from "@/lib/types";
import { AuthModal } from "../auth/AuthModal";
import { isFavorited as fetchIsFavorited, toggleFavorite, SIGN_IN_REQUIRED } from "@/lib/favorites";

/**
 * The one favorite button. All persistence, analytics and the signed-out
 * sentinel live in `lib/favorites.ts`; this component only owns presentation
 * and the two visual shapes the app uses:
 *
 *  - `ghost` / `outline` — a `Button`-wrapped star (resort title, cam tiles)
 *  - `pill` — a bare bordered heart (browse cards, resort hero)
 *
 * Two modes:
 *
 *  - Uncontrolled (no `favorited` prop): the button reads its own state on
 *    mount and writes the toggle itself.
 *  - Controlled: a parent that already tracks favorites through `useFavorites`
 *    passes `favorited` and `onToggle`, and owns the write. Several buttons for
 *    the same resort then stay in sync instead of drifting apart.
 */
interface FavoriteButtonProps {
  itemId: string;
  itemType?: FavoriteType;
  variant?: "ghost" | "outline" | "pill";
  /** `Button` size for the star variants; padding step for the `pill` variant. */
  size?: "sm" | "md";
  /** Icon size in px, for the `pill` variant. */
  iconSize?: number;
  className?: string;
  /**
   * Controlled state. When provided the button neither fetches nor writes:
   * it renders this value and hands the intended next state to `onToggle`.
   */
  favorited?: boolean;
  onToggle?: (favorited: boolean) => void;
  /**
   * Called instead of opening this component's own AuthModal. Uncontrolled
   * buttons call it when the write comes back signed-out; controlled buttons
   * only when the parent supplies no `onToggle`.
   */
  onAuthRequired?: () => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function FavoriteButton({
  itemId,
  itemType = "resort",
  variant = "ghost",
  size = "sm",
  iconSize = 18,
  className = "",
  favorited: controlledFavorited,
  onToggle,
  onAuthRequired,
}: FavoriteButtonProps) {
  const isControlled = controlledFavorited !== undefined;

  const [ownFavorited, setOwnFavorited] = useState(false);
  // Only an uncontrolled button with a queryable id has a lookup to wait for.
  const [isLoading, setIsLoading] = useState(() => !isControlled && UUID_RE.test(itemId));
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const favorited = isControlled ? controlledFavorited : ownFavorited;

  useEffect(() => {
    // Cam and resort ids are UUIDs; anything else can only miss, so skip the
    // round-trip rather than sending PostgREST a malformed filter.
    if (isControlled || !UUID_RE.test(itemId)) return;

    let cancelled = false;
    fetchIsFavorited(itemId, itemType).then((value) => {
      if (cancelled) return;
      setOwnFavorited(value);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [isControlled, itemId, itemType]);

  const promptAuth = useCallback(() => {
    if (onAuthRequired) onAuthRequired();
    else setShowAuthModal(true);
  }, [onAuthRequired]);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isProcessing) return;
      setError(null);

      // Controlled: the parent owns the write (and, through its own auth
      // state, the sign-in prompt). Doing it here too would toggle twice.
      if (isControlled) {
        if (onToggle) onToggle(!favorited);
        else promptAuth();
        return;
      }

      setIsProcessing(true);
      const result = await toggleFavorite(itemId, itemType);
      setIsProcessing(false);

      if (result.error === SIGN_IN_REQUIRED) {
        promptAuth();
        return;
      }
      if (result.error) {
        // Replaces a blocking `alert()`: the message is announced to screen
        // readers and shown on hover, and the button stays usable for a retry.
        console.error("[FavoriteButton] Could not save favorite:", result.error);
        setError("Couldn't save that. Try again in a moment.");
        return;
      }

      setOwnFavorited(result.favorited);
      onToggle?.(result.favorited);
    },
    [isProcessing, itemId, itemType, isControlled, favorited, onToggle, promptAuth]
  );

  const label = favorited ? "Remove from favorites" : "Add to favorites";
  const title = error ?? label;

  const liveRegion = (
    <span aria-live="polite" className="sr-only">
      {error ?? ""}
    </span>
  );

  if (variant === "pill") {
    return (
      <>
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
        <button
          onClick={handleClick}
          disabled={isProcessing}
          className={`
            ${size === "md" ? "p-2" : "p-1.5"} rounded-lg border transition-all duration-[220ms]
            ${favorited
              ? "bg-alpenglow/15 border-alpenglow/40 text-alpenglow hover:bg-alpenglow/25"
              : "bg-surface2/50 border-border text-text-muted hover:text-alpenglow hover:border-alpenglow/30 hover:bg-alpenglow/10"}
            ${isProcessing ? "opacity-50 cursor-wait" : "cursor-pointer"}
            ${className}
          `}
          aria-label={label}
          title={title}
        >
          <Heart
            size={iconSize}
            fill={favorited ? "currentColor" : "none"}
            strokeWidth={favorited ? 0 : 1.5}
          />
          {liveRegion}
        </button>
      </>
    );
  }

  return (
    <>
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={isProcessing}
        className={`${className} group min-w-[36px] relative z-50`}
        aria-label={label}
        title={title}
      >
        {isProcessing ? (
          <Loader2 className="w-4 h-4 animate-spin text-cyan" />
        ) : (
          <Star
            className={`w-4 h-4 transition-all duration-200 ${isLoading ? "opacity-40" : "opacity-100"} ${
              favorited
                ? "fill-cyan text-cyan"
                : "text-text-muted group-hover:text-text-subtle"
            }`}
          />
        )}
        {liveRegion}
      </Button>
    </>
  );
}
