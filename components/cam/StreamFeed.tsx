"use client";
import { useEffect, useState } from "react";
import { brownriceCamera, type FeedState } from "@/lib/cam-status/brownrice";
import { recordBugAction } from "@/lib/bug-reports/client";

export function StreamFeed({ id, url, name, resortUrl }: { id: string; url: string; name: string; resortUrl?: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FeedState | "checking">("checking");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [trouble, setTrouble] = useState(false);
  const [manualRetry, setManualRetry] = useState(false);
  const isBrownrice = Boolean(brownriceCamera(url));
  const safeResort = resortUrl?.startsWith("https://") ? resortUrl : null;
  useEffect(() => {
    if (!isBrownrice) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let current = true;
    fetch(`/api/cams/${id}/status`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json();
      if (!current) return;
      setState(["available", "unavailable", "unknown"].includes(result.state) ? result.state : "unknown");
      setCheckedAt(typeof result.checkedAt === "string" && Number.isFinite(Date.parse(result.checkedAt)) ? result.checkedAt : null);
      if (result.state === "unavailable") recordBugAction("resource-error", { cameraId: id });
    }).catch(() => { if (current) setState("unknown"); }).finally(() => clearTimeout(timer));
    return () => { current = false; controller.abort(); clearTimeout(timer); };
  }, [id, attempt, isBrownrice]);
  const retry = () => { setManualRetry(true); setTrouble(false); setState("checking"); setCheckedAt(null); setAttempt(value => value + 1); };
  // An explicit retry may try playback even while an earlier cached probe says down.
  const failed = trouble || (state === "unavailable" && !manualRetry);
  return <>
    {!failed && <iframe key={attempt} src={url} title={name} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen onError={() => setTrouble(true)} className="absolute inset-0 w-full h-full border-0" />}
    {failed ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink px-4 py-8 text-center text-cream-50" role="status">
      <p className="text-base font-bold">{state === "unavailable" ? "Camera unavailable" : "Camera not playing?"}</p>
      <p className="text-xs">{state === "unavailable" ? "The camera operator’s stream is unavailable." : "Try reloading the player or checking the resort’s cameras."}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={retry} className="min-h-11 rounded-full border border-cream-50 px-4 text-sm font-bold">Retry camera</button>
        {safeResort && <a href={safeResort} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-cream-50 px-4 text-sm font-bold text-ink">Resort cameras ↗</a>}
      </div>
      {checkedAt && <p className="text-[10px]">Stream checked {new Date(checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Not a capture time</p>}
    </div> : <div className="absolute bottom-2 left-2 z-10 max-w-[calc(100%-4rem)]">
      <button type="button" onClick={() => setTrouble(true)} className="min-h-11 rounded-full border border-cream-50/70 bg-ink/90 px-3 text-xs font-bold text-cream-50">Camera not playing?</button>
    </div>}
  </>;
}
