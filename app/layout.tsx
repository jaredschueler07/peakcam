import type { Metadata } from "next";
import "./globals.css";
import { PostHogProvider } from "@/lib/posthog";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const BASE_URL = "https://peakcam.co";

export const metadata: Metadata = {
  title: {
    default: "PeakCam — Live Mountain Cams & Snow Reports",
    template: "%s | PeakCam",
  },
  description:
    "Live cams, snow reports, and weather forecasts for ski resorts across North America. " +
    "Browse 75+ resorts on an interactive map.",
  keywords: [
    "ski cams",
    "live mountain cams",
    "ski resort conditions",
    "snow report",
    "skiing",
    "live webcam ski resort",
    "powder day",
    "ski resort weather",
    "trail conditions",
  ],
  metadataBase: new URL(BASE_URL),
  openGraph: {
    type: "website",
    siteName: "PeakCam",
    title: "PeakCam — Live Mountain Cams & Snow Reports",
    description: "Browse live cams and snow conditions for 75+ North American ski resorts.",
  },
  twitter: {
    card: "summary_large_image",
    title: "PeakCam — Live Mountain Cams",
    description: "Browse live cams and snow conditions for 75+ North American ski resorts.",
  },
  robots: { index: true, follow: true },
};

const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "PeakCam",
  url: BASE_URL,
  logo: `${BASE_URL}/icon.png`,
  sameAs: [],
};

const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "PeakCam",
  url: BASE_URL,
  description: "Live webcams, snow reports, and weather forecasts for ski resorts across North America.",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${BASE_URL}/?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />
        <PostHogProvider>{children}</PostHogProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
