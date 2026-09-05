"use client";

import dynamic from "next/dynamic";
import type { ResortGameProfile } from "@/lib/game/config/schema";
import type { ConditionsSnapshot } from "@/lib/game/conditions";

import type { CourseChoice } from "@/lib/game/config/course-choices";

const DropInGame = dynamic(() => import("./DropInGame"), {
  ssr: false,
  loading: () => (
    <div className="pc-topo fixed inset-0 flex items-center justify-center bg-cream text-ink" role="status">
      <span className="pc-eyebrow">Loading Drop In…</span>
    </div>
  ),
});

export default function DropInClientBoundary({ profile, conditions, courseChoices }: {
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
  courseChoices: readonly CourseChoice[];
}) {
  return <DropInGame profile={profile} conditions={conditions} courseChoices={courseChoices} />;
}
