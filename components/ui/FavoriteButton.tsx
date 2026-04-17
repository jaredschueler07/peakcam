"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "./Button";
import { type FavoriteType } from "@/lib/types";
import { AuthModal } from "../auth/AuthModal";
import { track, EVENTS } from "@/lib/analytics-events";

interface FavoriteButtonProps {
  itemId: string;
  itemType: FavoriteType;
  variant?: "ghost" | "outline";
  size?: "sm" | "md";
  className?: string;
}

export function FavoriteButton({
  itemId,
  itemType,
  variant = "ghost",
  size = "sm",
  className = "",
}: FavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const supabase = createSupabaseBrowserClient();

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

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
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
        track(EVENTS.FAVORITE_REMOVED, { item_id: itemId, item_type: itemType });
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
        track(EVENTS.FAVORITE_ADDED, { item_id: itemId, item_type: itemType });
      }
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

  return (
    <>
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      <Button
        variant={variant}
        size={size}
        onClick={toggleFavorite}
        disabled={isProcessing}
        className={`${className} group min-w-[36px] relative z-50`}
        title={isFavorited ? "Remove from Favorites" : "Add to Favorites"}
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
