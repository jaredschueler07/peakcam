"use client";

import { useMemo, useState } from "react";
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
  const { user, loaded, favorites, isFavorite, toggle } = useFavorites();
  const [showAuthModal, setShowAuthModal] = useState(false);

  const favoriteResorts = useMemo(() => {
    return resorts.filter((r) => favorites.has(r.id));
  }, [resorts, favorites]);

  async function handleToggleFavorite(resortId: string) {
    const result = await toggle(resortId);
    if (result?.error === "Sign in to save favorites") {
      setShowAuthModal(true);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} redirectTo="/favorites" />}
      <Header showSearch={false} />

      <div className="max-w-screen-2xl mx-auto px-4 py-8 md:px-8">
        <div className="mb-8">
          <h1 className="font-display text-5xl md:text-6xl text-text-base mb-2">
            MY FAVORITES
          </h1>
          <p className="text-text-subtle text-lg">
            Quick access to your saved resorts
          </p>
        </div>

        {!loaded ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-80 bg-surface border border-border rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !user ? (
          <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
            <div className="w-16 h-16 rounded-full bg-alpenglow/10 border border-alpenglow/30 flex items-center justify-center">
              <Heart size={28} className="text-alpenglow" />
            </div>
            <div>
              <p className="text-text-base font-semibold text-lg mb-1">Sign in to save favorites</p>
              <p className="text-text-muted text-sm max-w-sm">
                Bookmark your go-to resorts and check conditions at a glance.
              </p>
            </div>
            <Link
              href="/auth?next=/favorites"
              className="px-6 py-3 rounded-lg border border-cyan/30 bg-cyan/10 text-cyan font-semibold text-sm hover:bg-cyan/20 transition-all duration-200"
            >
              Sign in
            </Link>
          </div>
        ) : favoriteResorts.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-surface2 border border-border flex items-center justify-center mx-auto mb-4">
              <Heart size={28} className="text-text-muted" />
            </div>
            <h2 className="text-text-base font-semibold text-lg mb-2">No favorites yet</h2>
            <p className="text-text-muted text-sm mb-4 max-w-md mx-auto">
              Tap the heart icon on any resort card to save it here for quick access.
            </p>
            <Link
              href="/"
              className="text-cyan text-sm hover:underline"
            >
              Browse resorts
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {favoriteResorts.map((resort) => (
              <SummitResortCard
                key={resort.id}
                resort={resort}
                favorited={isFavorite(resort.id)}
                onToggleFavorite={() => handleToggleFavorite(resort.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
