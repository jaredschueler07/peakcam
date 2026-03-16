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
        heading: ["Barlow Condensed", "sans-serif"],
        sans: ["DM Sans", "Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      colors: {
        // ── Base palette (warm charcoal) ──
        bg:          "#0c0c0e",
        surface:     "#161618",
        surface2:    "#1e1e20",
        surface3:    "#282828",
        border:      "#2a2826",
        "border-hi": "#3d3a36",

        // ── Brand accent: burnt amber ──
        cyan: {
          DEFAULT: "#e08a3a",
          dim:     "#2a1f14",
          mid:     "#3d2a18",
        },

        // ── Conditions palette ──
        powder:  "#f5c542",
        good:    "#4ade80",
        fair:    "#fbbf24",
        poor:    "#f87171",

        // ── Snow data ──
        snow: {
          DEFAULT: "#f5c542",
          dim:     "#2a2210",
        },

        // ── Semantic ──
        success: "#34D399",
        warning: "#FBBF24",
        danger:  "#F87171",

        // ── Text hierarchy ──
        "text-base":   "#e8e6e3",
        "text-subtle": "#a8a4a0",
        "text-muted":  "#7a7775",
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
        "card-hover": "0 4px 20px rgba(0,0,0,0.5)",
        "card-lift":  "0 8px 30px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "hero-gradient": "linear-gradient(180deg, #1e1e20 0%, #0c0c0e 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
