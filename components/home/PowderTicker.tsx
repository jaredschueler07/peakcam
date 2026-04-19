"use client";

interface PowderAlert {
  name: string;
  snow24h: number;
}

interface PowderTickerProps {
  alerts: PowderAlert[];
}

// Poster ticker: ink bar, alpen eyebrow, mono data
export function PowderTicker({ alerts }: PowderTickerProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="relative bg-ink text-cream-50 border-y-[1.5px] border-ink py-3 overflow-hidden">
      <div className="flex items-center gap-8">
        {/* Pow day label */}
        <div className="flex items-center gap-3 px-6 shrink-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-alpen opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-alpen" />
            </span>
            <span className="font-display font-black italic text-[18px] text-alpen tracking-[-0.01em]">
              Pow day
            </span>
            <span className="font-mono font-bold text-[10px] uppercase tracking-[0.18em] text-cream-50/70">
              · live
            </span>
          </div>
        </div>

        {/* Scrolling ticker — duplicated for seamless loop */}
        <div className="flex-1 overflow-hidden">
          <div className="flex gap-6 whitespace-nowrap animate-ticker">
            {[...alerts, ...alerts].map((alert, index) => (
              <div key={index} className="flex items-center gap-2 shrink-0">
                <span className="text-alpen text-lg leading-none">&#10052;</span>
                <span className="font-semibold text-cream-50 text-[14px]">{alert.name}</span>
                <span className="font-mono font-bold text-alpen text-[13px] tabular-nums">
                  +{alert.snow24h}&quot;
                </span>
                <span className="font-mono text-cream-50/40 text-[11px]">·</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
