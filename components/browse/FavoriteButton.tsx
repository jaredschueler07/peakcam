"use client";

import { useState, useCallback } from "react";
import { Heart } from "lucide-react";
import { toggleFavorite } from "@/lib/favorites";

interface Props {
  resortId: string;
  initialFavorited: boolean;
  onToggle?: (favorited: boolean) => void;
  onAuthRequired?: () => void;
  size?: number;
}

export function FavoriteButton({
  resortId,
  initialFavorited,
  onToggle,
  onAuthRequired,
  size = 18,
}: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (loading) return;

      setLoading(true);
      const result = await toggleFavorite(resortId);
      setLoading(false);

      if (result.error === "Sign in to save favorites") {
        onAuthRequired?.();
        return;
      }

      if (!result.error) {
        setFavorited(result.favorited);
        onToggle?.(result.favorited);
      }
    },
    [resortId, loading, onToggle, onAuthRequired]
  );

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`
        p-1.5 rounded-lg border transition-all duration-[220ms]
        ${favorited
          ? "bg-alpenglow/15 border-alpenglow/40 text-alpenglow hover:bg-alpenglow/25"
          : "bg-surface2/50 border-border text-text-muted hover:text-alpenglow hover:border-alpenglow/30 hover:bg-alpenglow/10"}
        ${loading ? "opacity-50 cursor-wait" : "cursor-pointer"}
      `}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      title={favorited ? "Remove from favorites" : "Add to favorites"}
    >
      <Heart
        size={size}
        fill={favorited ? "currentColor" : "none"}
        strokeWidth={favorited ? 0 : 1.5}
      />
    </button>
  );
}
