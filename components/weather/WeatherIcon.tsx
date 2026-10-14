"use client";

interface WeatherIconProps {
  condition: string;
  size?: number;
  className?: string;
}

export const CONDITION_LABELS: Record<string, string> = {
  "clear": "Clear",
  "partly-cloudy": "Partly Cloudy",
  "cloudy": "Cloudy",
  "fog": "Fog",
  "light-snow": "Light Snow",
  "heavy-snow": "Heavy Snow",
  "blizzard": "Blizzard",
  "rain": "Rain",
  "freezing-rain": "Freezing Rain",
  "mixed": "Mixed",
  "wind": "Wind",
  "cold": "Cold",
};

const STROKE = "#E8E8E8";
const CYAN = "#22D3EE";

export default function WeatherIcon({
  condition,
  size = 24,
  className,
}: WeatherIconProps) {
  const sw = 1.5 * (size / 24); // scale strokeWidth proportionally

  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    className,
    "aria-label": CONDITION_LABELS[condition] ?? condition,
  };

  switch (condition) {
    case "clear":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4" stroke={STROKE} strokeWidth={sw} />
          {/* Radiating lines */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
            const rad = (angle * Math.PI) / 180;
            const x1 = 12 + 6 * Math.cos(rad);
            const y1 = 12 + 6 * Math.sin(rad);
            const x2 = 12 + 8 * Math.cos(rad);
            const y2 = 12 + 8 * Math.sin(rad);
            return (
              <line
                key={angle}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={STROKE} strokeWidth={sw} strokeLinecap="round"
              />
            );
          })}
        </svg>
      );

    case "partly-cloudy":
      return (
        <svg {...props}>
          {/* Sun behind */}
          <circle cx="15" cy="8" r="3.5" stroke={STROKE} strokeWidth={sw} />
          <line x1="15" y1="2" x2="15" y2="3.5" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" />
          <line x1="20" y1="5.5" x2="18.8" y2="6.4" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" />
          <line x1="20.5" y1="8" x2="19" y2="8" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" />
          {/* Cloud in front */}
          <path
            d="M6 18a3 3 0 0 1 0-6h1a4 4 0 0 1 7.8-1A3 3 0 0 1 17 14a3 3 0 0 1-1 5.8H6z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
        </svg>
      );

    case "cloudy":
      return (
        <svg {...props}>
          {/* Back cloud */}
          <path
            d="M8 14a2.5 2.5 0 0 1 0-5h.5a3.5 3.5 0 0 1 6.8-.5A2.5 2.5 0 0 1 17.5 11a2.5 2.5 0 0 1-.5 4.9H8z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round" opacity={0.5}
          />
          {/* Front cloud */}
          <path
            d="M5 20a3 3 0 0 1 0-6h.8a4 4 0 0 1 7.7-1A3 3 0 0 1 16 16a3 3 0 0 1-.8 5.9H5z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
        </svg>
      );

    case "fog":
      return (
        <svg {...props}>
          <line x1="4" y1="9" x2="20" y2="9" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" strokeDasharray="3 2" />
          <line x1="6" y1="13" x2="18" y2="13" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" strokeDasharray="3 2" />
          <line x1="4" y1="17" x2="20" y2="17" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" strokeDasharray="3 2" />
        </svg>
      );

    case "light-snow":
      return (
        <svg {...props}>
          {/* Cloud */}
          <path
            d="M5 13a3 3 0 0 1 0-6h.8a4 4 0 0 1 7.7-1A3 3 0 0 1 16 9a3 3 0 0 1-.8 4H5z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
          {/* Snowflakes */}
          <text x="7" y="19" fontSize="4" fill={CYAN}>✳</text>
          <text x="12" y="21" fontSize="4" fill={CYAN}>✳</text>
          <text x="16" y="18" fontSize="4" fill={CYAN}>✳</text>
        </svg>
      );

    case "heavy-snow":
      return (
        <svg {...props}>
          <path
            d="M5 11a3 3 0 0 1 0-6h.8a4 4 0 0 1 7.7-1A3 3 0 0 1 16 7a3 3 0 0 1-.8 4H5z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
          {/* Dense snowflakes */}
          <text x="5" y="17" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="9" y="19" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="13" y="16" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="16" y="19" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="7" y="22" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="14" y="22" fontSize="3.5" fill={CYAN}>✳</text>
        </svg>
      );

    case "blizzard":
      return (
        <svg {...props}>
          <path
            d="M5 10a3 3 0 0 1 0-6h.8a4 4 0 0 1 7.7-1A3 3 0 0 1 16 6a3 3 0 0 1-.8 4H5z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
          {/* Wind lines */}
          <line x1="3" y1="13" x2="9" y2="13" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
          <line x1="5" y1="15.5" x2="11" y2="15.5" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
          {/* Snowflakes */}
          <text x="12" y="14.5" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="16" y="17" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="13" y="19.5" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="18" y="14" fontSize="3.5" fill={CYAN}>✳</text>
          <text x="9" y="20" fontSize="3.5" fill={CYAN}>✳</text>
        </svg>
      );

    case "rain":
      return (
        <svg {...props}>
          <path
            d="M5 12a3 3 0 0 1 0-6h.8a4 4 0 0 1 7.7-1A3 3 0 0 1 16 8a3 3 0 0 1-.8 4H5z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
          {/* Rain lines */}
          <line x1="8" y1="15" x2="6" y2="20" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
          <line x1="12" y1="15" x2="10" y2="20" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
          <line x1="16" y1="15" x2="14" y2="20" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );

    case "freezing-rain":
      return (
        <svg {...props}>
          <path
            d="M5 12a3 3 0 0 1 0-6h.8a4 4 0 0 1 7.7-1A3 3 0 0 1 16 8a3 3 0 0 1-.8 4H5z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
          {/* Rain lines */}
          <line x1="7" y1="15" x2="5.5" y2="19" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
          <line x1="13" y1="15" x2="11.5" y2="19" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
          {/* Ice crystals */}
          <text x="9" y="20" fontSize="4" fill={CYAN}>◆</text>
          <text x="15" y="20" fontSize="4" fill={CYAN}>◆</text>
        </svg>
      );

    case "mixed":
      return (
        <svg {...props}>
          <path
            d="M5 12a3 3 0 0 1 0-6h.8a4 4 0 0 1 7.7-1A3 3 0 0 1 16 8a3 3 0 0 1-.8 4H5z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
          {/* Rain line */}
          <line x1="8" y1="15" x2="6" y2="20" stroke={CYAN} strokeWidth={sw} strokeLinecap="round" />
          {/* Snowflake */}
          <text x="13" y="20" fontSize="5" fill={CYAN}>✳</text>
        </svg>
      );

    case "wind":
      return (
        <svg {...props}>
          <path d="M3 8h10a2 2 0 1 0-2-2" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" fill="none" />
          <path d="M4 12h12a2.5 2.5 0 1 0-2.5-2.5" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" fill="none" />
          <path d="M3 16h8a2 2 0 1 1-2 2" stroke={STROKE} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );

    case "cold":
      return (
        <svg {...props}>
          {/* Thermometer body */}
          <rect x="10" y="3" width="4" height="14" rx="2" stroke={STROKE} strokeWidth={sw} />
          {/* Bulb */}
          <circle cx="12" cy="19" r="3" stroke={STROKE} strokeWidth={sw} />
          {/* Low fill */}
          <rect x="11" y="13" width="2" height="5" rx="1" fill={CYAN} />
          <circle cx="12" cy="19" r="1.8" fill={CYAN} />
        </svg>
      );

    default:
      // Fallback: partly-cloudy
      return (
        <svg {...props}>
          <path
            d="M6 18a3 3 0 0 1 0-6h1a4 4 0 0 1 7.8-1A3 3 0 0 1 17 14a3 3 0 0 1-1 5.8H6z"
            stroke={STROKE} strokeWidth={sw} strokeLinejoin="round"
          />
        </svg>
      );
  }
}
