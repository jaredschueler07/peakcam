import type { Metadata } from "next";
import "./globals.css";
import { PostHogProvider } from "@/lib/posthog";
import { MetaPixel } from "@/lib/meta-pixel";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const BASE_URL = "https://peakcam.io";

export const metadata: Metadata = {
  title: {
    default: "PeakCam — Live Mountain Cams & Snow Reports",
    template: "%s | PeakCam",
  },
  description:
    "Live cams, snow reports, and weather forecasts for ski resorts across North America. " +
    "Browse 128 resorts on an interactive map.",
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
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "PeakCam",
    title: "PeakCam — Live Mountain Cams & Snow Reports",
    description: "Browse live cams and snow conditions for 128 North American ski resorts.",
  },
  twitter: {
    card: "summary_large_image",
    title: "PeakCam — Live Mountain Cams",
    description: "Browse live cams and snow conditions for 128 North American ski resorts.",
  },
  robots: { index: true, follow: true },
  verification: {
    google: 'WxEYSVb48l8MEVfSy2aRBYcwIxq1hq2djwwO6UcL_Q8',
  },
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
        <a href="#main-content"
           className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100]
                      focus:px-4 focus:py-2 focus:bg-cyan focus:text-bg focus:rounded-lg focus:text-sm focus:font-semibold">
          Skip to main content
        </a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />
        <PostHogProvider>{children}</PostHogProvider>
        <MetaPixel />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
