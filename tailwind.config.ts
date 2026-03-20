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
        display: ['"Bebas Neue"', "sans-serif"],
        heading: ["Inter", "system-ui", "sans-serif"],
        sans:    ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono:    ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
      colors: {
        // ── Summit Light base palette ──
        bg:          "#080D14",
        surface:     "#0E1825",
        surface2:    "#0D1F35",
        surface3:    "#1A2840",
        border:      "rgba(232, 240, 248, 0.1)",
        "border-hi": "rgba(232, 240, 248, 0.2)",

        // ── Primary accent: Ice Blue ──
        cyan: {
          DEFAULT: "#60C8FF",
          dim:     "rgba(96, 200, 255, 0.1)",
          mid:     "rgba(96, 200, 255, 0.2)",
        },

        // ── Secondary accent: Alpenglow ──
        alpenglow: {
          DEFAULT: "#FF7B5E",
          dim:     "rgba(255, 123, 94, 0.15)",
        },

        // ── Conditions palette ──
        powder:  "#2ECC8F",
        good:    "#60C8FF",
        fair:    "#8AA3BE",
        poor:    "#f87171",

        // ── Snow data ──
        snow: {
          DEFAULT: "#60C8FF",
          dim:     "rgba(96, 200, 255, 0.08)",
        },

        // ── Semantic ──
        success: "#2ECC8F",
        warning: "#FBBF24",
        danger:  "#FF7B5E",

        // ── Text hierarchy (snow light) ──
        "text-base":   "#E8F0F8",
        "text-subtle": "#8AA3BE",
        "text-muted":  "#4A6480",
      },
      borderRadius: {
        sm:      "4px",
        DEFAULT: "8px",
        lg:      "12px",
        xl:      "16px",
      },
      transitionDuration: {
        fast: "100ms",
        base: "200ms",
        slow: "300ms",
      },
      boxShadow: {
        "card-hover": "0 8px 30px rgba(0,0,0,0.5)",
        "card-lift":  "0 12px 40px rgba(0,0,0,0.6)",
        "glow-ice":   "0 0 40px rgba(96, 200, 255, 0.3)",
        "glow-alpen": "0 0 30px rgba(255, 123, 94, 0.2)",
      },
      backgroundImage: {
        "hero-gradient": "linear-gradient(180deg, #0D1F35 0%, #0A1628 50%, #080D14 100%)",
        "noise": `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      },
      keyframes: {
        "shimmer": {
          "0%": { backgroundPosition: "0% 0%" },
          "100%": { backgroundPosition: "100% 100%" },
        },
        "ticker": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "pulse-live": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
      },
      animation: {
        "shimmer": "shimmer 3s linear infinite",
        "ticker": "ticker 20s linear infinite",
        "pulse-live": "pulse-live 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
