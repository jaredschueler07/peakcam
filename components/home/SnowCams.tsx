"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Snowflake, Play } from "lucide-react";
import type { Cam, ResortWithData } from "@/lib/types";

interface SnowCam {
  cam: Cam;
  resort: ResortWithData;
}

interface SnowCamsProps {
  snowCams: SnowCam[];
}

// "Snowing now" — paper strip, alpen snowflake badge, stamped cam cards
export function SnowCams({ snowCams }: SnowCamsProps) {
  const [loadedCams, setLoadedCams] = useState<Set<string>>(new Set());

  if (snowCams.length === 0) return null;

  const handleLoad = (id: string) => {
    setLoadedCams((prev) => new Set(prev).add(id));
  };

  return (
    <section className="relative py-16 px-6 bg-cream">
      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-full
                             bg-alpen text-cream-50 border-[1.5px] border-ink shadow-stamp-sm">
              <Snowflake size={20} strokeWidth={2.25} />
            </span>
            <div>
              <div className="pc-eyebrow" style={{ color: "var(--pc-bark)" }}>
                Right now
              </div>
              <h2 className="font-display font-black text-3xl md:text-4xl text-ink leading-[0.95] tracking-[-0.02em]">
                Snowing <em className="text-alpen italic font-bold">now</em>.
              </h2>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                          bg-ink text-cream-50 border-[1.5px] border-ink shadow-stamp-sm">
            <span className="w-2 h-2 bg-alpen rounded-full animate-pulse-live" />
            <span className="font-mono font-bold text-[11px] uppercase tracking-[0.14em]">
              {snowCams.length} {snowCams.length === 1 ? "resort" : "resorts"}
            </span>
          </div>
        </div>

        {/* Cam grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {snowCams.slice(0, 6).map(({ cam, resort }) => (
            <SnowCamCard
              key={cam.id}
              cam={cam}
              resort={resort}
              isLoaded={loadedCams.has(cam.id)}
              onLoad={() => handleLoad(cam.id)}
            />
          ))}
        </div>

        {/* Show more caption */}
        {snowCams.length > 6 && (
          <div className="text-center mt-6">
            <span className="font-mono text-[12px] text-bark uppercase tracking-[0.12em]">
              + {snowCams.length - 6} more resorts with active snow
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function SnowCamCard({
  cam,
  resort,
  isLoaded,
  onLoad,
}: {
  cam: Cam;
  resort: ResortWithData;
  isLoaded: boolean;
  onLoad: () => void;
}) {
  const snow = resort.snow_report;

  const embedSrc =
    cam.embed_type === "youtube" && cam.youtube_id
      ? `https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`
      : cam.embed_type === "image"
        ? cam.embed_url
        : cam.embed_url;

  const isImage = cam.embed_type === "image";

  return (
    <motion.div
      className="group relative rounded-[18px] overflow-hidden
                 bg-cream-50 border-[1.5px] border-ink shadow-stamp
                 hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]
                 transition-[transform,box-shadow] duration-150"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
    >
      {/* Cam embed */}
      <div className="relative aspect-video bg-cream border-b-[1.5px] border-ink">
        {isLoaded ? (
          isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cam.embed_url ?? ""}
              alt={cam.name}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : cam.embed_type === "link" ? null : (
            <iframe
              src={embedSrc ?? ""}
              className="w-full h-full border-0"
              allow="autoplay; encrypted-media"
              allowFullScreen
              title={cam.name}
            />
          )
        ) : (
          <button
            onClick={onLoad}
            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-2
                       hover:bg-ink/5 transition-colors"
          >
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-full
                             bg-alpen text-cream-50 border-[1.5px] border-ink shadow-stamp-sm
                             group-hover:shadow-stamp transition-shadow">
              <Play className="w-5 h-5 ml-0.5" />
            </span>
            <span className="font-mono text-[11px] text-bark uppercase tracking-[0.14em]">Load cam</span>
          </button>
        )}

        {/* SNOWING badge — alpen stamp */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-0.5
                        bg-alpen text-cream-50 border-[1.5px] border-ink rounded-full
                        shadow-[2px_2px_0_#2a1f14] font-bold text-[11px] uppercase tracking-[0.14em]">
          <Snowflake size={11} strokeWidth={2.5} />
          Snowing
        </div>

        {/* Live indicator */}
        {isLoaded && (
          <div className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5
                          bg-ink text-cream-50 border-[1.5px] border-ink rounded-full">
            <span className="w-1.5 h-1.5 bg-alpen rounded-full animate-pulse-live" />
            <span className="font-mono font-bold text-[10px] uppercase tracking-[0.14em]">Live</span>
          </div>
        )}
      </div>

      {/* Info bar — cream paper footer */}
      <Link
        href={`/resorts/${resort.slug}`}
        className="block px-4 py-3 bg-cream-50 hover:bg-cream transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display font-black text-ink text-[17px] leading-tight truncate">
              {resort.name}
            </h3>
            <p className="font-mono text-[10.5px] text-bark uppercase tracking-[0.1em] mt-0.5 truncate">
              {cam.name} · {resort.state}
            </p>
          </div>
          <div className="text-right shrink-0">
            {snow && snow.new_snow_24h != null && snow.new_snow_24h > 0 && (
              <div className="font-display font-black text-alpen text-lg leading-none tabular-nums">
                {snow.new_snow_24h}″
              </div>
            )}
            {snow && snow.base_depth != null && (
              <div className="font-mono text-bark text-[10.5px] tabular-nums mt-0.5">
                {snow.base_depth}″ base
              </div>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
