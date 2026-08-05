import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PeakCam — Live Mountain Cams & Snow Reports",
    short_name: "PeakCam",
    description:
      "Live cams, snow reports, and weather forecasts for ski resorts across North & South America.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1e7cf",
    theme_color: "#2a1f14",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
