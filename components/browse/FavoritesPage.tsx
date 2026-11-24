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
    <div className="min-h-screen pc-paper">
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} redirectTo="/favorites" source="favorites_page" heading="Save your mountains." />}
      <Header showSearch={false} />

      <main id="main-content" className="max-w-screen-2xl mx-auto px-4 py-8 md:px-8">
        <div className="mb-8">
          <h1 className="font-display text-5xl md:text-6xl text-ink mb-2">
            MY FAVORITES
          </h1>
          <p className="text-bark-dk text-lg">
            Quick access to your saved resorts
          </p>
        </div>

        {!loaded ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-80 bg-cream-50 border border-ink/20 rounded-[18px] motion-safe:animate-pulse" />
            ))}
          </div>
        ) : !user ? (
          <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
            <div className="w-16 h-16 rounded-full bg-alpen/10 border border-alpen/30 flex items-center justify-center">
              <Heart size={28} className="text-alpen-dk" />
            </div>
            <div>
              <p className="text-ink font-semibold text-lg mb-1">Sign in to save favorites</p>
              <p className="text-bark text-sm max-w-sm">
                Bookmark your go-to resorts and check conditions at a glance.
              </p>
            </div>
            <Link
              href="/auth?next=/favorites"
              className="px-6 py-3 rounded-full border-[1.5px] border-ink bg-forest text-cream-50 font-semibold text-sm shadow-stamp-sm hover:shadow-stamp transition-all duration-200"
            >
              Sign in
            </Link>
          </div>
        ) : favoriteResorts.length === 0 ? (
          <div className="bg-cream-50 border-[1.5px] border-ink rounded-[18px] shadow-stamp-sm p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-cream border border-ink/20 flex items-center justify-center mx-auto mb-4">
              <Heart size={28} className="text-bark" />
            </div>
            <h2 className="text-ink font-semibold text-lg mb-2">No favorites yet</h2>
            <p className="text-bark text-sm mb-4 max-w-md mx-auto">
              Tap the heart icon on any resort card to save it here for quick access.
            </p>
            <Link
              href="/"
              className="text-alpen-dk font-semibold text-sm hover:underline"
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
      </main>
    </div>
  );
}
