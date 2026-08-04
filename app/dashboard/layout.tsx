import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/dashboard/page.tsx is a "use client" component and can't export
// metadata itself — this layout is the only place to attach it. Personalized
// per-user widget layout, never indexable.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
