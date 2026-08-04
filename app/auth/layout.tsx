import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/auth/page.tsx is a "use client" component and can't export metadata
// itself — this layout is the only place to attach it. Sign-in/sign-up
// forms shouldn't be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
