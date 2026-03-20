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
