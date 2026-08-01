import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: [],
  },
  async headers() {
    return [
      {
        // The Drop In iframe is deliberately not sandboxed. Keep CORS permissive
        // for the public static engine assets during the v2 strangler migration;
        // this header is removed with engine.html once the iframe is retired.
        source: "/drop-in/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          // Belt and braces with engine.html's own meta tag: the game is a
          // playable canvas, not a search result.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "peakcam.vercel.app" }],
        destination: "https://peakcam.io/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
