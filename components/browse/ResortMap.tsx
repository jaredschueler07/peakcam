"use client";

/**
 * ResortMap — Leaflet map for the Browse page sidebar.
 *
 * Dynamically imported with { ssr: false } — Leaflet requires window/document.
 * Carto dark-matter tiles match our midnight navy theme.
 */

import { useEffect, useRef } from "react";
import type { ResortWithData } from "@/lib/types";

interface Props {
  resorts: ResortWithData[];
  hoveredSlug: string | null;
  onResortHover: (slug: string | null) => void;
}

// ─── Colour helper ───────────────────────────────────────────────────────────
function markerColor(resort: ResortWithData): string {
  const snow = resort.snow_report;
  if (!snow) return "#64748B"; // slate — no data
  const depth = snow.base_depth ?? 0;
  if (depth >= 60) return "#22D3EE"; // cyan — great
  if (depth >= 30) return "#BAE6FD"; // powder blue — good
  if (depth >= 10) return "#7DD3FC"; // sky — fair
  return "#94A3B8"; // muted slate — thin
}

export default function ResortMap({ resorts, hoveredSlug, onResortHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());

  // ── Init map ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require("leaflet");

    const map = L.map(containerRef.current, {
      center: [41.5, -108],
      zoom: 4,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }
    ).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // ── Sync markers when resorts change ──────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require("leaflet");
    const map = mapRef.current;
    const existing = markersRef.current;

    // Remove markers no longer in filtered list
    const slugSet = new Set(resorts.map((r) => r.slug));
    for (const [slug, marker] of existing) {
      if (!slugSet.has(slug)) {
        marker.remove();
        existing.delete(slug);
      }
    }

    // Add / update markers
    for (const resort of resorts) {
      if (!resort.lat || !resort.lng) continue;

      const color = markerColor(resort);
      const isHovered = resort.slug === hoveredSlug;

      const icon = L.divIcon({
        className: "",
        html: `
          <div style="
            width: ${isHovered ? 14 : 10}px;
            height: ${isHovered ? 14 : 10}px;
            background: ${color};
            border: 2px solid ${isHovered ? "#fff" : "rgba(255,255,255,0.3)"};
            border-radius: 50%;
            box-shadow: 0 0 ${isHovered ? "8px" : "3px"} ${color}aa;
            transition: all 0.2s ease;
            cursor: pointer;
          "></div>`,
        iconSize: [isHovered ? 14 : 10, isHovered ? 14 : 10],
        iconAnchor: [isHovered ? 7 : 5, isHovered ? 7 : 5],
      });

      if (existing.has(resort.slug)) {
        existing.get(resort.slug).setIcon(icon);
      } else {
        const marker = L.marker([resort.lat, resort.lng], { icon })
          .addTo(map)
          .bindTooltip(
            `<strong style="color:#22D3EE">${resort.name}</strong><br/>
             <span style="color:#94A3B8;font-size:11px">${resort.region}</span>
             ${resort.snow_report?.base_depth != null
               ? `<br/><span style="color:#BAE6FD;font-size:12px">⛄ ${resort.snow_report.base_depth}″ base</span>`
               : ""}`,
            {
              direction: "top",
              offset: [0, -6],
              className: "peakcam-tooltip",
            }
          )
          .on("mouseover", () => onResortHover(resort.slug))
          .on("mouseout", () => onResortHover(null))
          .on("click", () => {
            window.location.href = `/resorts/${resort.slug}`;
          });
        existing.set(resort.slug, marker);
      }
    }
  }, [resorts, hoveredSlug, onResortHover]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: "#070B11" }}
    />
  );
}
