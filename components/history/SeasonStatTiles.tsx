import type { SeasonStatsPublic } from "@/lib/public-api/schema";
import { formatDayLabel, inchesLabel } from "@/lib/season-stats";

interface Tile {
  label: string;
  value: string;
  note?: string | null;
}

/**
 * Six readouts for the season in progress. Server-rendered; the numbers are
 * the /season-stats document's, so the page and the API cannot disagree.
 */
export function SeasonStatTiles({ stats }: { stats: SeasonStatsPublic }) {
  const p = stats.percentOfNormal;
  const tiles: Tile[] = [
    {
      label: `Snow since ${formatDayLabel(stats.season.startDate)}`,
      value: inchesLabel(stats.seasonToDateIn),
      note: `${stats.daysMeasured} days measured · ${stats.snowDays} snow days`,
    },
    {
      label: "Percent of normal to date",
      value: p.thirtyYear != null ? `${p.thirtyYear}%` : "—",
      note:
        p.thirtyYear != null
          ? `of the ${p.normalYears ?? 30}-winter mean, ${inchesLabel(p.normalToDateIn)}${p.recentDecade != null ? ` · ${p.recentDecade}% of the last ${p.recentYears ?? 10}` : ""}`
          : stats.source === "open_meteo"
            ? "no station normal (model values)"
            : "no normal seeded yet",
    },
    {
      label: "Powder days",
      value: String(stats.powderDays),
      note: `${stats.powderDayThresholdIn} in. or more in a day`,
    },
    {
      label: "Deepest base",
      value: stats.deepestBase ? inchesLabel(stats.deepestBase.depthIn) : "—",
      note: stats.deepestBase ? `${formatDayLabel(stats.deepestBase.date)} · now ${inchesLabel(stats.currentBaseIn)}` : null,
    },
    {
      label: "Same day last season",
      value: stats.lastYear ? inchesLabel(stats.lastYear.seasonToDateIn) : "—",
      note: stats.lastYear
        ? `${stats.lastYear.season.label}: ${stats.lastYear.powderDays} powder days${stats.lastYear.baseOnSameDayIn != null ? `, base ${inchesLabel(stats.lastYear.baseOnSameDayIn)}` : ""} · this season ${stats.lastYear.diffIn >= 0 ? "+" : ""}${stats.lastYear.diffIn} in.`
        : "no rows for last season",
    },
    {
      label: "Last 7 days",
      value: inchesLabel(stats.trend.last7In),
      note: `${stats.trend.direction} · the 7 before: ${inchesLabel(stats.trend.prior7In)}`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-4 py-3 shadow-stamp-sm">
          <dt className="pc-eyebrow">{t.label}</dt>
          <dd className="mt-1 font-mono text-2xl font-black tabular-nums text-ink">{t.value}</dd>
          {t.note && <dd className="mt-1 text-xs text-bark">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
