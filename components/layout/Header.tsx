"use client";
import Link from "next/link";
import { BugReportButton } from "@/components/feedback/BugReportProvider";
import { recordBugAction } from "@/lib/bug-reports/client";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";
import { Menu, X, Search } from "lucide-react";
import { isDropInEnabled } from "@/lib/drop-in";
import { EVENTS, track } from "@/lib/analytics-events";

interface HeaderProps {
  onSearch?: (query: string) => void;
  showSearch?: boolean;
  searchValue?: string;
}

export const navLinks = [
  { label: "Resorts",     href: "/" },
  { label: "Map",         href: "/map" },
  { label: "Compare",     href: "/compare" },
  { label: "Snow Report", href: "/snow-report" },
  { label: "Webcams",     href: "/ski-cams" },
  ...(isDropInEnabled() ? [{ label: "Drop In", href: "/drop-in", hideBelowXl: true }] : []),
  { label: "Favorites",   href: "/favorites", authOnly: true },
  { label: "My Peak",     href: "/dashboard", authOnly: true },
  { label: "About",       href: "/about", hideBelowXl: true },
];

export function Header({ onSearch, showSearch = true, searchValue }: HeaderProps) {
  const pathname = usePathname();
  // The account CTA has to be unambiguous at every width: the primary link
  // opens signup mode, the secondary one keeps returning users on sign-in.
  // Query params are built with URLSearchParams so the ordering is stable.
  const authHref = (mode?: "signup") => {
    const query = new URLSearchParams();
    if (pathname && pathname !== "/") query.set("next", pathname);
    if (mode) query.set("mode", mode);
    const suffix = query.toString();
    return suffix ? `/auth?${suffix}` : "/auth";
  };
  const signInHref = authHref();
  const signUpHref = authHref("signup");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setUser(data.user ?? null);
        setAuthLoaded(true);
      })
      .catch(() => setAuthLoaded(true));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setAuthLoaded(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setIsMenuOpen(false); menuButton.current?.focus(); }
    };
    const outside = (event: PointerEvent) => { if (!headerRef.current?.contains(event.target as Node)) setIsMenuOpen(false); };
    const focusOutside = (event: FocusEvent) => { if (!headerRef.current?.contains(event.target as Node)) setIsMenuOpen(false); };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", focusOutside); };
  }, [isMenuOpen]);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    recordBugAction("search-edited");
    setQuery(e.target.value);
    onSearch?.(e.target.value);
  }

  // Without an `onSearch` prop there is no local list to filter (only the home
  // page holds the resort data), so submitting hands the query to the home
  // page's search via ?q=.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (onSearch) return;
    const q = query.trim();
    if (!q) return;
    router.push(`/?q=${encodeURIComponent(q)}`);
  }

  function clearSearch() {
    recordBugAction("search-cleared");
    setQuery("");
    onSearch?.("");
    inputRef.current?.focus();
  }

  return (
    /* pc-on-ink — the header surface is ink, so the global ember
       :focus-visible ring (3.1:1 on ink) is upgraded to the cream ring
       (14.7:1 on ink) by the rule in app/globals.css. */
    <header ref={headerRef} className="pc-on-ink sticky top-0 z-50 h-[64px] flex items-center gap-2 px-4 sm:gap-5 sm:px-6 md:px-7
      bg-ink text-cream-50 border-b-[1.5px] border-ink">

      {/* Logo — Fraunces display, italic, PEAK cream + CAM alpen */}
      <Link href="/" className="flex items-center flex-shrink-0 group">
        <span className="font-display italic font-black text-[20px] tracking-tight leading-none group-hover:opacity-90 transition-opacity duration-150 sm:text-[22px]">
          <span className="text-cream-50">Peak</span>
          <span className="text-alpen">Cam</span>
        </span>
      </Link>

      {/* Search — cream bg, ink border, stamp shadow, pill radius */}
      {showSearch && (
        <form
          role="search"
          onSubmit={handleSubmit}
          className="flex-1 max-w-[420px] relative hidden sm:block"
        >
          <Search size={15} strokeWidth={2.5}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-bark pointer-events-none" />
          {/* 16px base font keeps iOS Safari from zooming the viewport on focus;
              no `outline-none` — the focus shadow alone isn't a reliable focus
              indicator (forced-colors mode drops box-shadows entirely). */}
          <input
            ref={inputRef}
            type="text"
            value={searchValue ?? query}
            onChange={handleChange}
            aria-label="Search resorts"
            placeholder="Search resorts, states, regions…"
            className="w-full bg-cream-50 border-[1.5px] border-ink
              rounded-full shadow-[2px_2px_0_#2a1f14]
              pl-10 pr-9 py-2 text-[16px] md:text-[13.5px] text-ink placeholder:text-bark
              transition-shadow duration-100
              focus:shadow-[3px_3px_0_#a93f20] focus:border-alpen-dk"
          />
          {(searchValue ?? query) && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-bark
                text-lg px-1 hover:text-ink transition-colors duration-150"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
          <button type="submit" className="sr-only">Search</button>
        </form>
      )}

      {/* Desktop Nav — `lg`, not `md`: at 768px (iPad portrait) the search
          pill + links + two account actions overflowed. The less essential
          links (About, Drop In) only join at xl, so 1024px keeps "Sign in"
          and "Create free account" fully visible with no sideways scroll. */}
      <nav className="hidden lg:flex items-center gap-1 ml-auto flex-shrink-0">
        {navLinks.filter((link) => !("authOnly" in link && link.authOnly) || user).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`
              px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap
              tracking-wide
              transition-colors duration-150
              ${"hideBelowXl" in link && link.hideBelowXl ? "hidden xl:inline-flex" : ""}
              ${pathname === link.href
                ? "text-alpen"
                : "text-cream-50/80 hover:text-cream-50 hover:bg-cream-50/10"}
            `}
          >
            {link.label}
          </Link>
        ))}

        <BugReportButton compact className="hidden lg:inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-cream-50/10" />
        {/* Auth — primary signup, secondary returning-user sign-in. */}
        {user ? (
          <Link
            href="/account"
            className="ml-1 px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap
              text-cream-50/80 hover:text-cream-50 hover:bg-cream-50/10 transition-colors duration-150"
            title={user.email ?? "Signed in"}
          >
            Account
          </Link>
        ) : (
          <div className="ml-1 flex items-center gap-1">
            <Link
              href={signInHref}
              onClick={() => track(EVENTS.ACCOUNT_CTA_CLICKED, { source: "header", surface: "desktop", intent: "sign_in" })}
              className="px-2.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap
                text-cream-50/80 hover:text-cream-50 hover:bg-cream-50/10 transition-colors duration-150"
              title="Sign in to your existing PeakCam account"
            >
              Sign in
            </Link>
            <Link
              href={signUpHref}
              onClick={() => track(EVENTS.ACCOUNT_CTA_CLICKED, { source: "header", surface: "desktop", intent: "create_account" })}
              className="px-3 py-1.5 rounded-full text-[13px] font-bold whitespace-nowrap
                bg-alpen-dk text-cream-50 border-[1.5px] border-ink
                shadow-[2px_2px_0_#faf4e6] hover:shadow-[3px_3px_0_#faf4e6]
                hover:-translate-x-[1px] hover:-translate-y-[1px]
                active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#faf4e6]
                transition-all duration-100"
              title="Create a free account to save your mountains"
            >
              Create free account
            </Link>
          </div>
        )}
      </nav>

      {/* Mobile account actions. Signed out, the primary signup entry stays
          visible beside the menu at every phone width; sign-in remains one tap
          away inside the menu. Signed in, the menu keeps Account settings and
          Sign out, exactly as before. */}
      <div className="ml-auto flex shrink-0 items-center gap-1 lg:hidden">
        {authLoaded && !user && (
          <Link
            href={signUpHref}
            onClick={() =>
              track(EVENTS.ACCOUNT_CTA_CLICKED, { source: "header", surface: "mobile_header", intent: "create_account" })
            }
            className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border-[1.5px] border-cream-50
              bg-alpen-dk px-2.5 text-[11.5px] font-bold text-cream-50
              shadow-[2px_2px_0_#faf4e6] hover:shadow-[3px_3px_0_#faf4e6]
              hover:-translate-x-[1px] hover:-translate-y-[1px]
              active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#faf4e6]
              transition-all duration-100 sm:px-3 sm:text-[13px]"
            title="Create a free account to save your mountains"
          >
            Create free account
          </Link>
        )}
        <button
          ref={menuButton} aria-expanded={isMenuOpen} aria-controls="mobile-navigation"
          className="min-h-11 min-w-11 p-2 text-cream-50/80 hover:text-cream-50"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Toggle menu"
        >
          {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <nav id="mobile-navigation" aria-label="Main navigation" className="max-h-[calc(100dvh-64px)] overflow-y-auto overscroll-contain absolute top-[64px] left-0 right-0 bg-ink border-b-[1.5px] border-ink shadow-lg p-4 flex flex-col gap-1 lg:hidden">
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

          <BugReportButton className="flex min-h-11 items-center px-3 text-sm font-semibold" />
          <div className="h-px bg-cream-50/15 my-2" />

          {user ? (<>
            <Link href="/account" className="px-4 py-3 rounded-full text-sm font-semibold text-cream-50 hover:bg-cream-50/10">Account settings</Link>
            <button
              onClick={() => { handleSignOut(); setIsMenuOpen(false); }}
              className="px-4 py-3 rounded-full break-words text-sm font-semibold text-left text-cream-50/80 hover:bg-cream-50/10"
            >
              Sign out ({user.email})
            </button></>
          ) : (
            <Link
              href={signInHref}
              onClick={() => {
                track(EVENTS.ACCOUNT_CTA_CLICKED, { source: "header", surface: "mobile_menu", intent: "sign_in" });
                setIsMenuOpen(false);
              }}
              className="min-h-11 rounded-full border-[1.5px] border-cream-50 px-4 py-3 text-center text-sm font-bold
                text-cream-50 hover:bg-cream-50/10"
              title="Sign in to your existing PeakCam account"
            >
              Sign in
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
