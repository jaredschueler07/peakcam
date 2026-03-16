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
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      colors: {
        // ── Base palette ──
        bg:        "#070B11",
        surface:   "#0C1220",
        surface2:  "#111928",
        surface3:  "#172035",
        border:    "#1E2D47",
        "border-hi": "#2A3F5F",

        // ── Brand accent: mountain sky ──
        cyan: {
          DEFAULT: "#22D3EE",
          dim:     "#0A2A35",
          mid:     "#0E3D4D",
        },

        // ── Conditions palette ──
        powder:  "#22D3EE", // epic/great
        good:    "#60A5FA",
        fair:    "#FBBF24",
        poor:    "#F87171",

        // ── Snow data ──
        snow: {
          DEFAULT: "#BAE6FD",
          dim:     "#0C2034",
        },

        // ── Semantic ──
        success: "#34D399",
        warning: "#FBBF24",
        danger:  "#F87171",
        purple:  "#A78BFA",

        // ── Text hierarchy ──
        "text-base":   "#F1F5F9",
        "text-subtle": "#94A3B8",
        "text-muted":  "#64748B",
      },
      borderRadius: {
        sm:  "6px",
        DEFAULT: "10px",
        lg:  "14px",
        xl:  "18px",
      },
      transitionDuration: {
        fast: "150ms",
        base: "220ms",
        slow: "300ms",
      },
      boxShadow: {
        "cyan-glow":  "0 0 20px rgba(34,211,238,0.15)",
        "card-hover": "0 8px 30px rgba(34,211,238,0.12), 0 2px 8px rgba(0,0,0,0.4)",
      },
      backgroundImage: {
        "hero-gradient": "linear-gradient(180deg, #111928 0%, #070B11 100%)",
        "cyan-gradient":  "linear-gradient(90deg, transparent, #22D3EE, #60A5FA, transparent)",
      },
    },
  },
  plugins: [],
};

export default config;
