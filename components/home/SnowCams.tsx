"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Snowflake, Camera, Play } from "lucide-react";
import type { Cam, ResortWithData } from "@/lib/types";

interface SnowCam {
  cam: Cam;
  resort: ResortWithData;
}

interface SnowCamsProps {
  snowCams: SnowCam[];
}

export function SnowCams({ snowCams }: SnowCamsProps) {
  const [loadedCams, setLoadedCams] = useState<Set<string>>(new Set());

  if (snowCams.length === 0) return null;

  const handleLoad = (id: string) => {
    setLoadedCams((prev) => new Set(prev).add(id));
  };

  return (
    <section className="relative py-16 px-6 bg-gradient-to-b from-bg via-surface/30 to-bg">
      {/* Background watermark */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
        <span className="text-[10rem] md:text-[16rem] font-display text-text-base opacity-[0.02] select-none whitespace-nowrap">
          SNOWING NOW
        </span>
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan/10 border border-cyan/30 rounded-lg">
              <Snowflake className="text-cyan" size={24} />
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-display text-text-base">
                SNOWING NOW
              </h2>
              <p className="text-text-muted text-sm mt-0.5">
                Live cams from resorts with active snowfall
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan/10 border border-cyan/30 rounded-full">
            <div className="w-2 h-2 bg-cyan rounded-full animate-pulse" />
            <span className="text-cyan text-xs font-semibold">
              {snowCams.length} {snowCams.length === 1 ? "resort" : "resorts"}
            </span>
          </div>
        </div>

        {/* Cam grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

        {/* Show more link */}
        {snowCams.length > 6 && (
          <div className="text-center mt-6">
            <span className="text-text-muted text-sm">
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

  // Build embed src
  const embedSrc =
    cam.embed_type === "youtube" && cam.youtube_id
      ? `https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`
      : cam.embed_type === "image"
        ? cam.embed_url
        : cam.embed_url;

  const isImage = cam.embed_type === "image";

  return (
    <motion.div
      className="group relative rounded-xl overflow-hidden border border-cyan/20 hover:border-cyan/50 transition-all duration-300"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
    >
      {/* Cam embed */}
      <div className="relative aspect-video bg-surface2">
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
            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-colors"
          >
            <div className="w-12 h-12 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center group-hover:bg-cyan/20 transition-all">
              <Play className="w-5 h-5 text-cyan ml-0.5" />
            </div>
            <span className="text-text-muted text-xs">Load cam</span>
          </button>
        )}

        {/* SNOWING badge */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 bg-cyan/20 backdrop-blur-sm border border-cyan/40 rounded-full">
          <Snowflake size={12} className="text-cyan" />
          <span className="text-cyan text-[10px] font-bold uppercase tracking-wider">Snowing</span>
        </div>

        {/* Live indicator */}
        {isLoaded && (
          <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 bg-surface/80 backdrop-blur-sm rounded-full">
            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-text-base text-[10px] font-semibold">LIVE</span>
          </div>
        )}
      </div>

      {/* Info bar */}
      <Link
        href={`/resorts/${resort.slug}`}
        className="block px-3 py-2.5 bg-surface border-t border-border hover:bg-surface2 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-text-base text-sm font-semibold">{resort.name}</h3>
            <p className="text-text-muted text-xs mt-0.5">{cam.name} · {resort.state}</p>
          </div>
          <div className="text-right">
            {snow && snow.new_snow_24h != null && snow.new_snow_24h > 0 && (
              <div className="text-cyan text-sm font-bold">{snow.new_snow_24h}″</div>
            )}
            {snow && snow.base_depth != null && (
              <div className="text-text-muted text-xs">{snow.base_depth}″ base</div>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
