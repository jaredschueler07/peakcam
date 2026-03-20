"use client";

interface PowderAlert {
  name: string;
  snow24h: number;
}

interface PowderTickerProps {
  alerts: PowderAlert[];
}

export function PowderTicker({ alerts }: PowderTickerProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="relative bg-surface/90 backdrop-blur-md border-y border-border py-4 overflow-hidden">
      <div className="flex items-center gap-8">
        {/* Powder Alert Label */}
        <div className="flex items-center gap-3 px-6 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-alpenglow rounded-full animate-pulse-live" />
            <span className="font-display text-xl text-alpenglow tracking-widest">
              POWDER ALERT
            </span>
          </div>
        </div>

        {/* Scrolling ticker - duplicate content for seamless loop */}
        <div className="flex-1 overflow-hidden">
          <div className="flex gap-8 whitespace-nowrap animate-ticker">
            {[...alerts, ...alerts].map((alert, index) => (
              <div key={index} className="flex items-center gap-2 shrink-0">
                <span className="text-cyan text-2xl">&#10052;</span>
                <span className="text-text-base font-semibold">{alert.name}</span>
                <span className="text-cyan font-mono">{alert.snow24h}&quot; NEW</span>
                {index < alerts.length * 2 - 1 && (
                  <span className="text-text-muted">&bull;</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
