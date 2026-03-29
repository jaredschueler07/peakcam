import { Mountain } from "lucide-react";
import Link from "next/link";

export function PeakFooter() {
  return (
    <footer className="relative bg-bg border-t border-border py-12 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Mountain className="text-cyan" size={32} />
              <span className="text-3xl font-display text-text-base">
                PEAKCAM
              </span>
            </div>
            <p className="text-text-subtle text-sm leading-relaxed max-w-md">
              Real-time ski resort conditions, webcams, and snow reports for
              serious skiers and snowboarders. No marketing noise.
            </p>
            {/* Social links */}
            <div className="flex items-center gap-3 mt-4">
              <a
                href="https://instagram.com/peakcam.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-cyan transition-colors duration-[220ms]"
                aria-label="Follow PeakCam on Instagram"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="5" />
                  <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a
                href="https://x.com/peakcam_io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-cyan transition-colors duration-[220ms]"
                aria-label="Follow PeakCam on X"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-text-base uppercase text-sm tracking-widest mb-4">
              Resources
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Resorts
                </Link>
              </li>
              <li>
                <Link
                  href="/snow-report"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Snow Reports
                </Link>
              </li>
              <li>
                <Link
                  href="/compare"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Compare
                </Link>
              </li>
              <li>
                <Link
                  href="/map"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Map
                </Link>
              </li>
              <li>
                <Link
                  href="/alerts/manage"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Powder Alerts
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-text-base uppercase text-sm tracking-widest mb-4">
              Company
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/about"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  About
                </Link>
              </li>
              <li>
                <Link
                  href="/about#privacy"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/about#terms"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <a
                  href="mailto:hello@peakcam.io"
                  className="text-text-subtle hover:text-cyan transition-colors duration-base text-sm"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-border">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-text-muted text-sm">
              &copy; {new Date().getFullYear()} PeakCam. Data updated every 5
              minutes.
            </p>
            <Link
              href="/alerts/manage"
              className="text-cyan hover:text-cyan/80 transition-colors duration-[220ms] text-sm font-medium"
            >
              Get powder alerts &rarr;
            </Link>
            <p className="text-text-muted text-xs">
              Conditions subject to change. Always check with resort before
              heading out.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
