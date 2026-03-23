"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { SummitResortCard } from "@/components/browse/SummitResortCard";
import { AuthModal } from "@/components/auth/AuthModal";
import { useFavorites } from "@/lib/useFavorites";
import type { ResortWithData } from "@/lib/types";

interface Props {
  resorts: ResortWithData[];
}

export function FavoritesPage({ resorts }: Props) {
  const { favoriteIds, userId, loading, toggleFavorite } = useFavorites();
  const [showAuthModal, setShowAuthModal] = useState(false);

  async function handleToggleFavorite(resortId: string) {
    const { needsAuth } = await toggleFavorite(resortId);
    if (needsAuth) setShowAuthModal(true);
  }

  const favoriteResorts = resorts.filter((r) => favoriteIds.has(r.id));

  return (
    <div className="min-h-screen bg-bg">
      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}
      <Header showSearch={false} />

      <div className="max-w-screen-2xl mx-auto px-4 py-10 md:px-8">
        {/* Page heading */}
        <div className="mb-10">
          <h1 className="font-display text-5xl md:text-6xl text-text-base mb-2 tracking-wide">
            FAVORITES
          </h1>
          <p className="text-text-subtle text-lg">Your saved resorts</p>
        </div>

        {/* Unauthenticated state */}
        {!loading && !userId && (
          <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
            <div className="w-16 h-16 rounded-full bg-alpenglow/10 border border-alpenglow/30 flex items-center justify-center">
              <Heart size={28} className="text-alpenglow" />
            </div>
            <div>
              <p className="text-text-base font-semibold text-lg mb-1">Sign in to save favorites</p>
              <p className="text-text-muted text-sm max-w-sm">
                Bookmark your go-to resorts and check conditions at a glance — no password needed.
              </p>
            </div>
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-6 py-3 rounded-lg border border-cyan/30 bg-cyan/10 text-cyan font-semibold text-sm hover:bg-cyan/20 transition-all duration-200"
            >
              Sign in with magic link
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-80 rounded-lg bg-surface animate-pulse border border-border"
              />
            ))}
          </div>
        )}

        {/* Empty favorites (signed in, nothing saved) */}
        {!loading && userId && favoriteResorts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
            <div className="w-16 h-16 rounded-full bg-surface2 border border-border flex items-center justify-center">
              <Heart size={28} className="text-text-muted" />
            </div>
            <div>
              <p className="text-text-base font-semibold text-lg mb-1">No favorites yet</p>
              <p className="text-text-muted text-sm max-w-sm">
                Tap the heart icon on any resort card to save it here.
              </p>
            </div>
            <Link
              href="/"
              className="px-6 py-3 rounded-lg border border-border text-text-subtle font-medium text-sm hover:text-cyan hover:border-cyan/40 transition-all duration-200"
            >
              Browse resorts
            </Link>
          </div>
        )}

        {/* Favorites grid */}
        {!loading && userId && favoriteResorts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {favoriteResorts.map((resort) => (
              <SummitResortCard
                key={resort.id}
                resort={resort}
                isFavorited={favoriteIds.has(resort.id)}
                onToggleFavorite={() => handleToggleFavorite(resort.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
