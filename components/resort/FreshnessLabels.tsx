// ─────────────────────────────────────────────────────────────
// Freshness labels (P6): one small line per populated headline field of the
// conditions contract, naming its source and freshness tier with the age,
// so a reader can see at a glance that the base depth is a station reading
// from this morning and the lift count is the operator's from an hour ago.
// Pure presentational; the page passes the contract it already built for
// the status chip and the API, so the three never disagree.
// ─────────────────────────────────────────────────────────────

import Link from "next/link";
import type { ConditionsContract, Field, FreshnessTier } from "@/lib/conditions-contract";

const TIER_STYLE: Record<FreshnessTier, string> = {
  live: "bg-great/15 text-forest-dk border-great/50",
  recent: "bg-cream-50 text-ink border-bark/60",
  estimated: "bg-fair/25 text-ink border-fair",
  stale: "bg-poor/15 text-bark-dk border-poor/60",
  unknown: "bg-cream-50 text-bark border-bark/40 border-dashed",
};

const SOURCE_WORD: Record<string, string> = {
  snotel: "SNOTEL",
  "station:snotel": "SNOTEL",
  "station:ghcn": "GHCN station",
  "station:nws": "NWS station",
  "station:bc_asws": "BC ASWS",
  "station:eccc": "ECCC",
  operator: "operator",
  model: "model",
  profile: "catalogue",
  derived: "derived",
  none: "none",
};

function age(f: Field<unknown>): string {
  const h = f.freshness.ageHours;
  if (h == null) return "";
  if (h < 1) return " <1 h";
  return ` ${Math.round(h)} h`;
}

const ROWS: Array<{ key: keyof ConditionsContract; label: string; unit: string }> = [
  { key: "baseDepthIn", label: "Base depth", unit: "″" },
  { key: "newSnow24hIn", label: "24 h new", unit: "″" },
  { key: "liftsOpen", label: "Lifts open", unit: "" },
  { key: "tempF", label: "Temp", unit: "°F" },
  { key: "windMph", label: "Wind", unit: " mph" },
  { key: "forecastNext48hCm", label: "Next 48 h", unit: " cm" },
];

export function FreshnessLabels({ contract }: { contract: ConditionsContract }) {
  const rows = ROWS.map((r) => ({ ...r, field: contract[r.key] as Field<number> })).filter((r) => r.field.value != null);
  if (!rows.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Where each number comes from and how fresh it is" data-testid="freshness-labels">
      {rows.map((r) => (
        <li
          key={r.key}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] ${TIER_STYLE[r.field.freshness.tier]}`}
          title={`${r.label}: ${r.field.value}${r.unit} from ${SOURCE_WORD[r.field.source] ?? r.field.source}${r.field.observedAt ? `, observed ${r.field.observedAt}` : ""}; ${r.field.freshness.tier}${age(r.field)}`}
        >
          <span>{r.label}</span>
          <span aria-hidden="true">·</span>
          <span className="normal-case tracking-normal">{SOURCE_WORD[r.field.source] ?? r.field.source}</span>
          <span aria-hidden="true">·</span>
          <span>
            {r.field.freshness.tier}
            {age(r.field)}
          </span>
        </li>
      ))}
      <li className="inline-flex items-center px-1 text-[11px] text-bark">
        <Link href="/methodology#status" className="underline underline-offset-2 hover:text-ink">
          What the tiers mean
        </Link>
      </li>
    </ul>
  );
}
