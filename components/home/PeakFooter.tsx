import { Mountain } from "lucide-react";
import Link from "next/link";

// Poster footer — ink bar on cream paper, Fraunces wordmark with alpen italic CAM,
// dashed bark rules between sections, mono caption row.
export function PeakFooter() {
  return (
    <footer className="relative bg-cream border-t-[1.5px] border-ink pt-14 pb-10 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-ink border-[1.5px] border-ink shadow-stamp-sm">
                <Mountain className="text-alpen" size={22} strokeWidth={2.25} />
              </span>
              <span className="font-display font-black text-4xl tracking-[-0.02em] text-ink">
                Peak<em className="text-alpen italic font-bold">Cam</em>
              </span>
            </div>
            <p className="text-ink/80 text-[15px] leading-relaxed max-w-md">
              Real-time ski resort conditions, webcams, and snow reports for
              skiers and riders who&rsquo;d rather be on the hill than reading marketing copy.
              <span className="block mt-2 font-display italic text-bark">The lift&rsquo;s spinning somewhere.</span>
            </p>

            {/* Social links */}
            <div className="flex items-center gap-3 mt-5">
              <a
                href="https://instagram.com/peakcam.io"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-10 h-10 rounded-full
                           bg-cream-50 border-[1.5px] border-ink text-ink shadow-stamp-sm
                           hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                           transition-[transform,box-shadow] duration-100"
                aria-label="Follow PeakCam on Instagram"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="5" />
                  <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a
                href="https://x.com/peakcam_io"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-10 h-10 rounded-full
                           bg-cream-50 border-[1.5px] border-ink text-ink shadow-stamp-sm
                           hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                           transition-[transform,box-shadow] duration-100"
                aria-label="Follow PeakCam on X"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Resources */}
          <div>
            <h4 className="pc-eyebrow mb-4">Resources</h4>
            <ul className="space-y-2.5">
              {[
                { href: "/", label: "Resorts" },
                { href: "/snow-report", label: "Snow reports" },
                { href: "/compare", label: "Compare" },
                { href: "/map", label: "Map" },
                { href: "/alerts/manage", label: "Powder alerts" },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-ink/80 hover:text-alpen transition-colors duration-150 text-[14px] font-medium"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="pc-eyebrow mb-4">Company</h4>
            <ul className="space-y-2.5">
              {[
                { href: "/about", label: "About" },
                { href: "/about#privacy", label: "Privacy policy" },
                { href: "/about#terms", label: "Terms of service" },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-ink/80 hover:text-alpen transition-colors duration-150 text-[14px] font-medium"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href="mailto:hello@peakcam.io"
                  className="text-ink/80 hover:text-alpen transition-colors duration-150 text-[14px] font-medium"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar — dashed bark rule, mono caption */}
        <div className="pt-6 border-t-[1.5px] border-dashed border-bark">
          <div className="flex flex-col md:flex-row justify-between items-center gap-3">
            <p className="font-mono text-[11px] text-bark uppercase tracking-[0.12em]">
              &copy; {new Date().getFullYear()} PeakCam · Updated every 5 min
            </p>
            <Link
              href="/alerts/manage"
              className="inline-flex items-center gap-1.5 font-semibold text-[13px] text-alpen-dk
                         hover:text-alpen transition-colors duration-150"
            >
              Get powder alerts <span aria-hidden>→</span>
            </Link>
            <p className="font-mono text-[11px] text-bark/80 uppercase tracking-[0.1em] text-center md:text-right">
              Always check with the resort before heading out.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
