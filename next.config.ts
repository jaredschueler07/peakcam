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
      {
        // These files are committed precompressed. The browser fetch stack
        // transparently decodes Brotli only when the response declares it;
        // client DecompressionStream support is not portable for Brotli.
        source: "/game/terrain/:slug.height.u16.br",
        headers: [
          { key: "Content-Encoding", value: "br" },
          { key: "Content-Type", value: "application/octet-stream" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
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
