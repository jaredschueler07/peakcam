import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getDropInRoster, type DropInProfile } from "@/lib/drop-in";

interface DropInRosterProps {
  /** Hide one resort — used when the roster is shown *on* a resort's own page. */
  exclude?: string;
  /** Drops the stat block and trail list for the tighter error-state layout. */
  compact?: boolean;
  className?: string;
}

const CARD =
  "group flex h-full flex-col rounded-2xl border-[1.5px] border-ink bg-cream-50 p-5 " +
  "shadow-stamp transition-[transform,box-shadow] duration-100 " +
  "hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp-lg " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

// Small-caps label. Deliberately not the global `.pc-eyebrow` class: that rule
// is unlayered, so it beats Tailwind's utility layer and its bark tone can't be
// darkened per-instance. bark-dk clears WCAG AA on cream at this size.
const LABEL =
  "text-[10.5px] font-bold uppercase tracking-[0.16em] text-bark-dk";

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={LABEL}>{label}</dt>
      <dd className="font-mono text-[15px] font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function RosterCard({ profile, compact }: { profile: DropInProfile; compact: boolean }) {
  return (
    <li className="h-full">
      <Link
        href={`/resorts/${profile.slug}/drop-in`}
        className={CARD}
        aria-label={`Drop In — ski ${profile.name} in an arcade descent`}
      >
        <span
          className="mb-4 block h-2 w-14 rounded-full border-[1.5px] border-ink"
          style={{ backgroundColor: profile.accent }}
          aria-hidden
        />
        <h3 className="pc-display text-[28px] text-ink">{profile.name}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-bark-dk">{profile.tagline}</p>

        {!compact && (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-dashed border-bark/50 pt-4">
              <StatCell
                label="Vertical"
                value={`${profile.verticalDropFt.toLocaleString()} ft`}
              />
              <StatCell
                label="Summit"
                value={`${profile.summitElevationFt.toLocaleString()} ft`}
              />
            </dl>
            <p className={`mt-4 ${LABEL}`}>Six runs, including</p>
            <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-bark-dk">
              {profile.trailNames.slice(0, 3).join(" · ")}
            </p>
          </>
        )}

        <span className="mt-auto flex items-center gap-2 pt-5 text-[13px] font-bold uppercase tracking-[0.06em] text-alpen-dk">
          Drop In
          <ArrowRight
            className="h-4 w-4 shrink-0 transition-transform duration-100 group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </Link>
    </li>
  );
}

/**
 * The three pilot mountains, rendered from `lib/drop-in`'s roster so this can
 * never advertise a resort the engine can't build. Shared by the /drop-in hub
 * and by both "Drop In isn't here" states, so the cross-links stay identical.
 */
export default function DropInRoster({
  exclude,
  compact = false,
  className = "",
}: DropInRosterProps) {
  const profiles = getDropInRoster().filter((p) => p.slug !== exclude);
  if (profiles.length === 0) return null;

  return (
    <ul
      className={`grid list-none grid-cols-1 gap-5 sm:grid-cols-2 ${
        profiles.length > 2 ? "lg:grid-cols-3" : ""
      } ${className}`}
    >
      {profiles.map((profile) => (
        <RosterCard key={profile.slug} profile={profile} compact={compact} />
      ))}
    </ul>
  );
}

/** Roster count, for copy that needs to stay honest as the pilot grows. */
export function dropInResortCount(): number {
  return getDropInRoster().length;
}
