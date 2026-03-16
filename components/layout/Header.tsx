"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef } from "react";

interface HeaderProps {
  onSearch?: (query: string) => void;
  showSearch?: boolean;
}

const navLinks = [
  { label: "Resorts",     href: "/" },
  { label: "Snow Report", href: "/snow-report" },
  { label: "About",       href: "/about" },
];

export function Header({ onSearch, showSearch = true }: HeaderProps) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    <header className="sticky top-0 z-50 h-[60px] flex items-center gap-5 px-7
      bg-bg/88 backdrop-blur-md border-b border-border">

      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 flex-shrink-0 group">
        <div className="w-[30px] h-[30px] rounded-lg flex items-center justify-center
          text-[15px] flex-shrink-0
          bg-gradient-to-br from-blue-500 to-cyan-400
          shadow-[0_0_12px_rgba(34,211,238,0.35)]
          transition-opacity duration-150 group-hover:opacity-85">
          ⛰
        </div>
        <span className="text-[17px] font-extrabold tracking-[-0.6px] text-text-base">
          Peak<span className="text-cyan">Cam</span>
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
              focus:border-cyan focus:bg-surface3 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.1)]"
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
                ? "text-text-base bg-surface3"
                : "text-text-muted hover:text-text-subtle hover:bg-surface2"}
            `}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
