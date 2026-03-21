"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AuthModal } from "@/components/auth/AuthModal";
import type { User } from "@supabase/supabase-js";

interface HeaderProps {
  onSearch?: (query: string) => void;
  showSearch?: boolean;
}

const navLinks = [
  { label: "Resorts",     href: "/" },
  { label: "Compare",     href: "/compare" },
  { label: "Snow Report", href: "/snow-report" },
  { label: "About",       href: "/about" },
];

export function Header({ onSearch, showSearch = true }: HeaderProps) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

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
    <>
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    <header className="sticky top-0 z-50 h-[60px] flex items-center gap-5 px-7
      bg-bg/88 backdrop-blur-md border-b border-border">

      {/* Logo */}
      <Link href="/" className="flex items-center flex-shrink-0 group">
        <span className="font-heading font-bold tracking-wider text-lg text-text-base group-hover:opacity-85 transition-opacity duration-150">
          PEAK<span className="text-cyan">CAM</span>
        </span>
      </Link>

      {/* Search */}
      {showSearch && (
        <div className="flex-1 max-w-[400px] relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm pointer-events-none">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            placeholder="Search resorts, states, regions…"
            className="w-full bg-surface2 border border-border rounded-[10px]
              pl-9 pr-8 py-[9px] text-[13.5px] font-['Inter'] text-text-base
              placeholder:text-text-muted outline-none
              transition-all duration-[220ms]
              focus:border-cyan focus:bg-surface3"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted
                text-base px-1 hover:text-text-base transition-colors duration-150"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex items-center gap-0.5 ml-auto flex-shrink-0">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`
              px-3 py-1.5 rounded text-[13px] font-medium whitespace-nowrap
              transition-all duration-150
              ${pathname === link.href
                ? "text-cyan"
                : "text-text-muted hover:text-text-subtle hover:bg-surface2"}
            `}
          >
            {link.label}
          </Link>
        ))}

        {/* Auth */}
        {user ? (
          <button
            onClick={handleSignOut}
            className="ml-1 px-3 py-1.5 rounded text-[13px] font-medium whitespace-nowrap
              text-text-muted hover:text-text-subtle hover:bg-surface2 transition-all duration-150"
            title={user.email ?? "Signed in"}
          >
            Sign out
          </button>
        ) : (
          <button
            onClick={() => setShowAuthModal(true)}
            className="ml-1 px-3 py-1.5 rounded text-[13px] font-semibold whitespace-nowrap
              text-cyan border border-cyan/30 hover:bg-cyan-dim transition-all duration-150"
          >
            Sign in
          </button>
        )}
      </nav>
    </header>
    </>
  );
}
