"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ConditionBadge } from "@/components/ui/Badge";
import type { ResortWithData, WeatherPeriod, LiveConditions, Cam, UserCondition } from "@/lib/types";
import { ConditionVoter } from "@/components/resort/ConditionVoter";
import { UserConditionsForm } from "@/components/resort/UserConditionsForm";
import { UserConditionsList } from "@/components/resort/UserConditionsList";
import { trackResortView, trackCamClick } from "@/lib/posthog";

interface Props {
  resort: ResortWithData;
  weather: WeatherPeriod[] | null;
  liveConditions?: LiveConditions | null;
  userConditions?: UserCondition[];
}

// ─── Auto-refreshing image cam ───────────────────────────────────────────────

function ImageCam({ url, name }: { url: string; name: string }) {
  const [src, setSrc] = useState(url);

  useEffect(() => {
    const interval = setInterval(() => {
      const sep = url.includes("?") ? "&" : "?";
      setSrc(`${url}${sep}_t=${Date.now()}`);
    }, 30_000); // refresh every 30 seconds
    return () => clearInterval(interval);
  }, [url]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className="absolute inset-0 w-full h-full object-cover"
      loading="lazy"
    />
  );
}

// ─── Cam player ──────────────────────────────────────────────────────────────

function CamPlayer({ cam, resortSlug }: { cam: Cam; resortSlug: string }) {
  const [loaded, setLoaded] = useState(false);

  // Link-out cams — no embed available
  if (cam.embed_type === "link") {
    return (
      <a
        href={cam.embed_url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackCamClick(resortSlug, cam.name, cam.embed_type)}
        className="group flex flex-col items-center justify-center gap-3 bg-surface2 rounded-xl
                   border border-border hover:border-border-hi aspect-video
                   transition-all duration-220 hover:shadow-card-hover"
      >
        <div className="w-12 h-12 rounded-full bg-bg border border-border flex items-center justify-center
                        group-hover:border-cyan group-hover:text-cyan text-text-muted transition-all duration-220">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </div>
        <div className="text-center px-4">
          <p className="text-text-subtle text-sm font-medium group-hover:text-cyan transition-colors">
            {cam.name}
          </p>
          <p className="text-text-muted text-xs mt-0.5">Opens on resort website</p>
        </div>
      </a>
    );
  }

  // Image cams — auto-refreshing snapshot
  if (cam.embed_type === "image") {
    return (
      <div className="relative aspect-video bg-surface2 rounded-xl overflow-hidden border border-border">
        {!loaded ? (
          <button
            onClick={() => { setLoaded(true); trackCamClick(resortSlug, cam.name, cam.embed_type); }}
            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3
                       hover:bg-white/5 transition-colors group"
          >
            <div className="w-14 h-14 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center
                            group-hover:bg-cyan/20 group-hover:border-cyan transition-all duration-220">
              <svg className="w-6 h-6 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <div className="text-center px-4">
              <p className="text-text-subtle text-sm font-medium">{cam.name}</p>
              {cam.elevation && (
                <p className="text-text-muted text-xs mt-0.5">
                  {Number(cam.elevation).toLocaleString()}′ elevation
                </p>
              )}
              <p className="text-text-muted text-xs mt-1">Click to load snapshot</p>
            </div>
          </button>
        ) : (
          <ImageCam url={cam.embed_url ?? ""} name={cam.name} />
        )}
      </div>
    );
  }

  // YouTube + iframe — click-to-play
  const embedSrc =
    cam.embed_type === "youtube" && cam.youtube_id
      ? `https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`
      : cam.embed_url ?? "";

  return (
    <div className="relative aspect-video bg-surface2 rounded-xl overflow-hidden border border-border">
      {/* Placeholder until user clicks */}
      {!loaded && (
        <button
          onClick={() => { setLoaded(true); trackCamClick(resortSlug, cam.name, cam.embed_type); }}
          className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3
                     hover:bg-white/5 transition-colors group"
        >
          <div className="w-14 h-14 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center
                          group-hover:bg-cyan/20 group-hover:border-cyan transition-all duration-220">
            <svg className="w-6 h-6 text-cyan ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div className="text-center px-4">
            <p className="text-text-subtle text-sm font-medium">{cam.name}</p>
            {cam.elevation && (
              <p className="text-text-muted text-xs mt-0.5">
                {Number(cam.elevation).toLocaleString()}′ elevation
              </p>
            )}
            <p className="text-text-muted text-xs mt-1 flex items-center justify-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-[livePulse_2s_ease-in-out_infinite]" />
              Click to load live cam
            </p>
          </div>
        </button>
      )}

      {/* Actual embed */}
      {loaded && (
        <iframe
          src={embedSrc}
          title={cam.name}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full border-0"
        />
      )}
    </div>
  );
}

// ─── Weather strip ───────────────────────────────────────────────────────────

function WeatherStrip({ weather }: { weather: WeatherPeriod[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
      {weather.map((day, i) => (
        <div
          key={i}
          className={`shrink-0 flex flex-col items-center gap-1.5 rounded-xl px-4 py-3 border min-w-[72px]
            ${i === 0 ? "bg-surface2 border-border-hi" : "bg-surface border-border"}`}
        >
          <span className="text-text-muted text-[11px] font-medium">{day.dow}</span>
          <span className="text-xl">{day.icon}</span>
          <div className="text-center">
            <span className="text-text-base text-sm font-semibold">{day.high}°</span>
            {day.low != null && (
              <span className="text-text-muted text-xs"> / {day.low}°</span>
            )}
          </div>
          {day.snowInches > 0 && (
            <span className="text-powder text-[11px] font-medium">
              ⛄ {day.snowInches}″
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Conditions strip ────────────────────────────────────────────────────────

function ConditionsStrip({ resort }: { resort: ResortWithData }) {
  const snow = resort.snow_report;
  if (!snow) return null;

  const stats = [
    { label: "Base Depth", value: snow.base_depth != null ? `${snow.base_depth}″` : "—", color: "text-powder" },
    { label: "24h New Snow", value: snow.new_snow_24h != null ? `${snow.new_snow_24h}″` : "—", color: "text-cyan" },
    { label: "48h New Snow", value: snow.new_snow_48h != null ? `${snow.new_snow_48h}″` : "—", color: "text-text-subtle" },
    {
      label: "Trails Open",
      value: snow.trails_open != null ? `${snow.trails_open}${snow.trails_total ? `/${snow.trails_total}` : ""}` : "—",
      color: "text-text-base",
    },
    {
      label: "Lifts Open",
      value: snow.lifts_open != null ? `${snow.lifts_open}${snow.lifts_total ? `/${snow.lifts_total}` : ""}` : "—",
      color: "text-text-base",
    },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface border border-border rounded-xl px-4 py-3 min-w-[100px]">
          <div className={`text-2xl font-bold ${s.color} leading-none`}>{s.value}</div>
          <div className="text-text-muted text-xs mt-1">{s.label}</div>
        </div>
      ))}
      {snow.conditions && (
        <div className="bg-surface border border-border rounded-xl px-4 py-3">
          <div className="text-text-base text-sm font-semibold">{snow.conditions}</div>
          <div className="text-text-muted text-xs mt-1">Conditions</div>
        </div>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function ResortDetailPage({ resort, weather, liveConditions, userConditions = [] }: Props) {
  const activeCams = resort.cams.filter((c) => c.is_active);
  const snow = resort.snow_report;

  useEffect(() => {
    trackResortView(resort.name, resort.slug);
  }, [resort.name, resort.slug]);

  return (
    <div className="min-h-screen bg-bg">
      <Header showSearch={false} />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-b from-surface2 to-bg border-b border-border px-4 py-6 md:px-8 md:py-8">
        <div className="max-w-5xl mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-text-muted hover:text-cyan text-sm transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All Resorts
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-heading font-bold text-text-base uppercase tracking-wider leading-tight">
                {resort.name}
              </h1>
              <p className="text-text-muted text-sm mt-1.5">
                {resort.region} · {resort.state}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {resort.cond_rating && (
                <ConditionBadge
                  rating={resort.cond_rating}
                  label={resort.cond_rating.charAt(0).toUpperCase() + resort.cond_rating.slice(1)}
                />
              )}
              <div className="flex items-center gap-2">
                {resort.instagram_url && (
                  <a href={resort.instagram_url} target="_blank" rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan transition-colors" title="Instagram">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                    </svg>
                  </a>
                )}
                {resort.facebook_url && (
                  <a href={resort.facebook_url} target="_blank" rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan transition-colors" title="Facebook">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </a>
                )}
                {resort.x_url && (
                  <a href={resort.x_url} target="_blank" rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan transition-colors" title="X (Twitter)">
                    <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </a>
                )}
                {resort.website_url && (
                  <a
                    href={resort.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan text-sm border border-border hover:border-border-hi
                               rounded-lg px-3 py-1.5 transition-all duration-150"
                  >
                    Resort site ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 space-y-10">

        {/* Snow conditions */}
        {snow ? (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">Snow Report</h2>
              {resort.snotel_station_id && (
                <a
                  href={`https://www.nrcs.usda.gov/wps/portal/wcc/home/snowpackProfile?station=${resort.snotel_station_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted hover:text-cyan text-xs transition-colors"
                >
                  SNOTEL Source ↗
                </a>
              )}
            </div>
            <ConditionsStrip resort={resort} />
            <p className="text-text-muted text-xs mt-2">
              Updated {new Date(snow.updated_at).toLocaleDateString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })} · Source: {snow.source}
            </p>
          </section>
        ) : (
          <section>
            <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base mb-3">Snow Report</h2>
            <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
              No snow data available yet. Check back after the first SNOTEL sync.
            </div>
          </section>
        )}

        {/* Weather forecast */}
        {weather && weather.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">5-Day Forecast</h2>
              <a
                href={`https://forecast.weather.gov/MapClick.php?lat=${resort.lat}&lon=${resort.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-cyan text-xs transition-colors"
              >
                NWS Forecast ↗
              </a>
            </div>
            <WeatherStrip weather={weather} />
            <p className="text-text-muted text-xs mt-2">Via National Weather Service · Updated hourly</p>
          </section>
        ) : (
          <section>
             <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">5-Day Forecast</h2>
              <a
                href={`https://forecast.weather.gov/MapClick.php?lat=${resort.lat}&lon=${resort.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-cyan text-xs transition-colors"
              >
                NWS Forecast ↗
              </a>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
              Weather data temporarily unavailable.
            </div>
          </section>
        )}

        {/* Live cams */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">
              Live Cams
              <span className="ml-2 text-text-muted text-sm font-normal">
                {activeCams.length} available
              </span>
            </h2>
            {resort.cam_page_url && (
              <a
                href={resort.cam_page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-cyan text-xs transition-colors"
              >
                View all on resort site ↗
              </a>
            )}
          </div>

          {activeCams.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
              No cams indexed yet for this resort.{" "}
              {resort.cam_page_url && (
                <a href={resort.cam_page_url} target="_blank" rel="noopener noreferrer"
                  className="text-cyan hover:underline">
                  View on resort website ↗
                </a>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCams.map((cam) => (
                <div key={cam.id}>
                  <CamPlayer cam={cam} resortSlug={resort.slug} />
                  <p className="text-text-muted text-xs mt-1.5 px-1">
                    {cam.name}
                    {cam.elevation && (
                      <span className="ml-1.5 text-text-muted/60">
                        · {Number(cam.elevation).toLocaleString()}′
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* User-verified conditions (quick vote) */}
        <ConditionVoter resortId={resort.id} resortSlug={resort.slug} liveConditions={liveConditions ?? null} />

        {/* User conditions reports — submit + list */}
        <section>
          <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base mb-4">
            Conditions Reports
          </h2>
          <div className="space-y-4">
            <UserConditionsForm resortId={resort.id} resortSlug={resort.slug} />
            <UserConditionsList conditions={userConditions} />
          </div>
        </section>

        {/* Footer nav */}
        <div className="border-t border-border pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-text-muted hover:text-cyan text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to all resorts
          </Link>
        </div>

      </div>
    </div>
  );
}
