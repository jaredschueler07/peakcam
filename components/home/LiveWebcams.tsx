"use client";

import { motion } from "motion/react";
import { Camera, Play } from "lucide-react";
import { useState } from "react";
import type { Cam } from "@/lib/types";

interface LiveWebcamsProps {
  cams: Cam[];
}

export function LiveWebcams({ cams }: LiveWebcamsProps) {
  const [loadedCams, setLoadedCams] = useState<Set<string>>(new Set());

  if (cams.length === 0) return null;

  const handleLoadCam = (id: string) => {
    setLoadedCams((prev) => new Set(prev).add(id));
  };

  const heroCam = cams[0];
  const secondaryCams = cams.slice(1);

  return (
    <section className="relative py-20 px-6 bg-gradient-to-br from-surface2 via-surface to-bg">
      {/* Background "LIVE FEEDS" watermark */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
        <span className="text-[12rem] md:text-[20rem] font-display text-text-base opacity-[0.03] select-none whitespace-nowrap">
          LIVE FEEDS
        </span>
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="mb-12 text-center">
          <h2 className="text-5xl md:text-6xl font-display text-text-base mb-4">
            LIVE FEEDS
          </h2>
          <p className="text-text-subtle text-lg">
            Real-time conditions from the mountain
          </p>
        </div>

        {/* Webcam Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Hero camera - full width */}
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
      className="group relative aspect-video rounded-lg overflow-hidden cursor-pointer border border-border hover:border-cyan/50 transition-all duration-slow"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -4 }}
    >
      {/* Loaded state: show actual embed */}
      {isLoaded && embedSrc && (
        <iframe
          src={embedSrc}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media"
          allowFullScreen
          title={cam.name}
        />
      )}

      {/* Unloaded overlay */}
      {!isLoaded && (
        <motion.div
          className="absolute inset-0 bg-surface/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <Camera className="text-text-subtle" size={isHero ? 64 : 48} />
          <div className="text-center">
            <h3 className="text-text-base text-2xl mb-2">{cam.name}</h3>
            {cam.elevation && (
              <div className="px-3 py-1 bg-text-base/10 border border-border-hi rounded-full text-text-subtle text-sm inline-block mb-4">
                {cam.elevation}
              </div>
            )}
          </div>
          <button
            onClick={onLoad}
            className="px-6 py-3 bg-cyan-dim hover:bg-cyan-mid border border-cyan/50 rounded-lg text-cyan font-semibold flex items-center gap-2 transition-colors duration-base"
          >
            <Play size={20} />
            LOAD LIVE FEED
          </button>
        </motion.div>
      )}

      {/* Live indicator on loaded cams */}
      {isLoaded && (
        <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-2 bg-surface/80 backdrop-blur-sm rounded-lg border-t-2 border-alpenglow">
          <div className="w-2 h-2 bg-alpenglow rounded-full animate-pulse-live" />
          <span className="text-text-base text-sm font-semibold">LIVE</span>
        </div>
      )}
    </motion.div>
  );
}
