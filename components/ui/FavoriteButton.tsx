"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "./Button";
import { type FavoriteType } from "@/lib/types";
import { AuthModal } from "../auth/AuthModal";
import { stageGuestLineup } from "../auth/lineup-gate";
import { track, EVENTS } from "@/lib/analytics-events";
import { notifyFavoritesChanged, subscribeFavoritesChanged } from "@/lib/favorites-events";

interface FavoriteButtonProps {
  itemId: string;
  itemType: FavoriteType;
  variant?: "ghost" | "outline";
  size?: "sm" | "md";
  /**
   * Name of the thing being favorited (cam name, resort name…). Used to keep
   * accessible names unique when several of these buttons share a page.
   */
  label?: string;
  className?: string;
  /** Surface that raised the auth gate, for AUTH_GATE_SHOWN attribution. */
  source?: string;
  /** Personalised modal heading ("Save Main Street.") instead of the generic default. */
  authHeading?: string;
  authNote?: string;
}

export function FavoriteButton({
  itemId,
  itemType,
  variant = "ghost",
  size = "sm",
  label,
  className = "",
  source,
  authHeading,
  authNote,
}: FavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [intentNote, setIntentNote] = useState<string | null>(null);
  const [intentWarning, setIntentWarning] = useState<string | null>(null);
  const supabase = createSupabaseBrowserClient();

  // A guest save writes the clicked item through the shared intent before the
  // modal opens, so a camera stays that camera after auth (never a resort).
  const gateSource = source ?? (itemType === "cam" ? "cam_save" : "resort_save");
  const noun = itemType === "resort" ? "mountain" : itemType === "cam" ? "camera" : "region";

  const checkFavoriteStatus = useCallback(async () => {
    try {
      // Basic UUID validation
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(itemId)) {
        setIsLoading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        setIsFavorited(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("item_type", itemType)
        .eq("item_id", itemId)
        .maybeSingle();

      if (error) {
        console.error("[FavoriteButton] Error checking status:", error.message, error.code, error.details);
        console.dir(error);
      }
      
      setIsFavorited(!!data);
    } catch (err) {
      console.error("[FavoriteButton] Unexpected error in checkFavoriteStatus:", err);
    } finally {
      setIsLoading(false);
    }
  }, [itemId, itemType, supabase]);

  useEffect(() => {
    checkFavoriteStatus();
  }, [checkFavoriteStatus]);

  // The lineup bridge (or another tab) can save this exact item while the
  // button is mounted; reconcile the heart instead of leaving it stale.
  useEffect(() => subscribeFavoritesChanged(() => { void checkFavoriteStatus(); }), [checkFavoriteStatus]);

  const toggleFavorite = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const staged = stageGuestLineup({ item_type: itemType, item_id: itemId }, { source: gateSource, noun });
      setIntentNote(staged.stored ? staged.note : null);
      setIntentWarning(staged.stored ? null : staged.message);
      setShowAuthModal(true);
      return;
    }

    setIsProcessing(true);
    
    try {
      if (isFavorited) {
        const { error } = await supabase
          .from("user_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("item_type", itemType)
          .eq("item_id", itemId);

        if (error) throw error;
        setIsFavorited(false);
        track(EVENTS.FAVORITE_REMOVED, { item_id: itemId, item_type: itemType, ...(source ? { source } : {}) });
      } else {
        const { error } = await supabase
          .from("user_favorites")
          .insert({
            user_id: user.id,
            item_type: itemType,
            item_id: itemId,
          });

        if (error) throw error;
        setIsFavorited(true);
        track(EVENTS.FAVORITE_ADDED, { item_id: itemId, item_type: itemType, ...(source ? { source } : {}) });
      }
      notifyFavoritesChanged();
    } catch (err: any) {
      console.error("[FavoriteButton] Error toggling favorite:", err.message || err);
      console.dir(err);
      
      // Handle the schema cache issue (PGRST204 / 400)
      if (err.code === 'PGRST204' || err.status === 400) {
        alert("Database sync error. Please refresh the page once to clear the cache.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const starOpacity = isLoading ? "opacity-40" : "opacity-100";

  // The visible control is an icon, so the accessible name has to carry both
  // the action and the specific thing it applies to ("Save Main Street to your
  // saved cameras"), not just "Add to Favorites".
  const accessibleName = label
    ? isFavorited
      ? `Remove ${label} from your saved ${noun}s`
      : `Save ${label} to your saved ${noun}s`
    : isFavorited
      ? "Remove from Favorites"
      : "Add to Favorites";

  return (
    <>
      {showAuthModal && (
        <AuthModal
          onClose={() => {
            setShowAuthModal(false);
            setIntentNote(null);
            setIntentWarning(null);
          }}
          source={gateSource}
          heading={authHeading ?? (label ? `Save ${label}.` : undefined)}
          intentNote={intentNote ?? (intentWarning ? undefined : authNote)}
          intentWarning={intentWarning ?? undefined}
          lineup={intentNote ? { lineup_source: gateSource, lineup_count: 1 } : null}
        />
      )}
      <Button
        variant={variant}
        size={size}
        onClick={toggleFavorite}
        disabled={isProcessing}
        className={`${className} group min-w-[36px] relative z-50`}
        title={accessibleName}
        aria-label={accessibleName}
      >
        {isProcessing ? (
          <Loader2 className="w-4 h-4 animate-spin text-cyan" />
        ) : (
          <Star
            className={`w-4 h-4 transition-all duration-200 ${starOpacity} ${
              isFavorited
                ? "fill-cyan text-cyan"
                : "text-text-muted group-hover:text-text-subtle"
            }`}
          />
        )}
      </Button>
    </>
  );
}
