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
        heading: ["Inter", "system-ui", "sans-serif"],
        sans:    ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono:    ["JetBrains Mono", "Fira Code", "monospace"],
      },
      colors: {
        // ── Base palette (alpine slate) ──
        bg:          "#0f172a",
        surface:     "#1e293b",
        surface2:    "#1e3a5f",
        surface3:    "#334155",
        border:      "#2d3f58",
        "border-hi": "#475569",

        // ── Brand accent: alpine blue ──
        cyan: {
          DEFAULT: "#3b82f6",
          dim:     "#172554",
          mid:     "#1e3a5f",
        },

        // ── Conditions palette ──
        powder:  "#38bdf8",
        good:    "#4ade80",
        fair:    "#fbbf24",
        poor:    "#f87171",

        // ── Snow data ──
        snow: {
          DEFAULT: "#38bdf8",
          dim:     "#0c2d48",
        },

        // ── Semantic ──
        success: "#34D399",
        warning: "#FBBF24",
        danger:  "#F87171",

        // ── Secondary accents ──
        summit:  "#f97316",
        forest:  "#22c55e",

        // ── Text hierarchy ──
        "text-base":   "#f8fafc",
        "text-subtle": "#94a3b8",
        "text-muted":  "#64748b",
      },
      borderRadius: {
        sm:      "6px",
        DEFAULT: "10px",
        lg:      "14px",
        xl:      "18px",
      },
      transitionDuration: {
        fast: "150ms",
        base: "220ms",
        slow: "300ms",
      },
      boxShadow: {
        "card-hover": "0 4px 20px rgba(0,0,0,0.4)",
        "card-lift":  "0 8px 30px rgba(0,0,0,0.5)",
        "glow-blue":  "0 0 24px rgba(59,130,246,0.15)",
      },
      backgroundImage: {
        "hero-gradient": "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
