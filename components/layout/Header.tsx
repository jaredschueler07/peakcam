"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";
import { Menu, X, Search } from "lucide-react";

interface HeaderProps {
  onSearch?: (query: string) => void;
  showSearch?: boolean;
}

export const navLinks = [
  { label: "Resorts",     href: "/" },
  { label: "Map",         href: "/map" },
  { label: "Compare",     href: "/compare" },
  { label: "Snow Report", href: "/snow-report" },
  { label: "Favorites",   href: "/favorites", authOnly: true },
  { label: "My Peak",     href: "/dashboard", authOnly: true },
  { label: "About",       href: "/about" },
];

export function Header({ onSearch, showSearch = true }: HeaderProps) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    onSearch?.(e.target.value);
  }

  function clearSearch() {
    setQuery("");
    onSearch?.("");
    inputRef.current?.focus();
  }

  return (
    <header className="sticky top-0 z-50 h-[64px] flex items-center gap-5 px-6 md:px-7
      bg-ink text-cream-50 border-b-[1.5px] border-ink">

      {/* Logo — Fraunces display, italic, PEAK cream + CAM alpen */}
      <Link href="/" className="flex items-center flex-shrink-0 group">
        <span className="font-display italic font-black text-[22px] tracking-tight leading-none group-hover:opacity-90 transition-opacity duration-150">
          <span className="text-cream-50">Peak</span>
          <span className="text-alpen">Cam</span>
        </span>
      </Link>

      {/* Search — cream bg, ink border, stamp shadow, pill radius */}
      {showSearch && (
        <div className="flex-1 max-w-[420px] relative hidden sm:block">
          <Search size={15} strokeWidth={2.5}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-bark pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            placeholder="Search resorts, states, regions…"
            className="w-full bg-cream-50 border-[1.5px] border-ink
              rounded-full shadow-[2px_2px_0_#2a1f14]
              pl-10 pr-9 py-2 text-[13.5px] text-ink placeholder:text-bark
              outline-none transition-shadow duration-100
              focus:shadow-[3px_3px_0_#a93f20] focus:border-alpen-dk"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-bark
                text-lg px-1 hover:text-ink transition-colors duration-150"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Desktop Nav */}
      <nav className="hidden md:flex items-center gap-1 ml-auto flex-shrink-0">
        {navLinks.filter((link) => !("authOnly" in link && link.authOnly) || user).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`
              px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap
              tracking-wide
              transition-colors duration-150
              ${pathname === link.href
                ? "text-alpen"
                : "text-cream-50/80 hover:text-cream-50 hover:bg-cream-50/10"}
            `}
          >
            {link.label}
          </Link>
        ))}

        {/* Auth */}
        {user ? (
          <button
            onClick={handleSignOut}
            className="ml-1 px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap
              text-cream-50/80 hover:text-cream-50 hover:bg-cream-50/10 transition-colors duration-150"
            title={user.email ?? "Signed in"}
          >
            Sign out
          </button>
        ) : (
          <Link
            href={`/auth?next=${encodeURIComponent(pathname)}`}
            className="ml-2 px-4 py-1.5 rounded-full text-[13px] font-bold whitespace-nowrap
              bg-alpen text-cream-50 border-[1.5px] border-ink
              shadow-[2px_2px_0_#faf4e6] hover:shadow-[3px_3px_0_#faf4e6]
              hover:-translate-x-[1px] hover:-translate-y-[1px]
              active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#faf4e6]
              transition-all duration-100"
            title="Sign in to save favorites, set powder alerts, and submit reports"
          >
            Sign in
          </Link>
        )}
      </nav>

      {/* Mobile Menu Toggle */}
      <button
        className="md:hidden ml-auto p-2 text-cream-50/80 hover:text-cream-50 flex-shrink-0"
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        aria-label="Toggle menu"
      >
        {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="absolute top-[64px] left-0 right-0 bg-ink border-b-[1.5px] border-ink shadow-lg p-4 flex flex-col gap-1 md:hidden">
          {navLinks.filter((link) => !("authOnly" in link && link.authOnly) || user).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`
                px-4 py-3 rounded-full text-sm font-semibold
                ${pathname === link.href
                  ? "text-alpen bg-cream-50/10"
                  : "text-cream-50 hover:bg-cream-50/10"}
              `}
            >
              {link.label}
            </Link>
          ))}

          <div className="h-px bg-cream-50/15 my-2" />

          {user ? (
            <button
              onClick={() => { handleSignOut(); setIsMenuOpen(false); }}
              className="px-4 py-3 rounded-full text-sm font-semibold text-left text-cream-50/80 hover:bg-cream-50/10"
            >
              Sign out ({user.email})
            </button>
          ) : (
            <Link
              href={`/auth?next=${encodeURIComponent(pathname)}`}
              className="px-4 py-3 rounded-full text-sm font-bold text-center
                bg-alpen text-cream-50 border-[1.5px] border-cream-50
                shadow-[2px_2px_0_#faf4e6]"
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
