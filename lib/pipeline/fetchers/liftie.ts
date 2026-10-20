// ─────────────────────────────────────────────────────────────
// PeakCam — Liftie Fetcher (dormant pipeline adapter)
//
// The pipeline is dormant (see CLAUDE.md); the live operator-status path is
// scripts/operator-sync.ts over lib/operators/liftie.ts (P6). This adapter
// keeps the pipeline's fetcher table compiling by delegating to the same
// parser, so there is one copy of the Liftie document shape.
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";
import { fetchLiftieResort } from "../../operators/liftie";

export async function fetchLiftie(
  resort: ResortContext,
): Promise<SourceReading | null> {
  const slug = resort.metadata?.liftie_slug ?? resort.slug;
  const result = await fetchLiftieResort(slug);
  if (!result.ok) {
    console.warn(`[PeakCam] Liftie fetch failed for ${slug}: ${result.reason}${result.status ? ` ${result.status}` : ""}`);
    return null;
  }
  const { stats, lifts } = result.report;
  const reading = emptyReading(resort.id, "liftie");
  reading.lifts_open = stats.total ? stats.open : null;
  reading.lifts_total = stats.total || null;
  reading.source_confidence = stats.total > 0 ? 1.0 : 0.3;
  reading.raw_json = { lifts, stats } as unknown as Record<string, unknown>;
  return reading;
}
