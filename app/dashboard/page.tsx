"use client";

import { useDashboard } from "@/hooks/useDashboard";
import dynamic from "next/dynamic";
const DashboardGrid = dynamic(() => import("@/components/dashboard/DashboardGrid").then(m => ({ default: m.DashboardGrid })));
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { Heart, Layout, Loader2 } from "lucide-react";

export default function DashboardPage() {
  const { widgets, resolved, isLoading } = useDashboard();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <Header />

      <main className="flex-grow container mx-auto px-4 py-12">
        <header className="mb-12">
          <div className="flex items-center gap-3 mb-2 text-cyan">
            <Layout size={24} />
            <h1 className="text-4xl font-bold tracking-tight text-text-base">My Peak</h1>
          </div>
          <p className="text-text-muted text-lg">
            Your favorite mountains and cameras, arranged your way.
          </p>
        </header>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-10 h-10 text-cyan animate-spin" />
            <p className="text-text-muted font-mono animate-pulse uppercase tracking-widest text-xs">
              Initializing Dashboard...
            </p>
          </div>
        ) : (
          <DashboardGrid initialLayout={widgets} resolved={resolved} />
        )}

        <section className="mt-20 pt-12 border-t border-border/40">
          <div className="flex items-center gap-2 mb-6 text-text-muted">
            <Heart size={16} />
            <h2 className="text-xs font-semibold uppercase tracking-widest">Dashboard Guide</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="space-y-3">
              <h3 className="text-text-base font-semibold">1. Save favorites</h3>
              <p className="text-sm text-text-subtle leading-relaxed">
                Tap the heart on a resort card or camera to add it to your dashboard.
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="text-text-base font-semibold">2. Enter Edit Mode</h3>
              <p className="text-sm text-text-subtle leading-relaxed">
                Choose <span className="text-cyan font-mono">Customize Layout</span> to arrange your cards. In list layout, use Move up and Move down.
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="text-text-base font-semibold">3. Choose your view</h3>
              <p className="text-sm text-text-subtle leading-relaxed">
                Phones use an easy-to-scan list. On larger screens, switch between list and grid; the grid also supports dragging and resizing.
              </p>
            </div>
          </div>
        </section>
      </main>

      <PeakFooter />
    </div>
  );
}
