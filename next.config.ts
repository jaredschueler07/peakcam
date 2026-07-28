import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: [],
  },
  async headers() {
    return [
      {
        // Drop In's engine runs in an iframe sandboxed without allow-same-origin,
        // so its document has an opaque origin. Module scripts are always fetched
        // in CORS mode — which means the engine's own `import('./three.module.js')`,
        // a relative import of a file sitting beside it, reaches the server as a
        // cross-origin request with `Origin: null` and is blocked without this.
        // Both files are public static assets, so `*` gives nothing away.
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
