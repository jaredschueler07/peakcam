"use client";

import dynamic from "next/dynamic";
import type { ResortGameProfile } from "@/lib/game/config/schema";
import type { ConditionsSnapshot } from "@/lib/game/conditions";
import type { CourseChoice } from "@/lib/game/config/course-choices";

const DescentGame = dynamic(() => import("./DescentGame"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-[#06080b] p-4 font-mono text-[11px] leading-5 text-[#7f8b99]" role="status" aria-live="polite">
      <p>:: PEAKCAM DROP IN // loading the runtime…</p>
    </div>
  ),
});

export default function DescentClientBoundary({ profile, conditions, courseChoices }: {
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
  courseChoices: readonly CourseChoice[];
}) {
  return <DescentGame profile={profile} conditions={conditions} courseChoices={courseChoices} />;
}
