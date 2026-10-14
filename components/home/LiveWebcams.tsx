"use client";

import { motion } from "motion/react";
import { Camera, Play } from "lucide-react";
import { useState } from "react";
import type { Cam } from "@/lib/types";

interface LiveWebcamsProps {
  cams: Cam[];
}

// Poster "Live feeds" — paper section, Fraunces headline with alpen italic, stamped cam tiles
export function LiveWebcams({ cams }: LiveWebcamsProps) {
  const [loadedCams, setLoadedCams] = useState<Set<string>>(new Set());

  if (cams.length === 0) return null;

  const handleLoadCam = (id: string) => {
    setLoadedCams((prev) => new Set(prev).add(id));
  };

  const heroCam = cams[0];
  const secondaryCams = cams.slice(1);

  return (
    <section className="relative py-20 px-6 pc-topo">
      {/* Masthead */}
      <div className="relative max-w-7xl mx-auto">
        <div className="mb-12 text-center">
          <div className="pc-eyebrow mb-3" style={{ color: "var(--pc-bark)" }}>
            Live from the mountain
          </div>
          <h2 className="font-display font-black text-5xl md:text-6xl text-ink leading-[0.95] tracking-[-0.02em]">
            Live <em className="text-alpen italic font-bold">feeds</em>.
          </h2>
          <p className="text-bark text-lg mt-3">
            Real-time conditions from 128 resorts across North America.
          </p>
        </div>

        {/* Webcam grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Hero camera — full width */}
          <div className="md:col-span-2">
            <WebcamTile
              cam={heroCam}
              isLoaded={loadedCams.has(heroCam.id)}
              onLoad={() => handleLoadCam(heroCam.id)}
              isHero
            />
          </div>

          {/* Secondary cameras */}
          {secondaryCams.map((cam) => (
            <WebcamTile
              key={cam.id}
              cam={cam}
              isLoaded={loadedCams.has(cam.id)}
              onLoad={() => handleLoadCam(cam.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function WebcamTile({
  cam,
  isLoaded,
  onLoad,
  isHero = false,
}: {
  cam: Cam;
  isLoaded: boolean;
  onLoad: () => void;
  isHero?: boolean;
}) {
  const embedSrc =
    cam.embed_type === "youtube" && cam.youtube_id
      ? `https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`
      : cam.embed_url;

  return (
    <motion.div
      className="group relative aspect-video rounded-[18px] overflow-hidden cursor-pointer
                 bg-cream-50 border-[1.5px] border-ink shadow-stamp
                 hover:shadow-stamp-hover transition-shadow duration-150"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -2, x: -1 }}
    >
      {/* Loaded state: actual embed */}
      {isLoaded && embedSrc && (
        <iframe
          src={embedSrc}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media"
          allowFullScreen
          title={cam.name}
        />
      )}

      {/* Unloaded poster overlay */}
      {!isLoaded && (
        <motion.div
          className="absolute inset-0 bg-cream flex flex-col items-center justify-center gap-4
                     bg-[image:var(--pc-grain)] bg-[length:160px_160px]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <span className="inline-flex items-center justify-center rounded-full
                         bg-cream-50 border-[1.5px] border-ink shadow-stamp-sm p-3">
            <Camera className="text-ink" size={isHero ? 40 : 32} strokeWidth={2} />
          </span>
          <div className="text-center px-4">
            <h3 className="font-display font-black text-ink text-2xl leading-tight">{cam.name}</h3>
            {cam.elevation && (
              <span className="mt-2 inline-block font-mono font-bold text-[10.5px] px-2.5 py-0.5
                               rounded-full bg-ink text-cream-50 uppercase tracking-[0.14em]">
                {cam.elevation}
              </span>
            )}
          </div>
          <button
            onClick={onLoad}
            className="inline-flex items-center gap-2 px-5 py-2.5
                       bg-alpen text-cream-50 font-semibold text-[14px]
                       rounded-full border-[1.5px] border-ink shadow-stamp
                       hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]
                       transition-[transform,box-shadow] duration-100"
          >
            <Play size={16} />
            Load live feed
          </button>
        </motion.div>
      )}

      {/* Live indicator on loaded cams — alpen stamp pill */}
      {isLoaded && (
        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-0.5
                        bg-alpen text-cream-50 border-[1.5px] border-ink rounded-full
                        shadow-[2px_2px_0_#2a1f14] font-bold text-[11px] uppercase tracking-[0.14em]">
          <span className="w-1.5 h-1.5 bg-cream-50 rounded-full animate-pulse-live" />
          Live
        </div>
      )}
    </motion.div>
  );
}
