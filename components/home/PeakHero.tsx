"use client";

import { useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { navLinks } from "@/components/layout/Header";

export function PeakHero() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="pc-topo relative h-screen w-full overflow-hidden">
      {/* Subtle warmth radials layered over topo */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_10%_-10%,rgba(217,85,47,0.10),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_110%_10%,rgba(60,90,58,0.12),transparent_60%)]" />
      </div>

      {/* Overlay navigation — cream text on topo, logo italic */}
      <nav className="absolute top-0 left-0 right-0 z-20 px-6 md:px-8 py-5 flex items-center justify-between">
        <Link href="/" className="font-display italic font-black text-[26px] md:text-[30px] tracking-tight leading-none">
          <span className="text-ink">Peak</span>
          <span className="text-alpen">Cam</span>
        </Link>
        <div className="hidden md:flex items-center gap-2">
          {navLinks.filter(l => !l.authOnly).map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="text-ink/80 hover:text-ink font-semibold text-[14px] px-3 py-1.5 rounded-full hover:bg-ink/5 transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/auth"
            className="ml-2 bg-forest text-cream-50 font-bold text-[14px] border-[1.5px] border-ink
              rounded-full px-5 py-2 shadow-stamp
              hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp-hover
              active:translate-x-[2px] active:translate-y-[2px] active:shadow-stamp-sm
              transition-transform duration-100"
          >
            Sign In
          </Link>
        </div>
        <button
          className="md:hidden text-ink p-2"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div className="absolute top-[72px] left-4 right-4 bg-cream-50 border-[1.5px] border-ink rounded-2xl shadow-stamp p-3 flex flex-col gap-1 md:hidden z-20">
          {navLinks.filter(l => !l.authOnly).map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="px-4 py-3 rounded-full text-sm font-semibold text-ink hover:bg-ink/5 transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/auth"
            className="mt-1 px-4 py-3 rounded-full text-sm font-bold text-center bg-forest text-cream-50 border-[1.5px] border-ink shadow-stamp-sm"
            onClick={() => setMenuOpen(false)}
          >
            Sign In
          </Link>
        </div>
      )}

      {/* Content — massive Fraunces headline with italic alpen accent */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0.3, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="text-center max-w-5xl"
        >
          {/* Eyebrow tag */}
          <motion.div
            className="inline-block mb-6 px-4 py-1.5 bg-ink text-cream-50 rounded-full font-mono font-bold text-[11px] tracking-[0.16em] uppercase"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            Est. 2025 · 128 Resorts
          </motion.div>

          <h1 className="font-display font-black text-[26vw] sm:text-[22vw] md:text-[18vw] lg:text-[15rem] xl:text-[18rem] leading-[0.88] tracking-[-0.03em] mb-4">
            <span className="text-ink">Peak</span>
            <span className="text-alpen italic font-bold">Cam</span>
          </h1>

          <motion.p
            className="font-display italic font-bold text-2xl md:text-4xl text-bark-dk mb-4 tracking-tight"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
          >
            Got the goods?
          </motion.p>

          <motion.p
            className="text-base md:text-lg text-bark font-medium mb-12 max-w-xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
          >
            Live webcams + real-time snow reports for 128+ ski resorts across North America.
            No marketing noise. Just the mountain.
          </motion.p>

          <motion.a
            href="#conditions"
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-alpen text-cream-50 border-[1.5px] border-ink
              rounded-full shadow-stamp font-bold text-[15px] tracking-wide
              hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp-hover
              active:translate-x-[2px] active:translate-y-[2px] active:shadow-stamp-sm
              transition-transform duration-100"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
          >
            Check Conditions &rarr;
          </motion.a>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-bark"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </motion.div>
    </div>
  );
}
