"use client";

import { useDashboard } from "@/hooks/useDashboard";
import dynamic from "next/dynamic";
const DashboardGrid = dynamic(() => import("@/components/dashboard/DashboardGrid").then(m => ({ default: m.DashboardGrid })));
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { Heart, Layout, Loader2 } from "lucide-react";

export default function DashboardPage() {
  const { widgets, resolved, isLoading, isAuthenticated } = useDashboard();

  return (
    <div className="min-h-screen bg-bg pc-paper flex flex-col">
      <Header />

      <main id="main-content" className="flex-grow container mx-auto px-4 py-6 md:py-8 scroll-mt-16">
        <header className="mb-4">
          <div className="flex items-center gap-2.5 mb-1 text-alpen-dk">
            <Layout size={22} />
            <h1 className="font-display font-black text-3xl sm:text-4xl tracking-tight text-ink">
              My Peak
            </h1>
          </div>
          <p className="text-bark text-sm sm:text-base">
            Your favorite mountains and live cameras, arranged your way.
          </p>
        </header>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-10 h-10 text-alpen-dk animate-spin" />
            <p className="text-bark font-mono animate-pulse uppercase tracking-widest text-xs">
              Initializing Dashboard...
            </p>
          </div>
        ) : (
          <DashboardGrid
            initialLayout={widgets}
            resolved={resolved}
            isAuthenticated={isAuthenticated}
          />
        )}

        <section className="mt-16 pt-10 border-t border-ink/15">
          <div className="flex items-center gap-2 mb-6 text-bark">
            <Heart size={16} />
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest">Dashboard Guide</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <h3 className="font-display font-bold text-ink">1. Save favorites</h3>
              <p className="text-sm text-bark leading-relaxed">
                Tap the heart on a resort card or camera to add it to your dashboard.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-display font-bold text-ink">2. Enter Edit Mode</h3>
              <p className="text-sm text-bark leading-relaxed">
                Choose <span className="text-ink font-mono font-bold">Customize layout</span> to arrange your cards. In list layout, use Move up and Move down.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-display font-bold text-ink">3. Choose your view</h3>
              <p className="text-sm text-bark leading-relaxed">
                Phones use an easy-to-scan list. On larger screens, switch between list and grid; resize any resort card larger to unlock a multi-camera live grid.
              </p>
            </div>
          </div>
        </section>
      </main>

      <PeakFooter />
    </div>
  );
}
