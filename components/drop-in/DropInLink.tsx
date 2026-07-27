"use client";

import Link from "next/link";
import { Mountain } from "lucide-react";
import { getDropInHref, getDropInProfile } from "@/lib/drop-in";

interface DropInLinkProps {
  slug: string;
  /**
   * `pill` is the compact desktop-popup treatment; `block` is the full-width
   * mobile sheet treatment. Both are the same control, sized for their card.
   */
  variant?: "pill" | "block";
  className?: string;
}

/**
 * The Drop In entry point, shared by the desktop map popup and the mobile
 * bottom sheet so the two can't drift. Renders nothing for resorts outside the
 * pilot — callers don't need to guard, though the map cards do anyway to keep
 * their layout honest.
 *
 * Deliberately loud: alpenglow fill against the cards' cream/ink, so it never
 * reads as a second "View resort".
 */
export default function DropInLink({
  slug,
  variant = "pill",
  className = "",
}: DropInLinkProps) {
  const href = getDropInHref(slug);
  const profile = getDropInProfile(slug);
  if (!href || !profile) return null;

  const base =
    "group inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-ink " +
    "bg-alpen text-cream-50 font-bold uppercase tracking-[0.06em] shadow-stamp-sm " +
    "hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-cream-50 transition-[transform,box-shadow] duration-100";

  const sizing =
    variant === "block"
      ? "w-full px-4 py-2.5 text-sm"
      : "w-full px-3 py-2 text-[12px]";

  return (
    <Link
      href={href}
      className={`${base} ${sizing} ${className}`}
      aria-label={`Drop In — ski ${profile.name} in an arcade descent`}
    >
      <Mountain className="h-4 w-4 shrink-0" aria-hidden />
      <span>Drop In</span>
      <span
        className="font-mono text-[9.5px] font-bold tracking-[0.12em] opacity-80"
        aria-hidden
      >
        BETA
      </span>
    </Link>
  );
}
