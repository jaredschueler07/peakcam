"use client";

import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";
import MinimapCanvas from "./MinimapCanvas";
import RunStatus from "./RunStatus";
import Speedometer from "./Speedometer";
import TrailStatus from "./TrailStatus";

export default function DropInHUD({ store }: { store: StoreApi<HudState> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 p-3 sm:p-5" aria-live="polite">
      <div className="flex items-start justify-between gap-3"><Speedometer store={store} /><TrailStatus store={store} /></div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2"><RunStatus store={store} /></div>
      <div className="absolute right-4 top-20 hidden sm:block"><MinimapCanvas store={store} /></div>
    </div>
  );
}

