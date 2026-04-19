import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Fraunces for display headings/stats
        display: ["var(--font-fraunces)", "Recoleta", "Georgia", "serif"],
        heading: ["var(--font-fraunces)", "Recoleta", "Georgia", "serif"],
        // DM Sans body text
        sans:    ["var(--font-dm-sans)", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        // JetBrains Mono readouts
        mono:    ["var(--font-jetbrains)", '"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      colors: {
        // ── PeakCam earth + snow palette ──
        // Paper / cream
        cream: {
          50:      "#faf4e6",
          DEFAULT: "#f1e7cf",
          dk:      "#e3d5b2",
        },

        // Bark (browns)
        bark: {
          50:      "#b59b74",
          DEFAULT: "#7a5a3a",
          dk:      "#4a3620",
        },

        // Ink (body text, stamps)
        ink: "#2a1f14",

        // Forest (primary)
        forest: {
          50:      "#8aa37a",
          DEFAULT: "#3c5a3a",
          dk:      "#1f3322",
        },

        // Sky / snow
        sky: {
          DEFAULT: "#c9d9d6",
          dk:      "#6c8a88",
        },
        snow: "#ffffff",

        // Alpenglow (persimmon accent)
        alpen: {
          DEFAULT: "#d9552f",
          dk:      "#a93f20",
        },
        mustard: "#e2a740",

        // ── Back-compat alias for alpenglow ──
        alpenglow: {
          DEFAULT: "#d9552f",
          dim:     "rgba(217, 85, 47, 0.15)",
        },

        // ── Condition semantics ──
        great:  "#3c5a3a",   // forest
        good:   "#6d8a4a",   // moss
        fair:   "#e2a740",   // mustard
        poor:   "#a93f20",   // alpen-dk
        powder: "#3c5a3a",   // alias for condition 'great'

        // ── Semantic ──
        success: "#3c5a3a",
        warning: "#e2a740",
        danger:  "#a93f20",

        // ── Legacy/back-compat surfaces remapped to paper ──
        bg:          "#f1e7cf",   // cream
        surface:     "#faf4e6",   // cream-50
        surface2:    "#e3d5b2",   // cream-dk
        surface3:    "#c9b896",   // deeper cream
        border:      "rgba(42, 31, 20, 0.15)",
        "border-hi": "rgba(42, 31, 20, 0.3)",

        // Text hierarchy — ink → bark → bark-50
        "text-base":   "#2a1f14",
        "text-subtle": "#4a3620",
        "text-muted":  "#7a5a3a",

        // ── Legacy cyan remapped to forest for any stragglers ──
        cyan: {
          DEFAULT: "#3c5a3a",
          dim:     "rgba(60, 90, 58, 0.1)",
          mid:     "rgba(60, 90, 58, 0.2)",
        },
      },
      borderRadius: {
        sm:      "4px",
        DEFAULT: "10px",
        md:      "10px",
        lg:      "18px",
        xl:      "18px",
        pill:    "999px",
      },
      transitionDuration: {
        fast: "100ms",
        base: "220ms",
        slow: "300ms",
      },
      boxShadow: {
        // Signature stamp shadows
        stamp:       "3px 3px 0 #2a1f14",
        "stamp-sm":  "2px 2px 0 #2a1f14",
        "stamp-lg":  "6px 6px 0 #2a1f14",
        "stamp-hover": "4px 4px 0 #2a1f14",
        "stamp-alpen":  "3px 3px 0 #a93f20",
        "stamp-forest": "3px 3px 0 #1f3322",

        // Soft lifted
        soft:        "0 8px 24px -12px rgba(42,31,20,0.35)",
        "card-hover":"0 10px 30px -12px rgba(42,31,20,0.35)",
        "card-lift": "0 14px 40px -14px rgba(42,31,20,0.45)",

        // Glows (toned down for paper)
        "glow-ice":   "0 0 30px rgba(60, 90, 58, 0.25)",
        "glow-alpen": "0 0 24px rgba(217, 85, 47, 0.25)",
      },
      backgroundImage: {
        // Paper hero — cream + soft radial warmth
        "hero-gradient":
          "radial-gradient(1200px 600px at 10% -10%, rgba(217,85,47,.08), transparent 60%), radial-gradient(900px 500px at 110% 10%, rgba(60,90,58,.10), transparent 60%), linear-gradient(180deg, #faf4e6 0%, #f1e7cf 100%)",

        // Topo contour-line pattern
        "topo":
          "repeating-radial-gradient(ellipse 120% 80% at 50% 100%, transparent 0 22px, rgba(74,54,32,.11) 22px 23px)",

        // Paper grain noise
        "noise":
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .16  0 0 0 0 .12  0 0 0 0 .08  0 0 0 .18 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
      },
      keyframes: {
        shimmer: {
          "0%":   { backgroundPosition: "0% 0%" },
          "100%": { backgroundPosition: "100% 100%" },
        },
        ticker: {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "pulse-live": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.3" },
        },
        "slide-up": {
          "0%":   { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
      },
      animation: {
        "shimmer":     "shimmer 3s linear infinite",
        "ticker":      "ticker 20s linear infinite",
        "pulse-live":  "pulse-live 2s ease-in-out infinite",
        "slide-up":    "slide-up 300ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
