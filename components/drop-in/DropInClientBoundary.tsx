"use client";

import dynamic from "next/dynamic";
import type { ResortGameProfile } from "@/lib/game/config/schema";

const DropInGame = dynamic(() => import("./DropInGame"), {
  ssr: false,
  loading: () => (
    <div className="pc-topo fixed inset-0 flex items-center justify-center bg-cream text-ink" role="status">
      <span className="pc-eyebrow">Loading Drop In…</span>
    </div>
  ),
});

export default function DropInClientBoundary({ profile }: { profile: ResortGameProfile }) {
  return <DropInGame profile={profile} />;
}

